import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import { RailwayDestinationSidebar, type RailwayDestinationSidebarItem } from './RailwayDestinationSidebar';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const items: RailwayDestinationSidebarItem[] = [
  { key: 'worksite:p:a', label: '研究现场', description: '当前现场' },
  { key: 'worksite:p:b', label: '交付现场', description: '点击直接进入' },
];

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', class {
    observe = vi.fn();
    disconnect = vi.fn();
  });
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

const render = (activeKey: string | undefined, busy = false, onSelect = vi.fn(), destinations = items) => {
  act(() => root.render(
    <RailwayDestinationSidebar items={destinations} activeKey={activeKey} busy={busy} onSelect={onSelect} />,
  ));
  return onSelect;
};

it('uses the caller-owned active destination and selects by canonical destination key', () => {
  const onSelect = render('worksite:p:a');
  const active = host.querySelector<HTMLButtonElement>('[data-lcos-railway-destination-key="worksite:p:a"]');
  const target = host.querySelector<HTMLButtonElement>('[data-lcos-railway-destination-key="worksite:p:b"]');

  expect(active?.getAttribute('aria-current')).toBe('page');
  expect(target?.getAttribute('aria-current')).toBeNull();
  act(() => target?.click());
  expect(onSelect).toHaveBeenCalledExactlyOnceWith('worksite:p:b');
  expect(target?.getAttribute('aria-current')).toBeNull();

  render('worksite:p:b', false, onSelect);
  expect(host.querySelector('[data-lcos-railway-destination-key="worksite:p:b"]')?.getAttribute('aria-current')).toBe('page');
});

it('keeps busy, unavailable, and Drop target state on the native destination button', () => {
  const onElement = vi.fn();
  const onSelect = vi.fn();
  const dropItem: RailwayDestinationSidebarItem = {
    key: 'worksite:p:drop',
    label: '接收现场',
    description: '可以接收材料',
    receivePresentation: 'receive-hot',
    onElement,
  };
  render(undefined, false, onSelect, [
    dropItem,
    { key: 'worksite:p:unavailable', label: '暂不可用', description: '暂不可用', disabled: true },
  ]);

  const dropTarget = host.querySelector<HTMLButtonElement>('[data-lcos-railway-destination-key="worksite:p:drop"]');
  const unavailable = host.querySelector<HTMLButtonElement>('[data-lcos-railway-destination-key="worksite:p:unavailable"]');
  expect(dropTarget?.getAttribute('data-lcos-receive-state')).toBe('receive-hot');
  expect(onElement).toHaveBeenLastCalledWith(dropTarget);
  expect(unavailable?.disabled).toBe(true);
  act(() => unavailable?.click());
  expect(onSelect).not.toHaveBeenCalled();

  render(undefined, true, onSelect, [dropItem]);
  const busyTarget = host.querySelector<HTMLButtonElement>('[data-lcos-railway-destination-key="worksite:p:drop"]');
  expect(busyTarget?.disabled).toBe(true);
  expect(host.querySelector('[data-lcos-railway-destination-sidebar]')?.getAttribute('aria-busy')).toBe('true');
  act(() => busyTarget?.click());
  expect(onSelect).not.toHaveBeenCalled();
});

it('forwards container-owned reorder drag events on the native overflow target', () => {
  const onSelect = vi.fn();
  const onDragStart = vi.fn();
  const onDragOver = vi.fn();
  const onDrop = vi.fn();
  const onDragEnd = vi.fn();
  render(undefined, false, onSelect, [{
    key: 'worksite:p:overflow',
    label: '溢出现场',
    description: '可拖到顺序位置',
    draggable: true,
    reorderDropTarget: true,
    reorderDropPosition: 'after',
    onDragStart,
    onDragOver,
    onDrop,
    onDragEnd,
  }]);

  const target = host.querySelector<HTMLButtonElement>('[data-lcos-railway-destination-key="worksite:p:overflow"]');
  expect(target?.getAttribute('draggable')).toBe('true');
  expect(target?.getAttribute('data-lcos-railway-reorder-target')).toBe('true');
  expect(target?.getAttribute('data-lcos-railway-reorder-position')).toBe('after');
  for (const type of ['dragstart', 'dragover', 'drop', 'dragend']) {
    act(() => target?.dispatchEvent(new Event(type, { bubbles: true, cancelable: true })));
  }
  expect(onDragStart).toHaveBeenCalledOnce();
  expect(onDragOver).toHaveBeenCalledOnce();
  expect(onDrop).toHaveBeenCalledOnce();
  expect(onDragEnd).toHaveBeenCalledOnce();
  expect(onSelect).not.toHaveBeenCalled();
});

it('does not expose a disabled destination as a drag source', () => {
  render(undefined, true, vi.fn(), [{ key: 'worksite:p:busy', label: '处理中', description: '', draggable: true }]);
  expect(host.querySelector<HTMLButtonElement>('[data-lcos-railway-destination-key="worksite:p:busy"]')?.getAttribute('draggable')).toBe('false');
});


it('offers one sibling handle that forwards the shared pointer gesture without selecting', () => {
  const onSelect = vi.fn();
  const onPointerDown = vi.fn();
  render(undefined, false, onSelect, [{...items[0]!, onPointerDown}]);
  const target = host.querySelector<HTMLButtonElement>('[data-lcos-railway-destination-key]')!;
  const handle = host.querySelector<HTMLButtonElement>('[data-semantic-drop-handle]')!;
  expect(handle).not.toBeNull();
  expect(target.contains(handle)).toBe(false);
  act(() => handle.dispatchEvent(new MouseEvent('pointerdown', {bubbles:true,button:0,buttons:1})));
  expect(onPointerDown).toHaveBeenCalledOnce();
  act(() => handle.click());
  expect(onSelect).not.toHaveBeenCalled();
});

it('keeps busy sources without handles and does not forward their pointer transport', () => {
  const onPointerDown = vi.fn();
  render(undefined, true, vi.fn(), [{...items[0]!, onPointerDown}]);
  expect(host.querySelector('[data-semantic-drop-handle]')).toBeNull();
  const row = host.querySelector('.lcos-railway-destination-row');
  act(() => row?.dispatchEvent(new MouseEvent('pointerdown', {bubbles:true,button:2,buttons:2})));
  expect(onPointerDown).not.toHaveBeenCalled();
});

it('retains the secondary management action while the primary action stays direct', () => {
  const onManage = vi.fn();
  const onSelect = render(undefined, false, vi.fn(), [{...items[0]!, onManage}]);
  const target = host.querySelector<HTMLButtonElement>('[data-lcos-railway-destination-key]')!;
  const contextMenu = new MouseEvent('contextmenu', {bubbles:true,cancelable:true});
  act(() => target.dispatchEvent(contextMenu));
  expect(contextMenu.defaultPrevented).toBe(true);
  expect(onManage).toHaveBeenCalledOnce();
  expect(onSelect).not.toHaveBeenCalled();
});
