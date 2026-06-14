import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Database, RefreshCw, Server } from 'lucide-react';
import { useBlossomServers, useSyncBlossomBlobs } from '@/hooks/useBlossomSync';
import { RepairBlossomIndexDialog } from './RepairBlossomIndexDialog';

export function BlossomSyncCard() {
  const { data: servers = [], isLoading: isLoadingServers } = useBlossomServers();
  const { mutate: syncBlobs, isPending: isSyncing } = useSyncBlossomBlobs();

  return (
    <Card className="border-white/10 bg-white/5">
      <CardHeader>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Database className="h-5 w-5 text-violet-400" />
            <CardTitle className="text-lg text-white">Blossom Blob Sync</CardTitle>
          </div>
          {servers.length > 0 && (
            <Badge variant="outline" className="bg-emerald-500/20 border-emerald-500/30 text-emerald-400">
              {servers.length} Servers
            </Badge>
          )}
        </div>
        <CardDescription className="text-white/60">
          Fetch your configured Blossom servers (Kind 10063) and synchronize blobs between them using NIP-98 auth.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {isLoadingServers ? (
          <div className="text-sm text-white/60">Loading servers...</div>
        ) : servers.length === 0 ? (
          <div className="text-sm text-white/60">
            No Blossom servers found in your profile. Add servers to your Kind 10063 event first.
          </div>
        ) : (
          <div className="space-y-2">
            <div className="text-sm text-white/80 font-medium">Configured Servers:</div>
            <div className="space-y-1 max-h-32 overflow-y-auto">
              {servers.map((server, i) => (
                <div key={i} className="flex items-center gap-2 text-xs font-mono text-white/70 bg-white/5 p-2 rounded border border-white/10 break-all">
                  <Server className="h-3 w-3 shrink-0" />
                  {server}
                </div>
              ))}
            </div>
          </div>
        )}
        
        <Button 
          onClick={() => syncBlobs(servers)}
          disabled={isSyncing || servers.length < 2}
          className="w-full bg-violet-600 hover:bg-violet-700 text-white"
        >
          {isSyncing ? (
            <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
          ) : (
            <RefreshCw className="h-4 w-4 mr-2" />
          )}
          {isSyncing ? 'Syncing Blobs...' : `Sync Blobs Across ${servers.length} Servers`}
        </Button>
        {servers.length < 2 && !isLoadingServers && (
          <p className="text-xs text-amber-400 text-center">
            At least 2 servers are required to synchronize.
          </p>
        )}
        
        <div className="pt-2 border-t border-white/10">
          <RepairBlossomIndexDialog />
        </div>
      </CardContent>
    </Card>
  );
}
