import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

const resume = vi.fn();
const newSession = vi.fn();
const fork = vi.fn();
const refresh = vi.fn(async () => undefined);
const onSubmitted = vi.fn();
const shellMock = vi.hoisted(() => {
  type ShellState = {
    readonly continuationRequests: ReadonlyMap<string, unknown>;
    readonly setContinuationRequest: (key: string, request: unknown) => void;
    readonly openWindow: ReturnType<typeof vi.fn>;
  };
  const listeners = new Set<() => void>();
  const openWindow = vi.fn();
  let state: ShellState;
  const setContinuationRequest = vi.fn((key: string, request: unknown) => {
    const continuationRequests = new Map(state.continuationRequests);
    if (request === undefined) continuationRequests.delete(key);
    else continuationRequests.set(key, request);
    state = { ...state, continuationRequests };
    listeners.forEach((listener) => listener());
  });
  state = { continuationRequests: new Map(), setContinuationRequest, openWindow };
  return {
    openWindow,
    subscribe: (listener: () => void): (() => void) => {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    getState: (): ShellState => state,
    reset: (): void => {
      state = { ...state, continuationRequests: new Map() };
      listeners.forEach((listener) => listener());
    },
  };
});
const openWindow = shellMock.openWindow;
const projection = {
  capabilities: { canResume: true, canSelectedContext: true, canBlankNew: true, canFork: false },
  capabilityReasons: { canFork: '当前协作者不支持完整历史分支' },
};
vi.mock('@local-creative-os/web-gen2', () => ({ CoreCollaborationClient: class { resume = resume; newSession = newSession; fork = fork; } }));
vi.mock('../shell/lcosShellStore', async () => {
  const { useSyncExternalStore } = await import('react');
  const useLcosShellStore = Object.assign(
    <T,>(selector: (state: ReturnType<typeof shellMock.getState>) => T): T => useSyncExternalStore(
      shellMock.subscribe,
      () => selector(shellMock.getState()),
      () => selector(shellMock.getState()),
    ),
    { getState: shellMock.getState },
  );
  return { useLcosShellStore };
});
vi.mock('../app/lcosCoreClient', () => ({ createLcosCoreSession: () => ({ http: {} }) }));
vi.mock('../collaboration/useCollaborationSession', () => ({ useCollaborationSession: () => ({ status: 'ready', projection }) }));
vi.mock('../collaboration/collaborationSessionStore', () => ({ useCollaborationSessionStore: { getState: () => ({ refresh }) } }));

import { ConversationContinuationControls, type ConversationContinuationControlsProps } from './ConversationContinuationControls';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const roots: Root[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
  document.body.replaceChildren();
  vi.clearAllMocks();
  resume.mockReset(); newSession.mockReset(); fork.mockReset();
  shellMock.reset();
});

const base: ConversationContinuationControlsProps = {
  projectId: 'p1', conversationId: 'c1',
  draftReferences: [{ entityType: 'artifact', entityId: 'a1' }],
  referenceItems: [{ key: 'artifact:a1', label: '山野研究', onRemove: vi.fn() }], onSubmitted,
};
const accepted = (command: 'new_session' | 'resume' | 'fork', conversationId: string, continuationOperationId: string) => ({
  ok: true as const,
  receipt: { command, conversationId, continuationOperationId },
});
const failed = { ok: false, error: { code: 'provider_offline', retryable: true, userMessage: '连接中断，请重试原请求' } };

async function render(props: Partial<ConversationContinuationControlsProps> = {}) {
  const el = document.createElement('div'); document.body.appendChild(el);
  const root = createRoot(el); roots.push(root);
  await act(async () => root.render(<ConversationContinuationControls {...base} {...props} />));
  return { el, rerender: async (next: Partial<ConversationContinuationControlsProps>) => {
    await act(async () => root.render(<ConversationContinuationControls {...base} {...next} />));
  } };
}
async function expand(el: HTMLElement) {
  await act(async () => el.querySelector<HTMLButtonElement>('.lcos-continuation-toggle')?.click());
}
async function chooseMode(el: HTMLElement, value: string) {
  const field = el.querySelector<HTMLInputElement>(`input[type="radio"][value="${value}"]`);
  if (field === null) throw new Error('missing mode select');
  await act(async () => { field.click(); });
}
async function confirm(el: HTMLElement) {
  await act(async () => el.querySelector<HTMLButtonElement>('[data-lcos-continuation-confirm]')?.click());
}

describe('compact continuation controls', () => {
  it('starts folded and selecting a mode only previews its exact inheritance scope', async () => {
    const { el } = await render();
    expect(el.querySelector('select')).toBeNull();
    await expand(el); await chooseMode(el, 'selected_context');
    expect(el.textContent).toContain('不继承原会话历史');
    expect(el.textContent).toContain('山野研究');
    expect(el.querySelector('[aria-label^="移除引用"]')).toBeNull();
    expect(resume).not.toHaveBeenCalled(); expect(newSession).not.toHaveBeenCalled();
  });

  it('never changes unsupported full fork to a selected-context session', async () => {
    const { el } = await render(); await expand(el); await chooseMode(el, 'native_full_fork');
    expect(el.textContent).toContain('当前协作者不支持完整历史分支');
    expect(el.querySelector<HTMLButtonElement>('[data-lcos-continuation-confirm]')?.disabled).toBe(true);
    await confirm(el);
    expect(fork).not.toHaveBeenCalled(); expect(newSession).not.toHaveBeenCalled();
  });

  it('submits blank_new without draft references and presents acceptance rather than completion', async () => {
    newSession.mockImplementation((_projectId, _action, input: { conversationId: string; operationId: string }) =>
      Promise.resolve(accepted('new_session', input.conversationId, input.operationId)));
    const { el } = await render(); await expand(el); await chooseMode(el, 'blank_new'); await confirm(el);
    expect(newSession).toHaveBeenCalledWith('p1', 'blank_new', { conversationId: 'c1', operationId: expect.any(String) });
    expect(el.textContent).toContain('请求已提交，等待外部确认');
    expect(el.textContent).not.toContain('创建完成');
    expect(onSubmitted).toHaveBeenCalledWith({ action: 'blank_new', operationId: expect.any(String) });
  });

  it('retains the original selected references and labels during retry while the current draft changes', async () => {
    newSession.mockResolvedValueOnce(failed).mockImplementationOnce((_projectId, _action, input: { conversationId: string; operationId: string }) =>
      Promise.resolve(accepted('new_session', input.conversationId, input.operationId)));
    const { el, rerender } = await render(); await expand(el); await chooseMode(el, 'selected_context'); await confirm(el);
    const first = newSession.mock.calls[0]?.[2];
    await rerender({ draftReferences: [], referenceItems: [] });
    expect(el.textContent).toContain('本次提交 · 只读快照');
    expect(el.textContent).toContain('山野研究');
    expect(el.textContent).toContain('当前草稿 0 项');
    await confirm(el);
    expect(newSession.mock.calls[1]?.[2]).toEqual(first);
    expect(first.orderedReferences).toEqual([{ order: 0, ref: { type: 'artifact', artifactId: 'a1' } }]);
  });

  it('keeps distinct uncertain intents when modes change and retry returns to the original mode', async () => {
    resume.mockResolvedValue(failed); newSession.mockResolvedValue(failed);
    const { el } = await render(); await expand(el); await confirm(el);
    await chooseMode(el, 'blank_new'); await confirm(el); await chooseMode(el, 'continue_existing'); await confirm(el);
    expect(resume.mock.calls[1]?.[1]).toEqual(resume.mock.calls[0]?.[1]);
    expect(newSession.mock.calls[0]?.[2].operationId).not.toEqual(resume.mock.calls[0]?.[1].operationId);
  });

  it('keeps an unknown outcome honest and requires recovery instead of automatic or duplicate submission', async () => {
    resume.mockRejectedValue(new Error('timeout'));
    const { el } = await render(); await expand(el); await confirm(el);
    expect(el.querySelector('[data-lcos-continuation-error]')?.getAttribute('data-error-code')).toBe('operation_unknown');
    expect(el.querySelector<HTMLButtonElement>('[data-lcos-continuation-confirm]')?.disabled).toBe(true);
    expect(el.textContent).toContain('核对或恢复原操作');
    expect(resume).toHaveBeenCalledTimes(1);
    const recover = [...el.querySelectorAll<HTMLButtonElement>('button')].find((button) => button.textContent?.includes('核对或恢复原操作'));
    await act(async () => recover?.click());
    expect(openWindow).toHaveBeenCalledWith('conversation', '会话恢复', 'c1');
  });

  it('ignores a previous target callback and does not leak its receipt into the new target', async () => {
    let finish!: (value: ReturnType<typeof accepted>) => void;
    let operationId = '';
    resume.mockImplementation((_projectId, input: { conversationId: string; operationId: string }) =>
      new Promise<ReturnType<typeof accepted>>((resolve) => { finish = resolve; operationId = input.operationId; }));
    const { el, rerender } = await render(); await expand(el); await confirm(el);
    await rerender({ conversationId: 'c2' });
    await act(async () => finish(accepted('resume', 'c1', operationId)));
    await expand(el);
    expect(el.querySelector('[data-lcos-continuation-receipt]')).toBeNull();
    expect(onSubmitted).not.toHaveBeenCalled();
    expect(refresh).toHaveBeenCalledWith('p1', 'c1');
  });

  it('blocks selected-context submission for no references or unsupported entity kinds', async () => {
    const { el, rerender } = await render({ draftReferences: [], referenceItems: [] });
    await expand(el); await chooseMode(el, 'selected_context');
    expect(el.querySelector<HTMLButtonElement>('[data-lcos-continuation-confirm]')?.disabled).toBe(true);
    await rerender({ draftReferences: [{ entityType: 'note', entityId: 'n1' }] });
    expect(el.textContent).toContain('部分引用尚不支持');
    expect(newSession).not.toHaveBeenCalled();
  });

  it('prevents duplicate rapid confirmation and Escape only folds these options', async () => {
    resume.mockReturnValue(new Promise(() => undefined));
    const { el } = await render(); await expand(el);
    const button = el.querySelector<HTMLButtonElement>('[data-lcos-continuation-confirm]');
    await act(async () => { button?.click(); button?.click(); });
    expect(resume).toHaveBeenCalledTimes(1);
    const event = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
    await act(async () => button?.dispatchEvent(event));
    expect(event.defaultPrevented).toBe(true);
    expect(el.querySelector('select')).toBeNull();
  });
});
