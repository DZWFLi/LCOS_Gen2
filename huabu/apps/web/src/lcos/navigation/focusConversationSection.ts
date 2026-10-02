/** Presentation-only focus into the existing WorkView; no second window or session state. */
export type ConversationSectionAction = 'answer-input' | 'review-result' | 'view-progress' | 'recover-session' | 'session-diagnostics' | 'session-options' | 'cancel-work';
const SECTIONS: Record<ConversationSectionAction, string> = {
  'answer-input': '[data-lcos-waiting-input]',
  'review-result': '[data-lcos-artifact-return]',
  'view-progress': '[data-lcos-conversation-timeline]',
  'recover-session': '[data-lcos-user-recovery]',
  'session-diagnostics': '[data-lcos-diagnostics-host]',
  'session-options': '[data-lcos-conversation-composer]',
  'cancel-work': '[data-lcos-cancel-work-host]',
};

export function focusConversationSection(conversationId: string, action: ConversationSectionAction): () => void {
  let observer: MutationObserver | undefined;
  let timeout: ReturnType<typeof setTimeout> | undefined;
  let cancelled = false;
  const cancel = (): void => {
    cancelled = true;
    observer?.disconnect();
    if (timeout !== undefined) clearTimeout(timeout);
  };
  const focus = (): boolean => {
    if (cancelled) return false;
    const body = [...document.querySelectorAll<HTMLElement>('[data-lcos-window-body="conversation"]')]
      .find((element) => element.dataset.lcosWindowTarget === conversationId && !element.closest('[hidden], [aria-hidden="true"]'));
    const section = body?.querySelector<HTMLElement>(SECTIONS[action]);
    if (body === undefined || section === null || section === undefined) return false;
    if (action === 'session-diagnostics') {
      const toggle = section.querySelector<HTMLButtonElement>('[data-lcos-diagnostics-toggle]');
      if (toggle?.getAttribute('aria-expanded') === 'false') toggle.click();
    }
    // WaitingInput may mount a loading section first. Wait for its actual response control.
    const control = action === 'view-progress' ? null : section.querySelector<HTMLElement>(
      'textarea:not(:disabled), input:not(:disabled), button:not(:disabled), select:not(:disabled)',
    );
    if (action !== 'view-progress' && control === null) return false;
    const top = body.scrollTop + section.getBoundingClientRect().top - body.getBoundingClientRect().top - 12;
    body.scrollTo({ top: Math.max(0, top), behavior: 'auto' });
    if (control !== null) control.focus({ preventScroll: true });
    else {
      if (!section.hasAttribute('tabindex')) section.setAttribute('tabindex', '-1');
      section.focus({ preventScroll: true });
    }
    cancel();
    return true;
  };
  if (focus()) return cancel;
  observer = new MutationObserver(() => { focus(); });
  observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['disabled', 'data-lcos-window-target'] });
  // Lazy WorkView/section fetch may fail. Never steal focus later from a different task.
  timeout = setTimeout(cancel, 5000);
  return cancel;
}
