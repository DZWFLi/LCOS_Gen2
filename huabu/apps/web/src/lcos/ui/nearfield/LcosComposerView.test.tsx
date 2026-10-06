import { act, createRef } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { LcosComposerView } from './LcosComposerView';

import type { ComposerVisualState, LcosComposerViewProps } from './composerViewTypes';
import type { Root } from 'react-dom/client';

let root: Root | undefined;
let host: HTMLDivElement | undefined;
afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  host?.remove();
  root = undefined;
  host = undefined;
});
const defaults = (): LcosComposerViewProps => ({
  presentation: 'nearfield', state: 'editing', contextLabel: '当前工作目标', title: '当前对象', targetId: 'n1',
  references: [], text: '真实草稿', canSubmit: true, submitTitle: '提交',
  onTextChange: vi.fn(), onKeyDown: vi.fn(), onClose: vi.fn(), onSubmit: vi.fn(),
});
async function render(overrides: Partial<LcosComposerViewProps> = {}) {
  const props = { ...defaults(), ...overrides };
  host = document.createElement('div'); document.body.append(host);
  root = createRoot(host);
  await act(async () => root?.render(<LcosComposerView {...props} />));
  return { props, element: host };
}
const states: readonly ComposerVisualState[] = [
  'empty', 'editing', 'resolving', 'sending', 'ready', 'blocked', 'offline',
  'permission_required', 'degraded', 'unknown', 'error', 'reconciling', 'keyboard_focus',
];
describe('controlled Composer presentation', () => {
  it.each(states)('renders %s without creating a request or changing the draft', async (state) => {
    const { props, element } = await render({ state });
    expect(element.querySelector('[data-ui-state]')?.getAttribute('data-ui-state')).toBe(state);
    expect(props.onSubmit).not.toHaveBeenCalled();
    expect(props.onTextChange).not.toHaveBeenCalled();
    expect(element.querySelector('textarea')?.value).toBe('真实草稿');
  });
  it('forwards the actual textarea ref used by the host drop registry', async () => {
    const ref = createRef<HTMLTextAreaElement>();
    const { element } = await render({ textareaRef: ref });
    expect(ref.current).toBe(element.querySelector('[data-lcos-composer-input]'));
  });
  it('does not enable send just because there is text', async () => {
    const { props, element } = await render({ state: 'unknown', canSubmit: false });
    const button = element.querySelector<HTMLButtonElement>('[aria-label="提交"]');
    expect(button?.disabled).toBe(true);
    await act(async () => button?.click());
    expect(props.onSubmit).not.toHaveBeenCalled();
  });
  it('does not fabricate attachment, receiver-pick or remove actions', async () => {
    const { element } = await render({ references: [{ key: 'artifact:a', label: 'A' }] });
    expect(element.querySelector('[aria-label="移除引用 A"]')).toBeNull();
    expect(element.querySelector('[data-lcos-nearfield-glyph="at"]')).toBeNull();
    expect(element.querySelector('.lcos-composer-receiver')).toBeNull();
  });
  it('labels the current receiver and keeps the empty reference target visible for Drop', async () => {
    const { element } = await render({
      contextLabel: '当前接收者', identity: <span>Glyth</span>, title: '设计会话',
    });
    expect(element.querySelector('[data-lcos-composer-context-label]')?.textContent).toBe('当前接收者');
    expect(element.querySelector('.lcos-composer-title')?.textContent).toBe('设计会话');
    expect(element.querySelector('[data-lcos-composer-reference-empty]')?.textContent).toContain('拖入材料');
    expect(element.querySelector('.lcos-composer-reference-heading')?.textContent).toContain('本次引用');
  });
  it('preserves explicit reference order and calls the supplied remover exactly once', async () => {
    const remove = vi.fn();
    const { element } = await render({ references: [
      { key: 'artifact:b', label: 'B', onRemove: remove },
      { key: 'artifact:a', label: 'A' },
    ] });
    expect([...element.querySelectorAll('[data-reference-key]')].map((e) => e.getAttribute('data-reference-key')))
      .toEqual(['artifact:b', 'artifact:a']);
    await act(async () => element.querySelector<HTMLButtonElement>('[aria-label="移除引用 B"]')?.click());
    expect(remove).toHaveBeenCalledTimes(1);
    expect(element.querySelector('.lcos-composer-reference-count')?.textContent).toBe('2');
  });
  it('closing delegates only the close callback', async () => {
    const { props, element } = await render();
    await act(async () => element.querySelector<HTMLButtonElement>('[aria-label="关闭 Composer"]')?.click());
    expect(props.onClose).toHaveBeenCalledTimes(1);
    expect(props.onTextChange).not.toHaveBeenCalled();
    expect(props.onSubmit).not.toHaveBeenCalled();
  });
  it('unknown can expose check-original-operation without inventing retry', async () => {
    const check = vi.fn();
    const { props, element } = await render({
      state: 'unknown', canSubmit: false, feedback: '提交结果尚未确认，请先核对原操作。',
      feedbackAction: { label: '核对发送结果', onClick: check },
    });
    await act(async () => element.querySelector<HTMLButtonElement>('[aria-label="核对发送结果"]')?.click());
    expect(check).toHaveBeenCalledTimes(1);
    expect(props.onSubmit).not.toHaveBeenCalled();
  });
});
