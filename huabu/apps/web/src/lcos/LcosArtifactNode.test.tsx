// A02 regression tests — the density consumer must live INSIDE the
// NodeWrapper subtree (GPT review finding).
//
// The real NodeWrapper mounts LcosNodePresentationProvider above its
// children. The mock below mirrors exactly that contract: children render
// BELOW a provider carrying `mockPresentation.current`. If anyone ever moves
// the context read back above NodeWrapper (the original A02 bug — the
// consumer read `undefined` and froze at the 'working' fallback), every
// non-working assertion in this file goes red, because a consumer above the
// provider cannot see it.

import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { NodeProps } from '@xyflow/react';

import type { LcosNodePresentationInput } from '@/lcos-seam/nodePresentation';

import { LcosArtifactNode } from './LcosArtifactNode';

// React 19 act() environment flag — createRoot + act without this flag
// emits a warning on every act call.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

const mockPresentation = vi.hoisted(() => ({
  current: undefined as LcosNodePresentationInput | undefined,
}));

vi.mock('@/components/Nodes/NodeWrapper', async () => {
  const React = await import('react');
  const seam = await import('@/lcos-seam/nodePresentation');
  return {
    NodeWrapper: ({ children }: { children?: React.ReactNode }) =>
      mockPresentation.current === undefined
        ? children
        : React.createElement(
            seam.LcosNodePresentationProvider,
            { value: mockPresentation.current },
            children,
          ),
  };
});

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
  mockPresentation.current = undefined;
  for (const root of roots) {
    act(() => root.unmount());
  }
  for (const container of containers) {
    container.remove();
  }
  roots = [];
  containers = [];
  document.body.replaceChildren();
});

function presentationFor(
  worldWidth: number,
  worldHeight: number,
  zoom: number,
): LcosNodePresentationInput {
  return {
    worldWidth,
    worldHeight,
    zoom,
    dpr: 1,
    screenWidth: worldWidth * zoom,
    screenHeight: worldHeight * zoom,
    phase: 'rest',
  };
}

function nodeElement() {
  // NodeProps carries more required fields than this test cares about
  // (type/draggable/… are React Flow internals the renderer never reads).
  const props = {
    id: 'node-a1',
    data: { label: 'Brief' },
    selected: false,
  } as unknown as NodeProps;
  return <LcosArtifactNode {...props} />;
}

function densityOf(container: HTMLElement): string | null {
  return container
    .querySelector('[data-lcos-density]')
    ?.getAttribute('data-lcos-density') ?? null;
}

describe('LcosArtifactNode adaptive density (consumer below the NodeWrapper provider)', () => {
  it('renders the SAME node through the full zoom ladder', () => {
    // 400×300 world node: 600×450@1.5 reading; 400×300@1 working;
    // 100×75@0.25 summary; 80×60@0.2 mark.
    mockPresentation.current = presentationFor(400, 300, 1.5);
    expect(densityOf(render(nodeElement()))).toBe('reading');

    mockPresentation.current = presentationFor(400, 300, 1);
    expect(densityOf(render(nodeElement()))).toBe('working');

    mockPresentation.current = presentationFor(400, 300, 0.25);
    expect(densityOf(render(nodeElement()))).toBe('summary');

    mockPresentation.current = presentationFor(400, 300, 0.2);
    expect(densityOf(render(nodeElement()))).toBe('mark');
  });

  it('mark tier renders the identity dot, not the card', () => {
    mockPresentation.current = presentationFor(400, 300, 0.2);
    const container = render(nodeElement());
    const tier = container.querySelector('[data-lcos-density="mark"]');
    expect(tier).not.toBeNull();
    expect(tier?.querySelector('span')).not.toBeNull();
  });

  it('falls back to working when no provider is present (preview outside canvas)', () => {
    // mockPresentation.current stays undefined → mock renders children
    // WITHOUT a provider → the consumer must render the static default.
    const container = render(nodeElement());
    expect(densityOf(container)).toBe('working');
  });

  it('editing phase holds working even at a zoom that would read mark', () => {
    mockPresentation.current = {
      ...presentationFor(400, 300, 0.2),
      phase: 'editing',
    };
    expect(densityOf(render(nodeElement()))).toBe('working');
  });
});
