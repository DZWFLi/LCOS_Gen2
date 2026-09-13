// LcosComposerHost — 统一提交入口（Figma Composer READY；T3-A04 机制）。
// 显式引用 strip（reference store draft）+ 文本；Cmd/Ctrl+Enter 提交真实 Run（CoreRunClient.createRun）。
// 提交后回执展示；失败保留草稿文本；不伪造成功。Draft 是 local UI intent，Run truth 在 Core。

import { CoreRunClient, HttpError } from '@local-creative-os/web-gen2';
import { ArrowUp, Paperclip } from 'lucide-react';
import { useMemo, useRef, useState } from 'react';

import { createLcosCoreSession } from '../app/lcosCoreClient';
import { useLcosReferenceStore } from '../lcosReferenceState';
import { lcosGlassStyle, lcosTokens } from '../ui/lcosTokens';

import type { CoreEntityRefLike } from '../referenceBridge';

export interface LcosComposerHostProps {
  readonly projectId: string;
}

type ComposerState = 'idle' | 'submitting' | 'done' | 'error';

export function LcosComposerHost({ projectId }: LcosComposerHostProps): React.JSX.Element {
  const session = useMemo(() => createLcosCoreSession(), []);
  const runs = useMemo(() => new CoreRunClient(session.http), [session]);
  const draftRefs = useLcosReferenceStore((s) => s.draft.orderedEntityRefs);
  const [text, setText] = useState('');
  const [state, setState] = useState<ComposerState>('idle');
  const [receipt, setReceipt] = useState<string | null>(null);
  const [errorDetail, setErrorDetail] = useState<string | undefined>(undefined);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const canSubmit = text.trim().length > 0 && state !== 'submitting';

  const submit = async (): Promise<void> => {
    if (!canSubmit) return;
    setState('submitting');
    setErrorDetail(undefined);
    setReceipt(null);
    const refs: readonly CoreEntityRefLike[] = draftRefs;
    void runs
      .createRun(projectId, {
        instruction: text.trim(),
        outputIntent: 'analyze',
        contextArtifactIds: refs
          .filter((r) => r.entityType === 'artifact' || r.entityType === 'conversation')
          .map((r) => r.entityId),
        orderedReferences: refs.map((r) => ({ entityType: r.entityType, entityId: r.entityId })),
        workspaceId: 'main',
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
    <div data-lcos-composer className="pointer-events-auto fixed bottom-[100px] left-1/2 z-40 w-[min(720px,calc(100vw-240px))] -translate-x-1/2">
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
            onClick={() => void submit()}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full transition-colors disabled:opacity-40"
            style={{ background: lcosTokens.color.inverse.light, color: lcosTokens.color.textOnInverse.light }}
          >
            <ArrowUp className="h-4 w-4" />
          </button>
        </div>
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