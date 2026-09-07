// A04 Composer shell tests（chips + prompt 输入一体）。
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import { afterEach, describe, expect, it } from 'vitest';

import { LcosComposerShell } from './LcosComposerShell';
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
  for (const root of roots) act(() => root.unmount());
  for (const container of containers) container.remove();
  roots = [];
  containers = [];
  document.body.replaceChildren();
  useLcosReferenceStore.getState().reset();
});

function pick(...nodeIds: string[]) {
  for (const nodeId of nodeIds) {
    useLcosReferenceStore.getState().registerNodeEntity(nodeId, {
      entityType: 'artifact',
      entityId: `e-${nodeId}`,
    });
    useLcosReferenceStore.getState().toggleNodeReference(nodeId);
  }
}

describe('LcosComposerShell (A04)', () => {
  it('hidden when no references, input unfocused, prompt empty', () => {
    const container = render(<LcosComposerShell />);
    expect(container.querySelector('[data-lcos-composer]')).toBeNull();
  });

  it('reference pick shows the composer with ordered chips AND the prompt input', () => {
    pick('node-2', 'node-1', 'node-3');
    const container = render(<LcosComposerShell />);
    const composer = container.querySelector('[data-lcos-composer]');
    expect(composer).not.toBeNull();
    expect(composer?.querySelector('[data-lcos-composer-input]')).not.toBeNull();
    const strip = composer?.querySelector('[data-lcos-reference-strip]');
    expect(strip?.textContent).toContain('引用 (3)');
    expect(strip?.textContent).toContain('#1');
    expect(strip?.textContent).toContain('#3');
  });

  it('removing a chip drops exactly that reference; order preserved', () => {
    pick('node-a', 'node-b', 'node-c');
    const container = render(<LcosComposerShell />);
    const chips = container.querySelectorAll('button[aria-label^="移除引用"]');
    expect(chips.length).toBe(3);
    act(() => {
      chips[1]?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    const refs = useLcosReferenceStore.getState().orderedNodeReferences();
    expect(refs.map((r) => r.entityId)).toEqual(['e-node-a', 'e-node-c']);
  });

  it('composer hides again when the last reference is removed (input untouched)', () => {
    pick('node-a');
    const container = render(<LcosComposerShell />);
    expect(container.querySelector('[data-lcos-composer]')).not.toBeNull();
    const chip = container.querySelector('button[aria-label^="移除引用"]');
    act(() => {
      chip?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(container.querySelector('[data-lcos-composer]')).toBeNull();
  });
});
