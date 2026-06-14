import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Database, RefreshCw, Server, CheckCircle2, AlertCircle } from 'lucide-react';
import { useBlossomServers, useSyncBlossomBlobs, useBlossomSyncStats } from '@/hooks/useBlossomSync';
import { RepairBlossomIndexDialog } from './RepairBlossomIndexDialog';

export function BlossomSyncCard() {
  const { data: servers = [], isLoading: isLoadingServers } = useBlossomServers();
  const { data: stats, isLoading: isLoadingStats } = useBlossomSyncStats();
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
          Synchronize blobs between your configured Blossom servers bi-directionally.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {isLoadingServers || isLoadingStats ? (
          <div className="text-sm text-white/60">Analyzing server inventories...</div>
        ) : servers.length === 0 ? (
          <div className="text-sm text-white/60">
            No Blossom servers found in your profile. Add servers to your Kind 10063 event first.
          </div>
        ) : stats ? (
          <div className="space-y-4">
            {/* Global Stats */}
            <div className="grid grid-cols-2 gap-3">
              <div className="bg-white/5 p-3 rounded border border-white/10">
                <div className="text-xs text-white/60 mb-1">Total Unique Blobs</div>
                <div className="text-2xl font-semibold text-white">{stats.totalUniqueBlobs}</div>
              </div>
              <div className="bg-emerald-500/10 p-3 rounded border border-emerald-500/20">
                <div className="text-xs text-emerald-400/80 mb-1">Fully Synced</div>
                <div className="text-2xl font-semibold text-emerald-400">{stats.fullySyncedBlobs}</div>
              </div>
            </div>

            {/* Per-Server Stats */}
            <div className="space-y-2">
              <div className="text-sm text-white/80 font-medium">Server Status:</div>
              <div className="space-y-2 max-h-40 overflow-y-auto pr-1">
                {stats.serverStats.map((stat, i) => (
                  <div key={i} className="flex items-center justify-between text-xs bg-white/5 p-2 rounded border border-white/10">
                    <div className="flex items-center gap-2 min-w-0 flex-1">
                      <Server className="h-3 w-3 shrink-0 text-white/60" />
                      <span className="font-mono text-white/70 truncate">{stat.url.replace(/^https?:\/\//, '')}</span>
                    </div>
                    <div className="flex items-center gap-3 shrink-0">
                      <div className="flex items-center gap-1 text-emerald-400" title="Present">
                        <CheckCircle2 className="h-3.5 w-3.5" />
                        <span>{stat.presentCount}</span>
                      </div>
                      {stat.missingCount > 0 ? (
                        <div className="flex items-center gap-1 text-amber-400" title="Missing">
                          <AlertCircle className="h-3.5 w-3.5" />
                          <span>{stat.missingCount}</span>
                        </div>
                      ) : (
                        <div className="flex items-center gap-1 text-white/40" title="Missing">
                          <AlertCircle className="h-3.5 w-3.5" />
                          <span>0</span>
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        ) : null}
        
        <Button 
          onClick={() => syncBlobs(servers)}
          disabled={isSyncing || servers.length < 2 || !stats || stats.totalUniqueBlobs === 0}
          className="w-full bg-violet-600 hover:bg-violet-700 text-white"
        >
          {isSyncing ? (
            <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
          ) : (
            <RefreshCw className="h-4 w-4 mr-2" />
          )}
          {isSyncing ? 'Syncing Blobs...' : 'Sync Missing Blobs'}
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
