import { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { RadioIcon, CheckIcon, XIcon } from 'lucide-react';

interface RelayInputProps {
  title: string;
  description: string;
  placeholder: string;
  onRelayChange: (relay: string) => void;
  value: string;
  isConnected?: boolean;
  isLoading?: boolean;
  onDisconnect?: () => void;
}

export function RelayInput({ 
  title, 
  description, 
  placeholder, 
  onRelayChange, 
  value,
  isConnected,
  isLoading,
  onDisconnect 
}: RelayInputProps) {
  const [inputValue, setInputValue] = useState(value);

  // Sync local state with external value prop
  useEffect(() => {
    setInputValue(value);
  }, [value]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (inputValue.trim()) {
      onRelayChange(inputValue.trim());
    }
  };

  const getStatusBadge = () => {
    if (isLoading) {
      return <Badge variant="outline" className="bg-amber-500/20 border-amber-500/30 text-amber-400">Connecting...</Badge>;
    }
    if (isConnected) {
      return (
        <Badge variant="outline" className="bg-emerald-500/20 border-emerald-500/30 text-emerald-400">
          <CheckIcon className="h-3 w-3 mr-1" />
          Connected
        </Badge>
      );
    }
    if (value && !isConnected) {
      return (
        <Badge variant="outline" className="bg-red-500/20 border-red-500/30 text-red-400">
          <XIcon className="h-3 w-3 mr-1" />
          Failed
        </Badge>
      );
    }
    return null;
  };

  return (
    <Card className="border-white/10 bg-white/5">
      <CardHeader>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <RadioIcon className="h-5 w-5 text-violet-400" />
            <CardTitle className="text-lg text-white">{title}</CardTitle>
          </div>
          {getStatusBadge()}
        </div>
        <CardDescription className="text-white/60">{description}</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="relay-input" className="text-white/80">Relay URL</Label>
            <div className="flex gap-2">
              <Input
                id="relay-input"
                type="text"
                placeholder={placeholder || "wss://relay.example.com or relay.ts.net"}
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value)}
                className="flex-1 bg-white/5 border-white/10 text-white placeholder:text-white/40"
              />
              {isConnected && onDisconnect ? (
                <Button
                  type="button"
                  onClick={onDisconnect}
                  variant="outline"
                  disabled={isLoading}
                  className="border-white/20 text-white hover:bg-white/10"
                >
                  Disconnect
                </Button>
              ) : (
                <Button type="submit" disabled={!inputValue.trim() || isLoading} className="bg-violet-600 hover:bg-violet-700 text-white">
                  {isLoading ? 'Connecting...' : 'Connect'}
                </Button>
              )}
            </div>
          </div>
          {value && (
            <div className="p-3 bg-white/5 rounded-lg border border-white/10">
              <p className="text-sm font-mono break-all text-white/80">{value}</p>
            </div>
          )}
        </form>
      </CardContent>
    </Card>
  );
}