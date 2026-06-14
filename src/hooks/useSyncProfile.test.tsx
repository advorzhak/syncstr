import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useSyncProfile } from './useSyncProfile';
import { NUser } from '@nostrify/react/login';
import type { NPoolOpts, NRelay1Opts, NostrEvent, NostrSigner } from '@nostrify/nostrify';
import * as Nostrify from '@nostrify/nostrify';
import type { AppContextType } from '@/contexts/AppContext';

vi.mock('@/hooks/useAppContext');
vi.mock('@/hooks/useCurrentUser');
vi.mock('@/hooks/useToast');
vi.mock('@nostrify/nostrify', () => ({
  NPool: vi.fn(),
  NRelay1: vi.fn(),
}));

import { useAppContext } from '@/hooks/useAppContext';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useToast } from '@/hooks/useToast';

const mockToast = vi.fn();
const mockAppContext: AppContextType = {
  config: {
    theme: 'light',
    relayUrl: 'wss://default.relay.test',
  },
  updateConfig: vi.fn(),
  presetRelays: [],
};

const mockSignEvent = vi.fn().mockImplementation((event: Parameters<NostrSigner['signEvent']>[0]) =>
  Promise.resolve({ ...event, pubkey: 'testpubkey123', id: 'mockid', sig: 'mocksig' })
);

const mockSigner: NostrSigner = {
  getPublicKey: vi.fn().mockResolvedValue('testpubkey123'),
  signEvent: mockSignEvent,
};

const mockUser = new NUser('nsec', 'testpubkey123', mockSigner);

const mockEvent1: NostrEvent = {
  id: 'event1id123456789',
  pubkey: 'testpubkey123',
  created_at: 1234567890,
  kind: 0,
  tags: [],
  content: 'test content',
  sig: 'mocksig',
};

describe('useSyncProfile', () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    vi.clearAllMocks();
    queryClient = new QueryClient({
      defaultOptions: {
        mutations: { retry: false },
        queries: { retry: false },
      },
    });

    vi.mocked(useAppContext).mockReturnValue(mockAppContext);
    vi.mocked(useCurrentUser).mockReturnValue(
      { user: mockUser, users: [mockUser] } as unknown as ReturnType<typeof useCurrentUser>
    );
    vi.mocked(useToast).mockReturnValue({ toast: mockToast } as unknown as ReturnType<typeof useToast>);
  });

  afterEach(() => {
    queryClient.clear();
  });

  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>
      {children}
    </QueryClientProvider>
  );

  it('should successfully publish events to target relay', async () => {
    const mockEventResult = vi.fn().mockResolvedValue(undefined);
    vi.mocked(Nostrify.NPool).mockImplementation(() => ({
      event: mockEventResult,
    } as unknown as InstanceType<typeof Nostrify.NPool>));
    vi.mocked(Nostrify.NRelay1).mockImplementation(() =>
      ({} as unknown as InstanceType<typeof Nostrify.NRelay1>)
    );

    const { result } = renderHook(() => useSyncProfile(), { wrapper });

    await act(async () => {
      await result.current.mutateAsync({
        events: [mockEvent1],
        targetRelay: 'wss://target.relay.test',
      });
    });

    expect(Nostrify.NPool).toHaveBeenCalledWith(
      expect.objectContaining({
        eventRouter: expect.any(Function),
        reqRouter: expect.any(Function),
      })
    );
    
    expect(mockEventResult).toHaveBeenCalledWith(
      mockEvent1,
      expect.objectContaining({ signal: expect.any(AbortSignal) })
    );

    expect(mockToast).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Sync Complete' })
    );
  });

  it('should fall back to default relay when target relay fails', async () => {
    let callCount = 0;
    const mockEventResult = vi.fn().mockImplementation(() => {
      callCount++;
      if (callCount === 1) {
        return Promise.reject(new Error('Target relay timeout'));
      }
      return Promise.resolve(undefined);
    });

    vi.mocked(Nostrify.NPool).mockImplementation(() => ({
      event: mockEventResult,
    } as unknown as InstanceType<typeof Nostrify.NPool>));
    vi.mocked(Nostrify.NRelay1).mockImplementation(() =>
      ({} as unknown as InstanceType<typeof Nostrify.NRelay1>)
    );

    const { result } = renderHook(() => useSyncProfile(), { wrapper });

    await act(async () => {
      await result.current.mutateAsync({
        events: [mockEvent1],
        targetRelay: 'wss://target.relay.test',
      });
    });

    expect(Nostrify.NPool).toHaveBeenCalledTimes(2);
    expect(mockToast).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Sync Complete' })
    );
  });

  it('should fail if both target and default relay fail', async () => {
    const mockEventResult = vi.fn().mockRejectedValue(new Error('Relay connection failed'));
    vi.mocked(Nostrify.NPool).mockImplementation(() => ({
      event: mockEventResult,
    } as unknown as InstanceType<typeof Nostrify.NPool>));
    vi.mocked(Nostrify.NRelay1).mockImplementation(() =>
      ({} as unknown as InstanceType<typeof Nostrify.NRelay1>)
    );

    const { result } = renderHook(() => useSyncProfile(), { wrapper });

    await act(async () => {
      await result.current.mutateAsync({
        events: [mockEvent1],
        targetRelay: 'wss://target.relay.test',
      });
    });

    expect(Nostrify.NPool).toHaveBeenCalledTimes(2);
    expect(mockToast).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Sync Failed' })
    );
  });

  it('should configure NRelay1 with NIP-42 AUTH callback', async () => {
    let capturedRelayUrl = '';
    let capturedAuthCallback: NRelay1Opts['auth'];

    vi.mocked(Nostrify.NRelay1).mockImplementation((url, opts) => {
      capturedRelayUrl = url;
      if (opts?.auth) {
        capturedAuthCallback = opts.auth;
      }
      return { url, opts } as unknown as InstanceType<typeof Nostrify.NRelay1> & {
        url: string;
        opts?: NRelay1Opts;
      };
    });

    const mockEventResult = vi.fn().mockResolvedValue(undefined);
    vi.mocked(Nostrify.NPool).mockImplementation((opts: NPoolOpts<InstanceType<typeof Nostrify.NRelay1>>) => {
      if (opts.open) {
        opts.open('wss://target.relay.test');
      }
      return { event: mockEventResult } as unknown as InstanceType<typeof Nostrify.NPool>;
    });

    const { result } = renderHook(() => useSyncProfile(), { wrapper });

    await act(async () => {
      await result.current.mutateAsync({
        events: [mockEvent1],
        targetRelay: 'wss://target.relay.test',
      });
    });

    expect(capturedRelayUrl).toBe('wss://target.relay.test');
    expect(capturedAuthCallback).toBeDefined();
    
    if (capturedAuthCallback) {
      const authEvent = await capturedAuthCallback('test-challenge-123');
      expect(authEvent.kind).toBe(22242);
      expect(authEvent.tags).toContainEqual(['relay', 'wss://target.relay.test']);
      expect(authEvent.tags).toContainEqual(['challenge', 'test-challenge-123']);
      expect(mockUser.signer.signEvent).toHaveBeenCalled();
    }
  });

  it('should reject invalid target relay URLs', async () => {
    const { result } = renderHook(() => useSyncProfile(), { wrapper });

    await expect(
      act(async () => {
        await result.current.mutateAsync({
          events: [mockEvent1],
          targetRelay: 'invalid-url',
        });
      })
    ).rejects.toThrow('Invalid target relay URL');
  });

  it('should throw error if no events are provided', async () => {
    const { result } = renderHook(() => useSyncProfile(), { wrapper });

    await expect(
      act(async () => {
        await result.current.mutateAsync({
          events: [],
          targetRelay: 'wss://target.relay.test',
        });
      })
    ).rejects.toThrow('No events to sync');
  });
});
