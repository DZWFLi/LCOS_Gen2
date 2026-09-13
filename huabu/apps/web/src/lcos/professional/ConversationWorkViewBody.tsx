// ConversationWorkViewBody — Conversation Work View（Figma Professional Window / Work View 语义）。
// 同一会话的工作台：identity / reach（真实 Core 投影）+ Run 段（含 WaitingInput）+ 续工段（Recovery）。
// section 可 partial（identity_only 也可打开）；迟到回包由 controller 的 epoch/generation 丢弃。


import { CoreContinuationClient, CoreConversationClient, CoreRunClient } from '@local-creative-os/web-gen2';
import { ConversationWorkViewController } from '@local-creative-os/web-gen2';
import { CircleDot, Radio, User } from 'lucide-react';
import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';

import { ArtifactReturnSection } from './ArtifactReturnSection';
import { RecoverySection } from './RecoverySection';
import { WaitingInputSection } from './WaitingInputSection';
import { createLcosCoreSession } from '../app/lcosCoreClient';
import { LcosSurfaceFeedback } from '../ui/LcosSurfaceFeedback';
import { lcosTokens } from '../ui/lcosTokens';

import type { ContinuationRecoveryProjectionV1 } from '@local-creative-os/contracts';

export interface ConversationWorkViewBodyProps {
  readonly projectId: string;
  readonly connectedConversationId?: string;
}

export function ConversationWorkViewBody({
  projectId,
  connectedConversationId,
}: ConversationWorkViewBodyProps): React.JSX.Element {
  const session = useMemo(() => createLcosCoreSession(), []);
  const controller = useMemo(
    () => new ConversationWorkViewController(new CoreConversationClient(session.http)),
    [session],
  );
  const runs = useMemo(() => new CoreRunClient(session.http), [session]);
  const continuations = useMemo(() => new CoreContinuationClient(session.http), [session]);
  const [localOperations, setLocalOperations] = useState<readonly ContinuationRecoveryProjectionV1[] | null>(null);

  useEffect(() => {
    if (!connectedConversationId) return;
    controller.open(projectId, connectedConversationId);
    return () => controller.dispose();
  }, [controller, projectId, connectedConversationId]);

  const state = useSyncExternalStore(
    (listener) => controller.subscribe(listener),
    () => controller.read(),
    () => controller.read(),
  );

  if (!connectedConversationId) {
    return (
      <div className="flex min-h-[220px] items-center justify-center p-6">
        <LcosSurfaceFeedback presentation="empty" message="该 Glyth 尚未绑定 Core 会话（无 binding 不打开工作台）" />
      </div>
    );
  }

  const identity = state?.sections.identity;
  const reach = state?.sections.reach;
  const operations = localOperations ?? state?.operations ?? [];

  return (
    <div data-lcos-conversation-work-view className="flex flex-col gap-4 p-4">
      {/* identity / reach（真实 Core 投影；partial 也如实显示） */}
      <section className="flex flex-col gap-2 rounded-xl p-3" style={{ background: lcosTokens.color.surface.light, border: `1px solid ${lcosTokens.color.borderSubtle.light}` }}>
        <div className="flex items-center gap-2">
          <span
            aria-hidden
            className="flex h-7 w-7 items-center justify-center rounded-full text-[11px] font-bold"
            style={{ background: lcosTokens.color.inverse.light, color: lcosTokens.color.textOnInverse.light }}
          >
            <User className="h-3.5 w-3.5" />
          </span>
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold" style={{ color: lcosTokens.color.text.light }}>
              {connectedConversationId}
            </div>
            <div className="text-[10px]" style={{ color: lcosTokens.color.muted.light }}>
              {identity?.status === 'loaded' ? '身份链已读' : identity?.status === 'error' ? `身份读取失败（${identity.errorCode ?? ''}）` : '读取身份…'}
              {reach?.status === 'loaded' && reach.reach ? ` · 可达项 ${reach.reach.items.length}` : ''}
            </div>
          </div>
          <span className="ml-auto rounded-full px-2 py-0.5 text-[10px]" style={{ background: lcosTokens.color.raised.light, color: lcosTokens.color.muted.light }}>
            {identity?.identity?.conversationArtifactId ? '已链接导入会话' : '仅承接关系'}
          </span>
        </div>
      </section>

      {/* Run 段（attention）：真实 runs；waiting_input 的 Run 展示待回答 */}
      <section className="flex flex-col gap-2">
        <h4 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide" style={{ color: lcosTokens.color.muted.light }}>
          <Radio className="h-3.5 w-3.5" aria-hidden /> Run
        </h4>
        {state === undefined || (state.runs.length === 0 && identity?.status !== 'loaded') ? (
          <LcosSurfaceFeedback presentation="loading" message="读取该会话的 Run…" />
        ) : state.runs.length === 0 ? (
          <div className="rounded-xl px-3 py-2 text-xs" style={{ background: lcosTokens.color.surface.light, border: `1px solid ${lcosTokens.color.borderSubtle.light}`, color: lcosTokens.color.muted.light }}>
            该会话暂无关联 Run
          </div>
        ) : (
          state.runs.map((run) => (
            <div key={run.runId} className="flex flex-col gap-2">
              <div className="flex items-center gap-2 rounded-xl px-3 py-2" style={{ background: lcosTokens.color.surface.light, border: `1px solid ${lcosTokens.color.borderSubtle.light}` }}>
                <CircleDot className="h-3.5 w-3.5" style={{ color: run.status === 'waiting_input' ? lcosTokens.color.pinAmber : lcosTokens.color.muted.light }} aria-hidden />
                <span className="min-w-0 flex-1 truncate text-sm" style={{ color: lcosTokens.color.text.light }}>
                  {run.instruction || '(无指令)'}
                </span>
                <span className="shrink-0 rounded-full px-2 py-0.5 text-[10px]" style={{ background: lcosTokens.color.raised.light, color: lcosTokens.color.muted.light }}>
                  {run.status}
                </span>
              </div>
              {/* waiting_input → 原 Run 的待回答问题 */}
              {run.status === 'waiting_input' && (
                <WaitingInputSection runs={runs} runId={run.runId} runStatus={run.status} />
              )}
            </div>
          ))
        )}
      </section>

      {/* 复核段（Review / Artifact Return）：Run 产出的 Draft → 采纳/拒绝/重试 */}
      <section className="flex flex-col gap-2">
        <h4 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide" style={{ color: lcosTokens.color.muted.light }}>
          <Radio className="h-3.5 w-3.5" aria-hidden /> 复核
        </h4>
        <ArtifactReturnSection
          runs={runs}
          projectId={projectId}
          runIds={(state?.runs ?? []).map((run) => run.runId)}
        />
      </section>

      {/* 续工段（continuation / recovery） */}
      <section className="flex flex-col gap-2">
        <h4 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide" style={{ color: lcosTokens.color.muted.light }}>
          <Radio className="h-3.5 w-3.5" aria-hidden /> 续工 / 恢复
        </h4>
        <RecoverySection
          client={continuations}
          projectId={projectId}
          operations={operations}
          onRefreshed={(fresh) =>
            setLocalOperations((prev) => {
              const base = prev ?? state?.operations ?? [];
              return base.map((op) => (op.operationId === fresh.operationId ? fresh : op));
            })
          }
        />
      </section>
    </div>
  );
}