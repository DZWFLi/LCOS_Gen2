import { CoreCollaborationClient } from '@local-creative-os/web-gen2';
import { ChevronDown, GitFork, History, Layers, Plus, RotateCcw } from 'lucide-react';
import { useEffect, useId, useMemo, useRef, useState } from 'react';

import {
  buildSelectedContextReferences,
  createContinuationOperationId,
  retainContinuationIntent,
  type ConversationContinuationAction,
  type ContinuationUiRequest,
} from './conversationContinuationActions';
import { createLcosCoreSession } from '../app/lcosCoreClient';
import { useCollaborationSessionStore } from '../collaboration/collaborationSessionStore';
import { useCollaborationSession } from '../collaboration/useCollaborationSession';
import { useLcosShellStore } from '../shell/lcosShellStore';
import { ComposerReferenceStrip } from '../ui/nearfield/ComposerReferenceStrip';
import { LcosButton } from '../ui/primitives/LcosButton';
import '../ui/professional/conversation-continuation.css';

import type { CoreEntityRefLike } from '../referenceBridge';
import type { ComposerReferenceViewItem } from '../ui/nearfield/composerViewTypes';
import type { OrderedRunReferenceV2 } from '@local-creative-os/contracts';

export interface ConversationContinuationSubmission {
  readonly action: ConversationContinuationAction;
  readonly operationId: string;
  readonly orderedReferences?: readonly OrderedRunReferenceV2[];
}

export interface ConversationContinuationControlsProps {
  readonly disabled?: boolean;
  readonly projectId: string;
  readonly conversationId: string;
  readonly draftReferences: readonly CoreEntityRefLike[];
  readonly referenceItems?: readonly ComposerReferenceViewItem[];
  readonly collaboration?: Pick<CoreCollaborationClient, 'resume' | 'newSession' | 'fork'>;
  /** Journal acceptance only: this is never evidence that the external session exists. */
  readonly onSubmitted?: (submission: ConversationContinuationSubmission) => void;
}

const MODES = [
  { action: 'continue_existing', capability: 'canResume', label: '继续现有会话', Icon: RotateCcw, history: '保留当前会话历史', context: '沿用原上下文；不追加当前草稿引用' },
  { action: 'selected_context', capability: 'canSelectedContext', label: '精选上下文新建', Icon: Layers, history: '不继承原会话历史', context: '仅携带下方确认的引用' },
  { action: 'blank_new', capability: 'canBlankNew', label: '空白新建', Icon: Plus, history: '不继承原会话历史', context: '不携带当前引用' },
  { action: 'native_full_fork', capability: 'canFork', label: '完整历史分支', Icon: GitFork, history: '仅继承协作者支持分支的已完成历史', context: '不将当前草稿自动追加为引用' },
] as const;

function readOnlyItems(items: readonly ComposerReferenceViewItem[]): readonly ComposerReferenceViewItem[] {
  return items.map(({ onRemove: _onRemove, ...item }) => ({ ...item }));
}

/** Figma 5246:59 / 5249:415–1975, narrowed by T7 §9 and R5 §7–8.
 * The existing Composer owns the draft. This child holds only caller request identity
 * and its immutable submission preview, never another conversation/window store. */
export function ConversationContinuationControls({
  projectId, conversationId, disabled = false, draftReferences, referenceItems, collaboration: suppliedClient, onSubmitted,
}: ConversationContinuationControlsProps): React.JSX.Element {
  const ownedClient = useMemo(() => suppliedClient ?? new CoreCollaborationClient(createLcosCoreSession().http), [suppliedClient]);
  const entry = useCollaborationSession(projectId, conversationId);
  const projection = entry?.status === 'ready' ? entry.projection : undefined;
  const targetKey = JSON.stringify([projectId, conversationId]);
  const activeTarget = useRef(targetKey);
  activeTarget.current = targetKey;
  const mounted = useRef(true);
  const requests = useLcosShellStore((state) => state.continuationRequests);
  const setRequest = useLcosShellStore((state) => state.setContinuationRequest);
  const [expanded, setExpanded] = useState(false);
  const [action, setAction] = useState<ConversationContinuationAction>('continue_existing');
  const sectionId = useId();
  const selectedContext = useMemo(() => buildSelectedContextReferences(draftReferences), [draftReferences]);
  const fallbackItems = draftReferences.map((ref, index) => ({ key: `${ref.entityType}:${ref.entityId}`, label: `引用 ${index + 1}` }));
  const draftItems = readOnlyItems(referenceItems ?? fallbackItems);
  const mode = MODES.find((item) => item.action === action) ?? MODES[0];
  const requestKey = `${targetKey}:${action}`;
  const request = requests.get(requestKey);
  const pendingForTarget = MODES.some((item) => requests.get(`${targetKey}:${item.action}`)?.status === 'sending');
  const capabilityReason = projection?.capabilities[mode.capability] === true ? undefined
    : projection?.capabilityReasons?.[mode.capability] ?? (entry?.status === 'error' ? '暂时无法读取会话能力' : '当前协作方式尚未确认支持此操作');
  // A retry uses its first submitted snapshot even if the next draft is now empty.
  const referenceReason = action !== 'selected_context' || request !== undefined ? undefined
    : selectedContext.unsupportedEntityTypes.length > 0 ? '部分引用尚不支持新建会话，请先移除不支持的引用'
      : selectedContext.orderedReferences.length === 0 ? '先把要携带的材料加入输入框引用' : undefined;
  const blockedReason = disabled ? '当前消息尚未确认，请先核对或处理原消息' : capabilityReason ?? referenceReason;

  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => { setExpanded(false); setAction('continue_existing'); }, [targetKey]);

  const submit = async (): Promise<void> => {
    if (!mounted.current || activeTarget.current !== targetKey || blockedReason !== undefined || pendingForTarget || request?.status === 'accepted') return;
    if (useLcosShellStore.getState().continuationRequests.get(requestKey)?.status === 'accepted') return;
    // Synchronous guard also blocks two clicks before React has rendered busy state.
    if (MODES.some((item) => useLcosShellStore.getState().continuationRequests.get(`${targetKey}:${item.action}`)?.status === 'sending')) return;
    const intent = retainContinuationIntent(request?.intent, action, targetKey,
      () => createContinuationOperationId(action), action === 'selected_context' ? selectedContext.orderedReferences : undefined);
    const next: ContinuationUiRequest = { intent, items: request?.items ?? (action === 'selected_context' ? draftItems : []), status: 'sending' };
    setRequest(requestKey, next);
    const stillCurrent = (): boolean => mounted.current && activeTarget.current === targetKey;
    try {
      const result = action === 'continue_existing'
        ? await ownedClient.resume(projectId, { operationId: intent.operationId, conversationId })
        : action === 'native_full_fork'
          ? await ownedClient.fork(projectId, { operationId: intent.operationId, conversationId })
          : await ownedClient.newSession(projectId, action, {
            operationId: intent.operationId, conversationId,
            ...(action === 'selected_context' ? { orderedReferences: intent.orderedReferences ?? [] } : {}),
          });
      if (useLcosShellStore.getState().continuationRequests.get(requestKey) !== next) return;
      if (result.ok && (result.receipt.conversationId !== conversationId || result.receipt.continuationOperationId !== intent.operationId
        || result.receipt.command !== (action === 'continue_existing' ? 'resume' : action === 'native_full_fork' ? 'fork' : 'new_session'))) throw new Error('回执身份未确认');
      if (result.ok) {
        // Keep a readonly preview after settlement; it is not the editable draft.
        setRequest(requestKey, { ...next, status: 'accepted' });
        void useCollaborationSessionStore.getState().refresh(projectId, conversationId);
        if (stillCurrent()) onSubmitted?.({ action, operationId: intent.operationId,
          ...(intent.orderedReferences === undefined ? {} : { orderedReferences: intent.orderedReferences }) });
      } else {
        setRequest(requestKey, { ...next, status: 'error', error: result.error });
      }
    } catch {
      if (useLcosShellStore.getState().continuationRequests.get(requestKey) !== next) return;
      setRequest(requestKey, { ...next, status: 'error', error: {
        schemaVersion: 1, code: 'operation_unknown', retryable: false,
        userMessage: '请求结果尚未确认；请核对原请求，不要重复创建。',
      } });
    }
  };

  const handleEscape = (event: React.KeyboardEvent): void => {
    if (event.key === 'Escape' && expanded) {
      event.preventDefault(); event.stopPropagation(); setExpanded(false);
    }
  };

  return (
    <section data-lcos-conversation-continuation className="lcos-continuation-controls" aria-label="会话选项">
      <button type="button" className="lcos-continuation-toggle" onKeyDown={handleEscape} aria-expanded={expanded} aria-controls={sectionId}
        onClick={() => setExpanded((value) => !value)}>
        <GitFork size={14} aria-hidden /><span>会话选项</span>
        {request?.status === 'sending' && <small>提交中…</small>}
        {request?.status === 'accepted' && <small>请求已提交</small>}
        {request?.status === 'error' && <small>需要处理</small>}
        <ChevronDown size={13} aria-hidden className={expanded ? 'is-open' : undefined} />
      </button>
      {expanded && <div id={sectionId} className="lcos-continuation-detail">
        <fieldset className="lcos-continuation-modes">
          <legend>继承</legend>
          <div className="lcos-continuation-mode-grid">
            {MODES.map((item) => (
              <label key={item.action} className="lcos-continuation-mode-option" data-selected={action === item.action || undefined}
                title={`${item.label} · ${item.history} · ${item.context}`}>
                <input type="radio" name={`${sectionId}-continuation-mode`} value={item.action}
                  checked={action === item.action} disabled={pendingForTarget || disabled}
                  aria-label={`${item.label}。${item.history}；${item.context}`}
                  onKeyDown={handleEscape}
                  onChange={() => setAction(item.action)} />
                <span className="lcos-continuation-mode-icon"><item.Icon size={15} aria-hidden /></span>
                <span className="lcos-continuation-mode-short">{item.action === 'continue_existing' ? '续用'
                  : item.action === 'selected_context' ? '精选'
                    : item.action === 'blank_new' ? '空白' : '分支'}</span>
              </label>
            ))}
          </div>
          <div className="lcos-continuation-mode-summary" aria-live="polite">
            <strong>{mode.label}</strong>
            <span><History size={12} aria-hidden />{mode.history}</span>
            <span><Layers size={12} aria-hidden />{mode.context}</span>
          </div>
        </fieldset>
        {action === 'selected_context' && <div className="lcos-continuation-references" data-lcos-continuation-reference-preview>
          <small>{request === undefined ? '待确认引用' : '本次提交 · 只读快照'}</small>
          <ComposerReferenceStrip items={request?.items ?? draftItems} />
          {request !== undefined && <small>当前草稿 {draftReferences.length} 项；编辑不会改写本次提交。</small>}
        </div>}
        {blockedReason !== undefined && <p className="lcos-continuation-note" data-lcos-continuation-reason>{blockedReason}</p>}
        {request?.status === 'accepted' ? <p role="status" data-lcos-continuation-receipt className="lcos-continuation-note">
          请求已提交，等待外部确认。可继续编辑下一份草稿。
          <button type="button" data-lcos-open-request-status onClick={() => useLcosShellStore.getState().openWindow('conversation', '会话请求', conversationId)}>查看原请求</button>
          <button type="button" data-lcos-new-continuation-intent disabled={disabled} onClick={() => setRequest(requestKey, undefined)}>准备另一个请求</button>
        </p> : <div className="lcos-continuation-footer">
          {request?.error !== undefined && <p role="alert" data-lcos-continuation-error data-error-code={request.error.code}>
            {request.error.userMessage}
          </p>}
          <LcosButton appearance="oreo" variant="secondary" type="button" onKeyDown={handleEscape} data-lcos-continuation-confirm disabled={blockedReason !== undefined || pendingForTarget || (request?.error !== undefined && !request.error.retryable)}
            title={blockedReason ?? (request?.error !== undefined && !request.error.retryable ? '请先在会话工作窗核对或恢复原操作' : undefined)}
            onClick={() => { void submit(); }}>
            {pendingForTarget ? '提交中…' : request?.status === 'error' ? '重试原请求' : '确认并提交'}
          </LcosButton>
        </div>}
        {request?.error !== undefined && !request.error.retryable && <LcosButton appearance="oreo" variant="ghost" onKeyDown={handleEscape}
          onClick={() => useLcosShellStore.getState().openWindow('conversation', '会话恢复', conversationId)}>
          核对或恢复原操作
        </LcosButton>}
      </div>}
    </section>
  );
}
