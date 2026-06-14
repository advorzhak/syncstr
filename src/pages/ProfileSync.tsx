import { useState, useEffect } from 'react';
import { nip19 } from 'nostr-tools';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useProfileData } from '@/hooks/useProfileData';
import { useSyncProfile } from '@/hooks/useSyncProfile';
import { useBackupMode } from '@/hooks/useBackupMode';
import { LoginArea } from '@/components/auth/LoginArea';
import { BackupControls } from '@/components/BackupControls';
import { RelayInput } from '@/components/RelayInput';
import { ProfileDataCard } from '@/components/ProfileDataCard';
import { SyncButton } from '@/components/SyncButton';
import { BlossomSyncCard } from '@/components/BlossomSyncCard';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Separator } from '@/components/ui/separator';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { RotateCcwIcon, InfoIcon, CheckCircleIcon, ZapIcon, ShieldIcon, GlobeIcon, FileIcon, RadioIcon, SatelliteIcon, Activity } from 'lucide-react';
import type { NostrEvent } from '@nostrify/nostrify';

// Helper function to normalize relay URLs
const normalizeRelayUrl = (url: string): string => {
  if (!url) return url;
  
  const trimmed = url.trim();
  if (trimmed.startsWith('wss://') || trimmed.startsWith('ws://')) {
    return trimmed;
  }
  
  // Auto-add wss:// prefix for domain-like inputs (including .local and .ts.net)
  if (trimmed.includes('.') && !trimmed.includes('://')) {
    return `wss://${trimmed}`;
  }
  
  return trimmed;
};

export function ProfileSync() {
  const { user } = useCurrentUser();
  const [sourceRelay, setSourceRelay] = useState('');
  const [targetRelay, setTargetRelay] = useState('');
  const [selectedEvents, setSelectedEvents] = useState<Set<string>>(new Set());
  const { isBackupMode, backupData, backupSource, enterBackupMode, exitBackupMode } = useBackupMode();

  const {
    data: profileData,
    isLoading: isLoadingProfile,
    error: profileError,
    refetch: refetchProfile
  } = useProfileData(user?.pubkey, sourceRelay);

  const {
    mutate: syncProfile,
    isPending: isSyncing,
    data: syncResult
  } = useSyncProfile();

  // Reset selected events when source relay changes
  useEffect(() => {
    setSelectedEvents(new Set());
  }, [sourceRelay]);

  const handleSelectEvents = (events: NostrEvent[]) => {
    setSelectedEvents(new Set(events.map(e => e.id)));
  };

  const handleSync = () => {
    if (!profileData) return;

    const eventsToSync = Object.values(profileData)
      .filter(Boolean)
      .filter(event => selectedEvents.has(event.id)) as NostrEvent[];

    syncProfile({
      events: eventsToSync,
      targetRelay,
    });
  };

  const handleSourceRelayChange = (relay: string) => {
    const normalizedRelay = normalizeRelayUrl(relay);
    setSourceRelay(normalizedRelay);
    // Trigger a refetch when the relay changes
    if (user?.pubkey) {
      refetchProfile();
    }
  };

  const handleSourceRelayDisconnect = () => {
    // Simple and effective: reload the page to reset all state
    window.location.reload();
  };

  // Target relay change handler is no longer needed since we use direct onChange

  // Use backup data if in backup mode, otherwise use profile data from relay
  const currentProfileData = isBackupMode ? backupData : profileData;
  const currentSource = isBackupMode ? backupSource : sourceRelay;

  const selectedEventsArray = currentProfileData
    ? Object.values(currentProfileData).filter(Boolean).filter(event => selectedEvents.has(event.id)) as NostrEvent[]
    : [];

  if (!user) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-950 via-violet-950 to-slate-950">
        {/* Animated background grid */}
        <div className="fixed inset-0 overflow-hidden pointer-events-none">
          <div className="absolute inset-0 bg-[linear-gradient(rgba(139,92,246,0.03)_1px,transparent_1px),linear-gradient(90deg,rgba(139,92,246,0.03)_1px,transparent_1px)] bg-[size:60px_60px]" />

          {/* Glowing orbs */}
          <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-violet-500/20 rounded-full blur-[128px] animate-pulse" />
          <div className="absolute bottom-1/4 right-1/4 w-96 h-96 bg-fuchsia-500/20 rounded-full blur-[128px] animate-pulse" style={{ animationDelay: '1s' }} />
          <div className="absolute top-1/2 right-1/3 w-64 h-64 bg-amber-500/10 rounded-full blur-[100px] animate-pulse" style={{ animationDelay: '2s' }} />

          {/* Floating icons */}
          <div className="absolute top-20 left-[15%] animate-bounce-slow opacity-20 hidden md:block">
            <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-green-400 to-emerald-600 flex items-center justify-center">
              <Activity className="w-6 h-6 text-white" />
            </div>
          </div>
          <div className="absolute top-32 right-[20%] animate-bounce-slow opacity-20 hidden md:block" style={{ animationDelay: '0.5s' }}>
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-violet-400 to-purple-600 flex items-center justify-center">
              <RotateCcwIcon className="w-5 h-5 text-white" />
            </div>
          </div>
          <div className="absolute bottom-40 left-[10%] animate-bounce-slow opacity-20 hidden md:block" style={{ animationDelay: '1s' }}>
            <div className="w-14 h-14 rounded-xl bg-gradient-to-br from-amber-400 to-orange-600 flex items-center justify-center">
              <ZapIcon className="w-7 h-7 text-white" />
            </div>
          </div>
          <div className="absolute bottom-32 right-[15%] animate-bounce-slow opacity-20 hidden md:block" style={{ animationDelay: '1.5s' }}>
            <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-pink-400 to-rose-600 flex items-center justify-center">
              <GlobeIcon className="w-5 h-5 text-white" />
            </div>
          </div>
        </div>

        {/* Hero section */}
        <div className="relative z-10 flex flex-col items-center justify-center text-center px-4 py-16 min-h-[60vh]">
          {/* Main headline */}
          <h1 className="text-4xl sm:text-5xl md:text-6xl lg:text-7xl font-bold text-white mb-6 leading-[1.1] tracking-tight max-w-4xl">
            Sync your Nostr
            <br />
            <span className="text-transparent bg-clip-text bg-gradient-to-r from-violet-400 via-fuchsia-400 to-amber-400">
              profile anywhere
            </span>
          </h1>

          {/* Subtitle */}
          <p className="text-lg sm:text-xl text-white/60 mb-10 max-w-2xl leading-relaxed">
            Keep your Nostr profile perfectly synchronized across relays. Transfer contacts, bookmarks,
            relay lists, and more with just a few clicks.
          </p>

          {/* CTA */}
          <div className="flex flex-col sm:flex-row items-center gap-4">
            <LoginArea className="justify-center" />
          </div>
        </div>

        {/* How it works section */}
        <div className="relative z-10 container mx-auto px-4 py-16 max-w-5xl">
          {/* Intro text */}
          <div className="text-center mb-12">
            <p className="text-white/70 text-lg max-w-2xl mx-auto leading-relaxed">
              Your Nostr profile data can get scattered across relays. Relays go offline, events don't always broadcast everywhere,
              and switching to new relays leaves data behind. <span className="text-white font-medium">SyncStr fixes this.</span>
            </p>
          </div>

          {/* Steps flow */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-16">
            <div className="text-center p-6">
              <div className="w-16 h-16 mx-auto mb-4 rounded-2xl bg-gradient-to-br from-violet-500/30 to-purple-500/30 border border-violet-500/30 flex items-center justify-center">
                <span className="text-2xl font-bold text-violet-400">1</span>
              </div>
              <h3 className="font-semibold text-white mb-2">Connect a Source</h3>
              <p className="text-sm text-white/50">Pick a relay that has your profile data. We'll fetch everything from there.</p>
            </div>

            <div className="text-center p-6">
              <div className="w-16 h-16 mx-auto mb-4 rounded-2xl bg-gradient-to-br from-fuchsia-500/30 to-pink-500/30 border border-fuchsia-500/30 flex items-center justify-center">
                <span className="text-2xl font-bold text-fuchsia-400">2</span>
              </div>
              <h3 className="font-semibold text-white mb-2">Choose What to Sync</h3>
              <p className="text-sm text-white/50">Select your profile, contacts, bookmarks, relay lists - whatever you need.</p>
            </div>

            <div className="text-center p-6">
              <div className="w-16 h-16 mx-auto mb-4 rounded-2xl bg-gradient-to-br from-emerald-500/30 to-teal-500/30 border border-emerald-500/30 flex items-center justify-center">
                <span className="text-2xl font-bold text-emerald-400">3</span>
              </div>
              <h3 className="font-semibold text-white mb-2">Publish Anywhere</h3>
              <p className="text-sm text-white/50">Send your data to any relay, or broadcast it everywhere at once.</p>
            </div>
          </div>

          {/* Benefits grid */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-16">
            <div className="p-4 rounded-xl border border-white/10 bg-white/5 text-center">
              <ZapIcon className="w-6 h-6 mx-auto mb-2 text-amber-400" />
              <p className="text-sm text-white/70">Never Lose Contacts</p>
            </div>
            <div className="p-4 rounded-xl border border-white/10 bg-white/5 text-center">
              <ShieldIcon className="w-6 h-6 mx-auto mb-2 text-emerald-400" />
              <p className="text-sm text-white/70">Backup Your Identity</p>
            </div>
            <div className="p-4 rounded-xl border border-white/10 bg-white/5 text-center">
              <GlobeIcon className="w-6 h-6 mx-auto mb-2 text-blue-400" />
              <p className="text-sm text-white/70">Stay Discoverable</p>
            </div>
            <div className="p-4 rounded-xl border border-white/10 bg-white/5 text-center">
              <CheckCircleIcon className="w-6 h-6 mx-auto mb-2 text-violet-400" />
              <p className="text-sm text-white/70">Switch Relays Freely</p>
            </div>
          </div>

          {/* What gets synced */}
          <div className="p-6 rounded-2xl border border-white/10 bg-white/5 mb-16">
            <h3 className="text-lg font-semibold text-white mb-4 text-center">What can you sync?</h3>
            <div className="flex flex-wrap justify-center gap-2">
              {['Profile', 'Contacts', 'Bookmarks', 'Relay Lists', 'Mute Lists', 'Communities', 'Interests', 'Emojis', 'DM Relays', 'Search Relays', 'Blossom Servers'].map((item) => (
                <span key={item} className="px-3 py-1.5 rounded-full bg-violet-500/20 border border-violet-500/30 text-violet-400 text-sm">
                  {item}
                </span>
              ))}
            </div>
          </div>

          {/* CTA Section */}
          <div className="text-center p-8 rounded-2xl border border-violet-500/30 bg-gradient-to-br from-violet-500/10 to-fuchsia-500/10">
            <h3 className="text-2xl font-semibold mb-4 text-white">Ready to Sync?</h3>
            <p className="text-white/60 mb-6 max-w-lg mx-auto">
              Connect your Nostr account and keep your identity consistent across the network.
            </p>
            <div className="space-y-4">
              <LoginArea className="max-w-72 mx-auto justify-center" />
              <p className="text-xs text-white/40">
                Supports browser extensions, private key login, and more
              </p>
            </div>
          </div>

          {/* Footer */}
          <div className="text-center mt-12 pt-8 border-t border-white/10">
            <p className="text-xs text-white/30">
              Built for the Nostr community
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-950 via-violet-950 to-slate-950">
      <div className="container mx-auto px-4 py-8 max-w-6xl">
        {/* Header */}
        <div className="relative overflow-hidden rounded-3xl p-8 md:p-12 mb-8 bg-gradient-to-br from-violet-600 via-purple-600 to-fuchsia-600">
          {/* Background decorations */}
          <div className="absolute inset-0 overflow-hidden">
            <div className="absolute -top-1/2 -right-1/2 w-full h-full bg-gradient-to-br from-white/10 to-transparent rounded-full blur-3xl" />
            <div className="absolute -bottom-1/2 -left-1/2 w-full h-full bg-gradient-to-tr from-white/5 to-transparent rounded-full blur-3xl" />
          </div>

          <div className="relative z-10 flex flex-col md:flex-row items-center gap-6">
            <div className="w-20 h-20 rounded-full border-4 border-white/20 shadow-xl bg-white/20 flex items-center justify-center">
              <RotateCcwIcon className="h-10 w-10 text-white" />
            </div>

            <div className="text-center md:text-left">
              <h1 className="text-2xl md:text-3xl font-bold text-white mb-2">
                SyncStr Profile Sync
              </h1>
              <p className="text-white/80 text-lg max-w-xl">
                Broadcast and sync your Nostr profile metadata, contact lists, and preferences between relays.
              </p>
            </div>

            <div className="md:ml-auto">
              <LoginArea className="max-w-32" />
            </div>
          </div>

          <div className="relative z-10 mt-4 text-center md:text-left">
            <p className="text-xs text-white/60 font-mono break-all">
              {nip19.npubEncode(user.pubkey)}
            </p>
          </div>
        </div>

        {/* Info Alert */}
        <Alert className="mb-8 border-violet-500/30 bg-violet-500/10 text-white">
          <InfoIcon className="h-4 w-4 text-violet-400" />
          <AlertDescription className="text-sm text-white/70">
            This tool syncs profile metadata (kind 0), contact lists (kind 3), mute lists (kind 10000),
            pinned notes (kind 10001), relay lists (kind 10002), bookmarks (kind 10003), communities
            (kind 10004), search relays (kind 10007), interests (kind 10015), emoji lists (kind 10030),
            DM relays (kind 10050), and Blossom server lists (kind 10063) between relays.
          </AlertDescription>
        </Alert>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          {/* Source Relay Section */}
          <div className="space-y-6">
            {!isBackupMode ? (
              <RelayInput
                title="Source Relay"
                description="The relay to read your current profile data from. Supports Tailscale MagicDNS (e.g., umbrel.ts.net) and local addresses."
                placeholder="i.e. relay.damus.io, umbrel.ts.net, or umbrel.local:4848"
                onRelayChange={handleSourceRelayChange}
                value={sourceRelay}
                isConnected={!!profileData}
                isLoading={isLoadingProfile}
                onDisconnect={handleSourceRelayDisconnect}
              />
            ) : (
              <Card className="border-emerald-500/30 bg-emerald-500/10">
                <CardContent className="p-6">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <FileIcon className="h-6 w-6 text-emerald-400" />
                      <div>
                        <h3 className="text-lg font-semibold text-white">
                          Backup Mode Active
                        </h3>
                        <p className="text-sm text-white/70">
                          Using data from: {backupSource}
                        </p>
                      </div>
                    </div>
                    <Button
                      onClick={exitBackupMode}
                      variant="outline"
                      size="sm"
                      className="border-emerald-500/50 text-emerald-400 hover:bg-emerald-500/20"
                    >
                      Use Relay Instead
                    </Button>
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Backup Controls */}
            <BackupControls
              profileData={currentProfileData}
              pubkey={user.pubkey}
              onBackupRestore={enterBackupMode}
            />

            {/* Profile Data Display */}
            {currentSource && (
              <>
                {profileError && !isBackupMode && (
                  <Alert variant="destructive" className="border-red-500/30 bg-red-500/10">
                    <AlertDescription className="text-white/70">
                      Failed to load profile data: {profileError instanceof Error ? profileError.message : 'Unknown error'}
                    </AlertDescription>
                  </Alert>
                )}

                {currentProfileData && (
                  <ProfileDataCard
                    profileData={currentProfileData}
                    relayUrl={currentSource}
                    onSelectEvents={handleSelectEvents}
                    selectedEvents={selectedEvents}
                  />
                )}
              </>
            )}
          </div>

          {/* Target Relay Section */}
          <div className="space-y-6">
            <Card className="border-white/10 bg-white/5">
              <CardHeader>
                <div className="flex items-center gap-2">
                  <RadioIcon className="h-5 w-5 text-violet-400" />
                  <CardTitle className="text-lg text-white">Target Relay</CardTitle>
                </div>
                 <CardDescription className="text-white/60">The relay to copy your profile data to. Supports Tailscale MagicDNS (e.g., umbrel.ts.net) and local addresses (e.g., umbrel.local:4848). wss:// will be added automatically.</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="target-relay-input" className="text-white/80">Relay URL</Label>
                    <Input
                      id="target-relay-input"
                      type="text"
                      placeholder="i.e. relay.nostr.band, umbrel.ts.net, or umbrel.local:4848"
                      value={targetRelay}
                      onChange={(e) => setTargetRelay(e.target.value)}
                      onBlur={(e) => setTargetRelay(normalizeRelayUrl(e.target.value))}
                      className="w-full bg-white/5 border-white/10 text-white placeholder:text-white/40"
                    />
                    {targetRelay && (
                      <div className="p-3 bg-white/5 rounded-lg border border-white/10">
                        <p className="text-sm font-mono break-all text-white/80">{targetRelay}</p>
                      </div>
                    )}
                  </div>

                  {/* Blastr Quick Option */}
                  <div className="p-4 rounded-lg border border-purple-500/30 bg-purple-500/10">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <SatelliteIcon className="h-5 w-5 text-purple-400" />
                        <div>
                          <h4 className="font-medium text-white">
                            Use Blastr Broadcaster
                          </h4>
                          <p className="text-sm text-white/60">
                            Maximize reach by broadcasting to many relays
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <Popover>
                          <PopoverTrigger asChild>
                            <Button variant="ghost" size="sm" className="h-8 w-8 p-0 text-purple-400 hover:bg-purple-500/20">
                              <InfoIcon className="h-4 w-4" />
                            </Button>
                          </PopoverTrigger>
                          <PopoverContent className="max-w-xs bg-slate-900 border-white/10" side="left">
                            <div className="space-y-2">
                              <h4 className="font-medium text-sm text-white">About Blastr Broadcaster</h4>
                              <p className="text-sm text-white/60">
                                Blastr is a broadcaster relay that uses the nostr.watch API to send your events
                                to as many online relays as possible, drastically improving your reach and discoverability.
                              </p>
                            </div>
                          </PopoverContent>
                        </Popover>
                        <Button
                          onClick={() => setTargetRelay('wss://sendit.nosflare.com')}
                          size="sm"
                          className="bg-purple-600 hover:bg-purple-700 text-white"
                        >
                          Use Blastr
                        </Button>
                      </div>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Blossom Sync Section */}
            <BlossomSyncCard />

            {/* Sync Controls */}
            <SyncButton
              sourceRelay={currentSource}
              targetRelay={targetRelay}
              selectedEvents={selectedEventsArray}
              onSync={handleSync}
              isLoading={isSyncing}
              syncResult={syncResult}
            />
          </div>
        </div>

        {/* Footer */}
        <Separator className="my-12 bg-white/10" />
        <div className="text-center text-sm text-white/40">
          <p>
            Vibed with{' '}
            <a
              href="https://shakespeare.diy"
              target="_blank"
              rel="noopener noreferrer"
              className="text-violet-400 hover:underline"
            >
              Shakespeare
            </a>
          </p>
        </div>
      </div>
    </div>
  );
}