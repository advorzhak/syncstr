import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger, DialogFooter, DialogClose } from '@/components/ui/dialog';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Wrench, CheckCircle, XCircle, Loader2, Server } from 'lucide-react';
import { useRepairBlossomIndex } from '@/hooks/useBlossomSync';

export function RepairBlossomIndexDialog() {
  const [isOpen, setIsOpen] = useState(false);
  const [hashesInput, setHashesInput] = useState('');
  
  const { mutate: repairIndex, isPending, data: results } = useRepairBlossomIndex();

  const handleRepair = () => {
    const hashes = hashesInput
      .split('\n')
      .map(h => h.trim())
      .filter(h => h.length > 0);
    
    if (hashes.length === 0) return;
    
    repairIndex(hashes);
  };

  const reset = () => {
    setHashesInput('');
    setIsOpen(false);
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => {
      if (!open) reset();
      setIsOpen(open);
    }}>
      <DialogTrigger asChild>
        <Button variant="outline" className="w-full border-amber-500/30 text-amber-400 hover:bg-amber-500/10">
          <Wrench className="h-4 w-4 mr-2" />
          Repair Server Index
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[600px] max-h-[90vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>Repair Blossom Server Index</DialogTitle>
          <DialogDescription>
            Paste SHA-256 hashes of orphaned blobs. The app will fetch them from any of your configured servers and re-upload them to ALL your servers to fix indexing bugs.
          </DialogDescription>
        </DialogHeader>
        
        <div className="space-y-4 flex-1 overflow-hidden flex flex-col">
          {!results && (
            <div className="space-y-2 flex-1 flex flex-col">
              <Label htmlFor="hashes">SHA-256 Hashes (one per line)</Label>
              <Textarea
                id="hashes"
                placeholder={`68a6cc8b90b9a43ba629a44d49ad016bfbbdacced181433b11247984bb41ea15\n6be291c24fd6fa16ff32087b2c276c3d6c2ae74d05719afc867f285793debdfa`}
                value={hashesInput}
                onChange={(e) => setHashesInput(e.target.value)}
                className="flex-1 min-h-[200px] font-mono text-xs"
              />
            </div>
          )}

          {results && (
            <div className="flex-1 flex flex-col min-h-0">
              <Label className="mb-2">Results</Label>
              <ScrollArea className="flex-1 border rounded-md p-2 bg-white/5">
                <div className="space-y-3">
                  {results.map((result, i) => (
                    <div key={i} className="space-y-1">
                      <div className={`flex items-center gap-2 text-xs font-medium ${result.success ? 'text-emerald-400' : 'text-red-400'}`}>
                        {result.success ? (
                          <CheckCircle className="h-4 w-4 shrink-0" />
                        ) : (
                          <XCircle className="h-4 w-4 shrink-0" />
                        )}
                        <span className="font-mono">{result.hash.slice(0, 16)}...{result.hash.slice(-8)}</span>
                      </div>
                      <div className="pl-6 space-y-1">
                        {result.servers.map((server, j) => (
                          <div key={j} className={`flex items-center gap-2 text-[10px] ${server.success ? 'text-emerald-400/80' : 'text-red-400/80'}`}>
                            <Server className="h-3 w-3 shrink-0" />
                            <span className="truncate">{server.url.replace(/^https?:\/\//, '')}</span>
                            {server.error && <span className="opacity-70">- {server.error}</span>}
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </ScrollArea>
            </div>
          )}
        </div>

        <DialogFooter className="mt-4">
          {results ? (
            <DialogClose asChild>
              <Button onClick={reset}>Close</Button>
            </DialogClose>
          ) : (
            <>
              <DialogClose asChild>
                <Button variant="outline">Cancel</Button>
              </DialogClose>
              <Button 
                onClick={handleRepair} 
                disabled={isPending || hashesInput.trim().length === 0}
                className="bg-amber-600 hover:bg-amber-700 text-white"
              >
                {isPending ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Repairing...
                  </>
                ) : (
                  <>Repair Index</>
                )}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
