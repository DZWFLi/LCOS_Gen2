import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ nodes: [] as Array<{ id: string; selected: boolean; parentId?: string; position: { x: number; y: number }; data: object; type: string }>, deleteNodes: vi.fn(), move: vi.fn() }));
vi.mock('@/store/canvasStore', () => ({ default: (select: (s: { nodes: typeof mocks.nodes; edges: never[]; canvasId: string; deleteNodes: typeof mocks.deleteNodes; setMoveSelectionDialogOpen: typeof mocks.move }) => unknown) => select({ nodes: mocks.nodes, edges: [], canvasId: 'canvas', deleteNodes: mocks.deleteNodes, setMoveSelectionDialogOpen: mocks.move }) }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (s: string) => s }) }));
vi.mock('@/hooks/useInputMode', () => ({ useIsNotMouse: () => true }));
vi.mock('@/i18n/colors', () => ({ translateColorOptions: () => [] }));
vi.mock('@/components/Common/CanvasFloatingPopover', () => ({ CanvasFloatingPopover: ({ children }: { children: ReactNode }) => <div>{children}</div> }));
vi.mock('@/components/Common/FloatingToolbar', () => ({ FLOATING_TOOLBAR_CLASS: '', FloatingToolbar: { Popover: ({ children }: { children: ReactNode }) => <div>{children}</div>, AlignPicker: () => null, SizePicker: () => null, NumberInput: () => null, ColorPicker: () => null, Divider: () => null, ActionButton: ({ title, disabled, onClick }: { title: string; disabled?: boolean; onClick: () => void }) => <button title={title} disabled={disabled} onClick={onClick}>{title}</button> } }));
import { LcosMultiSelectToolbar } from './LcosMultiSelectToolbar';
import { useLcosReferenceStore } from '../lcosReferenceState';
import { useLcosShellStore } from '../shell/lcosShellStore';
let host: HTMLDivElement; let root: Root;
const node = (id: string, selected = true, parentId?: string) => ({ id, selected, ...(parentId ? { parentId } : {}), position: { x: 0, y: 0 }, data: {}, type: 'image' });
beforeEach(() => {
  mocks.nodes = [node('a'), node('b')]; mocks.deleteNodes.mockClear(); mocks.move.mockClear();
  useLcosShellStore.setState({ projectId: 'p' });
  useLcosReferenceStore.setState({ projectId: 'p', bindingCanvasId: 'canvas', bindingIdentitiesReady: true, nodeEntityRefs: new Map() });
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); host.remove(); });
const render = () => act(() => root.render(<LcosMultiSelectToolbar />));
const clickAll = () => act(() => host.querySelectorAll<HTMLButtonElement>('button').forEach((b) => b.click()));
it('keeps native selection move and touch delete operational', () => {
  render(); clickAll(); expect(mocks.move).toHaveBeenCalledWith(true); expect(mocks.deleteNodes).toHaveBeenCalledWith(['a', 'b']);
});
it('prevents mixed selection from moving or partially deleting bound objects', () => {
  useLcosReferenceStore.setState({ nodeEntityRefs: new Map([['a', { entityType: 'artifact', entityId: 'artifact-a' }]]) });
  render(); clickAll(); expect(mocks.move).not.toHaveBeenCalled(); expect(mocks.deleteNodes).not.toHaveBeenCalled();
  expect([...host.querySelectorAll('button')].filter((b) => ['common.moveToCanvas', 'common.delete'].includes(b.title)).every((b) => b.disabled)).toBe(true);
});
it('protects a selected parent with an unselected bound descendant', () => {
  mocks.nodes.push(node('child', false, 'a'));
  useLcosReferenceStore.setState({ nodeEntityRefs: new Map([['child', { entityType: 'conversation', entityId: 'conversation-c' }]]) });
  render(); clickAll(); expect(mocks.move).not.toHaveBeenCalled(); expect(mocks.deleteNodes).not.toHaveBeenCalled();
});
it('waits for current canvas identities and enables ordinary nodes once ready', () => {
  useLcosReferenceStore.setState({ bindingCanvasId: 'old-canvas' }); render(); clickAll();
  expect(mocks.deleteNodes).not.toHaveBeenCalled(); expect(mocks.move).not.toHaveBeenCalled();
  act(() => useLcosReferenceStore.setState({ bindingCanvasId: 'canvas' })); clickAll();
  expect(mocks.deleteNodes).toHaveBeenCalledWith(['a', 'b']);
});
it('exposes create-Collection action through the production host toolbar for fully bound selection', () => {
  useLcosReferenceStore.setState({ nodeEntityRefs: new Map([
    ['a', { entityType: 'artifact', entityId: 'artifact-a' }],
    ['b', { entityType: 'note', entityId: 'note-b' }],
  ]) });
  render();
  const action = host.querySelector<HTMLButtonElement>('button[aria-label="收成集合"]');
  expect(action).not.toBeNull();
  expect(action?.disabled).toBe(false);
});
