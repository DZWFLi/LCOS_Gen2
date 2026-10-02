import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({
  readSession: vi.fn(), readTimeline: vi.fn(), subscribe: vi.fn(),
  subscriptions: new Map<string, { event: () => void; artifact: (event: { type: string }) => void; recovery: () => void; close: ReturnType<typeof vi.fn> }>(),
}));
vi.mock('@local-creative-os/web-gen2', () => ({ CoreCollaborationClient: class {
  readSession = mocks.readSession; readTimeline = mocks.readTimeline; subscribe = mocks.subscribe;
} }));
vi.mock('../app/lcosCoreClient', () => ({ createLcosCoreSession: () => ({ http: {} }) }));
beforeEach(() => {
  vi.resetModules(); mocks.readSession.mockReset(); mocks.readTimeline.mockReset(); mocks.subscribe.mockReset(); mocks.subscriptions.clear();
  mocks.readSession.mockImplementation(async (projectId, conversationId) => ({ schemaVersion: 1, projectId, conversationId, userState: 'ready' }));
  mocks.readTimeline.mockResolvedValue([]);
  mocks.subscribe.mockImplementation((projectId: string, _conversationId: string, event: () => void, options: { onProjectEvent: (event: { type: string }) => void; onProjectRecovery: () => void }) => {
    const close = vi.fn(); mocks.subscriptions.set(projectId, { event, artifact: options.onProjectEvent, recovery: options.onProjectRecovery, close }); return close;
  });
});
async function store() { return (await import('./collaborationSessionStore')).useCollaborationSessionStore.getState(); }
async function settle() { await new Promise((resolve) => setTimeout(resolve, 0)); }
describe('shared conversation subscription consumer lifetime', () => {
  it('closing one of Glyth/WorkView/Composer preserves remaining consumers and refreshes once per event', async () => {
    const state = await store();
    state.watch('project', 'conversation'); state.watch('project', 'conversation'); state.watch('project', 'conversation');
    await settle();
    expect(mocks.subscribe).toHaveBeenCalledTimes(1); expect(mocks.readSession).toHaveBeenCalledTimes(1);
    const subscription = mocks.subscriptions.get('project')!;
    state.unwatch('project', 'conversation');
    expect(subscription.close).not.toHaveBeenCalled();
    mocks.readSession.mockClear(); subscription.event(); await settle();
    expect(mocks.readSession).toHaveBeenCalledExactlyOnceWith('project', 'conversation', expect.any(AbortSignal));
    state.unwatch('project', 'conversation'); expect(subscription.close).not.toHaveBeenCalled();
    state.unwatch('project', 'conversation'); expect(subscription.close).toHaveBeenCalledTimes(1);
    state.unwatch('project', 'conversation'); expect(subscription.close).toHaveBeenCalledTimes(1);
  });
  it('shares one project SSE across different conversations and stops refreshing only the released conversation', async () => {
    const state = await store(); state.watch('project', 'a'); state.watch('project', 'b'); await settle();
    const subscription = mocks.subscriptions.get('project')!;
    expect(mocks.subscribe).toHaveBeenCalledTimes(1);
    state.unwatch('project', 'a'); mocks.readSession.mockClear(); subscription.event(); await settle();
    expect(mocks.readSession).toHaveBeenCalledExactlyOnceWith('project', 'b', expect.any(AbortSignal)); expect(subscription.close).not.toHaveBeenCalled();
    state.unwatch('project', 'b'); expect(subscription.close).toHaveBeenCalledTimes(1);
  });
  it('keeps Artifact Reader invalidation on the same SSE until its final consumer releases', async () => {
    const state = await store(); const readerRefresh = vi.fn();
    const stopReader = state.watchArtifactChanges('project', readerRefresh); state.watch('project', 'conversation'); await settle();
    const subscription = mocks.subscriptions.get('project')!;
    state.unwatch('project', 'conversation'); expect(subscription.close).not.toHaveBeenCalled();
    subscription.artifact({ type: 'artifact.changed' }); expect(readerRefresh).toHaveBeenCalledTimes(1);
    subscription.artifact({ type: 'run.changed' }); expect(readerRefresh).toHaveBeenCalledTimes(1);
    stopReader(); expect(subscription.close).toHaveBeenCalledTimes(1);
    stopReader(); expect(subscription.close).toHaveBeenCalledTimes(1);
  });
  it('snapshot recovery invalidates Artifact/host consumers once and refreshes session/project consumers once', async () => {
    const state = await store(); const artifactHostRefresh = vi.fn(); const railwayRefresh = vi.fn();
    const stopArtifact = state.watchArtifactChanges('project', artifactHostRefresh);
    const stopRailway = state.watchProjectChanges('project', railwayRefresh);
    state.watch('project', 'conversation'); await settle();
    const subscription = mocks.subscriptions.get('project')!;
    mocks.readSession.mockClear();
    subscription.event();
    subscription.recovery();
    expect(artifactHostRefresh).toHaveBeenCalledTimes(1);
    await settle();
    expect(railwayRefresh).toHaveBeenCalledTimes(1);
    expect(mocks.readSession).toHaveBeenCalledExactlyOnceWith('project', 'conversation', expect.any(AbortSignal));
    stopArtifact(); stopRailway(); state.unwatch('project', 'conversation');
  });
  it('can remount after final cleanup and isolates identical conversation ids in different projects', async () => {
    const state = await store(); state.watch('a', 'same'); state.watch('b', 'same'); await settle();
    const first = mocks.subscriptions.get('a')!; const other = mocks.subscriptions.get('b')!;
    state.unwatch('a', 'same'); expect(first.close).toHaveBeenCalledTimes(1); expect(other.close).not.toHaveBeenCalled();
    state.watch('a', 'same'); await settle(); expect(mocks.subscribe).toHaveBeenCalledTimes(3);
    state.unwatch('a', 'same'); state.unwatch('b', 'same');
    expect(mocks.subscriptions.get('a')!.close).toHaveBeenCalledTimes(1); expect(other.close).toHaveBeenCalledTimes(1);
  });
});


it('Railway invalidation shares the existing SSE and survives closing conversation and reader consumers', async () => {
  const state = await store(); const nav = vi.fn(); const reader = vi.fn();
  const stopNav = state.watchProjectChanges('project', nav);
  const stopReader = state.watchArtifactChanges('project', reader);
  state.watch('project', 'a'); await settle();
  expect(mocks.subscribe).toHaveBeenCalledTimes(1);
  const subscription = mocks.subscriptions.get('project')!;
  state.unwatch('project', 'a'); stopReader();
  expect(subscription.close).not.toHaveBeenCalled();
  subscription.event(); expect(nav).toHaveBeenCalledTimes(1);
  mocks.readSession.mockClear(); subscription.event();
  expect(mocks.readSession).not.toHaveBeenCalled();
  stopNav(); expect(subscription.close).toHaveBeenCalledTimes(1);
  stopNav(); expect(subscription.close).toHaveBeenCalledTimes(1);
});
