import { act, useRef, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';

vi.mock('@xyflow/react', () => ({
  useStore: (selector: (state: { domNode: HTMLElement }) => unknown) => selector({ domNode: document.body }),
  useViewport: () => ({ zoom: 1, x: 0, y: 0 }),
}));

import { CanvasFloatingPopover } from './CanvasFloatingPopover';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const roots: Root[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
  document.body.replaceChildren();
  vi.unstubAllGlobals();
});

function FocusManagedComposerHarness(): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const [focusReturnKey, setFocusReturnKey] = useState('project-a:target-a');
  const entry = useRef<HTMLButtonElement>(null);
  return <>
    <button ref={entry} type="button" data-composer-entry onClick={() => setOpen(true)}>Open Composer</button>
    <button type="button" data-outside>Outside</button>
    <button type="button" data-change-target onClick={() => setFocusReturnKey('project-a:target-b')}>Change target</button>
    <CanvasFloatingPopover
      anchor={{ x: 10, y: 10, width: 1, height: 1 }}
      open={open}
      managedFocus
      focusReturnKey={focusReturnKey}
      referenceElement={entry}
    >
      <button type="button" data-close-popover onClick={() => setOpen(false)}>Close</button>
    </CanvasFloatingPopover>
  </>;
}

it('restores focus to its real reference and does not dismiss on outside press when focus-managed only', async () => {
  vi.stubGlobal('ResizeObserver', class {
    observe() {}
    unobserve() {}
    disconnect() {}
  });
  const host = document.createElement('div'); document.body.append(host);
  const root = createRoot(host); roots.push(root);
  await act(async () => root.render(<FocusManagedComposerHarness />));
  const entry = host.querySelector<HTMLButtonElement>('[data-composer-entry]');
  if (!entry) throw new Error('Composer entry did not render');
  entry.focus();
  await act(async () => entry.click());
  await act(async () => host.querySelector<HTMLButtonElement>('[data-outside]')?.click());
  expect(document.querySelector('[data-close-popover]')).not.toBeNull();

  await act(async () => document.querySelector<HTMLButtonElement>('[data-close-popover]')?.click());
  expect(document.activeElement).toBe(entry);
});

it('does not restore focus to a source from a different Composer target', async () => {
  vi.stubGlobal('ResizeObserver', class {
    observe() {}
    unobserve() {}
    disconnect() {}
  });
  const host = document.createElement('div'); document.body.append(host);
  const root = createRoot(host); roots.push(root);
  await act(async () => root.render(<FocusManagedComposerHarness />));
  const entry = host.querySelector<HTMLButtonElement>('[data-composer-entry]');
  if (!entry) throw new Error('Composer entry did not render');
  entry.focus();
  await act(async () => entry.click());
  const changeTarget = host.querySelector<HTMLButtonElement>('[data-change-target]');
  changeTarget?.focus();
  await act(async () => changeTarget?.click());
  const close = document.querySelector<HTMLButtonElement>('[data-close-popover]');
  close?.focus();
  await act(async () => close?.click());
  expect(document.activeElement).not.toBe(entry);
});
