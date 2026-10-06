import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';

import { LcosNavigatorIsland } from './LcosNavigatorIsland';

import type * as WebGen2 from '@local-creative-os/web-gen2';
const search = vi.hoisted(() => vi.fn());
const where = vi.hoisted(() => vi.fn());
const shell = vi.hoisted(() => ({
  state: { windowEnvironment: null, windows: [] as Array<{ bodyKey: string; target?: string; readerRevisionId?: string }> },
  openReader: vi.fn(),
  openWindow: vi.fn(),
}));
vi.mock('@local-creative-os/web-gen2', async (importOriginal) => {
  const actual = await importOriginal<typeof WebGen2>();
  return { ...actual, CoreSearchClient: class { searchProject = search; }, HttpError: class HttpError extends Error {} };
});
vi.mock('../app/lcosCoreClient', () => ({ createLcosCoreSession: () => ({ http: {} }) }));
vi.mock('../shell/lcosShellStore', () => ({ useLcosShellStore: (select: (state: unknown) => unknown) => select({
  ...shell.state, requestFocusWhere: where, openReader: shell.openReader, openWindow: shell.openWindow,
}) }));
const roots: ReturnType<typeof createRoot>[] = [];
const mounted = new Map<HTMLElement, { root: ReturnType<typeof createRoot>; tree: React.JSX.Element }>();
afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
  mounted.clear(); document.body.replaceChildren(); shell.state.windows = []; vi.useRealTimers(); vi.resetAllMocks();
});
async function render(overrides: Partial<React.ComponentProps<typeof LcosNavigatorIsland>> = {}) {
  const container = document.createElement('div'); document.body.append(container);
  const root = createRoot(container); roots.push(root);
  const tree = <LcosNavigatorIsland projectId="p" canvasBySurface={{}} ensureCanvas={async () => undefined} {...overrides} />;
  await act(async () => root.render(tree));
  mounted.set(container, { root, tree });
  return container;
}
async function rerender(container: HTMLElement): Promise<void> {
  const entry = mounted.get(container);
  if (!entry) throw new Error('root not mounted');
  await act(async () => entry.root.render(entry.tree));
}
function required<T extends Element>(container: ParentNode, selector: string): T {
  const element = container.querySelector<T>(selector);
  if (element === null) throw new Error(`Expected ${selector}`);
  return element;
}
async function query(container: HTMLElement, text = '材料') {
  await act(async () => container.querySelector<HTMLButtonElement>('[data-lcos-nav-part="search"]')?.click());
  const input = required<HTMLInputElement>(container, 'input');
  const valueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  if (!valueSetter) throw new Error('HTML input value setter missing');
  await act(async () => { valueSetter.call(input, text); input.dispatchEvent(new Event('input', { bubbles: true })); });
  await act(async () => vi.advanceTimersByTime(250));
  return input;
}
it('opens artifact results directly in the Reader and retains Where as a separate action', async () => {
  vi.useFakeTimers();
  search.mockResolvedValue({ hits: [{ entityType: 'artifact', entityId: 'a', title: '素材', snippet: '材料摘要', locationRefs: [{ id: 'wrong-first' }] }] });
  shell.openReader.mockImplementation((_title: string, target: string) => { shell.state.windows = [{ bodyKey: 'reader', target }]; });
  const container = await render(); await query(container);
  await act(async () => required<HTMLButtonElement>(container, '[role="option"]').click());
  expect(shell.openReader).toHaveBeenCalledExactlyOnceWith('阅读 · 素材', 'a');
  expect(where).not.toHaveBeenCalled();
  expect(container.querySelector('input')).toBeNull();
  expect(document.activeElement).toBe(container.querySelector('[data-lcos-nav-part="search"]'));
});
it('keeps full Where reachable through the existing secondary DropdownMenu', async () => {
  vi.useFakeTimers();
  search.mockResolvedValue({ hits: [{ entityType: 'artifact', entityId: 'a', title: '素材', snippet: '材料摘要', locationRefs: [{ id: 'wrong-first' }] }] });
  const container = await render(); await query(container);
  expect(container.querySelector('[role="option"] [data-lcos-search-locate-trigger]')).toBeNull();
  await act(async () => required<HTMLButtonElement>(container, '[data-lcos-search-locate-trigger]').click());
  const locateItem = document.body.querySelector<HTMLButtonElement>('[role="menuitem"]');
  expect(locateItem?.textContent).toContain('在画布中定位“素材”');
  await act(async () => locateItem?.click());
  expect(where).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ entityId: 'a', entityType: 'artifact', title: '素材' }));
  expect(shell.openReader).not.toHaveBeenCalled();
  expect(container.querySelector('input')).toBeNull();
});
it('uses the existing conversation window surface and keeps other contract entity types in Where', async () => {
  vi.useFakeTimers();
  search.mockResolvedValueOnce({ hits: [{ entityType: 'conversation', entityId: 'conversation-1', title: '访谈', snippet: '会话摘要' }] });
  const container = await render(); await query(container);
  await act(async () => required<HTMLButtonElement>(container, '[role="option"]').click());
  expect(shell.openWindow).toHaveBeenCalledExactlyOnceWith('conversation', '会话窗口 · 访谈', 'conversation-1');
  expect(where).not.toHaveBeenCalled();

  search.mockResolvedValueOnce({ hits: [{ entityType: 'resource', entityId: 'resource-1', title: '外部资源', snippet: '资源摘要' }] });
  await query(container, '外部资源');
  await act(async () => required<HTMLButtonElement>(container, '[role="option"]').click());
  expect(where).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ entityType: 'resource', entityId: 'resource-1' }));

  search.mockResolvedValueOnce({ hits: [{ entityType: 'note', entityId: 'note-1', title: '  ', snippet: '命名笔记' }] });
  await query(container, '命名笔记');
  await act(async () => required<HTMLButtonElement>(container, '[role="option"]').click());
  expect(where).toHaveBeenLastCalledWith(expect.objectContaining({ entityType: 'note', entityId: 'note-1', title: '命名笔记' }));
  expect(shell.openWindow).toHaveBeenCalledExactlyOnceWith('conversation', '会话窗口 · 访谈', 'conversation-1');
});
it('returns search-opened Reader focus to the persistent search trigger when the window closes', async () => {
  vi.useFakeTimers();
  search.mockResolvedValue({ hits: [{ entityType: 'artifact', entityId: 'a', title: '素材', snippet: '材料摘要' }] });
  shell.openReader.mockImplementation((_title: string, target: string) => { shell.state.windows = [{ bodyKey: 'reader', target }]; });
  const container = await render(); await query(container);
  await act(async () => required<HTMLButtonElement>(container, '[role="option"]').click());
  expect(container.querySelector('[data-lcos-reader-search-focus-return]')).not.toBeNull();
  expect(document.activeElement).toBe(container.querySelector('[data-lcos-nav-part="search"]'));
  shell.state.windows = [];
  await rerender(container);
  expect(document.activeElement).toBe(container.querySelector('[data-lcos-nav-part="search"]'));
});
it('uses the hit text fallback rather than showing a bare entity ID', async () => {
  vi.useFakeTimers();
  search.mockResolvedValue({ hits: [{ entityType: 'artifact', entityId: 'private-id', title: '  ', snippet: '命名材料' }] });
  const container = await render(); await query(container);
  const option = container.querySelector('[role="option"]');
  expect(option?.textContent).toContain('命名材料');
  expect(option?.textContent).not.toContain('private-id');
});
it('keeps input mounted after failure and supports real retry', async () => {
  vi.useFakeTimers(); search.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce({ hits: [] });
  const container = await render(); const input = await query(container);
  expect(container.querySelector('input')).toBe(input); expect(input.value).toBe('材料');
  expect(container.textContent).toContain('搜索失败');
  await act(async () => required<HTMLButtonElement>(container, '[role="alert"] button').click());
  await act(async () => vi.advanceTimersByTime(250));
  expect(container.textContent).toContain('没有匹配');
});
it('supports arrow and Enter without choosing during IME composition', async () => {
  vi.useFakeTimers(); search.mockResolvedValue({ hits: [{ entityType: 'artifact', entityId: 'a' }, { entityType: 'artifact', entityId: 'b' }] });
  const container = await render(); const input = await query(container);
  await act(async () => input.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true })));
  await act(async () => input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', isComposing: true, bubbles: true })));
  expect(shell.openReader).not.toHaveBeenCalled();
  await act(async () => input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })));
  expect(shell.openReader).toHaveBeenCalledExactlyOnceWith('阅读 · 项目材料', 'b');
});
it('does not steal local editor Find and closes search on one Escape', async () => {
  const container = await render(); const editor = document.createElement('textarea'); document.body.append(editor);
  await act(async () => editor.dispatchEvent(new KeyboardEvent('keydown', { key: 'f', ctrlKey: true, bubbles: true, cancelable: true })));
  expect(container.querySelector('input')).toBeNull();
  await act(async () => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'f', ctrlKey: true, cancelable: true })));
  expect(container.querySelector('input')).not.toBeNull();
  const trigger = container.querySelector('[data-lcos-nav-part="search"]');
  await act(async () => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })));
  expect(container.querySelector('input')).toBeNull(); expect(document.activeElement).toBe(trigger);
});
it('reacts to a resize without an unrelated state change', async () => {
  const original = window.innerWidth;
  const container = await render();
  await act(async () => { Object.defineProperty(window, 'innerWidth', { configurable: true, value: 640 }); window.dispatchEvent(new Event('resize')); });
  expect(parseFloat(required<HTMLElement>(container, '[data-lcos-navigator-island]').style.left) + 52 / 2).toBe(320);
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: original });
});

it('includes the always-available ColorPin More slot in its collision width', async () => {
  const original = window.innerWidth;
  const container = await render({ onCreatePin: vi.fn() });
  await act(async () => { Object.defineProperty(window, 'innerWidth', { configurable: true, value: 640 }); window.dispatchEvent(new Event('resize')); });
  const island = required<HTMLElement>(container, '[data-lcos-navigator-island]');
  expect(island.querySelector('[data-lcos-nav-part="overflow"]')?.textContent).toBe('更多');
  expect(parseFloat(island.style.left) + 96 / 2).toBe(320);
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: original });
});

it('consumes Escape before a separate window bubble listener can close the underlying window', async () => {
  const container = await render();
  const closeWindow = vi.fn(); window.addEventListener('keydown', closeWindow);
  try {
    await act(async () => required<HTMLButtonElement>(container, '[data-lcos-nav-part="search"]').click());
    await act(async () => required<HTMLInputElement>(container, 'input').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })));
    expect(container.querySelector('input')).toBeNull(); expect(closeWindow).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(container.querySelector('[data-lcos-nav-part="search"]'));
  } finally { window.removeEventListener('keydown', closeWindow); }
});


it('uses the server truncated flag even when fewer than the client limit are returned', async () => {
  vi.useFakeTimers(); search.mockResolvedValue({ hits: [{ entityType: 'artifact', entityId: 'a' }], truncated: true });
  const container = await render(); await query(container);
  expect(container.textContent).toContain('还有匹配结果');
  expect(search).toHaveBeenCalledWith('p', expect.objectContaining({ limit: 50 }));
});
it('does not invent pagination or a truncation warning for a complete 50-result response', async () => {
  vi.useFakeTimers(); search.mockResolvedValue({ hits: Array.from({ length: 50 }, (_, i) => ({ entityType: 'artifact', entityId: String(i) })), truncated: false });
  const container = await render(); await query(container);
  expect(container.querySelectorAll('[role="option"]')).toHaveLength(50);
  expect(container.textContent).not.toContain('还有匹配结果');
});

it('explains why a hit matched and reports only the server full location count', async () => {
  vi.useFakeTimers();
  search.mockResolvedValue({ hits: [{
    entityType: 'artifact', entityId: 'a', title: '材料', snippet: '包含风险评估',
    matchReason: 'body', locationCount: 7,
    locationRefs: Array.from({ length: 5 }, (_, index) => ({ kind: 'workspace', id: `legacy-${index}` })),
  }] });
  const container = await render(); await query(container);
  expect(container.querySelector('[data-lcos-search-match-reason]')?.textContent).toBe('正文匹配');
  expect(container.querySelector('[data-lcos-search-location-count]')?.textContent).toBe('出现在 7 个位置');
  expect(container.textContent).not.toContain('legacy-');
  expect(container.textContent).not.toMatch(/vector|FTS|embedding|score/i);
});
