import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';

import { TemporalRail } from './TemporalRail';

const getIndex = vi.hoisted(() => vi.fn());
vi.mock('../../app/lcosCoreClient', () => ({ createLcosCoreSession: () => ({ temporal: { getIndex } }) }));
vi.mock('../../lcosReferenceState', () => ({ useLcosReferenceStore: (select: (value: { nodeEntityRefs: Map<string, never> }) => unknown) => select({ nodeEntityRefs: new Map<string, never>() }) }));
vi.mock('../../ui/context/TemporalRailView', () => ({ TemporalRailView: ({ state, onRetry }: { state: string; onRetry: () => void }) => <div data-state={state}><button onClick={onRetry}>重试</button></div> }));
const empty = { value: { facts: [], mid: [] } };
describe('Temporal rail request continuity', () => {
  it('retries the same child index after failure', async () => {
    getIndex.mockReset().mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(empty);
    const host = document.createElement('div'); const root = createRoot(host);
    try {
      await act(async () => root.render(<TemporalRail projectId="p" workspaceId="child" />));
      expect(host.firstElementChild?.getAttribute('data-state')).toBe('error');
      await act(async () => host.querySelector('button')?.click());
      expect(getIndex).toHaveBeenLastCalledWith('p', 'child', expect.any(AbortSignal));
      expect(host.firstElementChild).toBeNull();
    } finally { await act(async () => root.unmount()); }
  });
  it('ignores a late successful index from the previous child', async () => {
    let finish!: (value: unknown) => void;
    getIndex.mockReset().mockReturnValueOnce(new Promise((resolve) => { finish = resolve; })).mockResolvedValueOnce(empty);
    const host = document.createElement('div'); const root = createRoot(host);
    try {
      await act(async () => root.render(<TemporalRail projectId="p" workspaceId="old" />));
      await act(async () => root.render(<TemporalRail projectId="p" workspaceId="new" />));
      expect((getIndex.mock.calls[0]?.[2] as AbortSignal).aborted).toBe(true);
      await act(async () => finish({ value: { facts: [{}], mid: [] } }));
      expect(host.firstElementChild).toBeNull();
    } finally { await act(async () => root.unmount()); }
  });
});
