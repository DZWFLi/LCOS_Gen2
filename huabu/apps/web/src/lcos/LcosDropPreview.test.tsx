// A06 drop-preview overlay tests: it renders nothing on idle, and once the
// store holds a preview it paints a non-interactive hint that states what WILL
// happen (never a second taxonomy picker).
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import { afterEach, describe, expect, it } from 'vitest';


import { resolveDropIntent } from './drop/dropIntentResolver';
import { LcosDropPreview } from './LcosDropPreview';
import { useLcosDropStore } from './lcosDropState';

import type { DropTargetRegistration } from './drop/dropTypes';
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

  it('shows only nearby resolver-approved receivers while carrying', () => {
    const target: DropTargetRegistration = {
      targetId: 'capture:main', kind: 'external-import', label: '资料收集区', priority: 30, enabled: true,
      rect: { left: 24, top: 36, width: 180, height: 96 },
      semantic: { kind: 'external-import', owner: 'capture' },
    };
    const rejected: DropTargetRegistration = {
      ...target, targetId: 'capture:disabled', label: '暂不可用的位置', enabled: false,
      ineligibleReason: '暂不可用', rect: { left: 240, top: 36, width: 180, height: 96 },
    };
    useLcosDropStore.getState().registerTarget(target);
    useLcosDropStore.getState().registerTarget(rejected);
    useLcosDropStore.setState({ state: { status: 'tracking', payload: { kind: 'text', value: '仅为测试' } }, pointerScreenPoint: { x: 210, y: 70 } });

    const container = render(<LcosDropPreview />);
    const receivers = container.querySelectorAll('[data-lcos-drop-receptor]');
    expect(receivers).toHaveLength(1);
    expect(receivers[0]?.getAttribute('data-target-label')).toBe('资料收集区');
    expect(receivers[0]?.getAttribute('data-state')).toBe('approaching');
    expect((receivers[0] as HTMLElement).style.left).toBe('24px');
    expect((receivers[0] as HTMLElement).style.width).toBe('180px');
    expect(container.querySelector('[data-presentation="carrying"]')?.textContent).toContain('拖到接收空间');
  });

  it('keeps the exact rejected receiver visible with its reason and real bounds', () => {
    const target: DropTargetRegistration = {
      targetId: 'capture:main', kind: 'external-import', label: '资料收集区', priority: 30, enabled: true,
      rect: { left: 42, top: 58, width: 120, height: 72 },
      semantic: { kind: 'external-import', owner: 'capture' },
    };
    useLcosDropStore.getState().registerTarget(target);
    const resolution = resolveDropIntent(previewState.payload, target);
    if (resolution.status !== 'ineligible') throw new Error('test fixture must be rejected by the existing resolver');
    useLcosDropStore.setState({ state: { ...previewState, destination: { ...previewState.destination, targetId: target.targetId } }, resolution });

    const container = render(<LcosDropPreview />);
    const receiver = container.querySelector('[data-lcos-drop-receptor]') as HTMLElement | null;
    expect(receiver?.getAttribute('data-state')).toBe('rejected');
    expect(receiver?.getAttribute('data-target-label')).toBe('资料收集区');
    expect(receiver?.style.left).toBe('42px');
    expect(container.querySelector('[data-lcos-drop-preview]')?.textContent).toContain('资料收集区：此目标只接收文件、文本或链接');
  });

  it('uses the captured assembly reference label while a native source is held', () => {
    const target: DropTargetRegistration = {
      targetId: 'railway:worksite-a', kind: 'railway-receive', label: '资料现场', priority: 30, enabled: true,
      rect: { left: 0, top: 0, width: 100, height: 80 },
      semantic: { kind: 'railway-receive', targetRef: { kind: 'workspace', id: 'workspace-a' },
        destinationRef: { kind: 'worksite', projectId: 'project-a', worksiteId: 'worksite-a' }, canvasId: 'canvas-a' },
    };
    useLcosDropStore.getState().registerTarget(target);
    useLcosDropStore.setState({ state: {
      status: 'tracking',
      payload: { kind: 'assembly', itemId: 'item-1', sourceRef: { kind: 'note', id: 'note-1' },
        reference: { entityType: 'note', entityId: 'note-1', displayLabel: '施工说明' } },
    }, pointerScreenPoint: { x: 120, y: 40 } });

    const container = render(<LcosDropPreview />);
    expect(container.querySelector('[data-presentation="carrying"]')?.textContent).toContain('施工说明');
  });


  it('keeps a carry proxy at the screen pointer even when there are no receivers', () => {
    useLcosDropStore.setState({ state: { status: 'tracking', payload: { kind: 'text', value: '测试' } },
      pointerScreenPoint: { x: 320, y: 240 } });
    const container = render(<LcosDropPreview />);
    expect(container.querySelector('[data-lcos-carry-proxy]')).not.toBeNull();
    expect(container.querySelector('[data-presentation="carrying"]')).not.toBeNull();
    expect(container.querySelector('[data-lcos-drop-receptor]')).toBeNull();
    expect(useLcosDropStore.getState().resolution).toBeNull();
  });

  it('does not invent a position before the transport supplies its first sample', () => {
    useLcosDropStore.setState({ state: { status: 'tracking', payload: { kind: 'text', value: '测试' } },
      pointerScreenPoint: null });
    expect(render(<LcosDropPreview />).querySelector('[data-lcos-drop-preview]')).toBeNull();
  });

  it('carries all selected objects with their count rather than rendering a single unnamed material', () => {
    useLcosDropStore.setState({ state: { status: 'tracking', payload: { kind: 'objects', objects: [
      { entityType: 'note', entityId: 'note-a', displayLabel: '创意草稿' },
      { entityType: 'note', entityId: 'note-b', displayLabel: '参考资料' },
    ] } }, pointerScreenPoint: { x: 320, y: 240 } });
    const container = render(<LcosDropPreview />);
    expect(container.querySelector('[data-lcos-drop-count]')?.textContent).toBe('2');
    expect(container.querySelector('[data-lcos-drop-preview]')?.textContent).toContain('创意草稿 等 2 项');
  });

  it('does not light a distant or occluded receiver just because it can accept the payload', () => {
    const target: DropTargetRegistration = { targetId: 'capture:far', kind: 'external-import',
      label: '资料收集区', priority: 30, enabled: true, rect: { left: 600, top: 400, width: 120, height: 90 },
      semantic: { kind: 'external-import', owner: 'capture' } };
    const store = useLcosDropStore.getState();
    store.registerTarget(target);
    store.registerTarget({ ...target, targetId: 'capture:covered', rect: { left: 350, top: 240, width: 100, height: 80 },
      acceptsPoint: () => false });
    useLcosDropStore.setState({ state: { status: 'tracking', payload: { kind: 'text', value: '测试' } },
      pointerScreenPoint: { x: 320, y: 260 } });
    const container = render(<LcosDropPreview />);
    expect(container.querySelector('[data-lcos-carry-proxy]')).not.toBeNull();
    expect(container.querySelector('[data-lcos-drop-receptor]')).toBeNull();
  });

  it.each([
    [{ targetId: 'glyth:node-a', kind: 'collaboration-reference', label: '创作会话', priority: 20, enabled: true,
      semantic: { kind: 'collaboration-reference', conversationId: 'conversation-a' } }, '持久加入「创作会话」的上下文'],
    [{ targetId: 'composer:one', kind: 'composer-reference', label: '本次草稿', priority: 20, enabled: true,
      semantic: { kind: 'composer-reference' } }, '仅加入本次草稿引用'],
    [{ targetId: 'railway:context-a', kind: 'railway-receive', label: '上下文现场', priority: 20, enabled: true,
      semantic: { kind: 'railway-receive', targetRef: { kind: 'workspace', id: 'workspace-a' }, destinationRef: { kind: 'context', viewId: 'context-a' } } }, '投递到「上下文现场」'],
    [{ targetId: 'portal:node-a', kind: 'portal-receive', label: '入口 · 资料现场', priority: 20, enabled: true,
      semantic: { kind: 'portal-receive', targetRef: { kind: 'workspace', id: 'workspace-a' },
        destinationRef: { kind: 'worksite', projectId: 'project-a', worksiteId: 'workspace-a' }, canvasId: 'canvas-a' } }, '投递到「入口 · 资料现场」'],
  ] as const)('names the real destination and distinguishes durable from draft-only actions', (targetShape, expected) => {
    const target = { ...targetShape, rect: { left: 10, top: 20, width: 80, height: 80 } } as DropTargetRegistration;
    useLcosDropStore.getState().registerTarget(target);
    const resolution = resolveDropIntent(previewState.payload, target);
    useLcosDropStore.setState({ state: { ...previewState, destination: { ...previewState.destination, targetId: target.targetId } }, resolution });
    const container = render(<LcosDropPreview />);
    expect(container.querySelector('[data-lcos-drop-preview]')?.textContent).toContain(expected);
  });

  it('keeps the exact receiver and carry feedback visible through canonical commit', () => {
    const target: DropTargetRegistration = {
      targetId: 'collection:target', kind: 'collection-membership', label: '参考集合', priority: 30, enabled: true,
      rect: { left: 180, top: 120, width: 110, height: 80 },
      semantic: { kind: 'collection-membership', collectionId: 'collection-b' },
    };
    const store = useLcosDropStore.getState();
    store.registerTarget(target);
    const payload = { kind: 'object' as const, entityType: 'note', entityId: 'note-a', displayLabel: '创意草稿' };
    store.begin(payload);
    store.setBounds({ left: 0, top: 0, right: 900, bottom: 700 });
    const resolution = resolveDropIntent(payload, target);
    store.advance({ x: 220, y: 150 }, true, 100, { targetId: target.targetId, previewPoint: { x: 220, y: 150 } },
      resolution, undefined, { x: 220, y: 150 });
    store.commitAt('commit-visual');
    const container = render(<LcosDropPreview />);
    expect(container.querySelector('[data-presentation="committing"]')).not.toBeNull();
    expect(container.querySelector('[data-lcos-drop-receptor][data-state="committing"]')).not.toBeNull();
    expect(container.querySelector('[data-lcos-drop-preview]')?.textContent).toContain('正在写入「参考集合」');
  });

});
