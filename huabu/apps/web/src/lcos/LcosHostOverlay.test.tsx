// A07 LcosHostOverlay tests — the canvas-level overlay container arbitrates
// child overlays through visibleOverlays: a drop in flight suppresses the
// composer and lets the drop-preview through; idle renders neither.
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import { afterEach, describe, expect, it } from 'vitest';


import { useLcosDropStore } from './lcosDropState';
import { LcosHostOverlay } from './LcosHostOverlay';
import { useLcosReferenceStore } from './lcosReferenceState';

import type { SemanticDropState } from '@local-creative-os/web-gen2';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

let roots: Root[] = [];
let containers: HTMLElement[] = [];

function render(element: React.JSX.Element): HTMLElement {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  roots.push(root);
  containers.push(container);
  act(() => {
    root.render(element);
  });
  return container;
}

afterEach(() => {
  for (const root of roots) act(() => root.unmount());
  for (const container of containers) container.remove();
  roots = [];
  containers = [];
  document.body.replaceChildren();
  useLcosDropStore.getState().reset();
  useLcosReferenceStore.getState().reset();
});

const previewState: SemanticDropState = {
  status: 'preview',
  payload: { kind: 'object', entityType: 'artifact', entityId: 'a1' },
  destination: {
    kind: 'slot',
    anchor: 'bottom',
    surface: 'surface:bottom-dock',
    place: { x: 400, y: 700 },
  },
};

describe('LcosHostOverlay (A07)', () => {
  it('idle shows neither composer-docked drop preview nor composer chrome', () => {
    const container = render(<LcosHostOverlay />);
    expect(container.querySelector('[data-lcos-drop-preview]')).toBeNull();
    expect(container.querySelector('[data-lcos-composer]')).toBeNull();
  });

  it('drop in flight renders the drop preview through the arbitrated container', () => {
    useLcosDropStore.setState({ state: previewState });
    const container = render(<LcosHostOverlay />);
    const el = container.querySelector('[data-lcos-drop-preview]');
    expect(el).not.toBeNull();
    expect(el?.textContent).toContain('放置 artifact·a1');
  });

  it('drop in transit suppresses the drop preview (single canopy, no Christmas tree)', () => {
    // A draft exists -> 历史 A04 画布级 composer 会在此时出现；Wave 10 已退役该壳
    // （唯一 Composer = route-level LcosComposerHost），本断言固定"画布级不产出
    // 第二个输入面"这一不变量。
    useLcosReferenceStore.getState().registerNodeEntity('node-9', {
      entityType: 'artifact',
      entityId: 'e-9',
    });
    useLcosReferenceStore.getState().toggleNodeReference('node-9');
    useLcosDropStore.setState({ state: { status: 'tracking', payload: { kind: 'object', entityType: 'artifact', entityId: 'a1' } } as SemanticDropState });
    const container = render(<LcosHostOverlay />);
    expect(container.querySelector('[data-lcos-composer]')).toBeNull();
    // Not in preview yet either.
    expect(container.querySelector('[data-lcos-drop-preview]')).toBeNull();
  });

  it('有草稿时画布级 overlay 仍不产出 composer（composer 归 route-level Host）', () => {
    useLcosReferenceStore.getState().registerNodeEntity('node-9', {
      entityType: 'artifact',
      entityId: 'e-9',
    });
    useLcosReferenceStore.getState().toggleNodeReference('node-9');
    const container = render(<LcosHostOverlay />);
    expect(container.querySelector('[data-lcos-composer]')).toBeNull();
  });
});
