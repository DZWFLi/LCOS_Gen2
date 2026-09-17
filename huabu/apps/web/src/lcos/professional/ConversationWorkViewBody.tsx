// ConversationWorkViewBody — Conversation Work View（Gate 4 conversation-first 重构）。
//
// 信息架构（收敛方案 V1 §13）：
//   Header（projection 身份 + 6 用户态 + capability 动作）
//   → Timeline / Work Events（真实投影，不伪造消息）
//   → inline WaitingInput / Review（needs_user 时才出现，动作走 command seam）
//   → Composer（canonical target = 当前 Conversation，不二次选 Session）
//   → Context View（relation 只读预览）
//   → Diagnostics（collapsed：T6 Recovery / identity / reach 工程细节）
//
// 状态唯一来源：Collaboration read projection（readSession/readTimeline + SSE invalidation）。
// 不常驻 provider / operation / revision / journal 工程字段（全部下沉 Diagnostics）。

import { CoreCollaborationClient } from '@local-creative-os/web-gen2';
import { ConversationWorkViewController } from '@local-creative-os/web-gen2';
import { CheckCheck, ChevronDown, ChevronRight, CircleHelp, Info, Loader, Play, User, XCircle } from 'lucide-react';
import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';

import { ArtifactReturnSection } from './ArtifactReturnSection';
import { RecoverySection } from './RecoverySection';
import { WaitingInputSection } from './WaitingInputSection';
import { createLcosCoreSession } from '../app/lcosCoreClient';
import { useCollaborationSession } from '../collaboration/useCollaborationSession';
import { LcosComposerHost } from '../composer/LcosComposerHost';
import { useLcosShellStore } from '../shell/lcosShellStore';
import { LcosSurfaceFeedback } from '../ui/LcosSurfaceFeedback';
import { lcosTokens } from '../ui/lcosTokens';

import type { ContinuationRecoveryProjectionV1 } from '@local-creative-os/contracts';
import type { CollaborationTimelineItemV1, CollaborationUserStateV1 } from '@local-creative-os/contracts';

export interface ConversationWorkViewBodyProps {
  readonly projectId: string;
  readonly connectedConversationId?: string;
}

const USER_STATE_LABEL: Readonly<Record<CollaborationUserStateV1, string>> = {
  ready: '可继续',
  thinking: '正在理解',
  working: '正在执行',
  needs_user: '等你回应',
  done: '本轮完成',
  unavailable: '暂时不可用',
};

const TIMELINE_KIND_META: Readonly<Record<CollaborationTimelineItemV1['kind'], { label: string; Icon: typeof Play }>> = {
  user_message: { label: '你', Icon: User },
  agent_message: { label: '协作者', Icon: User },
  work_started: { label: '开始执行', Icon: Play },
  progress: { label: '进行中', Icon: Loader },
  input_required: { label: '等你回答', Icon: CircleHelp },
  approval_required: { label: '需要审批', Icon: CircleHelp },
  result_returned: { label: '产出待复核', Icon: Info },
  result_adopted: { label: '产出已采纳', Icon: CheckCheck },
  error: { label: '执行失败', Icon: XCircle },
  recovered: { label: '已恢复', Icon: CheckCheck },
  system_note: { label: '系统提示', Icon: Info },
};

export function ConversationWorkViewBody({
  projectId,
  connectedConversationId,
}: ConversationWorkViewBodyProps): React.JSX.Element {
  const session = useMemo(() => createLcosCoreSession(), []);
  const collaboration = useMemo(() => new CoreCollaborationClient(session.http), [session]);
  const controller = useMemo(
    () => new ConversationWorkViewController(collaboration.conversations),
    [collaboration],
  );
  const [localOperations, setLocalOperations] = useState<readonly ContinuationRecoveryProjectionV1[] | null>(null);
  const [diagnosticsOpen, setDiagnosticsOpen] = useState(false);
  const composerOpen = useLcosShellStore((s) => s.composerOpen);
  const composerTarget = useLcosShellStore((s) => s.composerTarget);
  const activeWorkspaceId = useLcosShellStore((s) => s.activeWorkspaceId);
  const openComposer = useLcosShellStore((s) => s.openComposer);
  const closeComposer = useLcosShellStore((s) => s.closeComposer);

  // Gate 4：产品状态唯一来源 = Collaboration projection（SSE 驱动刷新）。
  const entry = useCollaborationSession(projectId, connectedConversationId ?? null);
  const projection = entry?.status === 'ready' ? entry.projection : undefined;
  const timeline = entry?.status === 'ready' ? entry.timeline ?? [] : [];

  // 工程细节（Diagnostics）保留既有 controller 聚合。
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
        <LcosSurfaceFeedback presentation="empty" message="该 Glyth 尚未绑定 Core 会话（无 binding 不打开会话窗口）" />
      </div>
    );
  }

  const identity = state?.sections.identity;
  const operations = localOperations ?? state?.operations ?? [];
  const runIds = (state?.runs ?? []).map((run) => run.runId);
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

  const userState = projection?.userState;
  const pendingInputId = projection?.activity.pendingInputId;
  const activeRunId = projection?.activity.activeRunId;
  const hasPendingReview = projection?.recentReturns.some((row) => row.status === 'pending_review') ?? false;

  return (
    <div data-lcos-conversation-work-view className="flex flex-col gap-4 p-4">
      {/* Header：projection 身份 + 用户态 + capability 驱动动作 */}
      <section
        data-lcos-conversation-header
        className="flex flex-col gap-2 rounded-xl p-3"
        style={{ background: lcosTokens.color.surface, border: `1px solid ${lcosTokens.color.borderSubtle}` }}
      >
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
              {projection?.identity.title ?? connectedConversationId}
            </div>
            {projection?.identity.subtitle !== undefined && (
              <div className="truncate text-[10px]" style={{ color: lcosTokens.color.muted }}>
                {projection.identity.subtitle}
              </div>
            )}
          </div>
          <span
            data-lcos-conversation-user-state
            className="ml-auto rounded-full px-2 py-0.5 text-[10px]"
            style={{ background: lcosTokens.color.raised, color: lcosTokens.color.text }}
          >
            {userState === undefined ? '状态读取中…' : USER_STATE_LABEL[userState]}
          </span>
        </div>
        {projection?.recovery !== undefined && projection.recovery.state !== 'none' && (
          <div className="text-[11px]" style={{ color: lcosTokens.color.pinAmber }}>
            {projection.recovery.userMessage ?? '需要恢复'}
          </div>
        )}
        {projection !== undefined && projection.capabilities.canSend === false && (
          <div className="text-[10px]" style={{ color: lcosTokens.color.muted }}>
            {projection.capabilityReasons?.canSend ?? '「发送」暂不可用'}
          </div>
        )}
      </section>

      {/* Timeline / Work Events */}
      <section className="flex flex-col gap-2" data-lcos-conversation-timeline>
        {entry === undefined || entry.status === 'loading' ? (
          <LcosSurfaceFeedback presentation="loading" message="读取会话进展…" />
        ) : timeline.length === 0 ? (
          <div className="rounded-xl px-3 py-2 text-xs" style={{ background: lcosTokens.color.surface, border: `1px solid ${lcosTokens.color.borderSubtle}`, color: lcosTokens.color.muted }}>
            还没有工作记录——从下方 Composer 开始
          </div>
        ) : (
          timeline.map((item) => {
            const meta = TIMELINE_KIND_META[item.kind];
            return (
              <div
                key={item.itemId}
                data-lcos-timeline-item={item.kind}
                className="flex items-center gap-2 rounded-xl px-3 py-2"
                style={{ background: lcosTokens.color.surface, border: `1px solid ${lcosTokens.color.borderSubtle}` }}
              >
                <meta.Icon
                  className="h-3.5 w-3.5 shrink-0"
                  style={{ color: item.kind === 'error' ? lcosTokens.color.danger : item.kind === 'input_required' ? lcosTokens.color.pinAmber : lcosTokens.color.muted }}
                  aria-hidden
                />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm" style={{ color: lcosTokens.color.text }}>{item.title}</div>
                  {item.body !== undefined && (
                    <div className="truncate text-[11px]" style={{ color: lcosTokens.color.muted }}>{item.body}</div>
                  )}
                </div>
                <span className="shrink-0 text-[10px]" style={{ color: lcosTokens.color.muted }}>{meta.label}</span>
              </div>
            );
          })
        )}
      </section>

      {/* inline WaitingInput：needs_user 时才出现（不再常驻） */}
      {pendingInputId !== undefined && activeRunId !== undefined && (
        <WaitingInputSection collaboration={collaboration} projectId={projectId} runId={activeRunId} runStatus="waiting_input" />
      )}

      {/* inline Review：有待复核产出时才出现 */}
      {hasPendingReview && runIds.length > 0 && (
        <ArtifactReturnSection collaboration={collaboration} projectId={projectId} runIds={runIds} />
      )}

      {/* Composer：target 直接绑定 canonical Conversation（不二次选 Session） */}
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
                  title: projection?.identity.title ?? '当前会话',
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

      {/* Context View：relation 只读预览 */}
      {projection !== undefined && projection.relation.targetRefs.length > 0 && (
        <section
          data-lcos-conversation-context
          className="flex flex-col gap-1.5 rounded-xl p-3"
          style={{ background: lcosTokens.color.surface, border: `1px solid ${lcosTokens.color.borderSubtle}` }}
        >
          <h4 className="text-xs font-semibold" style={{ color: lcosTokens.color.text }}>上下文引用</h4>
          <div className="flex flex-wrap gap-1.5">
            {projection.relation.targetRefs.map((ref) => (
              <span key={ref} className="rounded-full px-2 py-0.5 text-[11px]" style={{ background: lcosTokens.color.raised, color: lcosTokens.color.text }}>
                {ref}
              </span>
            ))}
          </div>
        </section>
      )}

      {/* Diagnostics：T6 Recovery / identity / reach 工程细节（collapsed 默认） */}
      <section
        className="flex flex-col gap-2 rounded-xl p-3"
        style={{ background: lcosTokens.color.surface, border: `1px solid ${lcosTokens.color.borderSubtle}` }}
      >
        <button
          type="button"
          data-lcos-diagnostics-toggle
          onClick={() => setDiagnosticsOpen((prev) => !prev)}
          className="flex items-center gap-1.5 text-left text-xs font-semibold"
          style={{ color: lcosTokens.color.muted }}
        >
          {diagnosticsOpen ? <ChevronDown className="h-3.5 w-3.5" aria-hidden /> : <ChevronRight className="h-3.5 w-3.5" aria-hidden />}
          诊断（工程细节）
        </button>
        {diagnosticsOpen && (
          <div data-lcos-diagnostics className="flex flex-col gap-2 pt-1">
            <div className="text-[10px]" style={{ color: lcosTokens.color.muted }}>
              {identity?.status === 'loaded' ? '身份链已读' : identity?.status === 'error' ? `身份读取失败（${identity.errorCode ?? ''}）` : '读取身份…'}
              {state?.sections.reach?.status === 'loaded' && state.sections.reach.reach ? ` · 可达项 ${state.sections.reach.reach.items.length}` : ''}
              {' · '}{identity?.identity?.conversationArtifactId ? '已链接导入会话' : '仅承接关系'}
            </div>
            <RecoverySection
              client={collaboration.continuations}
              projectId={projectId}
              operations={operations}
              onRefreshed={(fresh) =>
                setLocalOperations((prev) => {
                  const base = prev ?? state?.operations ?? [];
                  return base.map((op) => (op.operationId === fresh.operationId ? fresh : op));
                })
              }
            />
          </div>
        )}
      </section>
    </div>
  );
}