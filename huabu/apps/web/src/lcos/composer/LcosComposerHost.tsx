// LcosComposerHost — 统一提交入口（Figma Composer READY；T3-A04 机制）。
// 显式引用 strip（reference store draft）+ 文本；Cmd/Ctrl+Enter 提交真实 Run（CoreRunClient.createRun）。
// 提交后回执展示；失败保留草稿文本；不伪造成功。Draft 是 local UI intent，Run truth 在 Core。
// workspaceId 必须用当前现场的真实 workspace（由 Shell 从 Core workspaces 反查传入）——
// 写死 'main' 会被 Core 外键拒绝（FOREIGN KEY constraint failed → 409）。

import { CoreRunClient, HttpError } from '@local-creative-os/web-gen2';
import { ArrowUp, Paperclip } from 'lucide-react';
import { useMemo, useRef, useState } from 'react';

import { createLcosCoreSession } from '../app/lcosCoreClient';
import { useLcosReferenceStore } from '../lcosReferenceState';
import { lcosGlassStyle, lcosTokens } from '../ui/lcosTokens';

import type { CoreEntityRefLike } from '../referenceBridge';

export interface LcosComposerHostProps {
  readonly projectId: string;
  /** 当前现场的真实 workspaceId（缺省 = 现场未就绪，不可提交）。 */
  readonly workspaceId?: string;
}

type ComposerState = 'idle' | 'submitting' | 'done' | 'error';

export function LcosComposerHost({ projectId, workspaceId }: LcosComposerHostProps): React.JSX.Element {
  const session = useMemo(() => createLcosCoreSession(), []);
  const runs = useMemo(() => new CoreRunClient(session.http), [session]);
  const draftRefs = useLcosReferenceStore((s) => s.draft.orderedEntityRefs);
  const [text, setText] = useState('');
  const [state, setState] = useState<ComposerState>('idle');
  const [receipt, setReceipt] = useState<string | null>(null);
  const [errorDetail, setErrorDetail] = useState<string | undefined>(undefined);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const canSubmit = text.trim().length > 0 && state !== 'submitting' && workspaceId !== undefined;

  const submit = async (): Promise<void> => {
    if (!canSubmit || workspaceId === undefined) return;
    setState('submitting');
    setErrorDetail(undefined);
    setReceipt(null);
    const refs: readonly CoreEntityRefLike[] = draftRefs;
    void runs
      .createRun(projectId, {
        instruction: text.trim(),
        outputIntent: 'analyze',
        // contextArtifactIds 只接受真 Artifact id（Core 会校验并报
        // "Context Artifact not found"）。会话引用不是 Artifact —— 它的 entityId 是
        // connected-conversation id，只能走 orderedReferences 表达"用户显式引用"，
        // 不能冒充上下文 Artifact（Wave 10 真实 409 实测修正）。
        contextArtifactIds: refs
          .filter((r) => r.entityType === 'artifact')
          .map((r) => r.entityId),
        orderedReferences: refs.map((r) => ({ entityType: r.entityType, entityId: r.entityId })),
        workspaceId,
      })
      .then((result) => {
        const id = (result as { id?: string } | null)?.id;
        setState('done');
        setReceipt(id ? `Run 已创建 · ${id.slice(0, 12)}` : 'Run 已创建（回执未带 id，查阅 Main/运行节点）');
        setText('');
      })
      .catch((error: unknown) => {
        setState('error');
        setErrorDetail(error instanceof HttpError ? `${error.message} (${error.status})` : String(error));
      });
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>): void => {
    if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
      event.preventDefault();
      void submit();
    }
  };

  return (
    <div data-lcos-composer className="pointer-events-auto fixed bottom-[100px] left-1/2 z-40 w-[min(720px,calc(100vw-24px))] -translate-x-1/2">
      <div className="flex flex-col overflow-hidden rounded-2xl" style={{ ...lcosGlassStyle, borderRadius: 18 }}>
        {draftRefs.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5 px-3 pt-2.5">
            {draftRefs.map((ref) => (
              <span key={`${ref.entityType}:${ref.entityId}`} data-lcos-composer-ref className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px]" style={{ background: lcosTokens.color.raised.light, color: lcosTokens.color.text.light }}>
                <Paperclip className="h-3 w-3" style={{ color: lcosTokens.color.muted.light }} aria-hidden />
                {ref.entityId.slice(0, 16)}
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
            style={{ color: lcosTokens.color.text.light }}
          />
          <button
            type="button"
            disabled={!canSubmit}
            aria-label="提交"
            title={workspaceId === undefined ? '现场未就绪（未解析到 workspace），暂不可提交' : '提交（Cmd/Ctrl+Enter）'}
            onClick={() => void submit()}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full transition-colors disabled:opacity-40"
            style={{ background: lcosTokens.color.inverse.light, color: lcosTokens.color.textOnInverse.light }}
          >
            <ArrowUp className="h-4 w-4" />
          </button>
        </div>
        {workspaceId === undefined && (
          <div data-lcos-composer-blocked className="px-4 pb-2 text-xs" style={{ color: lcosTokens.color.danger }}>
            现场未就绪（未解析到 workspace），暂不可提交
          </div>
        )}
        {state === 'submitting' && (
          <div className="px-4 pb-2 text-xs" style={{ color: lcosTokens.color.muted.light }}>
            提交中…
          </div>
        )}
        {state === 'done' && receipt && (
          <div className="px-4 pb-2 text-xs" style={{ color: lcosTokens.color.accent.light }}>
            {receipt}
          </div>
        )}
        {state === 'error' && (
          <div className="px-4 pb-2 text-xs" style={{ color: lcosTokens.color.danger }}>
            提交失败 · {errorDetail}（草稿已保留）
          </div>
        )}
      </div>
    </div>
  );
}