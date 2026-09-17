// GlythNodeBody — Conversation/Glyth exact Main anchor.
// Figma visual truth: 5388:118 group 121×142; 5388:119 body 92×92 at x=9/y=0.
// Donor geometry is retained, but production Main stays on the single dark blob
// authorized by current Figma until identity variants are explicitly designed.

import {
  glythInputFromCollaborationState,
  resolveGlythPresentation,
  type GlythPresentationPose,
} from '@local-creative-os/web-gen2';

import { useLcosNodePresentation } from '@/lcos-seam/nodePresentation';

import {
  GLYTH_CENTER,
  GLYTH_IDLE_EYE_PATHS,
  GLYTH_SHAPE_PATHS,
  GLYTH_VIEW_BOX,
} from './glythGeometry';
import { useLcosDensity } from './useLcosDensity';
import { rectFromDomRect } from '../drop/dropTargetRegistry';
import { useLcosDropStore } from '../lcosDropState';
import { useCollaborationSession } from '../collaboration/useCollaborationSession';
import { useLcosReferenceStore } from '../lcosReferenceState';
import { useLcosShellStore } from '../shell/lcosShellStore';
import { lcosTokens } from '../ui/lcosTokens';

import type { CanvasNodeBodySlotInput } from '@/lcos-seam/types';
import type { DropTargetRegistration } from '../drop/dropTypes';
import { useEffect, useRef } from 'react';
import type { JSX } from 'react';

function titleOf(data: Readonly<Record<string, unknown>>): string {
  const raw = data.label ?? data.title;
  return typeof raw === 'string' && raw.trim() !== '' ? raw.trim() : 'Glyth';
}

function bodyPoseTransform(pose: GlythPresentationPose): string | undefined {
  switch (pose) {
    case 'listening': return 'translate(0 -2)';
    case 'working': return `rotate(-2 ${GLYTH_CENTER} ${GLYTH_CENTER})`;
    case 'curious': return `rotate(4 ${GLYTH_CENTER} ${GLYTH_CENTER})`;
    case 'idle':
    default: return undefined;
  }
}

export function GlythNodeBody(input: CanvasNodeBodySlotInput): JSX.Element {
  const bodyRef = useRef<HTMLDivElement>(null);
  const density = useLcosDensity();
  const presentation = useLcosNodePresentation();
  const ref = useLcosReferenceStore((state) => state.nodeEntityRefs.get(input.nodeId));
  const projectId = useLcosReferenceStore((state) => state.projectId);
  const title = titleOf(input.data as Readonly<Record<string, unknown>>);
  // Gate 4：Glyth 只消费 6 用户态（Collaboration projection）。
  // 投影 ready → userState 驱动 pose；未 ready → 回退既有 descriptor（不伪造状态）。
  const conversationId = ref?.entityType === 'conversation' ? ref.entityId : null;
  const collaborationEntry = useCollaborationSession(projectId, conversationId);
  const projection = collaborationEntry?.status === 'ready' ? collaborationEntry.projection : undefined;
  const collabInput = glythInputFromCollaborationState(projection?.userState);
  const pose = resolveGlythPresentation({
    ...collabInput,
    ...(projection === undefined
      ? {
          ...(ref?.descriptor?.active === undefined ? {} : { active: ref.descriptor.active }),
          ...(ref?.descriptor?.waiting === undefined ? {} : { waiting: ref.descriptor.waiting }),
        }
      : {}),
    ...(presentation?.phase === undefined ? {} : { phase: presentation.phase }),
  });
  const attention = projection?.userState === 'needs_user';
  const isMark = density === 'mark';
  const size = isMark ? 34 : 92;
  const left = isMark ? (121 - size) / 2 : 9;
  const top = isMark ? 16 : 0;

  const openWorkView = (): void => {
    if (!ref || ref.entityType !== 'conversation') return;
    useLcosShellStore.getState().openWindow('conversation', `会话窗口 · ${title}`, ref.entityId);
  };

  // R1 合流（CollaborationTarget）：Glyth 是 collaboration-reference drop target。
  // Drop 到 Glyth = 把对象作为 Reference 交给该 Conversation（preview = execute，无二次选择窗）。
  const registerTarget = useLcosDropStore((state) => state.registerTarget);
  const unregisterTarget = useLcosDropStore((state) => state.unregisterTarget);
  useEffect(() => {
    if (projectId === null || conversationId === null || bodyRef.current === null) return;
    const targetId = `glyth:${input.nodeId}`;
    const target: Omit<DropTargetRegistration, 'rect'> = {
      targetId,
      kind: 'collaboration-reference',
      label: `会话引用 · ${title}`,
      priority: 20,
      enabled: projection !== undefined,
      ...(projection === undefined ? { ineligibleReason: '该会话尚未完成状态读取，暂不可接收引用' } : {}),
      semantic: { kind: 'collaboration-reference', conversationId },
    };
    const publish = (): void => {
      const body = bodyRef.current;
      if (body === null) return;
      registerTarget({ ...target, rect: rectFromDomRect(body.getBoundingClientRect()) });
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
  }, [projectId, conversationId, title, input.nodeId, projection !== undefined, registerTarget, unregisterTarget]);

  return (
    <div
      ref={bodyRef}
      data-lcos-species-body
      data-lcos-species="glyth"
      data-lcos-glyth-body
      data-lcos-glyth-shape="blob"
      data-lcos-glyth-tone="ink"
      data-lcos-glyth-pose={pose}
      data-lcos-glyth-attention={attention ? 'needs_user' : undefined}
      data-lcos-glyth-user-state={projection?.userState}
      data-lcos-density={density}
      data-figma-node-id="5388:118"
      onDoubleClick={(event) => {
        event.stopPropagation();
        openWorkView();
      }}
      onKeyDown={(event) => {
        if (event.key === 'Enter') {
          event.stopPropagation();
          openWorkView();
        }
      }}
      role="button"
      tabIndex={0}
      aria-label={`${title} · ${pose}${attention ? ' · 等你回应' : ''} · 双击打开会话窗口`}
      className="relative h-full w-full overflow-visible"
      style={{ background: 'transparent', border: 0, boxShadow: 'none' }}
    >
      <svg
        data-lcos-glyth-vector
        data-figma-node-id="5388:119"
        viewBox={GLYTH_VIEW_BOX}
        width={size}
        height={size}
        preserveAspectRatio="xMidYMid meet"
        aria-hidden
        style={{
          position: 'absolute',
          left,
          top,
          display: 'block',
          overflow: 'visible',
          color: lcosTokens.color.text,
        }}
      >
        <g transform={bodyPoseTransform(pose)}>
          <path d={GLYTH_SHAPE_PATHS.blob} fill="currentColor" />
          <g data-lcos-glyth-eyes fill={lcosTokens.color.textOnInverse}>
            <path d={GLYTH_IDLE_EYE_PATHS[0]} />
            <path d={GLYTH_IDLE_EYE_PATHS[1]} />
          </g>
        </g>
      </svg>
      {!isMark && (
        <span
          data-lcos-glyth-label
          className="truncate"
          style={{
            position: 'absolute',
            left: 20,
            top: 108,
            width: 88,
            color: lcosTokens.color.muted,
            fontFamily: "'DM Sans', sans-serif",
            fontSize: 11,
            lineHeight: '18px',
            fontWeight: 400,
          }}
        >
          {title}
        </span>
      )}
    </div>
  );
}
