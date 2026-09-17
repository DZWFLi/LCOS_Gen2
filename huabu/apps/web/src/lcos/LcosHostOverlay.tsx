// LcosHostOverlay — 唯一的 LCOS 画布级 overlay 容器（Phase A07）。
//
// 禁止 node Christmas tree（F-L0 §2）：任何画布浮层不再由各 renderer 自由
// 绝对定位。composer / drop-preview 等画布级浮层一律收进本容器，由
// interaction/overlayArbitration 的纯函数 visibleOverlays 裁决当前应显示哪
// 一些，并按统一 overlayLayers 分级 z-index 渲染。
//
// 仲裁输入从各 store 采集（drop 在拖拽/让步 → 只可能保留 drop-preview），
// 仲裁结果决定挂载哪些子浮层。Composer 只有显式 selection-local open intent
// 才挂载；拖拽这类全局高优先级状态会经仲裁把它让道，草稿仍留在 ephemeral store。

import {
  CoreAssemblyClient,
  visibleOverlays,
} from '@local-creative-os/web-gen2';
import React from 'react';
import { useEffect, useMemo, useRef } from 'react';

import useCanvasStore from '@/store/canvasStore';

import { createLcosCoreSession } from './app/lcosCoreClient';
import { LcosComposerHost } from './composer/LcosComposerHost';
import { LcosDropPreview } from './LcosDropPreview';
import { useLcosDropStore } from './lcosDropState';
import { useLcosShellStore } from './shell/lcosShellStore';
import { rectFromDomRect } from './drop/dropTargetRegistry';
import { DropCommitRouter } from './drop/dropCommitRouter';
import { useLcosReferenceStore } from './lcosReferenceState';
import { advanceDropAtScreenPoint } from './lcosRecognizers';

import type {
  DropAssemblyApplyIntent,
  DropComposerReferenceIntent,
  DropTargetRegistration,
} from './drop/dropTypes';

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
  const composerOpen = useLcosShellStore((state) => state.composerOpen);
  const composerTarget = useLcosShellStore((state) => state.composerTarget);
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

  // Native HTML5 drag sources emit dragover rather than pointermove while the
  // payload is held. Feed that event into the same resolver path as the
  // pointer-router observer and prevent the browser's default file-drop page
  // navigation only while an LCOS payload is active.
  useEffect(() => {
    const onDragOver = (event: DragEvent): void => {
      const status = useLcosDropStore.getState().state.status;
      if (
        (status !== 'tracking' && status !== 'dwell' && status !== 'preview') ||
        canvasWrapper === null ||
        rfInstance === null
      ) return;
      event.preventDefault();
      advanceDropAtScreenPoint(event, { wrapper: canvasWrapper, instance: rfInstance });
    };
    window.addEventListener('dragover', onDragOver);
    return () => window.removeEventListener('dragover', onDragOver);
  }, [canvasWrapper, rfInstance]);

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
    const store = useLcosDropStore.getState();
    const intent = dropResolution.intent;
    const router = commitRouterRef.current;
    if (router === null) return;
    const owners = {
      applyAssembly: async (assemblyIntent: DropAssemblyApplyIntent, signal?: AbortSignal): Promise<unknown> => {
        const point = assemblyIntent.placementPoint;
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
        return assembly.apply(
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
      },
      addComposerReference: (referenceIntent: DropComposerReferenceIntent): void => {
        useLcosReferenceStore.getState().addEntityToDraft(referenceIntent.reference);
      },
    };
    void router.commit(intent, dropState.transactionId, owners)
      .then((receipt) => {
        if (!active) return;
        if (receipt.status === 'success') {
          store.cancel();
        } else {
          store.fail(receipt.message ?? '投放失败', true);
        }
      });
    return () => { active = false; };
  }, [assembly, dropResolution, dropState, projectId]);

  const dropActive =
    dropStatus === 'tracking' ||
    dropStatus === 'dwell' ||
    dropStatus === 'preview';
  const dropPreview = dropStatus === 'preview';

  const visible = visibleOverlays({
    dragging: isNodeDragging || dropActive,
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
  // Professional bodies render the same Composer inline. Keep this canvas host
  // silent while any window is foregrounded, so one shell intent never double-renders.
  const professionalWindowOpen = useLcosShellStore((state) => state.windows.length > 0);
  const showComposer = has(visible, 'composer') && !professionalWindowOpen;

  return (
    <>
      {showDrop && <LcosDropPreview />}
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
