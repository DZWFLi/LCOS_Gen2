import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import { AssemblyItemView } from './AssemblyItemView';

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});

it('exposes the primary take action before opening extra actions', async () => {
  const take = vi.fn();
  await act(async () => root.render(
    <AssemblyItemView
      title="材料 A"
      primaryAction={<button type="button" data-primary-take onClick={take}>放入目标</button>}
      actions={<button type="button" data-secondary-action>打开预览</button>}
    >
      <div>材料预览</div>
    </AssemblyItemView>,
  ));

  const primary = host.querySelector<HTMLButtonElement>('[data-primary-take]');
  const more = host.querySelector<HTMLButtonElement>('[data-lcos-assembly-more]');
  expect(primary).not.toBeNull();
  expect(primary?.closest('[data-lcos-assembly-actions]')).toBeNull();
  expect(more?.getAttribute('aria-expanded')).toBe('false');

  await act(async () => primary?.click());
  expect(take).toHaveBeenCalledTimes(1);
});
