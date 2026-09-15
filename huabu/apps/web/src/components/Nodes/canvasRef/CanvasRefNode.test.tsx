import { act, type PropsWithChildren } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import { CanvasRefNode } from './CanvasRefNode';

const mocks = vi.hoisted(() => ({ navigate: vi.fn(), hostBody: false }));
vi.mock('react-router-dom', () => ({ useNavigate: () => mocks.navigate }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('@/lcos-seam/nodeBodySlot', () => ({ useResolvedNodeBody: () => mocks.hostBody ? () => null : undefined }));
vi.mock('@/store/canvasStore', () => ({ default: (select: (s: { nodes: { id: string; selected: boolean }[] }) => unknown) => select({ nodes: [{ id: 'p', selected: true }] }) }));
vi.mock('@/store/workspaceStore', () => ({ useWorkspaceStore: (select: (s: { spaceTitles: Record<string, string>; spaceTitlesLoaded: boolean }) => unknown) => select({ spaceTitles: { child: 'Child' }, spaceTitlesLoaded: true }) }));
vi.mock('@/components/Nodes/NodeWrapper', () => ({ NodeWrapper: ({ children, onDoubleClick }: PropsWithChildren<{ onDoubleClick?: () => void }>) => <div data-wrapper onDoubleClick={onDoubleClick}>{children}</div> }));
let host: HTMLDivElement;
let root: Root;
beforeEach(() => { mocks.navigate.mockClear(); host = document.createElement('div'); document.body.append(host); root = createRoot(host); });
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });
async function exercise(hostBody: boolean) {
  mocks.hostBody = hostBody;
  await act(async () => root.render(<CanvasRefNode id="p" data={{ type: 'canvasRef', targetCanvasId: 'child' }} selected type="canvasRef" dragging={false} isConnectable draggable selectable deletable zIndex={0} positionAbsoluteX={0} positionAbsoluteY={0} />));
  await act(async () => {
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    host.querySelector('[data-wrapper]')?.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
  });
}
it('retains native Enter and double click when there is no host body', async () => {
  await exercise(false);
  expect(mocks.navigate).toHaveBeenCalledTimes(2);
  expect(mocks.navigate).toHaveBeenCalledWith('/canvas/child');
});
it('does not retain native navigation underneath a host body', async () => {
  await exercise(true);
  expect(mocks.navigate).not.toHaveBeenCalled();
});
