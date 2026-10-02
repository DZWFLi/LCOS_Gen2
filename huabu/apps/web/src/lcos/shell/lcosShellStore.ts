import type { CoreEntityRefLike } from '../referenceBridge';
import { composerInputKey, type ComposerCaret } from '../composer/composerInputJourney';
import type { ContinuationUiRequest } from '../professional/conversationContinuationActions';
import { captureConversationSend, conversationSendKey, sameConversationSend, type ConversationSendAttempt } from '../composer/conversationSendAttempt';
import type { CollaborationSendInputV1 } from '@local-creative-os/contracts';
// lcosShellStore — LCOS 局部 UI intent（可丢失）。禁止放 Project/Run/Relation truth。
// 只放：activeSurface、open region、draft、focus/hover 等 ephemeral intent。

import { create } from 'zustand';

import type { CanvasViewport } from '@huabu/shared';
import type { AssemblyTargetRefV1 } from '@local-creative-os/contracts';
import type {
  ProfessionalRectV1,
  ProfessionalWindowEnvironmentV1,
} from '@local-creative-os/web-gen2';
import { activateRegionWindow, activeWindowIdForRegion, reorderRegionWindowBefore, createWindowRegion, mergeRegionGroups, moveRegionWindow, normalizeWindowRegion, removeRegionWindow, splitRegionGroup, windowIdsForRegion, type LcosReaderSplitDirection, type LcosWindowRegion, type LcosWindowRegionLayout } from './windowRegionTopology';
import { isFiniteProfessionalRect } from '../professional/professionalGestureGeometry';
import { readProfessionalWindowLayout, removeProfessionalWindowLayout, writeProfessionalWindowLayout } from '../professional/professionalWindowPersistence';

export type LcosSurfaceKey = 'main' | 'context' | 'workflow';

export const LCOS_SURFACES: readonly { key: LcosSurfaceKey; label: string }[] =
  [
    { key: 'main', label: 'Main' },
    { key: 'context', label: 'Context' },
    { key: 'workflow', label: 'Workflow' },
  ];

export const SURFACE_LABEL: Readonly<Record<LcosSurfaceKey, string>> = {
  main: 'Main',
  context: 'Context',
  workflow: 'Workflow',
};

export interface LcosLocateRequest {
  /** 请求唯一 id（pipeline 消费后 clear，避免重复 focus）。 */
  readonly reqId: string;
  /** 目标现场；与当前现场不同时先切现场再 pendingFocus。 */
  readonly surface: LcosSurfaceKey;
  /** 目标 canvasId（可选；resolve 用 workspace）。 */
  readonly canvasId?: string;
  /** 当前现场已存在该 nodeId → 直接 focus（无需换现场）。 */
  readonly nodeId?: string;
  /**
   * 同一次空间定位需要一起选择/取景的节点。`nodeId` 仍是到达提示的主目标；
   * 相机与 selection 只由当前 Huabu canvas consumer 执行，不在 Shell 保存第二份状态。
   */
  readonly nodeIds?: readonly string[];
  /** Navigation reveals a location without changing the user's selection. */
  readonly preserveSelection?: boolean;
  /** 未投影 → unavailable 展示原因（不假定位）。 */
  readonly status?: 'projected' | 'unprojected' | 'unavailable';
}

/** Known canonical entity handed to the existing Focus/Where occurrence resolver. */
export interface LcosFocusWhereRequest {
  readonly reqId: string;
  readonly entityType: string;
  readonly entityId: string;
  readonly title?: string;
}

/**
 * Same-tab return context for a Context/Workflow child worksite.
 * This is UI navigation state only; the workspace and canvas remain owned by Core/Huabu.
 */
export interface LcosChildReturn {
  readonly projectId: string;
  readonly sourceSurface: LcosSurfaceKey;
  readonly sourceWorkspaceId?: string;
  readonly sourceWasChild: boolean;
  readonly sourceCanvasId?: string;
  /** Snapshot of the Huabu viewport at entry; restored through the same canvas store on return. */
  readonly sourceViewport?: CanvasViewport;
  /** The visible approach pose reached before entry; used only as the first return frame. */
  readonly sourceApproachViewport?: CanvasViewport;
  readonly selectedNodeIds: readonly string[];
  /** Canonical entity refs for the selected nodes; node ids alone are not enough after reconcile. */
  readonly sourceEntityRefs?: readonly {
    readonly nodeId: string;
    readonly entityType: string;
    readonly entityId: string;
  }[];
}

export interface LcosWorksiteCameraTransition {
  readonly id: string;
  readonly canvasId: string;
  readonly kind: 'enter-settle' | 'return-restore';
  /** First rendered pose for the destination Canvas mount. */
  readonly startViewport?: CanvasViewport;
  /** Exact settle pose owned by the destination Huabu viewport. */
  readonly targetViewport?: CanvasViewport;
}

export type LcosCameraCommandKind = 'zoom-in' | 'zoom-out' | 'fit' | 'reset';

/** Selection-local Composer intent. It is ephemeral UI state, never Run truth. */
export interface LcosComposerTarget {
  readonly targetNodeIds?: readonly string[];
  readonly targetReferences?: readonly CoreEntityRefLike[];
  readonly nodeId: string;
  /** User-facing target identity captured from the selected node. */
  readonly title: string;
  readonly anchor: {
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
  };
  readonly workspaceId?: string;
  /**
   * Composer intent is explicit: delegate creates a canonical Run;
   * continue sends into the existing connected conversation.
   */
  readonly intent?: 'delegate' | 'continue';
  /** Canonical connected-conversation receiver, only set after an explicit Core identity read. */
  readonly receiverConversationId?: string;
  /** Caller-owned continuation journal identity for `intent: continue`. */
  readonly continuationOperationId?: string;
  /** Caller-owned message identity for idempotent live send. */
  readonly messageId?: string;
  /** Optional honest block reason for a host that cannot resolve a receiver yet. */
  readonly receiverBlockedReason?: string;
}

/** Professional body 键（body registry）。 */
export type LcosProfessionalBodyKey =
  | 'run-review'
  | 'assembly'
  | 'reader'
  | 'conversation'
  | 'portal-preview'
  | 'runtime-doctor'
  | 'capture-inbox'
  | 'connector-source'
  | 'archive';

export interface LcosWindow {
  readonly id: string;
  readonly bodyKey: LcosProfessionalBodyKey;
  readonly title: string;
  /** body 上下文（如 artifactId / projectId）。 */
  readonly target?: string;
  /** Explicit address kind; an entity id must never be fetched as a canvas id. */
  readonly targetKind?: 'canvas';
  readonly portalWorkspaceId?: string;
  readonly portalSourceNodeId?: string;
  /** Assembly caller 注入的 canonical target；Assembly 本身不保存 target truth。 */
  readonly assemblyTargetRef?: AssemblyTargetRefV1;
  /** Shell-opened Assembly follows the current worksite; explicit object targets remain fixed. */
  readonly assemblyFollowsWorksite?: boolean;
  /** Reader 的 canonical revision target；缺失表示由 Reader 恢复最后一次 UI 阅读目标。 */
  readonly readerRevisionId?: string;
  /** 打开 Reader 的真实节点来源；只用于关闭/返回时定位，不复制 Canvas geometry。 */
  readonly readerSource?: LcosReaderSourceV1;
  /** Same-page material/read detour; deliberately excluded from saved window layouts. */
  readonly composerOriginKey?: string | undefined;
  readonly active: boolean;
}

export interface LcosReaderSourceV1 {
  readonly surface: LcosSurfaceKey;
  readonly nodeId: string;
}

export interface LcosReaderOpenOptionsV1 {
  readonly composerOriginKey?: string | undefined;
  readonly revisionId?: string;
  readonly source?: LcosReaderSourceV1;
}

export interface LcosReaderPositionV1 {
  readonly scrollTop: number;
  readonly zoom: number;
}

/**
 * Window topology intent is separate from the window instances themselves.
 * A region owns grouping/layout; an instance owns body identity and target.
 * Geometry is published by ProfessionalWindowStage, never inferred here.
 */
export type { LcosWindowRegion, LcosWindowRegionLayout } from './windowRegionTopology';

export interface LcosShellUiState {
  projectId: string | null;
  activeSurface: LcosSurfaceKey;
  /** 当前 Surface 对应的真实 Core workspace；只读镜像，用于 Run/Assembly target。 */
  activeWorkspaceId: string | null;
  /** 现场 → stable canvasId（只读镜像；真实性来自 Core workspaces）。 */
  surfaceCanvasId: Readonly<Partial<Record<LcosSurfaceKey, string>>>;
  /** 画布内待执行命令（route-level 组件发布，canvas-local overlay 消费）。 */
  cameraRequest: { id: number; kind: LcosCameraCommandKind } | null;
  locateRequest: LcosLocateRequest | null;
  focusWhereRequest: LcosFocusWhereRequest | null;
  composerOpen: boolean;
  composerTarget: LcosComposerTarget | null;
  composerPrompt: string;
  composerCaret: ComposerCaret | null;
  composerFocusVersion: number;
  rememberComposerCaret(caret: ComposerCaret): void;
  resumeComposer(originKey: string): boolean;
  /** Same-tab, unacknowledged requests only. Core journal remains the durable send authority. */
  continuationRequests: ReadonlyMap<string, ContinuationUiRequest>;
  setContinuationRequest(key: string, request: ContinuationUiRequest | undefined): void;
  conversationSendAttempts: ReadonlyMap<string, ConversationSendAttempt>;
  beginConversationSend(projectId: string, input: CollaborationSendInputV1): ConversationSendAttempt | undefined;
  settleConversationSend(attempt: ConversationSendAttempt, accepted: boolean): void;
  /** route-level Professional 窗口（只放窗口拓扑 intent；body 数据仍在 Core）。 */
  windows: readonly LcosWindow[];
  /** Window instances → regions 的拓扑关系；不会把所有 instance 自动变成一个 tab 组。 */
  windowRegions: readonly LcosWindowRegion[];
  /** Reader UI-only 会话状态；key = JSON([project, artifact, revision])。 */
  readerPositions: Readonly<Record<string, LcosReaderPositionV1>>;
  /** Reader 最近目标 revision；key = JSON([project, artifact])。 */
  readerLastRevisions: Readonly<Record<string, string>>;
  /** 由 ProfessionalWindowStage 唯一发布的临时占位环境。 */
  windowEnvironment: ProfessionalWindowEnvironmentV1 | null;
  /** Child worksite 的来源现场；刷新后允许丢失，返回按钮仍有安全 fallback。 */
  childReturn: LcosChildReturn | null;
  /** One-shot camera intent consumed by the matching Huabu Canvas mount. */
  worksiteCameraTransition: LcosWorksiteCameraTransition | null;
  setProject(projectId: string): void;
  setActiveSurface(surface: LcosSurfaceKey): void;
  setActiveWorkspaceId(workspaceId: string | null): void;
  setSurfaceCanvasId(surface: LcosSurfaceKey, canvasId: string): void;
  setSurfaceCanvasMap(
    map: Readonly<Partial<Record<LcosSurfaceKey, string>>>,
  ): void;
  beginChildNavigation(returnContext: LcosChildReturn): void;
  clearChildNavigation(): void;
  requestWorksiteCameraTransition(
    transition: Omit<LcosWorksiteCameraTransition, 'id'>,
  ): string;
  updateWorksiteCameraTransition(
    id: string,
    patch: Pick<LcosWorksiteCameraTransition, 'startViewport' | 'targetViewport'>,
  ): void;
  consumeWorksiteCameraTransition(id: string): void;
  requestCamera(kind: LcosCameraCommandKind): void;
  requestLocate(request: LcosLocateRequest): void;
  requestFocusWhere(request: LcosFocusWhereRequest): void;
  consumeCamera(): void;
  consumeLocate(): void;
  consumeFocusWhere(): void;
  openComposer(target: LcosComposerTarget): void;
  prepareComposerContinuation(projectId: string, expected: LcosComposerTarget, operationId: string): void;
  closeComposer(): void;
  setComposerPrompt(prompt: string): void;
  clearSubmittedComposerPrompt(projectId: string, target: LcosComposerTarget, prompt: string): void;
  openWindow(
    bodyKey: LcosProfessionalBodyKey,
    title: string,
    target?: string,
    targetKind?: 'canvas',
    portal?: {readonly workspaceId?: string; readonly sourceNodeId?: string},
  ): void;
  openReader(title: string, artifactId: string, options?: LcosReaderOpenOptionsV1): void;
  rememberReaderPosition(key: string, value: LcosReaderPositionV1): void;
  rememberReaderRevision(key: string, revisionId: string): void;
  clearReaderContinuity(): void;
  openAssembly(targetRef: AssemblyTargetRefV1, title?: string, followWorksite?: boolean, composerOriginKey?: string): void;
  retargetWorksiteAssembly(targetRef: AssemblyTargetRefV1, title: string): void;
  closeWindow(id: string): void;
  activateWindow(id: string): void;
  setWindowRegionLayout(regionId: string, layout: LcosWindowRegionLayout): void;
  dockWindowRegionRight(regionId: string, width: number): void;
  floatWindowRegionAt(regionId: string, rect: ProfessionalRectV1): void;
  /** R2-B：提交一次 move/resize 后的 region 几何（唯一几何真相仍是 windowRegions）。 */
  setWindowRegionRect(regionId: string, rect: ProfessionalRectV1): void;
  /** R2-B：提交 docked-right 的宽度（左缘 resize）。 */
  setWindowRegionDockWidth(regionId: string, dockWidth: number): void;
  setWindowRegionSplitRatio(regionId: string, ratio: number): void;
  splitWindowRegion(regionId: string, direction: LcosReaderSplitDirection): void;
  mergeWindowRegionGroups(regionId: string): void;
  /**
   * R2-B 显式分组：把 sourceRegion 的**全部**窗口并进 targetRegion 成为 tab，
   * sourceRegion 消失。绝不自动把多个 instance 合成一个 tab 组 —— 只有本动作会。
   */
  groupWindowRegions(sourceRegionId: string, targetRegionId: string): void;
  /** Drag a whole existing region into the tab group under the pointer. */
  groupWindowRegionInto(sourceRegionId: string, targetRegionId: string, targetGroupId: string): void;
  /** Drag a whole existing region onto a target pane edge to create a split. */
  splitWindowRegionInto(sourceRegionId: string, targetRegionId: string, targetGroupId: string, direction: LcosReaderSplitDirection, sourceFirst: boolean): void;
  /** Drag one tab into the tab group under the pointer. */
  moveWindowToGroup(windowId: string, targetRegionId: string, targetGroupId: string, beforeWindowId?: string | null): void;
  detachWindowGroupToRegion(regionId: string, groupId: string, rect: ProfessionalRectV1): void;
  /** Drag one tab onto a pane edge to split it out. */
  splitWindowToGroup(windowId: string, targetRegionId: string, targetGroupId: string, direction: LcosReaderSplitDirection, sourceFirst: boolean): void;
  /** Drag a tab out into a free floating region at the pointer position. */
  detachWindowToRegion(windowId: string, rect: ProfessionalRectV1): void;
  detachWindowToDockRight(windowId: string, width: number): void;
  /** R2-B 显式取消分组：把该 region 的活动窗口拆成独立 floating region。 */
  ungroupWindowRegion(regionId: string): void;
  publishWindowEnvironment(environment: ProfessionalWindowEnvironmentV1): void;
  clearWindowEnvironment(): void;
  clear(): void;
}

type ProjectUiSession = Pick<LcosShellUiState,
  'windows' | 'windowRegions' | 'composerPrompt' | 'composerTarget' | 'composerOpen' | 'activeSurface'>;

// Same-tab project switching only. This is UI continuity, not reload persistence.
const projectUiSessions = new Map<string, ProjectUiSession>();

/** Caller-owned identity for one live continuation message. */
function createComposerMessageId(): string {
  const randomUuid = globalThis.crypto?.randomUUID;
  return randomUuid !== undefined
    ? randomUuid.call(globalThis.crypto)
    : `message-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export const useLcosShellStore = create<LcosShellUiState>((set, get) => ({
  projectId: null,
  activeSurface: 'main',
  activeWorkspaceId: null,
  surfaceCanvasId: {},
  cameraRequest: null,
  locateRequest: null,
  focusWhereRequest: null,
  composerOpen: false,
  composerTarget: null,
  composerPrompt: '',
  composerCaret: null, composerFocusVersion: 0,
  conversationSendAttempts: new Map(),
  continuationRequests: new Map(),
  windows: [],
  windowRegions: [],
  readerPositions: {},
  readerLastRevisions: {},
  windowEnvironment: null,
  childReturn: null,
  worksiteCameraTransition: null,
  setProject: (projectId) => set((state) => {
    if (state.projectId === projectId) return state;
    if (state.projectId !== null) {
      projectUiSessions.set(state.projectId, {
        windows: state.windows,
        windowRegions: state.windowRegions,
        composerPrompt: state.composerPrompt,
        composerTarget: state.composerTarget,
        composerOpen: state.composerOpen,
        activeSurface: state.activeSurface,
      });
    }
    const sameTabRestored = projectUiSessions.get(projectId);
    const diskRestored = sameTabRestored === undefined ? readProfessionalWindowLayout(projectId) : undefined;
    if (diskRestored !== undefined) {
      // One-time flat-region migration: save only canonical groups after legacy read.
      writeProfessionalWindowLayout(projectId, diskRestored.windows, diskRestored.windowRegions.map(normalizeWindowRegion));
    }
    return {
      projectId,
      windows: sameTabRestored?.windows ?? diskRestored?.windows ?? [],
      windowRegions: sameTabRestored?.windowRegions.map(normalizeWindowRegion) ?? diskRestored?.windowRegions.map(normalizeWindowRegion) ?? [],
      windowEnvironment: null,
      composerPrompt: sameTabRestored?.composerPrompt ?? '',
      composerCaret: null,
      composerTarget: sameTabRestored?.composerTarget ?? null,
      composerOpen: sameTabRestored?.composerOpen ?? false,
      activeSurface: sameTabRestored?.activeSurface ?? 'main',
      childReturn: null,
      worksiteCameraTransition: null,
      activeWorkspaceId: null,
      surfaceCanvasId: {},
      cameraRequest: null,
      locateRequest: null,
      focusWhereRequest: null,
    };
  }),
  setActiveSurface: (activeSurface) => set({ activeSurface }),
  setActiveWorkspaceId: (activeWorkspaceId) => set({ activeWorkspaceId }),
  setSurfaceCanvasId: (surface, canvasId) =>
    set((s) => ({
      surfaceCanvasId: { ...s.surfaceCanvasId, [surface]: canvasId },
    })),
  setSurfaceCanvasMap: (map) => set({ surfaceCanvasId: map }),
  beginChildNavigation: (childReturn) => set({ childReturn }),
  clearChildNavigation: () => set({ childReturn: null }),
  requestWorksiteCameraTransition: (transition) => {
    const id = globalThis.crypto?.randomUUID?.()
      ?? `worksite-camera-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    set({ worksiteCameraTransition: { id, ...transition } });
    return id;
  },
  updateWorksiteCameraTransition: (id, patch) => set((state) =>
    state.worksiteCameraTransition?.id === id
      ? { worksiteCameraTransition: { ...state.worksiteCameraTransition, ...patch } }
      : state),
  consumeWorksiteCameraTransition: (id) => set((state) =>
    state.worksiteCameraTransition?.id === id
      ? { worksiteCameraTransition: null }
      : state),
  requestCamera: (kind) =>
    set((s) => ({
      cameraRequest: { id: (s.cameraRequest?.id ?? 0) + 1, kind },
    })),
  requestLocate: (request) => set({ locateRequest: request }),
  requestFocusWhere: (request) => set({ focusWhereRequest: request }),
  consumeCamera: () => set({ cameraRequest: null }),
  consumeLocate: () => set({ locateRequest: null }),
  consumeFocusWhere: () => set({ focusWhereRequest: null }),
  setContinuationRequest: (key, request) => set((state) => {
    const next = new Map(state.continuationRequests);
    if (request) next.set(key, request); else next.delete(key);
    return { continuationRequests: next };
  }),
  beginConversationSend: (projectId, input) => {
    const key = conversationSendKey(projectId, input.conversationId);
    const previous = get().conversationSendAttempts.get(key);
    if (previous?.phase === 'sending' || (previous && !sameConversationSend(previous.input, input))) return undefined;
    const attempt = captureConversationSend(projectId, input);
    set((state) => { const next = new Map(state.conversationSendAttempts); next.set(key, attempt); return { conversationSendAttempts: next }; });
    return attempt;
  },
  settleConversationSend: (attempt, accepted) => set((state) => {
    const key = conversationSendKey(attempt.projectId, attempt.input.conversationId);
    if (state.conversationSendAttempts.get(key) !== attempt) return state;
    const next = new Map(state.conversationSendAttempts);
    if (accepted) next.delete(key); else next.set(key, { ...attempt, phase: 'unconfirmed' });
    const matches = (target: LcosComposerTarget | null | undefined) => target?.intent === 'continue'
      && target.messageId === attempt.input.messageId && target.receiverConversationId === attempt.input.conversationId
      && target.continuationOperationId === attempt.input.continuationOperationId;
    if (accepted && state.projectId === attempt.projectId && matches(state.composerTarget)) {
      return { conversationSendAttempts: next, composerTarget: { ...state.composerTarget!, messageId: createComposerMessageId() } };
    }
    const saved = projectUiSessions.get(attempt.projectId);
    if (accepted && saved && matches(saved.composerTarget)) projectUiSessions.set(attempt.projectId,
      { ...saved, composerTarget: { ...saved.composerTarget!, messageId: createComposerMessageId() } });
    return { conversationSendAttempts: next };
  }),
  openComposer: (composerTarget) => set((state) => {
    const pending = composerTarget.intent === 'continue' && composerTarget.receiverConversationId && state.projectId
      ? state.conversationSendAttempts.get(conversationSendKey(state.projectId, composerTarget.receiverConversationId)) : undefined;
    const sameReceiver = composerTarget.intent === 'continue' && state.composerTarget?.intent === 'continue'
      && composerTarget.receiverConversationId === state.composerTarget.receiverConversationId;
    return { composerOpen: true, composerTarget: { ...composerTarget,
      ...(pending ? { continuationOperationId: pending.input.continuationOperationId, messageId: pending.input.messageId }
        : sameReceiver ? { continuationOperationId: state.composerTarget?.continuationOperationId,
          messageId: state.composerTarget?.messageId ?? composerTarget.messageId } : {}),
    } };
  }),
  prepareComposerContinuation: (projectId, expected, operationId) => set((state) => {
    if (state.projectId !== projectId || !state.composerOpen || state.composerTarget !== expected
      || expected.intent !== 'continue' || !expected.receiverConversationId) return state;
    // The caller just confirmed the live capability; retire the entry-time reason.
    const { receiverBlockedReason: _previousReason, ...prepared } = expected;
    return { composerTarget: {
      ...prepared, continuationOperationId: operationId,
      messageId: expected.messageId ?? createComposerMessageId(),
    } };
  }),
  rememberComposerCaret: (composerCaret) => set((s) => s.projectId === composerCaret.projectId
    && composerInputKey(s.composerTarget) === composerCaret.targetKey ? { composerCaret } : s),
  resumeComposer: (originKey) => {
    const current = get();
    if (composerInputKey(current.composerTarget) !== originKey) return false;
    const owner = current.windows.find((w) => w.bodyKey === 'assembly' && w.composerOriginKey === originKey)
      ?? current.windows.find((w) => w.bodyKey === 'conversation' && w.target === current.composerTarget?.receiverConversationId);
    if (owner) get().activateWindow(owner.id);
    set((s) => ({ composerOpen: true, composerFocusVersion: s.composerFocusVersion + 1 }));
    return true;
  },
  closeComposer: () => set({ composerOpen: false }),
  setComposerPrompt: (composerPrompt) => set({ composerPrompt }),
  clearSubmittedComposerPrompt: (projectId, target, prompt) => set((state) => {
    if (state.projectId === projectId) {
      const sameMessage = target.intent === 'continue' && target.messageId !== undefined
        && state.composerTarget?.intent === 'continue' && state.composerTarget.messageId === target.messageId
        && state.composerTarget.receiverConversationId === target.receiverConversationId
        && state.composerTarget.continuationOperationId === target.continuationOperationId;
      if ((!sameMessage && state.composerTarget !== target) || state.composerPrompt.trim() !== prompt.trim()) return state;
      return target.intent === 'continue'
        ? { composerPrompt: '', composerTarget: { ...(state.composerTarget ?? target), messageId: createComposerMessageId() } }
        : { composerPrompt: '' };
    }
    const saved = projectUiSessions.get(projectId);
    if (saved && saved.composerTarget === target && saved.composerPrompt === prompt) {
      projectUiSessions.set(projectId, target.intent === 'continue'
        ? { ...saved, composerPrompt: '', composerTarget: { ...target, messageId: createComposerMessageId() } }
        : { ...saved, composerPrompt: '' });
    }
    return state;
  }),
  openWindow: (bodyKey, title, target, targetKind, portal) =>
    set((s) => {
      const existing = s.windows.find(
        (w) =>
          w.bodyKey === bodyKey &&
          w.targetKind === targetKind &&
          w.target === target &&
          w.portalWorkspaceId === portal?.workspaceId,
      );
      if (existing) {
        return {
          windows: s.windows.map((w) => ({
            ...w,
            active: w.id === existing.id,
            ...(w.id === existing.id && portal?.sourceNodeId ? {portalSourceNodeId:portal.sourceNodeId} : {}),
          })),
          windowRegions: s.windowRegions.map((region) => activateRegionWindow(normalizeWindowRegion(region), existing.id)),
        };
      }
      const id = `${bodyKey}-${crypto.randomUUID()}`;
      return {
        windows: [
          ...s.windows.map((w) => ({ ...w, active: false })),
          { id, bodyKey, title, target, ...(targetKind ? { targetKind } : {}),
            ...(portal?.workspaceId ? {portalWorkspaceId:portal.workspaceId} : {}),
            ...(portal?.sourceNodeId ? {portalSourceNodeId:portal.sourceNodeId} : {}), active: true },
        ],
        windowRegions: [...s.windowRegions.map(normalizeWindowRegion), createWindowRegion(`region-${id}`, [id], id)],
      };
    }),
  openReader: (title, artifactId, options) =>
    set((state) => {
      const revisionId = options?.revisionId;
      const existing = state.windows.find((window) =>
        window.bodyKey === 'reader'
        && window.target === artifactId
        && window.readerRevisionId === revisionId);
      if (existing !== undefined) {
        return {
          windows: state.windows.map((window) => window.id === existing.id
            ? {
                ...window,
                title,
                ...(options?.source === undefined ? {} : { readerSource: options.source }),
                composerOriginKey: options?.composerOriginKey,
                active: true,
              }
            : { ...window, active: false }),
          windowRegions: state.windowRegions.map((region) => activateRegionWindow(normalizeWindowRegion(region), existing.id)),
        };
      }
      const id = `reader-${crypto.randomUUID()}`;
      return {
        windows: [
          ...state.windows.map((window) => ({ ...window, active: false })),
          {
            id,
            bodyKey: 'reader',
            title,
            target: artifactId,
            ...(revisionId === undefined ? {} : { readerRevisionId: revisionId }),
            ...(options?.source === undefined ? {} : { readerSource: options.source }),
                composerOriginKey: options?.composerOriginKey,
            active: true,
          },
        ],
        windowRegions: [...state.windowRegions.map(normalizeWindowRegion), createWindowRegion(`region-${id}`, [id], id)],
      };
    }),
  rememberReaderPosition: (key, value) => set((state) => ({
    readerPositions: { ...state.readerPositions, [key]: value },
  })),
  rememberReaderRevision: (key, revisionId) => set((state) => ({
    readerLastRevisions: { ...state.readerLastRevisions, [key]: revisionId },
  })),
  clearReaderContinuity: () => set({ readerPositions: {}, readerLastRevisions: {} }),
  retargetWorksiteAssembly: (assemblyTargetRef, title) => set((state) => ({
    windows: state.windows.map((window) => window.bodyKey === 'assembly' && window.assemblyFollowsWorksite
      ? { ...window, assemblyTargetRef, title } : window),
  })),
  openAssembly: (assemblyTargetRef, title = '装配', assemblyFollowsWorksite = false, composerOriginKey) =>
    set((s) => {
      // R4 / C1-3：一个 Project 只有一个共享 Assembly region。
      // target 不编码进 regionId —— 换 target 只 live 更新同一 instance 的
      // assemblyTargetRef/title 并激活它所在区域，绝不新建第二个 Assembly、也不重建 body。
      const shared = s.windows.find((window) => window.bodyKey === 'assembly');
      if (shared !== undefined) {
        const hostRegion = s.windowRegions.find((region) => windowIdsForRegion(region).includes(shared.id));
        return {
          windows: s.windows.map((window) =>
            window.id === shared.id
              ? { ...window, title, assemblyTargetRef, assemblyFollowsWorksite, composerOriginKey, active: true }
              : { ...window, active: false }),
          // 保留该 region 既有 geometry / dock / group topology，只把活动窗口指回 Assembly。
          windowRegions: s.windowRegions.map((input) => {
            const region = normalizeWindowRegion(input);
            return hostRegion !== undefined && region.id === hostRegion.id
              ? activateRegionWindow(region, shared.id)
              : region;
          }),
        };
      }
      const id = 'assembly';
      return {
        windows: [
          ...s.windows.map((window) => ({ ...window, active: false })),
          {
            id,
            bodyKey: 'assembly',
            title,
            assemblyTargetRef,
            assemblyFollowsWorksite,
            composerOriginKey,
            active: true,
          },
        ],
        windowRegions: [...s.windowRegions.map(normalizeWindowRegion), createWindowRegion(`region-${id}`, [id], id)],
      };
    }),
  closeWindow: (id) =>
    set((s) => {
      if (!s.windows.some((window) => window.id === id)) return s;
      const remaining = s.windows.filter((window) => window.id !== id);
      const regions = s.windowRegions.map(normalizeWindowRegion)
        .map((region) => removeRegionWindow(region, id))
        .filter((region): region is LcosWindowRegion => region !== undefined);
      const activeId = remaining.find((window) => window.active)?.id ?? remaining.at(-1)?.id;
      return {
        windows: remaining.map((window) => window.active === (window.id === activeId)
          ? window : { ...window, active: window.id === activeId }),
        // Closing a pane must activate the same fallback in the group and the
        // global window list. Otherwise Escape would close a hidden Reader.
        windowRegions: activeId === undefined ? regions : regions.map((region) => activateRegionWindow(region, activeId)),
      };
    }),
  activateWindow: (id) => set((s) => {
    if (!s.windows.some((window) => window.id === id)) return s;
    const windowRegions = s.windowRegions.map((region) => activateRegionWindow(normalizeWindowRegion(region), id));
    if (s.windows.find((window) => window.active)?.id === id && windowRegions.every((region, i) => region === s.windowRegions[i])) return s;
    return { windows: s.windows.map((window) => window.active === (window.id === id) ? window : { ...window, active: window.id === id }), windowRegions };
  }),
  setWindowRegionLayout: (regionId, layout) =>
    set((s) => ({
      windowRegions: s.windowRegions.map((region) =>
        region.id === regionId ? { ...region, layout } : region,
      ),
    })),
  // R2-B：几何 override 写回 windowRegions —— 拓扑与几何同一份真相，工程往返可恢复。
  setWindowRegionRect: (regionId, rect) =>
    set((s) => !isFiniteProfessionalRect(rect) ? s : ({
      windowRegions: s.windowRegions.map((region) =>
        region.id === regionId ? { ...region, rect: { ...rect } } : region,
      ),
    })),
  setWindowRegionDockWidth: (regionId, dockWidth) =>
    set((s) => !Number.isFinite(dockWidth) || dockWidth <= 0 ? s : ({
      windowRegions: s.windowRegions.map((region) =>
        region.id === regionId ? { ...region, dockWidth: Math.max(1, Math.round(dockWidth)) } : region,
      ),
    })),
  dockWindowRegionRight: (regionId, width) => set((s) => !Number.isFinite(width) || width <= 0 ? s : ({
    windowRegions: s.windowRegions.map((input) => {
      const region = normalizeWindowRegion(input);
      return region.id === regionId ? { ...region, layout: 'docked-right', dockWidth: Math.max(360, Math.round(width)) } : region;
    }),
  })),
  floatWindowRegionAt: (regionId, rect) => set((s) => !isFiniteProfessionalRect(rect) ? s : ({
    windowRegions: s.windowRegions.map((input) => {
      const region = normalizeWindowRegion(input);
      if (region.id !== regionId) return region;
      const { dockWidth: _dockWidth, ...floating } = region;
      return { ...floating, layout: 'floating', rect: { ...rect } };
    }),
  })),
  setWindowRegionSplitRatio: (regionId, ratio) => set((s) => !Number.isFinite(ratio) ? s : ({
    windowRegions: s.windowRegions.map((input) => {
      const region = normalizeWindowRegion(input);
      return region.id === regionId && region.groups.length > 1
        ? { ...region, splitRatio: Math.min(0.8, Math.max(0.2, ratio)) }
        : region;
    }),
  })),
  splitWindowRegion: (regionId, direction) => set((s) => ({
    windowRegions: s.windowRegions.map((input) => {
      const region = normalizeWindowRegion(input);
      if (region.id !== regionId) return region;
      const active = region.groups.find((group) => group.id === region.activeGroupId)?.activeWindowId ?? region.groups[0]?.activeWindowId;
      return active === undefined ? region : splitRegionGroup(region, active, direction);
    }),
  })),
  mergeWindowRegionGroups: (regionId) => set((s) => ({
    windowRegions: s.windowRegions.map((input) => {
      const region = normalizeWindowRegion(input);
      return region.id === regionId ? mergeRegionGroups(region) : region;
    }),
  })),
  // R2-B 显式分组：只有这个动作会把多个 region 合成一个 tab 组。
  groupWindowRegions: (sourceRegionId, targetRegionId) =>
    set((s) => {
      if (sourceRegionId === targetRegionId) return s;
      const source = s.windowRegions.find((region) => region.id === sourceRegionId);
      const target = s.windowRegions.find((region) => region.id === targetRegionId);
      if (source === undefined || target === undefined) return s;
      const merged = [...windowIdsForRegion(target)];
      for (const windowId of windowIdsForRegion(source)) {
        if (!merged.includes(windowId)) merged.push(windowId);
      }
      return {
        windowRegions: s.windowRegions
          .filter((region) => region.id !== sourceRegionId)
          .map((region) => {
            if (region.id !== targetRegionId) return region;
            const { splitDirection: _splitDirection, splitRatio: _splitRatio, ...withoutSplit } = region;
            const groupId = target.groups[0]?.id ?? `group-${merged[0]}`;
            return {
              ...withoutSplit,
              groups: [{ id: groupId, windowIds: merged, activeWindowId: source.groups.find((group) => group.id === source.activeGroupId)?.activeWindowId ?? source.groups[0]?.activeWindowId ?? merged.at(-1)! }],
              activeGroupId: groupId,
              // tab 顶栏接管呈现：dock 专用宽度不再适用，几何交回 Stage 派生。
              ...(region.dockWidth === undefined ? {} : { dockWidth: undefined }),
            };
          }),
      };
    }),
  groupWindowRegionInto: (sourceRegionId, targetRegionId, targetGroupId) => set((s) => {
    if (sourceRegionId === targetRegionId) return s;
    const regions = s.windowRegions.map(normalizeWindowRegion);
    const source = regions.find((region) => region.id === sourceRegionId);
    const target = regions.find((region) => region.id === targetRegionId);
    const targetGroup = target?.groups.find((group) => group.id === targetGroupId);
    const activeWindowId = source === undefined ? undefined : activeWindowIdForRegion(source);
    if (!source || !target || !targetGroup || !activeWindowId) return s;
    const sourceIds = windowIdsForRegion(source);
    return { windowRegions: regions.flatMap((region) => {
      if (region.id === source.id) return [];
      if (region.id !== target.id) return [region];
      return [{ ...region, activeGroupId: targetGroupId, groups: region.groups.map((group) => group.id === targetGroupId
        ? { ...group, windowIds: [...group.windowIds, ...sourceIds.filter((id) => !group.windowIds.includes(id))], activeWindowId }
        : group) }];
    }) };
  }),
  splitWindowRegionInto: (sourceRegionId, targetRegionId, targetGroupId, direction, sourceFirst) => set((s) => {
    if (sourceRegionId === targetRegionId) return s;
    const regions = s.windowRegions.map(normalizeWindowRegion);
    const source = regions.find((region) => region.id === sourceRegionId);
    const target = regions.find((region) => region.id === targetRegionId);
    const targetGroup = target?.groups.find((group) => group.id === targetGroupId);
    const sourceActive = source === undefined ? undefined : activeWindowIdForRegion(source);
    const sourceIds = source === undefined ? [] : windowIdsForRegion(source);
    if (!source || !target || !targetGroup || target.groups.length !== 1 || !sourceActive || sourceIds.length === 0) return s;
    let sourceGroupId = `group-${sourceActive}`;
    while (target.groups.some((group) => group.id === sourceGroupId)) sourceGroupId = `${sourceGroupId}-split`;
    const sourceGroup = { id: sourceGroupId, windowIds: sourceIds, activeWindowId: sourceActive };
    const groups = sourceFirst ? [sourceGroup, targetGroup] : [targetGroup, sourceGroup];
    return { windowRegions: regions.flatMap((region) => {
      if (region.id === source.id) return [];
      if (region.id !== target.id) return [region];
      return [{ ...region, groups, activeGroupId: sourceGroupId, splitDirection: direction, splitRatio: 0.5 }];
    }) };
  }),
  moveWindowToGroup: (windowId, targetRegionId, targetGroupId, beforeWindowId) => set((s) => {
    const regions = s.windowRegions.map(normalizeWindowRegion);
    const source = regions.find((region) => windowIdsForRegion(region).includes(windowId));
    const target = regions.find((region) => region.id === targetRegionId);
    const targetGroup = target?.groups.find((group) => group.id === targetGroupId);
    if (!source || !target || !targetGroup || beforeWindowId != null && !targetGroup.windowIds.includes(beforeWindowId)) return s;
    if (source.id === target.id) {
      const merged = moveRegionWindow(source, windowId, targetGroupId);
      const moved = beforeWindowId === undefined ? merged : reorderRegionWindowBefore(merged, windowId, beforeWindowId);
      return moved === source ? s : { windowRegions: regions.map((region) => region.id === source.id ? moved : region) };
    }
    const remaining = removeRegionWindow(source, windowId);
    return { windowRegions: regions.flatMap((region) => {
      if (region.id === source.id) return remaining === undefined ? [] : [remaining];
      if (region.id !== target.id) return [region];
      const merged = { ...region, activeGroupId: targetGroupId, groups: region.groups.map((group) => group.id === targetGroupId
        ? { ...group, windowIds: [...group.windowIds, windowId], activeWindowId: windowId }
        : group) };
      return [beforeWindowId === undefined ? merged : reorderRegionWindowBefore(merged, windowId, beforeWindowId)];
    }) };
  }),
  splitWindowToGroup: (windowId, targetRegionId, targetGroupId, direction, sourceFirst) => set((s) => {
    const regions = s.windowRegions.map(normalizeWindowRegion);
    const source = regions.find((region) => windowIdsForRegion(region).includes(windowId));
    const target = regions.find((region) => region.id === targetRegionId);
    const targetGroup = target?.groups.find((group) => group.id === targetGroupId);
    if (!source || !target || !targetGroup || target.groups.length !== 1) return s;
    const remaining = removeRegionWindow(source, windowId);
    const remainderTarget = source.id === target.id ? remaining : target;
    if (!remainderTarget || remainderTarget.groups.length !== 1) return s;
    const baseGroup = remainderTarget.groups.find((group) => group.id === targetGroupId);
    if (!baseGroup) return s;
    let sourceGroupId = `group-${windowId}`;
    while (remainderTarget.groups.some((group) => group.id === sourceGroupId)) sourceGroupId = `${sourceGroupId}-split`;
    const sourceGroup = { id: sourceGroupId, windowIds: [windowId], activeWindowId: windowId };
    const groups = sourceFirst ? [sourceGroup, baseGroup] : [baseGroup, sourceGroup];
    const nextTarget = { ...remainderTarget, groups, activeGroupId: sourceGroupId, splitDirection: direction, splitRatio: 0.5 };
    if (source.id === target.id) return { windowRegions: regions.map((region) => region.id === source.id ? nextTarget : region) };
    return { windowRegions: regions.flatMap((region) => {
      if (region.id === source.id) return remaining === undefined ? [] : [remaining];
      if (region.id === target.id) return [nextTarget];
      return [region];
    }) };
  }),
  detachWindowToRegion: (windowId, rect) => set((s) => {
    if (!isFiniteProfessionalRect(rect)) return s;
    const regions = s.windowRegions.map(normalizeWindowRegion);
    const source = regions.find((region) => windowIdsForRegion(region).includes(windowId));
    if (!source) return s;
    const remaining = removeRegionWindow(source, windowId);
    const nextRegions = regions.flatMap((region) => region.id === source.id ? remaining === undefined ? [] : [remaining] : [region]);
    let id = `region-${windowId}`;
    while (nextRegions.some((region) => region.id === id)) id = `${id}-float`;
    return { windowRegions: [...nextRegions, { ...createWindowRegion(id, [windowId], windowId), rect }] };
  }),
  detachWindowToDockRight: (windowId, width) => set((s) => {
    if (!Number.isFinite(width) || width <= 0) return s;
    const regions = s.windowRegions.map(normalizeWindowRegion);
    const source = regions.find((region) => windowIdsForRegion(region).includes(windowId));
    if (!source) return s;
    const remaining = removeRegionWindow(source, windowId);
    const nextRegions = regions.flatMap((region) => region.id === source.id ? remaining === undefined ? [] : [remaining] : [region]);
    let id = `region-${windowId}`;
    while (nextRegions.some((region) => region.id === id)) id = `${id}-dock`;
    const docked = { ...createWindowRegion(id, [windowId], windowId), layout: 'docked-right' as const, dockWidth: Math.max(360, Math.round(width)) };
    return { windowRegions: [...nextRegions, docked] };
  }),
  detachWindowGroupToRegion: (regionId, groupId, rect) => set((s) => {
    if (!isFiniteProfessionalRect(rect)) return s;
    const source = s.windowRegions.find((region) => region.id === regionId);
    const group = source?.groups.find((item) => item.id === groupId);
    if (!source || !group || source.groups.length < 2) return s;
    const remainingGroups = source.groups.filter((item) => item.id !== groupId);
    const remainingActive = remainingGroups.find((item) => item.id === source.activeGroupId) ?? remainingGroups[0]!;
    const { splitDirection: _direction, splitRatio: _ratio, ...rest } = source;
    let id = `region-${group.activeWindowId}`;
    while (s.windowRegions.some((region) => region.id === id)) id += '-group';
    return {
      windows: s.windows.map((window) => ({ ...window, active: window.id === group.activeWindowId })),
      windowRegions: [...s.windowRegions.map((region) => region.id === source.id
        ? { ...rest, groups: remainingGroups, activeGroupId: remainingActive.id } : region),
        { id, layout: 'floating', groups: [group], activeGroupId: group.id, rect: { ...rect } }],
    };
  }),
  // R2-B 显式取消分组：把活动窗口拆出去，剩余窗口留在原 region。
  ungroupWindowRegion: (regionId) =>
    set((s) => {
      const source = s.windowRegions.find((region) => region.id === regionId);
      if (source === undefined || windowIdsForRegion(source).length < 2) return s;
      const activeWindowId = source.groups.find((group) => group.id === source.activeGroupId)?.activeWindowId ?? source.groups[0]?.activeWindowId;
      if (activeWindowId === undefined) return s;
      const remaining = windowIdsForRegion(source).filter((windowId) => windowId !== activeWindowId);
      const remainingActiveWindowId = remaining[remaining.length - 1];
      if (remainingActiveWindowId === undefined) return s;
      const nextRegionId = `region-${activeWindowId}`;
      // 拆出原组宿主时，其 region 身份随该窗口走；剩余组继续使用自己的窗口身份。
      const remainingRegionId = source.id === nextRegionId
        ? `region-${remainingActiveWindowId}`
        : source.id;
      if (s.windowRegions.some((region) => region.id !== source.id
        && (region.id === nextRegionId || region.id === remainingRegionId))) return s;
      const index = s.windowRegions.findIndex((region) => region.id === regionId);
      const regions = s.windowRegions.map((region) =>
        region.id === regionId
          ? { ...createWindowRegion(remainingRegionId, remaining, remainingActiveWindowId), layout: region.layout, ...(region.rect === undefined ? {} : { rect: region.rect }), ...(region.dockWidth === undefined ? {} : { dockWidth: region.dockWidth }) }
          : region,
      );
      regions.splice(index + 1, 0, {
        ...createWindowRegion(nextRegionId, [activeWindowId], activeWindowId),
      });
      return { windowRegions: regions };
    }),
  publishWindowEnvironment: (windowEnvironment) => set({ windowEnvironment }),
  clearWindowEnvironment: () => set({ windowEnvironment: null }),
  clear: () => {
    const projectId = useLcosShellStore.getState().projectId;
    if (projectId !== null) removeProfessionalWindowLayout(projectId);
    projectUiSessions.clear();
    set({
      projectId: null,
      activeSurface: 'main',
      activeWorkspaceId: null,
      surfaceCanvasId: {},
      cameraRequest: null,
      locateRequest: null,
      focusWhereRequest: null,
      composerOpen: false,
      composerTarget: null,
      composerPrompt: '',
      composerCaret: null, composerFocusVersion: 0,
      conversationSendAttempts: new Map(),
      continuationRequests: new Map(),
      windows: [],
      windowRegions: [],
      readerPositions: {},
      readerLastRevisions: {},
      windowEnvironment: null,
      childReturn: null,
      worksiteCameraTransition: null,
    });
  },
}));

useLcosShellStore.subscribe((state, previous) => {
  if (state.projectId === null || state.projectId !== previous.projectId
    || (state.windows === previous.windows && state.windowRegions === previous.windowRegions)) return;
  writeProfessionalWindowLayout(state.projectId, state.windows, state.windowRegions.map(normalizeWindowRegion));
});
