import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';

import { LcosWorksiteStage, shouldStageSwitchCanvas } from './LcosWorksiteStage';

const canvasState = {
  canvasId: 'canvas-main' as string | null,
  isLoading: false,
  canvasNotFound: false,
  canvasLoadFailure: null as { canvasId: string; kind: 'error' | 'not-found'; message: string } | null,
  loadCanvas: vi.fn(async (canvasId: string) => { canvasState.canvasId = canvasId; }),
  switchCanvas: vi.fn(async (canvasId: string) => { canvasState.canvasId = canvasId; }),
};

vi.mock('@/components/Common/Loading', () => ({ Loading: () => null }));
vi.mock('../host/CanvasHostBoundary', () => ({ CanvasHostBoundary: () => null }));
vi.mock('../ui/LcosSurfaceFeedback', () => ({ LcosSurfaceFeedback: ({ message, onAction }: { message: string; onAction?: () => void }) => <button onClick={onAction}>{message}</button> }));
vi.mock('@/store/canvasStore', () => ({
  default: (selector: (state: typeof canvasState) => unknown) => selector(canvasState),
}));
vi.mock('react-i18next', () => ({
  initReactI18next: { type: '3rdParty', init: () => undefined },
  useTranslation: () => ({ t: (key: string) => key }),
}));

describe('LcosWorksiteStage canvas transition guard', () => {
  it('does not switch an outgoing Main stage back after nav has moved to Context', () => {
    expect(shouldStageSwitchCanvas({
      requestedCanvasId: 'canvas-main',
      storeCanvasId: 'canvas-context',
      previousRequestedCanvasId: 'canvas-main',
    })).toBe(false);
  });

  it('switches when one mounted stage receives a genuinely new canvas prop', () => {
    expect(shouldStageSwitchCanvas({
      requestedCanvasId: 'canvas-workflow',
      storeCanvasId: 'canvas-context',
      previousRequestedCanvasId: 'canvas-context',
    })).toBe(true);
  });

  it('does not switch when the shared store owns the requested canvas', () => {
    expect(shouldStageSwitchCanvas({
      requestedCanvasId: 'canvas-context',
      storeCanvasId: 'canvas-context',
      previousRequestedCanvasId: 'canvas-context',
    })).toBe(false);
  });

  it('effect sequence A → B → external C does not switch unchanged B back', async () => {
    canvasState.canvasId = 'canvas-main';
    canvasState.loadCanvas.mockClear();
    canvasState.switchCanvas.mockClear();
    const host = document.createElement('div');
    const root = createRoot(host);
    const props = (canvasId: string) => ({
      projectId: 'project-1',
      surface: 'main' as const,
      canvasId,
      ensureCanvas: async () => canvasId,
    });

    await act(async () => { root.render(<LcosWorksiteStage {...props('canvas-main')} />); });
    await act(async () => { root.render(<LcosWorksiteStage {...props('canvas-context')} />); });
    expect(canvasState.switchCanvas).toHaveBeenCalledWith('canvas-context');

    canvasState.canvasId = 'canvas-workflow';
    canvasState.switchCanvas.mockClear();
    await act(async () => { root.render(<LcosWorksiteStage {...props('canvas-context')} />); });
    expect(canvasState.switchCanvas).not.toHaveBeenCalled();
    root.unmount();
  });

  it('offers retry without recreation for a network failure, but recreation for a real 404', async () => {
    const host = document.createElement('div');
    const root = createRoot(host);
    canvasState.canvasId = 'canvas-main';
    canvasState.switchCanvas.mockImplementation(async () => {});
    const props = { projectId: 'project-1', surface: 'context' as const, canvasId: 'canvas-context', ensureCanvas: vi.fn(async () => undefined) };
    canvasState.canvasLoadFailure = { canvasId: 'canvas-context', kind: 'error', message: 'offline' };
    await act(async () => root.render(<LcosWorksiteStage {...props} />));
    expect(host.textContent).toContain('offline');
    expect(host.querySelector('[data-lcos-recover-canvas]')).toBeNull();
    canvasState.switchCanvas.mockClear();
    await act(async () => host.querySelector<HTMLButtonElement>('button')?.click());
    expect(canvasState.switchCanvas).toHaveBeenCalledWith('canvas-context');
    expect(props.ensureCanvas).not.toHaveBeenCalled();
    canvasState.canvasLoadFailure = { canvasId: 'canvas-context', kind: 'not-found', message: 'missing' };
    await act(async () => root.render(<LcosWorksiteStage {...props} />));
    expect(host.querySelector('[data-lcos-recover-canvas]')).not.toBeNull();
    await act(async () => root.unmount());
    canvasState.canvasLoadFailure = null;
  });
});
