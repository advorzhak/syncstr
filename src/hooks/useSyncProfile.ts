import { useMutation } from '@tanstack/react-query';
import { NPool, NRelay1 } from '@nostrify/nostrify';
import type { NostrEvent } from '@nostrify/nostrify';
import { useToast } from '@/hooks/useToast';
import { useAppContext } from '@/hooks/useAppContext';
import { useCurrentUser } from '@/hooks/useCurrentUser';

export interface SyncProfileData {
  events: NostrEvent[];
  targetRelay: string;
}

// Common Nostr event kinds mapping for readable logs
const KIND_NAMES: Record<number, string> = {
  0: 'User Metadata',
  1: 'Short Text Note',
  2: 'Recommendation',
  3: 'Contact List',
  4: 'Encrypted Direct Message',
  6: 'Repost',
  7: 'Reaction',
  9: 'Event Deletion Request',
  16: 'Generic Repost',
  1111: 'Comment',
  10000: 'Mute List',
  10001: 'Pin List',
  10002: 'Relay List Metadata',
  10005: 'Bookmark List',
  10007: 'Relay Sets List',
  10015: 'Interest List',
  10050: 'DM Relays',
  10063: 'Blossom Server List',
  10086: 'User Statuses',
  22242: 'Relay Auth',
};

export function useSyncProfile() {
  const { toast } = useToast();
  const { config } = useAppContext();
  const { user } = useCurrentUser();

  return useMutation({
    mutationFn: async ({ events, targetRelay }: SyncProfileData) => {
      console.log('🚀 Starting sync:', { eventCount: events.length, targetRelay, defaultRelay: config.relayUrl });
      
      if (events.length === 0) {
        throw new Error('No events to sync');
      }

      // Pre-flight check for Mixed Content (HTTPS page trying to connect to WS relay)
      if (typeof window !== 'undefined' && window.location.protocol === 'https:' && targetRelay.startsWith('ws://')) {
        throw new Error(
          `Browser security blocked the connection: Cannot connect to an unencrypted 'ws://' relay from a secure 'https://' website. ` +
          `Please use a secure 'wss://' URL (e.g., via Tailscale MagicDNS), or access this app locally via 'http://'.`
        );
      }

      if (!user) {
        throw new Error('User must be logged in to sync profile');
      }

      if (!targetRelay || (!targetRelay.startsWith('wss://') && !targetRelay.startsWith('ws://'))) {
        throw new Error('Invalid target relay URL');
      }

      let successCount = 0;
      let errorCount = 0;
      const results: Array<{ event: NostrEvent; success: boolean; usedRelay: string; error?: unknown }> = [];

      const createPool = (relayUrl: string) => {
        return new NPool({
          open(url: string) {
            console.log(`🔌 Opening connection to relay: ${url}`);
            return new NRelay1(url, {
              auth: async (challenge: string) => {
                if (!user?.signer) {
                  throw new Error('No signer available for relay authentication (NIP-42)');
                }
                console.log(`🔐 Responding to NIP-42 AUTH challenge from ${url}`);
                const event: Omit<NostrEvent, 'id' | 'pubkey' | 'sig'> = {
                  kind: 22242,
                  created_at: Math.floor(Date.now() / 1000),
                  tags: [
                    ['relay', url],
                    ['challenge', challenge],
                  ],
                  content: '',
                };
                return await user.signer.signEvent(event);
              },
            });
          },
          reqRouter() {
            return new Map([[relayUrl, []]]);
          },
          eventRouter() {
            return [relayUrl];
          },
        });
      };

      const targetPool = createPool(targetRelay);
      const fallbackPool = config.relayUrl !== targetRelay ? createPool(config.relayUrl) : null;

      const publishPromises = events.map(async (event) => {
        let eventSuccess = false;
        let eventError: unknown = null;
        let usedRelay = '';

        // Determine a readable description for the event log
        let description = '';
        
        if (event.kind === 0) {
          try {
            const metadata = JSON.parse(event.content);
            if (metadata.display_name || metadata.name) {
              description = metadata.display_name || metadata.name;
            }
          } catch {
            // ignore JSON parsing errors
          }
        }

        if (!description) {
          description = event.tags.find(t => t[0] === 'alt')?.[1] || '';
        }

        if (!description && event.content.trim()) {
          const snippet = event.content.trim().slice(0, 40).replace(/\n/g, ' ');
          description = snippet + (event.content.trim().length > 40 ? '...' : '');
        }

        const kindName = KIND_NAMES[event.kind] || `Kind ${event.kind}`;
        const eventLabel = description ? `"${description}" => ${kindName}` : kindName;

        // 1. Try target relay first
        try {
          console.log(`📤 Publishing ${eventLabel} (${event.id.slice(0, 8)}...) to TARGET relay: ${targetRelay}`);
          await targetPool.event(event, { signal: AbortSignal.timeout(15000) });
          console.log(`✅ Successfully published ${eventLabel} (${event.id.slice(0, 8)}...) to TARGET relay: ${targetRelay}`);
          eventSuccess = true;
          usedRelay = targetRelay;
        } catch (targetError) {
          console.warn(`⚠️ TARGET relay failed for ${eventLabel} (${event.id.slice(0, 8)}...) (${targetRelay}):`, targetError);
          
          // 2. Fallback to default relay if different from target
          if (fallbackPool) {
            try {
              console.log(`🔄 Falling back to DEFAULT relay for ${eventLabel}: ${config.relayUrl}`);
              await fallbackPool.event(event, { signal: AbortSignal.timeout(15000) });
              console.log(`✅ Successfully published ${eventLabel} to DEFAULT relay: ${config.relayUrl}`);
              eventSuccess = true;
              usedRelay = config.relayUrl;
            } catch (fallbackError) {
              console.error(`❌ Both TARGET (${targetRelay}) and DEFAULT (${config.relayUrl}) relays failed for ${eventLabel}:`, { targetError, fallbackError });
              eventError = fallbackError;
            }
          } else {
            eventError = targetError;
          }
        }

        return { event, success: eventSuccess, usedRelay, error: eventError };
      });

      const settledResults = await Promise.allSettled(publishPromises);

      for (const result of settledResults) {
        if (result.status === 'fulfilled') {
          const res = result.value;
          if (res.success) {
            successCount++;
          } else {
            errorCount++;
          }
          results.push(res);
        } else {
          errorCount++;
          console.error('Unexpected promise rejection during event publishing:', result.reason);
        }
      }

      console.log('📊 Sync results:', { successCount, errorCount, total: events.length });

      return {
        results,
        successCount,
        errorCount,
        total: events.length,
      };
    },
    onSuccess: (data) => {
      const { successCount, errorCount, total } = data;

      if (errorCount === 0) {
        toast({
          title: "Sync Complete",
          description: `Successfully synced ${successCount} events.`,
        });
      } else if (successCount > 0) {
        toast({
          title: "Partial Sync",
          description: `Synced ${successCount}/${total} events. ${errorCount} failed.`,
          variant: "destructive",
        });
      } else {
        toast({
          title: "Sync Failed",
          description: `Failed to sync any events.`,
          variant: "destructive",
        });
      }
    },
    onError: (error) => {
      toast({
        title: "Sync Error",
        description: error instanceof Error ? error.message : "An unknown error occurred",
        variant: "destructive",
      });
    },
  });
}