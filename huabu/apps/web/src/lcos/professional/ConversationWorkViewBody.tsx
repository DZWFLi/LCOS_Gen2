// ConversationWorkViewBody — Conversation Work View（Gate 4 conversation-first 结构）。
//
// 信息架构（收敛方案 V1 §13 + Batch B）：
//   Header（projection 身份 + 6 用户态 + capability）
//   → Timeline / Work Events（真实投影）
//   → inline WaitingInput / Review（needs_user 时才出现；B2 全部走产品 read）
//   → Composer（B3：Delegate 语义明确，send≠delegate；canSend=false 如实提示）
//   → Context View（relation 只读预览）
//   → Diagnostics（collapsed；identity/reach/operations 经 readDiagnostics seam，
//     不再由 controller / raw domain 各自拼）
//
// 状态唯一来源：Collaboration read projection（readSession/readTimeline + SSE invalidation）。
// B1：本组件不再访问 collaboration.conversations / .runs / .continuations。

import { CoreCollaborationClient } from '@local-creative-os/web-gen2';
import { Boxes, CheckCheck, ChevronDown, ChevronRight, CircleHelp, Info, Loader, Play, User, XCircle } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';

import { ArtifactReturnSection } from './ArtifactReturnSection';
import { RecoverySection } from './RecoverySection';
import { WaitingInputSection } from './WaitingInputSection';
import { createLcosCoreSession } from '../app/lcosCoreClient';
import { useCollaborationSession } from '../collaboration/useCollaborationSession';
import { LcosComposerHost } from '../composer/LcosComposerHost';
import { useLcosShellStore } from '../shell/lcosShellStore';
import { LcosSurfaceFeedback } from '../ui/LcosSurfaceFeedback';
import { lcosTokens } from '../ui/lcosTokens';

import type { CollaborationDiagnosticsV1, CollaborationTimelineItemV1, CollaborationUserStateV1 } from '@local-creative-os/contracts';

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
  const [diagnostics, setDiagnostics] = useState<CollaborationDiagnosticsV1 | undefined>(undefined);
  const [diagnosticsState, setDiagnosticsState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [diagnosticsOpen, setDiagnosticsOpen] = useState(false);
  const composerOpen = useLcosShellStore((s) => s.composerOpen);
  const composerTarget = useLcosShellStore((s) => s.composerTarget);
  const activeWorkspaceId = useLcosShellStore((s) => s.activeWorkspaceId);
  const openComposer = useLcosShellStore((s) => s.openComposer);
  const closeComposer = useLcosShellStore((s) => s.closeComposer);
  const openAssembly = useLcosShellStore((s) => s.openAssembly);

  // Gate 4：产品状态唯一来源 = Collaboration projection（SSE 驱动刷新）。
  const entry = useCollaborationSession(projectId, connectedConversationId ?? null);
  const projection = entry?.status === 'ready' ? entry.projection : undefined;
  const timeline = entry?.status === 'ready' ? entry.timeline ?? [] : [];

  // B2：工程细节（Diagnostics）只经 readDiagnostics seam 读取，不再由 controller 拼装。
  const loadDiagnostics = useCallback((): void => {
    if (!connectedConversationId) return;
    setDiagnosticsState('loading');
    void collaboration
      .readDiagnostics(projectId, connectedConversationId)
      .then((value) => {
        setDiagnostics(value);
        setDiagnosticsState('ready');
      })
      .catch(() => setDiagnosticsState('error'));
  }, [collaboration, projectId, connectedConversationId]);

  useEffect(() => {
    loadDiagnostics();
  }, [loadDiagnostics]);

  if (!connectedConversationId) {
    return (
      <div className="flex min-h-[220px] items-center justify-center p-6">
        <LcosSurfaceFeedback presentation="empty" message="该 Glyth 尚未绑定 Core 会话（无 binding 不打开会话窗口）" />
      </div>
    );
  }

  const workComposerOpen =
    composerOpen && composerTarget?.receiverConversationId === connectedConversationId;

  const userState = projection?.userState;
  const hasPendingInput = projection?.activity.pendingInputId !== undefined;
  const hasPendingReview = projection?.recentReturns.some((row) => row.status === 'pending_review') ?? false;
  // B3：send 与 delegate 心智必须分开。当前 send fail-closed（无真实 transport）→
  // 不提供「继续这个会话（追加消息）」；Composer 明确是「交给它做（委托新任务）」。
  const canSend = projection?.capabilities.canSend === true;
  const sendReason = projection?.capabilityReasons?.canSend;

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
          {/* R4 §7 target continuity：只把共享 Assembly 的 live targetRef 更新为当前会话，
              不创建 ConversationAssembly，也不新开第二窗口。 */}
          <button
            type="button"
            data-lcos-conversation-open-assembly
            aria-label="打开 Assembly"
            title="打开 Assembly（投放到当前会话）"
            onClick={() => openAssembly({ kind: 'conversation', id: connectedConversationId }, 'Assembly · 当前会话')}
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full"
            style={{ background: lcosTokens.color.raised, color: lcosTokens.color.text }}
          >
            <Boxes className="h-3.5 w-3.5" aria-hidden />
          </button>
        </div>
        {projection?.recovery !== undefined && projection.recovery.state !== 'none' && (
          <div className="text-[11px]" style={{ color: lcosTokens.color.pinAmber }}>
            {projection.recovery.userMessage ?? '需要恢复'}
          </div>
        )}
        {projection !== undefined && !canSend && (
          <div data-lcos-send-unavailable className="text-[10px]" style={{ color: lcosTokens.color.muted }}>
            {sendReason ?? '当前协作方式暂不支持直接追加消息'}
          </div>
        )}
      </section>

      {/* Timeline / Work Events */}
      <section className="flex flex-col gap-2" data-lcos-conversation-timeline>
        {entry === undefined || entry.status === 'loading' ? (
          <LcosSurfaceFeedback presentation="loading" message="读取会话进展…" />
        ) : timeline.length === 0 ? (
          <div className="rounded-xl px-3 py-2 text-xs" style={{ background: lcosTokens.color.surface, border: `1px solid ${lcosTokens.color.borderSubtle}`, color: lcosTokens.color.muted }}>
            还没有工作记录——委托一个新任务开始
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

      {/* inline WaitingInput：needs_user / pendingInput 存在时才出现 */}
      {hasPendingInput && (
        <WaitingInputSection collaboration={collaboration} projectId={projectId} conversationId={connectedConversationId} />
      )}

      {/* inline Review：有待复核产出时才出现 */}
      {hasPendingReview && (
        <ArtifactReturnSection collaboration={collaboration} projectId={projectId} conversationId={connectedConversationId} />
      )}

      {/* Composer（B3）：明确 Delegate 语义——「交给它做」创建 canonical Run，
          绝不伪装成原会话 continuation（send 未接通时 fail-closed）。 */}
      <section
        data-lcos-conversation-composer
        className="flex flex-col gap-2 rounded-xl p-3"
        style={{ background: lcosTokens.color.surface, border: `1px solid ${lcosTokens.color.borderSubtle}` }}
      >
        <div className="flex items-center justify-between gap-2">
          <div>
            <h4 className="text-xs font-semibold" style={{ color: lcosTokens.color.text }}>交给它做（委托新任务）</h4>
            <p className="mt-1 text-[10px]" style={{ color: lcosTokens.color.muted }}>
              以当前会话为上下文，创建 Run 交给执行器；与「直接追加消息」不同
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
                  receiverConversationId: connectedConversationId,
                })
              }
              className="rounded-full px-3 py-1.5 text-xs"
              style={{ background: lcosTokens.color.inverse, color: lcosTokens.color.textOnInverse }}
            >
              委托新任务
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

      {/* Diagnostics：工程细节经 readDiagnostics seam（collapsed 默认） */}
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
            {diagnosticsState === 'loading' && (
              <span className="text-[10px]" style={{ color: lcosTokens.color.muted }}>读取工程状态…</span>
            )}
            {diagnosticsState === 'error' && (
              <div className="flex items-center gap-2">
                <span className="text-[10px]" style={{ color: lcosTokens.color.danger }}>工程状态读取失败</span>
                <button type="button" onClick={loadDiagnostics} className="rounded-full px-2 py-1 text-[11px]" style={{ background: lcosTokens.color.raised, color: lcosTokens.color.text }}>
                  重试
                </button>
              </div>
            )}
            {diagnosticsState === 'ready' && diagnostics !== undefined && (
              <>
                <div className="text-[10px]" style={{ color: lcosTokens.color.muted }}>
                  会话已连接
                  {diagnostics.identity !== undefined ? ' · 身份链已读' : ''}
                  {diagnostics.reach !== undefined && 'connected' in (diagnostics.reach as object) ? ' · 可达已读' : ''}
                </div>
                <RecoverySection
                  collaboration={collaboration}
                  projectId={projectId}
                  operations={diagnostics.operations}
                  onRefreshed={() => loadDiagnostics()}
                />
              </>
            )}
          </div>
        )}
      </section>
    </div>
  );
}