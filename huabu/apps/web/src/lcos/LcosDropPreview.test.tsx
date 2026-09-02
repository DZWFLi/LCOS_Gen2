// A06 drop-preview overlay tests: it renders nothing on idle, and once the
// store holds a preview it paints a non-interactive hint that states what WILL
// happen (never a second taxonomy picker).
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import { afterEach, describe, expect, it } from 'vitest';

import type { SemanticDropState } from '@local-creative-os/web-gen2';

import { LcosDropPreview } from './LcosDropPreview';
import { useLcosDropStore } from './lcosDropState';

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

describe('LcosDropPreview (A06)', () => {
  it('renders nothing when no drop is in flight (no Santa-tree chrome)', () => {
    const container = render(<LcosDropPreview />);
    expect(container.querySelector('[data-lcos-drop-preview]')).toBeNull();
  });

  it('paints a hint describing the pending action + surface once a preview exists', () => {
    useLcosDropStore.setState({ state: previewState });
    const container = render(<LcosDropPreview />);
    const el = container.querySelector('[data-lcos-drop-preview]');
    expect(el).not.toBeNull();
    expect(el?.textContent).toContain('放置 artifact·a1');
    expect(el?.textContent).toContain('底部停靠区');
  });

  it('unmounts the hint when the drop is cancelled', () => {
    useLcosDropStore.setState({ state: previewState });
    const container = render(<LcosDropPreview />);
    expect(container.querySelector('[data-lcos-drop-preview]')).not.toBeNull();
    act(() => {
      useLcosDropStore.getState().cancel();
    });
    expect(container.querySelector('[data-lcos-drop-preview]')).toBeNull();
  });
});