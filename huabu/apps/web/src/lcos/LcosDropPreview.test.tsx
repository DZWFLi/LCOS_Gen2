// A06 drop-preview overlay tests: it renders nothing on idle, and once the
// store holds a preview it paints a non-interactive hint that states what WILL
// happen (never a second taxonomy picker).
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import { afterEach, describe, expect, it } from 'vitest';


import { LcosDropPreview } from './LcosDropPreview';
import { useLcosDropStore } from './lcosDropState';
import { resolveDropIntent } from './drop/dropIntentResolver';

import type { SemanticDropState } from '@local-creative-os/web-gen2';
import type { DropTargetRegistration } from './drop/dropTypes';

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
  // Feedback is portal-mounted so professional windows cannot clip it.
  return document.body;
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
  payload: { kind: 'object', entityType: 'artifact', entityId: 'a1', artifactViewId: 'view-a' },
  destination: {
    targetId: 'railway:context-a',
    previewPoint: { x: 400, y: 700 },
  },
  carryAnchor: 'bottom',
};

describe('LcosDropPreview (A06)', () => {
  it('renders nothing when no drop is in flight (no Santa-tree chrome)', () => {
    const container = render(<LcosDropPreview />);
    expect(container.querySelector('[data-lcos-drop-preview]')).toBeNull();
  });

  it('paints a hint describing the pending action + stable target once a preview exists', () => {
    useLcosDropStore.setState({ state: previewState });
    const container = render(<LcosDropPreview />);
    const el = container.querySelector('[data-lcos-drop-preview]');
    expect(el).not.toBeNull();
    expect(el?.textContent).toContain('材料');
    expect(el?.textContent).toContain('等待接收位置');
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

  it.each([
    [{ targetId: 'glyth:node-a', kind: 'collaboration-reference', label: '创作会话', priority: 20, enabled: true,
      semantic: { kind: 'collaboration-reference', conversationId: 'conversation-a' } }, '持久加入「创作会话」的上下文'],
    [{ targetId: 'composer:one', kind: 'composer-reference', label: '本次草稿', priority: 20, enabled: true,
      semantic: { kind: 'composer-reference' } }, '仅加入本次草稿引用'],
    [{ targetId: 'railway:context-a', kind: 'railway-receive', label: '上下文现场', priority: 20, enabled: true,
      semantic: { kind: 'railway-receive', targetRef: { kind: 'workspace', id: 'workspace-a' }, destinationRef: { kind: 'context', viewId: 'context-a' } } }, '投递到 Railway · 上下文现场'],
    [{ targetId: 'portal:node-a', kind: 'portal-receive', label: '入口 · 资料现场', priority: 20, enabled: true,
      semantic: { kind: 'portal-receive', targetRef: { kind: 'workspace', id: 'workspace-a' } } }, '投递到「入口 · 资料现场」'],
  ] as const)('names the real destination and distinguishes durable from draft-only actions', (targetShape, expected) => {
    const target = { ...targetShape, rect: { left: 10, top: 20, width: 80, height: 80 } } as DropTargetRegistration;
    useLcosDropStore.getState().registerTarget(target);
    const resolution = resolveDropIntent(previewState.payload, target);
    useLcosDropStore.setState({ state: { ...previewState, destination: { ...previewState.destination, targetId: target.targetId } }, resolution });
    const container = render(<LcosDropPreview />);
    expect(container.querySelector('[data-lcos-drop-preview]')?.textContent).toContain(expected);
  });
});
