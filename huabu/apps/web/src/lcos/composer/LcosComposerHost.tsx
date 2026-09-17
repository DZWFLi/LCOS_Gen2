// LcosComposerHost — 统一提交入口（Figma Composer READY；T3-A04 机制）。
// 显式引用 strip（reference store draft）+ 文本；Cmd/Ctrl+Enter 提交真实 Run（CoreRunClient.createRun）。
// 提交后回执展示；失败保留草稿文本；不伪造成功。Draft 是 local UI intent，Run truth 在 Core。
// workspaceId 必须用当前现场的真实 workspace（由 Shell 从 Core workspaces 反查传入）——
// 写死 'main' 会被 Core 外键拒绝（FOREIGN KEY constraint failed → 409）。

import { CoreCollaborationClient, HttpError } from '@local-creative-os/web-gen2';
import { ArrowUp, Paperclip, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';

import {
  CanvasFloatingPopover,
  type CanvasAnchorRect,
} from '@/components/Common/CanvasFloatingPopover';
import { useCloseOnEscape } from '@/hooks/useCloseOnEscape';

import { buildComposerRunInput, canSubmitComposerTarget } from './composerSubmission';
import { createLcosCoreSession } from '../app/lcosCoreClient';
import { rectFromDomRect } from '../drop/dropTargetRegistry';
import { useLcosReferenceStore } from '../lcosReferenceState';
import { useLcosDropStore } from '../lcosDropState';
import { useLcosShellStore } from '../shell/lcosShellStore';
import { lcosGlassStyle, lcosTokens } from '../ui/lcosTokens';

import type { CoreEntityRefLike } from '../referenceBridge';
import type { DropTargetRegistration } from '../drop/dropTypes';

const ENTITY_LABEL: Readonly<Record<string, string>> = {
  artifact: '材料',
  conversation: '会话',
  note: '便签',
  resource: '资源',
  context: '上下文',
  workflow: '工作流',
  scene: '现场',
  collection: '集合',
};

function referenceLabel(ref: {
  readonly entityType: string;
  readonly displayLabel?: string;
  readonly descriptor?: { readonly title?: string };
}): string {
  return (
    ref.displayLabel ??
    ref.descriptor?.title ??
    ENTITY_LABEL[ref.entityType] ??
    '引用'
  );
}

export interface LcosComposerHostProps {
  readonly projectId: string;
  /** 当前现场的真实 workspaceId（缺省 = 现场未就绪，不可提交）。 */
  readonly workspaceId?: string;
  readonly anchor: CanvasAnchorRect | null;
  readonly open: boolean;
  readonly onClose: () => void;
  /** Work View reuses this exact Composer inline; canvas callers keep the popover host. */
  readonly inline?: boolean;
}

type ComposerState = 'idle' | 'submitting' | 'done' | 'error';

export function LcosComposerHost({
  projectId,
  workspaceId,
  anchor,
  open,
  onClose,
  inline = false,
}: LcosComposerHostProps): React.JSX.Element | null {
  const session = useMemo(() => createLcosCoreSession(), []);
  const collaboration = useMemo(() => new CoreCollaborationClient(session.http), [session]);
  const draftRefs = useLcosReferenceStore((s) => s.draft.orderedEntityRefs);
  const text = useLcosShellStore((s) => s.composerPrompt);
  const composerTarget = useLcosShellStore((s) => s.composerTarget);
  const setText = useLcosShellStore((s) => s.setComposerPrompt);
  const [state, setState] = useState<ComposerState>('idle');
  const [receipt, setReceipt] = useState<string | null>(null);
  const [errorDetail, setErrorDetail] = useState<string | undefined>(undefined);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const registerTarget = useLcosDropStore((s) => s.registerTarget);
  const unregisterTarget = useLcosDropStore((s) => s.unregisterTarget);

  useCloseOnEscape(open, onClose);

  // Register only the actual prompt editor as a Composer reference target.
  // The registry is live gesture geometry; the draft and Run remain owned by
  // their existing stores/clients.
  useEffect(() => {
    if (!open || projectId.length === 0 || composerTarget === null || textareaRef.current === null) return;
    const targetId = `composer:${projectId}:${composerTarget.nodeId}`;
    const target: Omit<DropTargetRegistration, 'rect'> = {
      targetId,
      kind: 'composer-reference',
      label: 'Composer 引用区',
      priority: 30,
      enabled: true,
      semantic: { kind: 'composer-reference' },
    };
    const publish = (): void => {
      const editor = textareaRef.current;
      if (editor === null) return;
      registerTarget({ ...target, rect: rectFromDomRect(editor.getBoundingClientRect()) });
    };
    publish();
    const observer = typeof ResizeObserver === 'function'
      ? new ResizeObserver(publish)
      : null;
    observer?.observe(textareaRef.current);
    window.addEventListener('resize', publish);
    window.addEventListener('scroll', publish, true);
    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', publish);
      window.removeEventListener('scroll', publish, true);
      unregisterTarget(targetId);
    };
  }, [composerTarget, open, projectId, registerTarget, unregisterTarget]);

  if (!open || (!inline && anchor === null) || projectId.length === 0) return null;

  const canSubmit =
    composerTarget !== null &&
    state !== 'submitting' &&
    canSubmitComposerTarget(composerTarget, text, workspaceId);

  const submit = async (): Promise<void> => {
    if (!canSubmit || workspaceId === undefined || !composerTarget) return;
    setState('submitting');
    setErrorDetail(undefined);
    setReceipt(null);
    const refs: readonly CoreEntityRefLike[] = draftRefs;
    void collaboration
      .delegate(projectId, buildComposerRunInput({
        projectId,
        instruction: text.trim(),
        workspaceId,
        target: composerTarget,
        refs,
      }))
      .then((result) => {
        const id = (result as { id?: string } | null)?.id;
        setState('done');
        setReceipt(
          id
            ? `Run 已创建 · ${id.slice(0, 12)}`
            : 'Run 已创建（回执未带 id，查阅 Main/运行节点）',
        );
        // The user may have changed projects, receiver, or draft while awaiting Core.
        useLcosShellStore.getState().clearSubmittedComposerPrompt(projectId, composerTarget, text);
      })
      .catch((error: unknown) => {
        setState('error');
        setErrorDetail(
          error instanceof HttpError
            ? `${error.message} (${error.status})`
            : String(error),
        );
      });
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>): void => {
    if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
      event.preventDefault();
      void submit();
    }
  };

  const content = (
      <div
        data-lcos-composer
        data-lcos-composer-target={composerTarget?.nodeId}
        className={inline ? 'pointer-events-auto w-full min-w-0' : 'pointer-events-auto w-[min(520px,calc(100vw-32px))]'}
      >
        <div
          className="flex flex-col overflow-hidden rounded-2xl"
          style={{ ...lcosGlassStyle, borderRadius: 18 }}
        >
          <div className="flex items-center justify-between px-3 pt-2.5">
            <span
              className="text-[11px]"
              style={{ color: lcosTokens.color.muted }}
            >
              围绕「{composerTarget?.title ?? '当前对象'}」工作
            </span>
            <button
              type="button"
              aria-label="关闭 Composer"
              title="关闭（草稿保留）"
              onClick={onClose}
              className="rounded-full p-1"
            >
              <X
                className="h-3.5 w-3.5"
                style={{ color: lcosTokens.color.muted }}
              />
            </button>
          </div>
          {draftRefs.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5 px-3 pt-2.5">
              {draftRefs.map((ref) => (
                <span
                  key={`${ref.entityType}:${ref.entityId}`}
                  data-lcos-composer-ref
                  className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px]"
                  style={{
                    background: lcosTokens.color.raised,
                    color: lcosTokens.color.text,
                  }}
                >
                  <Paperclip
                    className="h-3 w-3"
                    style={{ color: lcosTokens.color.muted }}
                    aria-hidden
                  />
                  {referenceLabel(ref)}
                </span>
              ))}
            </div>
          )}
          <div className="flex items-end gap-2 px-3 py-2.5">
            <textarea
              ref={textareaRef}
              data-lcos-composer-input
              value={text}
              onChange={(e) => {
                setText(e.target.value);
                if (state === 'done' || state === 'error') setState('idle');
              }}
              onKeyDown={onKeyDown}
              rows={2}
              placeholder="告诉 Agent 下一步要做什么…（Cmd/Ctrl+Enter 提交；空行不可提交）"
              aria-label="Composer 输入"
              className="max-h-40 w-full resize-none bg-transparent text-sm leading-relaxed outline-none"
              style={{ color: lcosTokens.color.text }}
            />
            <button
              type="button"
              disabled={!canSubmit}
              aria-label="提交"
              title={
                workspaceId === undefined
                  ? '现场未就绪（未解析到 workspace），暂不可提交'
                  : composerTarget?.receiverBlockedReason ?? '提交（Cmd/Ctrl+Enter）'
              }
              onClick={() => void submit()}
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full transition-colors disabled:opacity-40"
              style={{
                background: lcosTokens.color.inverse,
                color: lcosTokens.color.textOnInverse,
              }}
            >
              <ArrowUp className="h-4 w-4" />
            </button>
          </div>
          {workspaceId === undefined && (
            <div
              data-lcos-composer-blocked
              className="px-4 pb-2 text-xs"
              style={{ color: lcosTokens.color.danger }}
            >
              现场未就绪（未解析到 workspace），暂不可提交
            </div>
          )}
          {composerTarget?.receiverBlockedReason && (
            <div
              data-lcos-composer-receiver-blocked
              className="px-4 pb-2 text-xs"
              style={{ color: lcosTokens.color.danger }}
            >
              {composerTarget.receiverBlockedReason}
            </div>
          )}
          {state === 'submitting' && (
            <div
              className="px-4 pb-2 text-xs"
              style={{ color: lcosTokens.color.muted }}
            >
              提交中…
            </div>
          )}
          {state === 'done' && receipt && (
            <div
              className="px-4 pb-2 text-xs"
              style={{ color: lcosTokens.color.accent }}
            >
              {receipt}
            </div>
          )}
          {state === 'error' && (
            <div
              className="px-4 pb-2 text-xs"
              style={{ color: lcosTokens.color.danger }}
            >
              提交失败 · {errorDetail}（草稿已保留）
            </div>
          )}
        </div>
      </div>
  );

  return inline ? content : anchor ? (
    <CanvasFloatingPopover anchor={anchor} open={open} side="top" offset={10}>
      {content}
    </CanvasFloatingPopover>
  ) : null;
}
