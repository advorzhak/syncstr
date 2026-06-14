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

export function useSyncBlossomBlobs() {
  const { user } = useCurrentUser();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async (servers: string[]) => {
      if (!user || !user.signer) throw new Error('Not logged in or no signer');
      if (servers.length < 2) throw new Error('Need at least 2 servers to sync');

      console.log(`[Blossom Sync] Starting bi-directional sync across ${servers.length} servers.`);

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
          
          console.log(`[Blossom Sync] Verified ${shortHash}... (${(blobData.size / 1024).toFixed(1)} KB). Uploading to missing servers...`);
          
          let serverUploadSuccess = true;
          for (const targetServer of needsIt) {
            console.log(`[Blossom Sync] Uploading ${shortHash}... to ${targetServer}`);
            const uploaded = await uploadBlob(targetServer, blobData, hash, user.signer);
            if (uploaded) {
              console.log(`[Blossom Sync] Uploaded ${shortHash}... to ${targetServer} successfully.`);
            } else {
              console.warn(`[Blossom Sync] Failed to upload ${shortHash}... to ${targetServer}.`);
              serverUploadSuccess = false;
            }
          }
          
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
  action: 'get' | 'upload' | 'list' | 'delete', 
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

async function getNIP98AuthHeader(url: string, method: 'GET' | 'PUT', signer: NostrSigner): Promise<string> {
  const request = new Request(url, { method });
  const template = await NIP98.template(request, { validatePayload: false });
  const event = await signer.signEvent(template);
  return `Nostr ${btoa(JSON.stringify(event))}`;
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

export async function uploadBlob(serverUrl: string, blob: Blob, sha256: string, signer: NostrSigner): Promise<boolean> {
  const baseUrl = serverUrl.replace(/\/$/, '');
  const url = `${baseUrl}/upload`; // BUD-02 specifies PUT /upload, not PUT /<sha256>
  
  try {
    let authHeader = await getBlossomAuthHeader('upload', sha256, signer);
    
    let res = await fetch(url, {
      method: 'PUT',
      headers: { 
        'Authorization': authHeader,
        'Content-Type': blob.type || 'application/octet-stream',
        'X-SHA-256': sha256 // BUD-02: Optional but recommended for pre-validation
      },
      body: blob
    });
    
    // Fallback to NIP-98 if the server rejects the Kind 24242 auth
    if (res.status === 401) {
      authHeader = await getNIP98AuthHeader(url, 'PUT', signer);
      res = await fetch(url, {
        method: 'PUT',
        headers: { 
          'Authorization': authHeader,
          'Content-Type': blob.type || 'application/octet-stream',
          'X-SHA-256': sha256
        },
        body: blob
      });
    }
    
    if (res.ok) {
      return true;
    }
    
    const text = await res.text().catch(() => '');
    console.warn(`[Blossom Sync] Upload failed for ${sha256.slice(0, 8)}... to ${serverUrl}: ${res.status} ${text}`);
    return false;
  } catch (err) {
    if (err instanceof TypeError) {
      console.warn(`[Blossom Sync] Network/CORS error uploading ${sha256.slice(0, 8)}... to ${serverUrl}. The server may not support this operation or rejected the request. Skipping.`);
      return false;
    }
    throw err;
  }
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

        // 2. Re-upload to ALL servers to claim ownership and fix index (BUD-02)
        for (const serverUrl of servers) {
          console.log(`[Blossom Repair] Uploading/Claiming ${shortHash}... on ${serverUrl}`);
          try {
            const uploaded = await uploadBlob(serverUrl, blobData, cleanHash, user.signer);
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
