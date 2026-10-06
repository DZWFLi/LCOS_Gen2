import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';

import { NodeConnectionHandles } from './NodeConnectAffordance';

const runtime = vi.hoisted(() => ({ setPending: vi.fn() }));
vi.mock('@xyflow/react', () => ({
  Position: { Top: 'top', Right: 'right', Bottom: 'bottom', Left: 'left' },
  Handle: ({ children, id, type }: { children: ReactNode; id: string; type: string }) =>
    <div data-handle-id={id} data-handle-type={type}>{children}</div>,
  useInternalNode: () => ({
    internals: { positionAbsolute: { x: 10, y: 20 } },
    measured: { width: 200, height: 120 }, style: {},
  }),
  useStore: (selector: (state: { domNode: null; transform: number[] }) => unknown) =>
    selector({ domNode: null, transform: [0, 0, 1] }),
  useConnection: (selector: (state: { inProgress: boolean; fromHandle: null }) => unknown) =>
    selector({ inProgress: false, fromHandle: null }),
  useUpdateNodeInternals: () => vi.fn(),
}));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('@/components/Common/Tooltip.tsx', () => ({
  Tooltip: ({ children }: { children: ReactNode }) => <>{children}</>,
}));
vi.mock('@/hooks/useMultiSelectModifier.ts', () => ({ useMultiSelectModifierHeld: () => false }));
vi.mock('@/store/canvasStore.ts', () => ({ default: Object.assign(vi.fn(), { getState: vi.fn() }) }));
vi.mock('@/components/Nodes/question/questionCompose.ts', () => ({ createQuestionNodeAndCompose: vi.fn() }));
vi.mock('@/store/nodeCollapseStore.ts', () => ({
  useNodeCollapseStore: (selector: (state: { marks: object }) => unknown) => selector({ marks: {} }),
}));
vi.mock('@/store/connectPortStore.ts', () => ({
  useConnectPortStore: Object.assign(
    (selector: (state: { pending: null }) => unknown) => selector({ pending: null }),
    { getState: () => ({ setPending: runtime.setPending }) },
  ),
}));

let root: Root | undefined;
let container: HTMLDivElement;
function render(allowConnectedNodeCreation?: boolean) {
  container = document.createElement('div');
  document.body.append(container);
  const mountedRoot = createRoot(container);
  root = mountedRoot;
  act(() => mountedRoot.render(<NodeConnectionHandles nodeId="bound-material" hovered selected
    isNotMouse={false} dragging={false} allowConnectedNodeCreation={allowConnectedNodeCreation} />));
  return container;
}
afterEach(() => {
  act(() => root?.unmount());
  container.remove();
  runtime.setPending.mockClear();
});

it('retains all Relation handles without allowing keyboard native-node creation on hosted materials', () => {
  const host = render(false);
  expect(host.querySelectorAll('[data-handle-id]')).toHaveLength(8);
  expect(host.querySelector('[role="button"]')).toBeNull();
  act(() => host.querySelectorAll('[data-handle-type="source"] > span').forEach((port) =>
    port.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))));
  expect(runtime.setPending).not.toHaveBeenCalled();
});

it('preserves the existing keyboard create action and anchor for native nodes by default', () => {
  const host = render();
  expect(host.querySelectorAll('[role="button"]')).toHaveLength(4);
  const port = host.querySelector('[data-handle-id="top-source"] [role="button"]');
  act(() => port?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })));
  expect(runtime.setPending).toHaveBeenCalledWith({
    sourceId: 'bound-material', side: 'top', anchor: { x: 110, y: 20 }, kind: 'side',
  });
});
