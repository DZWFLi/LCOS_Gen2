// LcosHostOverlay — 唯一的 LCOS 画布级 overlay 容器（Phase A07）。
//
// 禁止 node Christmas tree（F-L0 §2）：任何画布浮层不再由各 renderer 自由
// 绝对定位。composer / drop-preview 等画布级浮层一律收进本容器，由
// interaction/overlayArbitration 的纯函数 visibleOverlays 裁决当前应显示哪
// 一些，并按统一 overlayLayers 分级 z-index 渲染。
//
// 仲裁输入从各 store 采集（拖拽保留已打开 Composer 接收面与 drop-preview），
// 仲裁结果决定挂载哪些子浮层。Composer 只有显式 selection-local open intent
// 才挂载；后续拖拽保留真实接收面，草稿仍留在既有 ephemeral store。

import {
  CoreAssemblyClient,
  CoreRailwayClient,
  visibleOverlays,
} from '@local-creative-os/web-gen2';
import React from 'react';
import { useEffect, useMemo, useRef } from 'react';

import { toast } from '@/components/Common/Toast';
import useCanvasStore from '@/store/canvasStore';

import { createLcosCoreSession } from './app/lcosCoreClient';
import { useCollaborationSessionStore } from './collaboration/collaborationSessionStore';
import { composerHasVisibleWindowOwner } from './composer/composerPresentationOwner';
import { composerInputKey } from './composer/composerInputJourney';
import { LcosComposerHost } from './composer/LcosComposerHost';
import { DropCommitRouter } from './drop/dropCommitRouter';
import { bookmarkRailway } from './drop/railwayBookmark';
import { planNativeCanvasLanding } from './drop/nativeCanvasDropGeometry';
import { captureCollectionDropPlacement, planCollectionDropPlacement } from './drop/collectionDropPlacement';
import { bindNativeAssemblyDropEvents } from './drop/nativeAssemblyDrop';
import { isDropPointExposed } from './drop/dropOcclusion';
import { rectFromDomRect } from './drop/dropTargetRegistry';
import { LcosDropReceipt } from './drop/LcosDropReceipt';
import { useLcosHostStore } from './host/lcosHostState';
import { LcosDropPreview } from './LcosDropPreview';
import { useProfessionalViewport, visibleWindowIdsForStage } from './professional/professionalStageVisibility';
import { useLcosDropStore } from './lcosDropState';
import { advanceDropAtScreenPoint } from './lcosRecognizers';
import { useLcosReferenceStore } from './lcosReferenceState';
import { useLcosShellStore } from './shell/lcosShellStore';
import { TemporalPreviewOutlines } from './surfaces/context/TemporalPreviewOutlines';
import {
  importWorkflowArchiveDrop,
  resolveWorkflowArchiveDrop,
} from './surfaces/workflow/workflowArchiveDrop';

import type {
  DropCommitReceipt,
  DropAssemblyApplyIntent,
  DropComposerReferenceIntent,
  DropCollectionMembershipIntent,
  DropTargetRegistration,
  DropRailwayBookmarkIntent,
} from './drop/dropTypes';
import type { AssemblyApplyResultV1 } from '@local-creative-os/contracts';

const has = (kinds: readonly string[], kind: string): boolean =>
  kinds.includes(kind);

export const LcosHostOverlay: React.FC = () => {
  const dropStatus = useLcosDropStore((s) => s.state.status);
  const dropState = useLcosDropStore((s) => s.state);
  const dropResolution = useLcosDropStore((s) => s.resolution);
  const registerTarget = useLcosDropStore((s) => s.registerTarget);
  const unregisterTarget = useLcosDropStore((s) => s.unregisterTarget);
  // 真实 selection（审计 §7：仲裁输入必须来自真实 store，不硬编码 false）。
  // resize/hover 相位是 NodeWrapper 局部 owner（overlayInteractionPriority 已反映），
  // 不在此重复订阅；actionArc/workView 待 B 阶段接 surface store。
  const hasSelection = useCanvasStore((state) =>
    state.nodes.some((node) => node.selected === true),
  );
  const isNodeDragging = useCanvasStore((state) =>
    state.nodes.some((node) => node.dragging === true),
  );
  const projectId = useLcosShellStore((state) => state.projectId);
  const activeSurface = useLcosShellStore((state) => state.activeSurface);
  const activeWorkspaceId = useLcosShellStore((state) => state.activeWorkspaceId);
  const host = useLcosHostStore((state) => state.host);
  const composerOpen = useLcosShellStore((state) => state.composerOpen);
  const composerTarget = useLcosShellStore((state) => state.composerTarget);
  const windows = useLcosShellStore((state) => state.windows);
  const windowRegions = useLcosShellStore((state) => state.windowRegions);
  const closeComposer = useLcosShellStore((state) => state.closeComposer);
  const canvasId = useCanvasStore((state) => state.canvasId);
  const canvasWrapper = useCanvasStore((state) => state.canvasWrapper);
  const rfInstance = useCanvasStore((state) => state.rfInstance);
  const session = useMemo(() => createLcosCoreSession(), []);
  const assembly = useMemo(() => new CoreAssemblyClient(session.http), [session]);
  const commitRouterRef = useRef<DropCommitRouter | null>(null);
  if (commitRouterRef.current === null) {
    commitRouterRef.current = new DropCommitRouter();
  }

  const feedbackProjectRef = useRef(projectId);
  useEffect(() => {
    if (feedbackProjectRef.current === projectId) return;
    feedbackProjectRef.current = projectId;
    // A gesture/receipt belongs to its original project, never the next route.
    useLcosDropStore.getState().cancel();
    commitRouterRef.current?.clear();
  }, [projectId]);

  // HTML5 transport uses the same resolver as pointer gestures. Only `drop`
  // commits; dragend/Escape/blur cancel. Capture before the native Canvas importer.
  useEffect(() => bindNativeAssemblyDropEvents(window, {
    read: () => useLcosDropStore.getState(),
    advance: (event) => {
      if (canvasWrapper === null || rfInstance === null) return false;
      advanceDropAtScreenPoint(event, { wrapper: canvasWrapper, instance: rfInstance });
      return true;
    },
    commit: () => useLcosDropStore.getState().commitAt(crypto.randomUUID()),
    cancel: () => useLcosDropStore.getState().cancel(),
  }), [canvasWrapper, rfInstance]);

  // Portable Workflow archives need their Blob bytes, while the spatial-drop
  // payload intentionally carries only file metadata. Capture this one native
  // file gesture at the LCOS host boundary and route it straight to the
  // canonical Core producer. No second store/card and no client-side ZIP parse.
  useEffect(() => {
    const onDrop = (event: DragEvent): void => {
      if (activeSurface !== 'main' && activeSurface !== 'workflow') return;
      const target = event.target;
      if (!(target instanceof Element)) return;
      const isReachableSurface = activeSurface === 'workflow'
        ? target.closest('[data-lcos-workflow-worksite]') !== null
        : target.closest('[data-canvas-root]') !== null;
      if (!isReachableSurface) return;

      const files = event.dataTransfer?.files;
      if (files === undefined || files.length === 0) return;
      const resolution = resolveWorkflowArchiveDrop(files);
      if (resolution.status === 'ignored') return;

      // Consume before any async work so the stock Canvas onDrop cannot turn
      // a failed Workflow import into an unrelated Huabu file node.
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();

      if (resolution.status === 'rejected') {
        toast(resolution.reason, { tone: 'danger' });
        return;
      }
      if (host === null) {
        toast('工作流导入尚未就绪，请等待项目现场完成连接。', { tone: 'danger' });
        return;
      }

      void importWorkflowArchiveDrop(resolution, host).then((outcome) => {
        if (outcome.status === 'failed') {
          toast(`工作流导入失败：${outcome.reason}`, { tone: 'danger' });
          return;
        }
        toast(
          outcome.receipt.created
            ? '工作流已加入 Main 与 Assembly'
            : '这个工作流已在项目中，已定位到现有定义',
          { tone: 'success' },
        );
      });
    };

    window.addEventListener('drop', onDrop, true);
    return () => window.removeEventListener('drop', onDrop, true);
  }, [activeSurface, host]);

  // Canvas is a live target, not a hard-coded edge destination. Its semantic
  // target is derived from the active Core/Huabu identity; its rect is only
  // ephemeral geometry used for hit testing during the current gesture.
  useEffect(() => {
    if (projectId === null || canvasId === null || canvasWrapper === null) return;
    const targetId = [
      'canvas',
      projectId,
      canvasId,
      activeSurface,
      activeWorkspaceId ?? 'root',
    ].join(':');
    const targetRef = activeSurface === 'main'
      ? { kind: 'main' as const }
      : activeWorkspaceId === null
        ? undefined
        : { kind: 'workspace' as const, id: activeWorkspaceId };
    const base: Omit<DropTargetRegistration, 'rect'> = {
      targetId,
      kind: 'canvas',
      label: activeSurface === 'main' ? 'Main' : `${activeSurface} 现场`,
      priority: 10,
      acceptsPoint: (point) => isDropPointExposed(canvasWrapper, point),
      enabled: targetRef !== undefined,
      ...(targetRef === undefined ? { ineligibleReason: '当前现场尚未解析到 workspace' } : {}),
      semantic: {
        kind: 'canvas',
        // The target is disabled until a real workspace identity exists; the
        // fallback keeps the registration shape total for diagnostics.
        targetRef: targetRef ?? { kind: 'project', id: projectId },
      },
    };
    const publish = (): void => {
      registerTarget({
        ...base,
        rect: rectFromDomRect(canvasWrapper.getBoundingClientRect()),
      });
    };
    publish();
    const observer = typeof ResizeObserver === 'function'
      ? new ResizeObserver(publish)
      : null;
    observer?.observe(canvasWrapper);
    window.addEventListener('resize', publish);
    window.addEventListener('scroll', publish, true);
    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', publish);
      window.removeEventListener('scroll', publish, true);
      unregisterTarget(targetId);
    };
  }, [
    activeSurface,
    activeWorkspaceId,
    canvasId,
    canvasWrapper,
    projectId,
    registerTarget,
    unregisterTarget,
  ]);

  // One commit owner bridge: the store freezes the resolved intent at
  // pointer-up, then this host invokes the existing canonical owner exactly
  // once. No Core truth is created in the drop layer itself.
  useEffect(() => {
    if (
      dropState.status !== 'committing' ||
      dropResolution?.status !== 'ready' ||
      projectId === null
    ) return;
    let active = true;
    const dropCanvasId = canvasId;
    const store = useLcosDropStore.getState();
    if (store.state.status !== 'committing' || store.state.transactionId !== dropState.transactionId) return;
    const intent = dropResolution.intent;
    const nativeSource = store.nativeSource ?? null;
    const memberNodeId = intent.kind === 'collection-membership'
      ? [...useLcosReferenceStore.getState().nodeEntityRefs].find(([, ref]) =>
          ref.entityType === intent.memberRef.type && ref.entityId === intent.memberRef.id)?.[0]
      : undefined;
    const spatialSource = nativeSource === null && intent.kind === 'collection-membership'
      ? captureCollectionDropPlacement(useCanvasStore.getState().nodes, useCanvasStore.getState().collapsedFrameIds,
          intent.collectionId, memberNodeId, store.carrySourceNodeId !== null)
      : undefined;
    const router = commitRouterRef.current;
    if (router === null) return;
    const owners = {
      projectId,
      bookmarkRailway: (intent: DropRailwayBookmarkIntent, signal?: AbortSignal) => bookmarkRailway(
        new CoreRailwayClient(session.http),intent,
        () => useLcosShellStore.getState().projectId===projectId,signal),
      receivePortal: async (intent: DropAssemblyApplyIntent, operationId: string, signal?: AbortSignal) => {
        if (intent.railwayDestinationRef?.kind !== 'worksite' || !intent.railwayCanvasId || !dropCanvasId)
          throw new Error('入口目标或来源尚未确认，请重新打开入口');
        return new CoreRailwayClient(session.http).receivePortal({schemaVersion:1,projectId,operationId,viaPortal:true,
          destination:intent.railwayDestinationRef,expectedCanvasId:intent.railwayCanvasId,
          sourceCanvasId:dropCanvasId,sourceRefs:intent.sourceRefs},signal);
      },
      receiveRailway: async (intent: DropAssemblyApplyIntent, operationId: string, signal?: AbortSignal) => {
        if (intent.railwayDestinationRef?.kind !== 'worksite' || intent.railwayOrderVersion === undefined || !intent.railwayCanvasId)
          throw new Error('旧目的地引用不可直接投递，请重新读取导航');
        return new CoreRailwayClient(session.http).receive({schemaVersion:1,projectId,operationId,
          destination:intent.railwayDestinationRef,expectedOrderVersion:intent.railwayOrderVersion,
          expectedCanvasId:intent.railwayCanvasId,...(dropCanvasId ? {sourceCanvasId:dropCanvasId} : {}),sourceRefs:intent.sourceRefs},signal);
      },
      applyAssembly: async (assemblyIntent: DropAssemblyApplyIntent, signal?: AbortSignal): Promise<AssemblyApplyResultV1> => {
        const point = assemblyIntent.targetRef.kind === 'conversation' ? undefined : assemblyIntent.placementPoint;
        const placementBySource = point === undefined
          ? undefined
          : assemblyIntent.sourceRefs.reduce<Record<string, { readonly x: number; readonly y: number }>>(
              (placements, sourceRef) => {
                placements[sourceRef.id] = {
                  x: point.x,
                  y: point.y,
                };
                return placements;
              },
              {},
            );
        const result = await assembly.apply(
          projectId,
          {
            schemaVersion: 1,
            projectId,
            sourceRefs: assemblyIntent.sourceRefs,
            targetRef: assemblyIntent.targetRef,
            ...(placementBySource === undefined ? {} : { placementBySource }),
          },
          signal,
        );
        if (assemblyIntent.targetRef.kind === 'conversation' && !signal?.aborted) {
          void useCollaborationSessionStore.getState().refresh(projectId, assemblyIntent.targetRef.id);
        }
        return result;
      },
      addComposerReference: (referenceIntent: DropComposerReferenceIntent): void => {
        const shell = useLcosShellStore.getState();
        const references = useLcosReferenceStore.getState();
        if (shell.projectId !== projectId || references.projectId !== projectId
          || (referenceIntent.inputKey !== undefined && referenceIntent.inputKey !== composerInputKey(shell.composerTarget))) {
          throw new Error('当前输入目标已改变，未把引用加入其他任务。');
        }
        const result = references.addEntitiesToDraft(referenceIntent.references ?? [referenceIntent.reference], shell.composerTarget?.intent);
        if (result.reason) throw new Error(result.reason);
      },
      // Canonical owner first. The router validates identity and positive status
      // BEFORE calling any spatial manifestation or refresh callback.
      addCollectionMember: (membershipIntent: DropCollectionMembershipIntent) =>
        session.collections.addMember(projectId, membershipIntent.collectionId, membershipIntent.memberRef),
      onCollectionApplied: (membershipIntent: DropCollectionMembershipIntent): void => {
        // A native selection lands as ONE native geometry/parent batch after all receipts.
        if (nativeSource !== null) return;
        const currentDrop = useLcosDropStore.getState().state;
        const currentCanvas = useCanvasStore.getState();
        if (useLcosShellStore.getState().projectId !== projectId || currentCanvas.canvasId !== dropCanvasId
          || currentDrop.status !== 'committing' || currentDrop.transactionId !== dropState.transactionId) return;
        useLcosReferenceStore.getState().requestNodeBindingRefresh();
        const placement = planCollectionDropPlacement(spatialSource, currentCanvas.nodes,
          currentCanvas.collapsedFrameIds, membershipIntent.collectionId);
        if (placement === undefined) return;
        const memberRef = useLcosReferenceStore.getState().nodeEntityRefs.get(placement.memberNodeId);
        if (memberRef?.entityType !== membershipIntent.memberRef.type || memberRef.entityId !== membershipIntent.memberRef.id) return;
        if (placement.geometry.length > 0) currentCanvas.setNodeGeometry(placement.geometry);
        currentCanvas.moveNodeIntoFrame(placement.memberNodeId, placement.frameId);
        if (useCanvasStore.getState().nodes.find((node) => node.id === placement.memberNodeId)?.parentId !== placement.frameId) {
          throw new Error('Collection spatial host did not confirm parentage.');
        }
      },

    };
    void router.commit(intent, dropState.transactionId, owners)
      .then((receipt) => {
        if (!active || useLcosShellStore.getState().projectId !== projectId) return;
        const current = useLcosDropStore.getState();
        if (current.state.status !== 'committing' || current.state.transactionId !== dropState.transactionId) return;
        let finalReceipt: DropCommitReceipt = receipt;
        if (nativeSource !== null && intent.kind === 'collection-membership') {
          if ((nativeSource.landing || nativeSource.landingRevoked) && receipt.status !== 'failed') {
            const canvas = useCanvasStore.getState();
            const plan = current.nativeSource === nativeSource && canvas.canvasId
              ? planNativeCanvasLanding(nativeSource, intent, receipt, { projectId, canvasId: canvas.canvasId },
                  canvas.nodes, useLcosReferenceStore.getState().nodeEntityRefs, canvas.collapsedFrameIds)
              : { items: [], skipped: true };
            let placed = plan.items.length === 0;
            try {
              if (plan.items.length > 0 && nativeSource.landing) placed = canvas.placeNodesInFrame(plan.items, nativeSource.landing.frameId);
            } catch { placed = false; }
            if (plan.skipped || !placed) {
              finalReceipt = { ...receipt, status: 'partial',
                message: '已确认的集合关系已保存；部分空间位置未应用，保留当前编辑，可重新展开集合' };
            }
          }
          if (useCanvasStore.getState().canvasId === nativeSource.scope.canvasId) {
            useLcosReferenceStore.getState().requestNodeBindingRefresh();
          }
        }
        store.settle(finalReceipt);
      });
    return () => { active = false; };
  }, [assembly, canvasId, dropResolution, dropState, projectId]);

  const dropActive =
    dropStatus === 'tracking' ||
    dropStatus === 'dwell' ||
    dropStatus === 'preview';
  const dropCommitting = dropStatus === 'committing';
  // The same feedback layer first outlines the resolver-approved live targets
  // while a payload is in transit, then keeps the accepted target visible until
  // the canonical receipt settles. This is the Gen1 carry -> accept continuity.
  const dropPreview = dropActive || dropCommitting;

  const visible = visibleOverlays({
    dragging: isNodeDragging || dropActive || dropCommitting,
    resizing: false,
    selected: hasSelection,
    hovered: false,
    composerOpen,
    actionArcOpen: false,
    workViewOpen: false,
    dropPreview,
    // reference-badge 是 per-node 节点级浮层，由 NodeWrapper 的 overlayContent
    // 呈现；此处画布级不重复。
    referenceBadge: false,
  });

  const showDrop = has(visible, 'drop-preview');
  const viewport = useProfessionalViewport();
  const visibleWindowIds = useMemo(
    () => visibleWindowIdsForStage(windows, windowRegions, viewport).windowIds,
    [viewport, windowRegions, windows],
  );
  // Only the visible body that actually owns this intent takes its inline Composer.
  // Unrelated Readers/Assembly windows must leave canvas-local intent reachable.
  const windowOwnsComposer = composerHasVisibleWindowOwner(composerTarget, windows, visibleWindowIds);
  const showComposer = has(visible, 'composer') && !windowOwnsComposer;

  return (
    <>
      <TemporalPreviewOutlines />
      {showDrop && <LcosDropPreview />}
      <LcosDropReceipt />
      {projectId && composerTarget && (
        <LcosComposerHost
          projectId={projectId}
          workspaceId={composerTarget.workspaceId}
          anchor={composerTarget.anchor}
          open={showComposer}
          onClose={closeComposer}
        />
      )}
    </>
  );
};
