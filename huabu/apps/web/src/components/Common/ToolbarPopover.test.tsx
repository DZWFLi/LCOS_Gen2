import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FloatingToolbar } from './FloatingToolbar';
import { ToolbarPopover } from './ToolbarPopover';

// Intentionally use the real Floating UI tree/dismiss/focus implementation.
// No mock of portals, dismissal, or the color picker: those are the regression.
let root: Root | undefined;
let host: HTMLDivElement | undefined;
const dialog = (label: string) => document.querySelector(`[role="dialog"][aria-label="${label}"]`);
const button = (label: string) => document.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)!;
async function click(element: HTMLElement) {
  await act(async () => {
    element.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0, pointerType: 'mouse' }));
    element.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0 }));
    element.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, button: 0 }));
    element.click();
    await Promise.resolve();
  });
}
async function key(value: string) {
  await act(async () => {
    (document.activeElement ?? document.body).dispatchEvent(new KeyboardEvent('keydown', { key: value, bubbles: true, cancelable: true }));
    await Promise.resolve();
  });
}
async function mount() {
  const picked = vi.fn();
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  await act(async () => root!.render(<ToolbarPopover label="更多组操作" trigger="更多">
    <FloatingToolbar.ColorPicker title="组颜色" colors={[{ token: 'red', name: '红色', value: '#f00' }]}
      value={null} onSelect={picked} />
    <button type="button" aria-label="另一个组命令">另一个组命令</button>
  </ToolbarPopover>));
  await click(button('更多组操作'));
  return picked;
}
afterEach(async () => {
  await act(async () => root?.unmount()); root = undefined; host?.remove(); host = undefined;
  document.body.replaceChildren();
});

describe('ToolbarPopover: existing nested control lifecycle', () => {
  it('selecting a portalled color closes only the child, retaining the parent controls', async () => {
    const picked = await mount(); await click(button('组颜色'));
    expect(dialog('更多组操作')).not.toBeNull(); expect(dialog('组颜色')).not.toBeNull();
    await click(button('红色'));
    expect(picked).toHaveBeenCalledExactlyOnceWith('red');
    expect(dialog('组颜色')).toBeNull(); expect(dialog('更多组操作')).not.toBeNull();
  });
  it('Escape closes the innermost portal before the parent', async () => {
    await mount(); await click(button('组颜色')); await key('Escape');
    expect(dialog('组颜色')).toBeNull(); expect(dialog('更多组操作')).not.toBeNull();
    await key('Escape'); expect(dialog('更多组操作')).toBeNull();
  });
  it('a real outside left press still dismisses the complete tree', async () => {
    await mount(); await click(button('组颜色')); await click(document.body);
    expect(dialog('组颜色')).toBeNull(); expect(dialog('更多组操作')).toBeNull();
  });
  it('an outside right press does not dismiss the currently requested context tools', async () => {
    await mount();
    await act(async () => document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 2, pointerType: 'mouse' })));
    expect(dialog('更多组操作')).not.toBeNull();
  });
  it('keyboard opens the same trigger and closing returns focus to it', async () => {
    await mount(); await key('Escape');
    await act(async () => button('更多组操作').focus());
    await key('Enter');
    // Happy DOM does not perform the browser's native Enter -> button click.
    // Real keyboard activation is separately exercised in the browser smoke.
    await act(async () => button('更多组操作').click());
    expect(dialog('更多组操作')).not.toBeNull();
    await key('Escape');
    expect(document.activeElement).toBe(button('更多组操作'));
  });
  it('unmounting cleans portalled descendants rather than leaving an orphan panel', async () => {
    await mount(); await click(button('组颜色'));
    await act(async () => root?.unmount()); root = undefined;
    expect(dialog('更多组操作')).toBeNull(); expect(dialog('组颜色')).toBeNull();
  });
});
