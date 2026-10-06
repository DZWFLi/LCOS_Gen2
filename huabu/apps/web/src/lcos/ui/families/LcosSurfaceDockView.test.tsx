import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, expect, it, vi } from 'vitest';

import { LcosSurfaceDockView } from './LcosSurfaceDockView';

vi.mock('../FigmaShellGlyph', () => ({ FigmaShellGlyph: () => null }));
let root: Root;
let host: HTMLDivElement;
afterEach(() => { act(() => root.unmount()); host.remove(); });

it('uses Rare UI while retaining controlled surface identity and preventing a second switch during navigation', () => {
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  const selected = vi.fn();
  const items = [
    { key: 'main', label: 'Main', title: 'Main · 现场画布', glyph: 'root' as const, selected: true, busy: false, disabled: false },
    { key: 'context', label: 'Context', title: 'Context · 现场画布', glyph: 'context' as const, selected: false, busy: false, disabled: false },
    { key: 'workflow', label: 'Workflow', title: 'Workflow · 现场画布', glyph: 'workflow' as const, selected: false, busy: false, disabled: false },
  ];
  const render = (busy: boolean, compact = false) => act(() => root.render(<MemoryRouter>
    <LcosSurfaceDockView items={items.map((item) => ({ ...item, disabled: busy,
      busy: busy && item.key === 'context' }))} onSelect={selected} compact={compact} />
  </MemoryRouter>));
  render(false);
  expect(host.querySelector('[data-slot="gooey-nav"]')).not.toBeNull();
  const main = host.querySelector<HTMLButtonElement>('[data-lcos-surface="main"]');
  const context = host.querySelector<HTMLButtonElement>('[data-lcos-surface="context"]');
  expect(main?.getAttribute('aria-pressed')).toBe('true');
  act(() => context?.click());
  expect(selected).toHaveBeenCalledExactlyOnceWith('context');
  expect(main?.getAttribute('aria-pressed')).toBe('true');
  render(false, true);
  const compactMain = host.querySelector<HTMLButtonElement>('[data-lcos-surface="main"]');
  expect(host.querySelector('[data-lcos-dock-compact="true"]')).not.toBeNull();
  expect(compactMain).toBe(main);
  expect([...host.querySelectorAll<HTMLButtonElement>('[data-lcos-surface]')].map((button) => button.getAttribute('aria-label')))
    .toEqual(['Main', 'Context', 'Workflow']);
  expect([...host.querySelectorAll<HTMLButtonElement>('[data-lcos-surface]')].map((button) => button.title))
    .toEqual(['Main · 现场画布', 'Context · 现场画布', 'Workflow · 现场画布']);
  expect([...host.querySelectorAll('[data-slot="gooey-nav-label"]')].every((label) => label.classList.contains('sr-only'))).toBe(true);
  act(() => host.querySelector<HTMLButtonElement>('[data-lcos-surface="workflow"]')?.click());
  expect(selected).toHaveBeenNthCalledWith(2, 'workflow');
  render(true, true);
  expect(host.querySelector('[data-lcos-surface="context"]')?.getAttribute('aria-busy')).toBe('true');
  expect([...host.querySelectorAll('button')].every((button) => button.disabled)).toBe(true);
  act(() => host.querySelector<HTMLButtonElement>('[data-lcos-surface="workflow"]')?.click());
  expect(selected).toHaveBeenCalledTimes(2);
});
