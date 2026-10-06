import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useLcosDensity } from '@/lcos/nodes/useLcosDensity';

import { NodeWrapper } from './NodeWrapper';

import type { NodeData } from './types';

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const runtime = vi.hoisted(() => ({
  zoom: 0.1,
  nodeCount: 1,
  hostPresentation: undefined as
    | undefined
    | {
        surface: 'body';
        selectionFeedback: 'body';
        allowOverflow: boolean;
        showAiBadge: boolean;
      },
}));

vi.mock('@xyflow/react', () => ({
  NodeResizer: () => null,
  useInternalNode: () => ({
    internals: { positionAbsolute: { x: 0, y: 0 } },
    style: {},
  }),
  useViewport: () => ({ zoom: runtime.zoom, x: 0, y: 0 }),
  useStore: (selector: (state: unknown) => unknown) =>
    selector({
      domNode: null,
      transform: [0, 0, runtime.zoom],
      width: 1200,
      height: 800,
      nodeLookup: new Map(Array.from({ length: runtime.nodeCount }, (_, index) => [
          `node-${index + 1}`,
          { id: `node-${index + 1}`,
            internals: { positionAbsolute: { x: 0, y: 0 } },
            style: { width: 400, height: 300 },
            measured: { width: 400, height: 300 },
          },
        ])),
    }),
}));

vi.mock('@/api/canvas.ts', () => ({
  getNodeContent: vi.fn(),
  revealCanvasNodesFolder: vi.fn(),
}));
vi.mock('@/components/Common/Loading', () => ({ Loading: () => null }));
vi.mock(
  '@/components/Panels/Canvas/FloatingToolbars/NodeFloatingToolbar.tsx',
  () => ({
    NodeFloatingToolbar: () => null,
  }),
);
vi.mock('./NodeConnectAffordance.tsx', () => ({
  NodeConnectionHandles: () => null,
}));
vi.mock('@/hooks/useInputMode.ts', () => ({ useIsNotMouse: () => false }));
vi.mock('@/hooks/useMultiSelectModifier.ts', () => ({
  useMultiSelectModifierHeld: () => false,
}));
vi.mock('@/lcos-seam/chromeModeSlot', () => ({
  shouldStandDownLegacyNodeToolbar: () => true,
  useCanvasChromeMode: () => 'lcos',
}));
vi.mock('@/lcos-seam/nodeBodySlot', () => ({
  useResolvedNodeHostPresentation: () => runtime.hostPresentation,
}));
vi.mock('@/store/connectPortStore.ts', () => ({
  useConnectPortStore: (selector: (state: unknown) => unknown) =>
    selector({ pending: null }),
}));
vi.mock('@/store/gesturePreviewStore.ts', () => ({
  useGesturePreviewStore: (selector: (state: unknown) => unknown) =>
    selector({ sketchStrokeSelection: {} }),
}));
vi.mock('@/store/nodeCollapseStore.ts', () => ({
  useNodeCollapseStore: (selector: (state: unknown) => unknown) =>
    selector({ marks: {} }),
}));
vi.mock('@/store/canvasStore.ts', () => {
  const state = {
    nodes: [] as unknown[],
    ingestionByNodeId: {},
    setNodeGeometry: vi.fn(),
    onNodeResizeStart: vi.fn(),
    updateResizePreview: vi.fn(),
    endResizePreview: vi.fn(),
    rfInstance: undefined,
  };
  const store = Object.assign(
    (selector: (value: typeof state) => unknown) => {
      state.nodes = Array.from({ length: runtime.nodeCount }, () => ({}));
      return selector(state);
    },
    { getState: () => state },
  );
  return { default: store, clearNodeDuplicateGuard: vi.fn() };
});

let roots: Root[] = [];
let containers: HTMLElement[] = [];

function DensityProbe() {
  return <div data-density={useLcosDensity()} />;
}

function renderWrapper(): HTMLElement {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  roots.push(root);
  containers.push(container);
  act(() => {
    root.render(
      <NodeWrapper
        id="node-1"
        type="note"
        data={{ label: 'LOD proof' } as unknown as NodeData}
      >
        <DensityProbe />
      </NodeWrapper>,
    );
  });
  return container;
}

afterEach(() => {
  runtime.zoom = 0.1;
  runtime.nodeCount = 1;
  runtime.hostPresentation = undefined;
  for (const root of roots) act(() => root.unmount());
  for (const container of containers) container.remove();
  roots = [];
  containers = [];
});

describe('NodeWrapper LOD ownership', () => {
  it('keeps a low-zoom LCOS host body visible and lets Gen2 render mark', () => {
    runtime.hostPresentation = {
      surface: 'body',
      selectionFeedback: 'body',
      allowOverflow: false,
      showAiBadge: false,
    };
    const container = renderWrapper();
    const root = container.querySelector('[data-lcos-host-surface="body"]');

    expect(root?.getAttribute('data-lod')).toBe('full');
    expect(root?.querySelector('.semantic-lod-placeholder')).toBeNull();
    expect(root?.querySelector('[data-density="mark"]')).not.toBeNull();
  });

  it('renders reading at high zoom and preserves the node-count cap', () => {
    runtime.hostPresentation = {
      surface: 'body',
      selectionFeedback: 'body',
      allowOverflow: false,
      showAiBadge: false,
    };
    runtime.zoom = 2;
    let container = renderWrapper();
    expect(container.querySelector('[data-density="reading"]')).not.toBeNull();

    runtime.nodeCount = 301;
    container = renderWrapper();
    expect(container.querySelector('[data-density="summary"]')).not.toBeNull();
  });

  it('preserves Huabu native minimal placeholder behavior', () => {
    runtime.hostPresentation = undefined;
    const container = renderWrapper();
    const root = container.querySelector('.semantic-lod-node');

    expect(root?.getAttribute('data-lod')).toBe('minimal');
    expect(root?.querySelector('.semantic-lod-placeholder')).not.toBeNull();
  });
});
