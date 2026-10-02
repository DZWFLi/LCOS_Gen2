// PortalNodeBody — 入口（Portal / 投影锚点）物种 body。
// 触发：双击/Enter 打开专业窗口里的 Portal 目标预览（shellStore.openWindow，
// 与 GlythNodeBody 同一 local intent 机制；单击仍是选择，selection 归 Huabu）。
// 目标身份取真实 Huabu 节点字段：canvasRef 节点的 data.targetCanvasId（见 CanvasRefNode）。
// 没有可解析目标时不假装可预览——窗口 body 会明确显示「目标缺失」。

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { SpacePreviewViewport } from '@/components/Nodes/spacePreview/SpacePreviewViewport';
import { useSpacePreviewScene } from '@/store/spacePreviewSceneCache';
import { isEditableTarget } from '@/hooks/shortcuts/isEditableTarget';
import useCanvasStore from '@/store/canvasStore';

import { LcosSpeciesBodyContent, SPECIES_ACCENT } from './LcosSpeciesBodies';
import { useLcosDensity } from './useLcosDensity';
import { NodeColorPinMarkers } from './NodeColorPinMarkers';
import { NodeReferenceMarker } from './NodeReferenceMarker';
import { useLcosShellStore } from '../shell/lcosShellStore';
import { useLcosReferenceStore } from '../lcosReferenceState';
import { useLcosDropStore } from '../lcosDropState';
import { isDropPointExposed } from '../drop/dropOcclusion';
import { rectFromDomRect } from '../drop/dropTargetRegistry';
import { portalDropTargetForCanvas, usePortalDropWorkspaceContext } from '../drop/PortalDropWorkspaceContext';
import { lcosTokens } from '../ui/lcosTokens';

import type { DropTargetRegistration } from '../drop/dropTypes';
import type { CanvasNodeBodySlotInput } from '@/lcos-seam/types';
import type { JSX } from 'react';

function readTarget(data: Readonly<Record<string, unknown>> | undefined): string | undefined {
  const raw = data?.targetCanvasId ?? data?.canvasRef;
  return typeof raw === 'string' && raw.trim() !== '' ? raw.trim() : undefined;
}

export function PortalNodeBody(input: CanvasNodeBodySlotInput): JSX.Element {
  const bodyRef = useRef<HTMLDivElement>(null);
  const density = useLcosDensity();
  const [nearViewport,setNearViewport] = useState(() => typeof IntersectionObserver === 'undefined');
  useEffect(() => {
    if (!bodyRef.current || typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver(([entry]) => setNearViewport(entry?.isIntersecting === true), {rootMargin:'300px'});
    observer.observe(bodyRef.current); return () => observer.disconnect();
  },[]);
  const data = input.data as Readonly<Record<string, unknown>> | undefined;
  const rawTitle = data?.label ?? data?.title;
  const title = typeof rawTitle === 'string' && rawTitle.trim() !== '' ? rawTitle.trim() : '入口';
  const target = readTarget(data);
  const workspaceContext = usePortalDropWorkspaceContext();
  const boundRef = useLcosReferenceStore((state) => state.nodeEntityRefs.get(input.nodeId));
  const pinnedWorkspaceId = boundRef?.entityType === 'workspace' ? boundRef.entityId : undefined;
  const sourceCanvasId = useCanvasStore((state) => state.canvasId);
  const locked = useCanvasStore((state) => state.nodes.find((node) => node.id === input.nodeId)?.data.locked === true);
  const resolvedTarget = useMemo(() => portalDropTargetForCanvas(workspaceContext,target,pinnedWorkspaceId), [workspaceContext,target,pinnedWorkspaceId]);
  const canReceive = !!resolvedTarget && !locked && sourceCanvasId !== target;
  const feedback = useLcosDropStore((state) => state.feedback?.receipt.targetId === `portal:${input.nodeId}`
    && state.feedback.originalIntent.intent.kind === 'assembly-apply'
    && state.feedback.originalIntent.intent.railwayCanvasId === resolvedTarget?.canvasId
    && state.feedback.originalIntent.intent.targetRef.kind === 'workspace'
    && state.feedback.originalIntent.intent.targetRef.id === resolvedTarget?.workspaceId ? state.feedback.receipt : null);
  const waiting = useLcosDropStore((state) => state.state.status === 'committing' && state.resolution?.status === 'ready'
    && state.resolution.intent.targetId === `portal:${input.nodeId}` && state.resolution.intent.kind === 'assembly-apply'
    && state.resolution.intent.railwayCanvasId === resolvedTarget?.canvasId
    && state.resolution.intent.targetRef.kind === 'workspace' && state.resolution.intent.targetRef.id === resolvedTarget?.workspaceId);
  const feedbackText = waiting ? '正在投递，等待确认' : feedback?.status === 'success' ? '已确认放入，原对象仍在原处'
    : feedback?.status === 'partial' ? '部分完成，请查看逐项回执' : feedback ? '投递未确认，请核对原操作' : undefined;
  const hostZoom = useCanvasStore((state) => state.viewport?.zoom ?? 1);
  const preview = useSpacePreviewScene(target ?? '',nearViewport && !!resolvedTarget);
  const scene = resolvedTarget && preview.scene?.canvasId === target ? preview.scene : null;
  const registerTarget = useLcosDropStore((state) => state.registerTarget);
  const unregisterTarget = useLcosDropStore((state) => state.unregisterTarget);

  const isOnlySelected = useCanvasStore((state) => {
    const selected = state.nodes.filter((node) => node.selected);
    return selected.length === 1 && selected[0]?.id === input.nodeId;
  });
  const openPreview = useCallback((): void => {
    useLcosShellStore.getState().openWindow('portal-preview', `入口 · ${title}`, target, 'canvas', {workspaceId:pinnedWorkspaceId ?? resolvedTarget?.workspaceId,sourceNodeId:input.nodeId});
  }, [title,target,pinnedWorkspaceId,resolvedTarget?.workspaceId,input.nodeId]);

  useEffect(() => {
    if (bodyRef.current === null) return;
    const targetId = `portal:${input.nodeId}`;
    const targetRegistration: Omit<DropTargetRegistration, 'rect'> = {
      targetId,
      kind: 'portal-receive',
      nodeId: input.nodeId,
      label: `入口 · ${title}${resolvedTarget === undefined ? '' : ` → ${resolvedTarget.label}`}`,
      priority: 25,
      enabled: canReceive,
      ...(!canReceive ? { ineligibleReason: locked ? '入口已锁定，不能接收材料' : sourceCanvasId === target ? '这是当前现场，请直接整理材料' : target === undefined
        ? '这个入口还没有目标现场'
        : '入口尚未唯一解析到目标工作现场' } : {}),
      semantic: { kind: 'portal-receive', ...(resolvedTarget === undefined ? {} : { targetRef: resolvedTarget.targetRef, destinationRef: resolvedTarget.destinationRef, canvasId: resolvedTarget.canvasId }) },
      acceptsPoint: (point) => {
        const element = bodyRef.current;
        return element !== null && isDropPointExposed(element, point);
      },
      readRect: () => {
        const body = bodyRef.current;
        return body?.isConnected ? rectFromDomRect(body.getBoundingClientRect()) : undefined;
      },
    };
    const publish = (): void => {
      const body = bodyRef.current;
      if (body !== null) registerTarget({ ...targetRegistration, rect: rectFromDomRect(body.getBoundingClientRect()) });
    };
    publish();
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(publish) : null;
    observer?.observe(bodyRef.current);
    window.addEventListener('resize', publish);
    window.addEventListener('scroll', publish, true);
    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', publish);
      window.removeEventListener('scroll', publish, true);
      unregisterTarget(targetId);
    };
  }, [input.nodeId, registerTarget, resolvedTarget, target, title, unregisterTarget,canReceive,locked,sourceCanvasId]);

  useEffect(() => {
    if (!isOnlySelected) return;
    const onKeyDown = (event: KeyboardEvent): void => {
      const shell = useLcosShellStore.getState();
      const element = event.target instanceof Element ? event.target : null;
      if (event.key !== 'Enter' || event.isComposing || event.repeat || event.ctrlKey || event.metaKey || event.altKey || event.shiftKey || event.defaultPrevented || isEditableTarget(event.target)
        || shell.composerOpen || shell.windows.some((window) => window.active)
        || document.querySelector('[aria-modal="true"]')
        || element?.closest('button, a, select, [role="button"], [role="menuitem"]')) return;
      event.preventDefault();
      openPreview();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isOnlySelected, openPreview]);

  return (
    <div
      ref={bodyRef}
      data-lcos-species-body
      data-lcos-portal-body
      data-portal-state={waiting ? 'waiting' : feedback?.status ?? 'idle'}
      data-lcos-drop-target={resolvedTarget === undefined ? 'unavailable' : 'portal'}
      data-lcos-density={density}
      onDoubleClick={(event) => {
        event.stopPropagation();
        if (!(event.target instanceof Element && event.target.closest('button, a, input'))) openPreview();
      }}
      onKeyDown={(event) => {
        if (event.target === event.currentTarget && event.key === 'Enter' && !event.nativeEvent.isComposing && !event.repeat && !event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey) {
          event.preventDefault();
          event.stopPropagation();
          openPreview();
        }
      }}
      role="button"
      tabIndex={0}
      aria-label={`${title} · 双击查看入口目标`}
      className="relative flex h-full w-full flex-col overflow-visible"
      style={{
        background: lcosTokens.color.surface,
        border: `1px solid ${SPECIES_ACCENT.portal}2E`,
        borderRadius: lcosTokens.radius.cardSmall,
        boxShadow: lcosTokens.shadow.default,
        padding: 10,
      }}
    >
      {(density === 'mark' || density === 'summary') ? <LcosSpeciesBodyContent species="portal" title={title} density={density} /> : <>
        <strong className="lcos-portal-node-title">{resolvedTarget?.label ?? title}</strong>
        {scene ? <div className="lcos-portal-node-scene" data-lcos-portal-node-scene>
          <SpacePreviewViewport scene={scene} hostCanvasId={sourceCanvasId} previewNodeId={input.nodeId} hostZoom={hostZoom}/>
        </div> : <div className="lcos-portal-node-empty">{!resolvedTarget ? '原目标尚未确认' : preview.error ? '预览暂不可用，双击可重试' : '正在读取目标预览…'}</div>}
      </>}
      <NodeColorPinMarkers nodeId={input.nodeId} />
      <NodeReferenceMarker nodeId={input.nodeId} />
      <span className="sr-only" role="status" aria-live="polite">{feedbackText}</span>
      {density === 'reading' && (
        <span className="mt-1 truncate text-[10px]" style={{ color: lcosTokens.color.muted }}>
          {feedbackText ?? (resolvedTarget ? `${resolvedTarget.label} · 只读入口` : '原目标尚未确认')}
        </span>
      )}
    </div>
  );
}
