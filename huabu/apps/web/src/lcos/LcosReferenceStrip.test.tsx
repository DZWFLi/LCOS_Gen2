// A04 Reference Strip tests — the GUI consumer of the reference controller.
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import { afterEach, describe, expect, it } from 'vitest';

import { LcosReferenceStrip } from './LcosReferenceStrip';
import { useLcosReferenceStore } from './lcosReferenceState';

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
  for (const root of roots) {
    act(() => root.unmount());
  }
  for (const container of containers) {
    container.remove();
  }
  roots = [];
  containers = [];
  document.body.replaceChildren();
  useLcosReferenceStore.getState().reset();
});

function pick(...nodeIds: string[]) {
  for (const nodeId of nodeIds) {
    useLcosReferenceStore
      .getState()
      .registerNodeEntity(nodeId, {
        entityType: 'artifact',
        entityId: `e-${nodeId}`,
      });
    useLcosReferenceStore.getState().toggleNodeReference(nodeId);
  }
}

describe('LcosReferenceStrip (A04)', () => {
  it('renders nothing when the draft is empty (no Christmas tree)', () => {
    const container = render(<LcosReferenceStrip />);
    expect(container.querySelector('[data-lcos-reference-strip]')).toBeNull();
  });

  it('shows one chip per reference, in PICK ORDER, with 1-based ordinals', () => {
    pick('node-2', 'node-1', 'node-3');
    const container = render(<LcosReferenceStrip />);
    const strip = container.querySelector('[data-lcos-reference-strip]');
    expect(strip).not.toBeNull();
    const chips = strip?.querySelectorAll('button[aria-label^="Remove reference"]');
    expect(chips?.length).toBe(3);
    expect(strip?.textContent).toContain('#1');
    expect(strip?.textContent).toContain('#2');
    expect(strip?.textContent).toContain('#3');
    expect(strip?.textContent).toContain('References (3)');
  });

  it('removing a chip drops exactly that reference; the rest keep their order', () => {
    pick('node-a', 'node-b', 'node-c');
    const container = render(<LcosReferenceStrip />);
    const strip = container.querySelector('[data-lcos-reference-strip]');
    const chipsBefore = strip?.querySelectorAll('button[aria-label^="Remove reference"]');
    expect(chipsBefore?.length).toBe(3);

    // Click the SECOND chip's remove button (node-b).
    act(() => {
      chipsBefore?.[1]?.dispatchEvent(
        new MouseEvent('click', { bubbles: true }),
      );
    });

    const refs = useLcosReferenceStore.getState().orderedNodeReferences();
    expect(refs.map((r) => r.entityId)).toEqual(['e-node-a', 'e-node-c']);
  });

  it('strip disappears again when the last reference is removed', () => {
    pick('node-a');
    const container = render(<LcosReferenceStrip />);
    expect(
      container.querySelector('[data-lcos-reference-strip]'),
    ).not.toBeNull();

    const chip = container.querySelector('button[aria-label^="Remove reference"]');
    act(() => {
      chip?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(
      container.querySelector('[data-lcos-reference-strip]'),
    ).toBeNull();
  });
});
