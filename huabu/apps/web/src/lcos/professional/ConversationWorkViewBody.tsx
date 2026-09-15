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
import { LcosComposerHost } from '../composer/LcosComposerHost';
import { useLcosShellStore } from '../shell/lcosShellStore';
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
  const composerOpen = useLcosShellStore((s) => s.composerOpen);
  const composerTarget = useLcosShellStore((s) => s.composerTarget);
  const activeWorkspaceId = useLcosShellStore((s) => s.activeWorkspaceId);
  const openComposer = useLcosShellStore((s) => s.openComposer);
  const closeComposer = useLcosShellStore((s) => s.closeComposer);

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
  const receiverReady =
    identity?.status === 'loaded' &&
    identity.identity?.connectedConversation.id === connectedConversationId;
  const receiverBlockedReason = receiverReady
    ? undefined
    : identity?.status === 'error'
      ? '接收者身份读取失败，暂不可发送'
      : '正在确认该会话的真实接收者，确认前暂不可发送';
  const workComposerOpen =
    composerOpen && composerTarget?.receiverConversationId === connectedConversationId;

  return (
    <div data-lcos-conversation-work-view className="flex flex-col gap-4 p-4">
      {/* identity / reach（真实 Core 投影；partial 也如实显示） */}
      <section className="flex flex-col gap-2 rounded-xl p-3" style={{ background: lcosTokens.color.surface, border: `1px solid ${lcosTokens.color.borderSubtle}` }}>
        <div className="flex items-center gap-2">
          <span
            aria-hidden
            className="flex h-7 w-7 items-center justify-center rounded-full text-[11px] font-bold"
            style={{ background: lcosTokens.color.inverse, color: lcosTokens.color.textOnInverse }}
          >
            <User className="h-3.5 w-3.5" />
          </span>
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold" style={{ color: lcosTokens.color.text }}>
              {connectedConversationId}
            </div>
            <div className="text-[10px]" style={{ color: lcosTokens.color.muted }}>
              {identity?.status === 'loaded' ? '身份链已读' : identity?.status === 'error' ? `身份读取失败（${identity.errorCode ?? ''}）` : '读取身份…'}
              {reach?.status === 'loaded' && reach.reach ? ` · 可达项 ${reach.reach.items.length}` : ''}
            </div>
          </div>
          <span className="ml-auto rounded-full px-2 py-0.5 text-[10px]" style={{ background: lcosTokens.color.raised, color: lcosTokens.color.muted }}>
            {identity?.identity?.conversationArtifactId ? '已链接导入会话' : '仅承接关系'}
          </span>
        </div>
      </section>

      {/* Run 段（attention）：真实 runs；waiting_input 的 Run 展示待回答 */}
      <section className="flex flex-col gap-2">
        <h4 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide" style={{ color: lcosTokens.color.muted }}>
          <Radio className="h-3.5 w-3.5" aria-hidden /> Run
        </h4>
        {state === undefined || (state.runs.length === 0 && identity?.status !== 'loaded') ? (
          <LcosSurfaceFeedback presentation="loading" message="读取该会话的 Run…" />
        ) : state.runs.length === 0 ? (
          <div className="rounded-xl px-3 py-2 text-xs" style={{ background: lcosTokens.color.surface, border: `1px solid ${lcosTokens.color.borderSubtle}`, color: lcosTokens.color.muted }}>
            该会话暂无关联 Run
          </div>
        ) : (
          state.runs.map((run) => (
            <div key={run.runId} className="flex flex-col gap-2">
              <div className="flex items-center gap-2 rounded-xl px-3 py-2" style={{ background: lcosTokens.color.surface, border: `1px solid ${lcosTokens.color.borderSubtle}` }}>
                <CircleDot className="h-3.5 w-3.5" style={{ color: run.status === 'waiting_input' ? lcosTokens.color.pinAmber : lcosTokens.color.muted }} aria-hidden />
                <span className="min-w-0 flex-1 truncate text-sm" style={{ color: lcosTokens.color.text }}>
                  {run.instruction || '(无指令)'}
                </span>
                <span className="shrink-0 rounded-full px-2 py-0.5 text-[10px]" style={{ background: lcosTokens.color.raised, color: lcosTokens.color.muted }}>
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

      <section
        data-lcos-conversation-composer
        className="flex flex-col gap-2 rounded-xl p-3"
        style={{ background: lcosTokens.color.surface, border: `1px solid ${lcosTokens.color.borderSubtle}` }}
      >
        <div className="flex items-center justify-between gap-2">
          <div>
            <h4 className="text-xs font-semibold" style={{ color: lcosTokens.color.text }}>继续这个会话</h4>
            <p className="mt-1 text-[10px]" style={{ color: lcosTokens.color.muted }}>
              使用同一个 Composer 草稿、引用和提交入口
            </p>
          </div>
          {!workComposerOpen && (
            <button
              type="button"
              data-lcos-open-work-composer
              onClick={() =>
                openComposer({
                  nodeId: `conversation:${connectedConversationId}`,
                  title: identity?.identity?.connectedConversation.label ?? '当前会话',
                  anchor: { x: 0, y: 0, width: 0, height: 0 },
                  ...(activeWorkspaceId === null ? {} : { workspaceId: activeWorkspaceId }),
                  ...(receiverReady ? { receiverConversationId: connectedConversationId } : {}),
                  ...(receiverBlockedReason === undefined ? {} : { receiverBlockedReason }),
                })
              }
              className="rounded-full px-3 py-1.5 text-xs"
              style={{ background: lcosTokens.color.inverse, color: lcosTokens.color.textOnInverse }}
            >
              写入 Composer
            </button>
          )}
        </div>
        {workComposerOpen && composerTarget && (
          <LcosComposerHost
            projectId={projectId}
            {...(activeWorkspaceId === null ? {} : { workspaceId: activeWorkspaceId })}
            anchor={composerTarget.anchor}
            open
            inline
            onClose={closeComposer}
          />
        )}
        {!workComposerOpen && receiverBlockedReason && (
          <div data-lcos-work-composer-blocked className="text-[10px]" style={{ color: lcosTokens.color.danger }}>
            {receiverBlockedReason}
          </div>
        )}
      </section>

      {/* 复核段（Review / Artifact Return）：Run 产出的 Draft → 采纳/拒绝/重试 */}
      <section className="flex flex-col gap-2">
        <h4 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide" style={{ color: lcosTokens.color.muted }}>
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
        <h4 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide" style={{ color: lcosTokens.color.muted }}>
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
