import { useQuery, useMutation } from '@tanstack/react-query';
import { NIP98, type NostrEvent, type NostrSigner } from '@nostrify/nostrify';
import { useCurrentUser } from './useCurrentUser';
import { useNostr } from '@nostrify/react';
import { useToast } from './useToast';

export function useBlossomServers() {
  const { user } = useCurrentUser();
  const { nostr } = useNostr();

  return useQuery({
    queryKey: ['blossom-servers', user?.pubkey],
    enabled: !!user,
    queryFn: async ({ signal }) => {
      if (!user) throw new Error('Not logged in');
      
      // Query kind 10063 (User server list) for the user's pubkey
      const events = await nostr.query([{ kinds: [10063], authors: [user.pubkey], limit: 1 }], { signal });
      
      if (events.length === 0) {
        return [];
      }
      
      const latestEvent = events[0];
      // Extract server URLs from tags: ['server', 'https://...']
      const servers = latestEvent.tags
        .filter(tag => tag[0] === 'server' && tag[1])
        .map(tag => tag[1] as string);
      
      return servers;
    },
  });
}

export interface BlossomServerStats {
  totalUniqueBlobs: number;
  fullySyncedBlobs: number;
  serverStats: {
    url: string;
    presentCount: number;
    missingCount: number;
  }[];
}

export function useBlossomSyncStats() {
  const { data: servers = [] } = useBlossomServers();
  const { user } = useCurrentUser();

  return useQuery({
    queryKey: ['blossom-sync-stats', servers.join(','), user?.pubkey],
    enabled: !!user && servers.length > 0,
    queryFn: async () => {
      if (!user) throw new Error('Not logged in');

      const serverBlobs = new Map<string, Set<string>>();
      const totalKnownHashes = new Set<string>();

      for (const server of servers) {
        try {
          const blobs = await fetchBlobList(server, user.pubkey, user.signer);
          const hashes = new Set(blobs.map(b => b.sha256));
          serverBlobs.set(server, hashes);
          for (const h of hashes) totalKnownHashes.add(h);
        } catch (err) {
          console.warn(`[Blossom Stats] Failed to fetch inventory from ${server}.`, err);
          serverBlobs.set(server, new Set());
        }
      }

      const serverStats = servers.map(server => {
        const present = serverBlobs.get(server) || new Set();
        let missingCount = 0;
        for (const hash of totalKnownHashes) {
          if (!present.has(hash)) {
            missingCount++;
          }
        }
        return {
          url: server,
          presentCount: present.size,
          missingCount,
        };
      });

      // Blobs that are present on ALL servers
      let fullySyncedBlobs = 0;
      for (const hash of totalKnownHashes) {
        const isEverywhere = servers.every(server => serverBlobs.get(server)?.has(hash));
        if (isEverywhere) fullySyncedBlobs++;
      }

      return {
        totalUniqueBlobs: totalKnownHashes.size,
        fullySyncedBlobs,
        serverStats,
      } as BlossomServerStats;
    },
  });
}

export function useSyncBlossomBlobs() {
  const { user } = useCurrentUser();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async (servers: string[]) => {
      if (!user || !user.signer) throw new Error('Not logged in or no signer');
      if (servers.length < 2) throw new Error('Need at least 2 servers to sync');

      console.log(`[Blossom Sync] Starting bi-directional sync across ${servers.length} servers.`);

      // 0. Fetch server capabilities (NIP-96 support)
      console.log(`[Blossom Sync] Checking server capabilities...`);
      const serverCapabilities = new Map<string, ServerCapabilities>();
      for (const server of servers) {
        const caps = await getServerCapabilities(server);
        serverCapabilities.set(server, caps);
        if (caps.isNip96) {
          console.log(`[Blossom Sync] ${server} supports NIP-96.`);
        }
      }

      // 1. Build inventory of what exists on each server
      const serverBlobs = new Map<string, Set<string>>();
      const totalKnownHashes = new Set<string>();

      for (const server of servers) {
        try {
          console.log(`[Blossom Sync] Fetching inventory from ${server}...`);
          const blobs = await fetchBlobList(server, user.pubkey, user.signer);
          const hashes = new Set(blobs.map(b => b.sha256));
          serverBlobs.set(server, hashes);
          for (const h of hashes) totalKnownHashes.add(h);
          console.log(`[Blossom Sync] Found ${hashes.size} blobs on ${server}.`);
        } catch (err) {
          console.warn(`[Blossom Sync] Failed to fetch inventory from ${server}. Assuming it needs all blobs.`, err);
          serverBlobs.set(server, new Set()); // Treat as empty, so it gets synced
        }
      }

      console.log(`[Blossom Sync] Total unique blobs across all servers: ${totalKnownHashes.size}`);

      let successCount = 0;
      let errorCount = 0;
      let skipCount = 0;

      // 2. Determine sync plan and execute
      for (const hash of totalKnownHashes) {
        const shortHash = hash.slice(0, 8);
        const hasIt: string[] = [];
        const needsIt: string[] = [];

        for (const server of servers) {
          if (serverBlobs.get(server)?.has(hash)) {
            hasIt.push(server);
          } else {
            needsIt.push(server);
          }
        }

        if (needsIt.length === 0) {
          skipCount++;
          continue; // Already synced everywhere
        }

        try {
          // Download from the first available source
          const sourceServer = hasIt[0];
          console.log(`[Blossom Sync] Downloading ${shortHash}... from ${sourceServer} to sync to ${needsIt.length} server(s).`);
          const blobData = await downloadBlob(sourceServer, hash, user.pubkey, user.signer);
          
          if (!blobData) {
            console.error(`[Blossom Sync] CRITICAL: Failed to download ${shortHash}... from source ${sourceServer}.`);
            errorCount++;
            continue;
          }

          // 3. Cross-check SHA-256 before uploading
          const isValid = await verifyBlobSha256(blobData, hash);
          if (!isValid) {
            console.error(`[Blossom Sync] CRITICAL: SHA-256 mismatch for ${shortHash}...! Aborting upload to prevent corruption.`);
            errorCount++;
            continue;
          }
          
          console.log(`[Blossom Sync] Verified ${shortHash}... (${(blobData.size / 1024).toFixed(1)} KB). Syncing to missing servers...`);
          
          const sourceBlobUrl = `${sourceServer.replace(/\/$/, '')}/${hash}`;

          // Process target servers concurrently for this blob to improve performance
          const uploadPromises = needsIt.map(async (targetServer) => {
            console.log(`[Blossom Sync] Attempting BUD-04 mirror of ${shortHash}... to ${targetServer}`);
            
            const mirrored = await mirrorBlob(targetServer, sourceBlobUrl, hash, user.signer);
            
            if (mirrored) {
              console.log(`[Blossom Sync] Mirrored ${shortHash}... to ${targetServer} successfully.`);
              return true;
            }

            // Fallback to download/upload if mirroring is unsupported or failed
            console.log(`[Blossom Sync] Mirroring failed or unsupported. Falling back to upload for ${shortHash}... to ${targetServer}`);
            const caps = serverCapabilities.get(targetServer);
            const uploaded = await uploadBlob(targetServer, blobData, hash, user.signer, caps?.nip96Config || undefined);
            
            if (uploaded) {
              console.log(`[Blossom Sync] Uploaded ${shortHash}... to ${targetServer} successfully (fallback).`);
              return true;
            } else {
              console.warn(`[Blossom Sync] Failed to upload ${shortHash}... to ${targetServer} (fallback).`);
              return false;
            }
          });

          const results = await Promise.all(uploadPromises);
          const serverUploadSuccess = results.every(r => r);
          
          if (serverUploadSuccess) {
            successCount++;
          } else {
            errorCount++;
          }
        } catch (err) {
          console.error(`[Blossom Sync] Failed to process blob ${shortHash}...:`, err);
          errorCount++;
        }
      }

      console.log(`[Blossom Sync] Bi-directional sync complete. Synced: ${successCount}, Skipped (already present): ${skipCount}, Errors: ${errorCount}`);
      return { successCount, errorCount, skipCount, total: totalKnownHashes.size };
    },
    onSuccess: (data) => {
      toast({
        title: "Blossom Sync Complete",
        description: `Synced ${data.successCount} blobs. Skipped ${data.skipCount} (already present). ${data.errorCount} failed.`,
      });
    },
    onError: (error) => {
      toast({
        title: "Blossom Sync Failed",
        description: error instanceof Error ? error.message : "An unknown error occurred",
        variant: "destructive",
      });
    }
  });
}

async function getBlossomAuthHeader(
  action: 'get' | 'upload' | 'list' | 'delete' | 'mirror', 
  sha256: string | undefined, 
  signer: NostrSigner
): Promise<string> {
  const expiration = Math.floor(Date.now() / 1000) + 300; // 5 minutes
  const tags: string[][] = [
    ['t', action],
    ['expiration', expiration.toString()]
  ];
  
  if (sha256) {
    tags.push(['x', sha256]);
  }

  const event: Omit<NostrEvent, 'id' | 'pubkey' | 'sig'> = {
    kind: 24242,
    created_at: Math.floor(Date.now() / 1000),
    tags,
    content: '',
  };

  const signedEvent = await signer.signEvent(event);
  return `Nostr ${btoa(JSON.stringify(signedEvent))}`;
}

async function getNIP98AuthHeader(url: string, method: 'GET' | 'PUT' | 'POST', signer: NostrSigner): Promise<string> {
  const request = new Request(url, { method });
  const template = await NIP98.template(request, { validatePayload: false });
  const event = await signer.signEvent(template);
  return `Nostr ${btoa(JSON.stringify(event))}`;
}

interface ServerCapabilities {
  isBlossom: boolean;
  isNip96: boolean;
  nip96Config: Record<string, unknown> | null;
}

async function getServerCapabilities(serverUrl: string): Promise<ServerCapabilities> {
  let isNip96 = false;
  let nip96Config: Record<string, unknown> | null = null;

  // 1. Check NIP-96
  try {
    const wellKnownUrl = new URL('/.well-known/nostr/nip96.json', serverUrl).toString();
    const res = await fetch(wellKnownUrl);
    if (res.ok) {
      const config = (await res.json()) as Record<string, unknown>;
      if (typeof config.api_url === 'string') {
        isNip96 = true;
        nip96Config = config;
      }
    }
  } catch {
    // Ignore errors, server likely doesn't support NIP-96
  }

  // 2. Check Blossom root endpoint (response agnostic) for validation/logging
  try {
    const rootUrl = new URL('/', serverUrl).toString();
    const res = await fetch(rootUrl);
    if (res.ok) {
      const text = await res.text();
      let confirmed = false;
      
      // Check plain text responses (e.g., "Welcome to Primal Blossom server...")
      if (text.toLowerCase().includes('blossom') || text.includes('BUD-')) {
        confirmed = true;
      } else {
        // Check JSON responses (e.g., {"name": "Azzamo", "protocols": ["BUD-01", ...]})
        try {
          const json = JSON.parse(text);
          if (json.protocols && Array.isArray(json.protocols) && json.protocols.some((p: string) => p.startsWith('BUD-'))) {
            confirmed = true;
          }
        } catch {
          // Not JSON, already checked text
        }
      }
      
      if (!confirmed) {
        console.warn(`[Blossom Sync] Server ${serverUrl} root response did not clearly identify as a Blossom server, but will attempt anyway.`);
      }
    }
  } catch (err) {
    console.warn(`[Blossom Sync] Could not reach root of ${serverUrl} for capability discovery.`, err);
  }

  // We assume isBlossom is true since it's from the user's 10063 list, 
  // the root check above is primarily for logging/validation.
  return { isBlossom: true, isNip96, nip96Config };
}

async function verifyBlobSha256(blob: Blob, expectedHash: string): Promise<boolean> {
  try {
    const buffer = await blob.arrayBuffer();
    const hashBuffer = await crypto.subtle.digest('SHA-256', buffer);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
    return hashHex.toLowerCase() === expectedHash.toLowerCase();
  } catch (err) {
    console.error('[Blossom Sync] Failed to compute SHA-256 for verification:', err);
    return false;
  }
}

async function fetchBlobList(serverUrl: string, pubkey: string, signer: NostrSigner): Promise<{ sha256: string; size?: number }[]> {
  const baseUrl = serverUrl.replace(/\/$/, '');
  const url = `${baseUrl}/list/${pubkey}`;
  
  let authHeader = await getBlossomAuthHeader('list', undefined, signer);
  let res = await fetch(url, {
    method: 'GET',
    headers: { 'Authorization': authHeader }
  });
  
  // Fallback to NIP-98 if the server rejects the Kind 24242 auth
  if (res.status === 401) {
    authHeader = await getNIP98AuthHeader(url, 'GET', signer);
    res = await fetch(url, {
      method: 'GET',
      headers: { 'Authorization': authHeader }
    });
  }
  
  try {
    if (res.status === 404) {
      console.warn(`[Blossom Sync] List endpoint not found or empty for ${pubkey} on ${serverUrl}.`);
      return [];
    }
    
    if (!res.ok) {
      throw new Error(`Failed to fetch blob list: ${res.status} ${res.statusText}`);
    }
    
    const data = await res.json() as { sha256: string; size?: number }[];
    return Array.isArray(data) ? data : [];
  } catch (err) {
    if (err instanceof TypeError) {
      console.warn(`[Blossom Sync] Network/CORS error fetching list from ${serverUrl}. Skipping.`);
      return [];
    }
    throw err;
  }
}

export async function downloadBlob(serverUrl: string, sha256: string, pubkey: string, signer: NostrSigner): Promise<Blob | null> {
  const baseUrl = serverUrl.replace(/\/$/, '');
  const url = `${baseUrl}/${sha256}`;
  
  try {
    let authHeader = await getBlossomAuthHeader('get', sha256, signer);
    let res = await fetch(url, {
      method: 'GET',
      headers: { 'Authorization': authHeader }
    });
    
    // Fallback to NIP-98 if the server rejects the Kind 24242 auth
    if (res.status === 401) {
      authHeader = await getNIP98AuthHeader(url, 'GET', signer);
      res = await fetch(url, {
        method: 'GET',
        headers: { 'Authorization': authHeader }
      });
    }
    
    if (res.status === 404) {
      console.warn(`[Blossom Sync] Blob ${sha256.slice(0, 8)}... not found on ${serverUrl}. Skipping.`);
      return null;
    }
    
    if (!res.ok) {
      throw new Error(`Failed to download blob ${sha256.slice(0, 8)}...: ${res.status} ${res.statusText}`);
    }
    
    return await res.blob();
  } catch (err) {
    if (err instanceof TypeError) {
      console.warn(`[Blossom Sync] Network/CORS error fetching ${sha256.slice(0, 8)}... from ${serverUrl}. The blob may be missing or the server rejected the request. Skipping.`);
      return null;
    }
    throw err;
  }
}

async function mirrorBlob(
  targetServerUrl: string,
  sourceUrl: string,
  sha256: string,
  signer: NostrSigner
): Promise<boolean> {
  const baseUrl = targetServerUrl.replace(/\/$/, '');
  const mirrorUrl = `${baseUrl}/mirror`;
  const shortHash = sha256.slice(0, 8);

  try {
    const authHeader = await getBlossomAuthHeader('mirror', sha256, signer);
    const mirrorPayload = JSON.stringify({ url: sourceUrl });

    const attemptMirror = async (auth: string) => {
      return fetch(mirrorUrl, {
        method: 'PUT',
        headers: {
          'Authorization': auth,
          'Content-Type': 'application/json'
        },
        body: mirrorPayload
      });
    };

    let res = await attemptMirror(authHeader);

    // Fallback to NIP-98 if 401
    if (res.status === 401) {
      const nip98Auth = await getNIP98AuthHeader(mirrorUrl, 'PUT', signer);
      res = await attemptMirror(nip98Auth);
    }

    if (res.ok) {
      console.log(`[Blossom Sync] Successfully mirrored ${shortHash}... to ${targetServerUrl}`);
      return true;
    }

    // If the server doesn't support mirroring (404/405), return false to trigger fallback
    if (res.status === 404 || res.status === 405) {
      console.log(`[Blossom Sync] Server ${targetServerUrl} does not support BUD-04 mirroring. Falling back to download/upload.`);
      return false;
    }

    const text = await res.text().catch(() => '');
    console.warn(`[Blossom Sync] Mirror request failed for ${shortHash}... to ${targetServerUrl}: ${res.status} ${text}`);
    return false;

  } catch (err) {
    if (err instanceof TypeError) {
      console.warn(`[Blossom Sync] Network error attempting mirror for ${shortHash}... to ${targetServerUrl}. Falling back.`);
      return false;
    }
    throw err;
  }
}

export async function uploadBlob(
  serverUrl: string, 
  blob: Blob, 
  sha256: string, 
  signer: NostrSigner,
  nip96Config?: Record<string, unknown>
): Promise<boolean> {
  const baseUrl = serverUrl.replace(/\/$/, '');
  const blossomUrl = `${baseUrl}/upload`;
  const shortHash = sha256.slice(0, 8);

  // Helper to attempt a Blossom PUT upload
  const attemptBlossomUpload = async (useNip98: boolean): Promise<Response> => {
    const authHeader = useNip98 
      ? await getNIP98AuthHeader(blossomUrl, 'PUT', signer)
      : await getBlossomAuthHeader('upload', sha256, signer);
    
    return fetch(blossomUrl, {
      method: 'PUT',
      headers: { 
        'Authorization': authHeader,
        'Content-Type': blob.type || 'application/octet-stream',
        'X-SHA-256': sha256
      },
      body: blob
    });
  };

  // 0. BUD-06 Pre-validation (Fail fast for size/type limits before uploading)
  try {
    const headRes = await fetch(blossomUrl, {
      method: 'HEAD',
      headers: {
        'Content-Type': blob.type || 'application/octet-stream',
        'Content-Length': blob.size.toString(),
        'X-SHA-256': sha256
      }
    });
    
    if (headRes.status === 413) {
      console.warn(`[Blossom Sync] Pre-validation failed for ${shortHash}...: File size (${(blob.size / 1024 / 1024).toFixed(2)} MB) exceeds server limit.`);
      return false;
    }
    if (headRes.status === 415) {
      console.warn(`[Blossom Sync] Pre-validation failed for ${shortHash}...: Media type '${blob.type}' is not accepted by this server.`);
      return false;
    }
    if (headRes.status >= 400 && headRes.status < 500 && headRes.status !== 401) {
      console.warn(`[Blossom Sync] Pre-validation failed for ${shortHash}...: Server returned ${headRes.status}.`);
      return false;
    }
  } catch (err) {
    // If HEAD fails (e.g., CORS or network), we still attempt the PUT as a fallback
    console.warn(`[Blossom Sync] BUD-06 HEAD pre-check failed for ${shortHash}..., attempting PUT anyway.`, err);
  }

  // 1. Try Blossom BUD-02/BUD-11 (with 1 retry for transient 5xx errors)
  let res = await attemptBlossomUpload(false);
  
  if (res.status === 401) {
    res = await attemptBlossomUpload(true); // Fallback to NIP-98
  }

  // Retry logic for transient gateway errors (502, 503, 504)
  if (res.status >= 500 && res.status < 600) {
    console.warn(`[Blossom Sync] Transient server error (${res.status}) for ${shortHash}... Retrying once...`);
    await new Promise(resolve => setTimeout(resolve, 1500)); // 1.5s backoff
    res = await attemptBlossomUpload(res.status === 401); 
  }
  
  if (res.ok) {
    return true;
  }

  // 2. If Blossom failed and we have NIP-96 config, try NIP-96
  if (nip96Config && typeof nip96Config.api_url === 'string') {
    console.log(`[Blossom Sync] Blossom upload failed, trying NIP-96 fallback for ${shortHash}...`);
    const apiUrl = nip96Config.api_url;
    const nip96Url = apiUrl.startsWith('http') ? apiUrl : new URL(apiUrl, baseUrl).toString();
    
    const nip98Auth = await getNIP98AuthHeader(nip96Url, 'POST', signer);
    const formData = new FormData();
    formData.append('file', blob);
    
    const nip96Res = await fetch(nip96Url, {
      method: 'POST',
      headers: {
        'Authorization': nip98Auth,
      },
      body: formData
    });
    
    if (nip96Res.ok) {
      console.log(`[Blossom Sync] Successfully uploaded via NIP-96 to ${nip96Url}`);
      return true;
    }
    
    await nip96Res.text().catch(() => ''); // Consume body to free resources
    console.warn(`[Blossom Sync] NIP-96 Upload also failed to ${nip96Url}: ${nip96Res.status}`);
  }
  
  const finalText = await res.text().catch(() => '');
  const errorMsg = res.status >= 500 
    ? `Gateway/Server error (${res.status}). The server may be overloaded or have strict timeout limits for large files.`
    : finalText;
    
  console.warn(`[Blossom Sync] Upload permanently failed for ${shortHash}... to ${serverUrl}: ${res.status} ${errorMsg}`);
  return false;
}

export interface RepairResult {
  hash: string;
  success: boolean;
  servers: { url: string; success: boolean; error?: string }[];
}

export function useRepairBlossomIndex() {
  const { user } = useCurrentUser();
  const { toast } = useToast();
  const { data: servers = [] } = useBlossomServers();

  return useMutation({
    mutationFn: async (hashes: string[]) => {
      if (!user || !user.signer) throw new Error('Not logged in or no signer');
      if (servers.length === 0) throw new Error('No blossom servers configured for this user');
      
      console.log(`[Blossom Repair] Starting index repair for ${hashes.length} hashes across ${servers.length} servers.`);
      
      // Fetch server capabilities for NIP-96 fallback
      const serverCapabilities = new Map<string, ServerCapabilities>();
      for (const server of servers) {
        serverCapabilities.set(server, await getServerCapabilities(server));
      }
      
      const results: RepairResult[] = [];

      for (const hash of hashes) {
        const cleanHash = hash.trim().toLowerCase();
        const shortHash = cleanHash.slice(0, 8);
        if (!/^[a-f0-9]{64}$/.test(cleanHash)) {
          console.warn(`[Blossom Repair] Invalid SHA-256 format: ${cleanHash || '(empty)'}`);
          results.push({ hash: cleanHash || '(empty)', success: false, servers: [] });
          continue;
        }

        const serverResults: { url: string; success: boolean; error?: string }[] = [];
        let overallSuccess = false;

        console.log(`[Blossom Repair] Searching for ${shortHash}... across configured servers.`);

        // 1. Download the blob from the FIRST available server that has it (BUD-01)
        let blobData: Blob | null = null;

        for (const serverUrl of servers) {
          const data = await downloadBlob(serverUrl, cleanHash, user.pubkey, user.signer);
          if (data) {
            blobData = data;
            console.log(`[Blossom Repair] Found and downloaded ${shortHash}... from ${serverUrl} (${(data.size / 1024).toFixed(1)} KB).`);
            break; // Found it!
          }
        }

        if (!blobData) {
          console.warn(`[Blossom Repair] ${shortHash}... not found on any configured server.`);
          results.push({ 
            hash: cleanHash, 
            success: false, 
            servers: servers.map(url => ({ url, success: false, error: 'Blob not found on this server' }))
          });
          continue;
        }

        // 2. Re-upload to ALL servers to claim ownership and fix index (BUD-02 / NIP-96)
        for (const serverUrl of servers) {
          console.log(`[Blossom Repair] Uploading/Claiming ${shortHash}... on ${serverUrl}`);
          try {
            const caps = serverCapabilities.get(serverUrl);
            const uploaded = await uploadBlob(serverUrl, blobData, cleanHash, user.signer, caps?.nip96Config || undefined);
            if (uploaded) {
              console.log(`[Blossom Repair] Successfully claimed ${shortHash}... on ${serverUrl}.`);
              overallSuccess = true;
            } else {
              console.warn(`[Blossom Repair] Failed to claim ${shortHash}... on ${serverUrl}.`);
            }
            serverResults.push({ url: serverUrl, success: uploaded, error: uploaded ? undefined : 'Upload/Claim failed' });
          } catch (err) {
            console.error(`[Blossom Repair] Error claiming ${shortHash}... on ${serverUrl}:`, err);
            serverResults.push({ 
              url: serverUrl, 
              success: false, 
              error: err instanceof Error ? err.message : 'Unknown error' 
            });
          }
        }

        results.push({ hash: cleanHash, success: overallSuccess, servers: serverResults });
      }

      const successCount = results.filter(r => r.success).length;
      console.log(`[Blossom Repair] Repair complete. Successfully claimed ${successCount}/${results.length} blobs.`);
      return results;
    },
    onSuccess: (results) => {
      const successCount = results.filter(r => r.success).length;
      toast({
        title: "Index Repair Complete",
        description: `Successfully claimed ${successCount}/${results.length} blobs across all your servers.`,
      });
    },
    onError: (error) => {
      toast({
        title: "Index Repair Failed",
        description: error instanceof Error ? error.message : "An unknown error occurred",
        variant: "destructive",
      });
    }
  });
}
