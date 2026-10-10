import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ConversationEventView } from './ConversationEventView';
import { ConversationIdentityView } from './ConversationIdentityView';
let host: HTMLDivElement; let root: Root;
beforeEach(() => { vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); host = document.createElement('div'); document.body.append(host); root = createRoot(host); });
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); });
async function mount(node: ReactNode) { await act(async () => root.render(node)); }
const props = { kind: 'progress', title: '正在整理', body: '从真实材料继续整理', label: '进展', icon: null, presentation: 'activity' as const };
it('pins a neutral process preview and Escape returns focus to its original trigger', async () => {
 await mount(<ConversationEventView {...props} />); const trigger = host.querySelector('button')!;
 expect(trigger.getAttribute('aria-expanded')).toBe('false'); expect(host.querySelector('[inert]')).not.toBeNull();
 await act(async () => { trigger.focus(); trigger.click(); });
 expect(trigger.getAttribute('aria-expanded')).toBe('true'); expect(host.querySelector('[inert]')).toBeNull();
 await act(async () => trigger.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })));
 expect(trigger.getAttribute('aria-expanded')).toBe('false'); expect(document.activeElement).toBe(trigger);
});
it('keeps recovery and required-answer text immediately visible, outside disclosure', async () => {
 for (const tone of ['danger', 'attention'] as const) {
  await mount(<ConversationEventView {...props} tone={tone}><button>恢复原操作</button></ConversationEventView>);
  expect(host.querySelector('[data-lcos-inline-peek]')).toBeNull(); expect(host.querySelector('.lcos-conversation-event-body')?.textContent).toBe(props.body);
  expect(host.querySelector('button')?.textContent).toBe('恢复原操作');
 }
});
it('keeps complete messages once when their generated title repeats a truncated opening', async () => {
 await mount(<ConversationEventView {...props} presentation="message" title="你好…" body="你好，这是完整正文。" />);
 expect(host.querySelector('.lcos-conversation-event-title')).toBeNull(); expect(host.querySelector('.lcos-conversation-event-body')?.textContent).toBe('你好，这是完整正文。');
});
it('only removes exact duplicate identity text and preserves distinct capability facts', async () => {
 await mount(<ConversationIdentityView title="会话" subtitle=" 会话 " stateLabel="等待" />); expect(host.querySelector('p')).toBeNull();
 await mount(<ConversationIdentityView title="会话" subtitle="权限需要确认" stateLabel="等待" />); expect(host.querySelector('p')?.textContent).toBe('权限需要确认');
});
