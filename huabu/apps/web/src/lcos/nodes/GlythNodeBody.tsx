// GlythNodeBody — Conversation/Glyth exact Main anchor.
// Figma visual truth: 5388:118 group 121×142; 5388:119 body 92×92 at x=9/y=0.
// Donor geometry is retained, but production Main stays on the single dark blob
// authorized by current Figma until identity variants are explicitly designed.

import {
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
import { useLcosReferenceStore } from '../lcosReferenceState';
import { useLcosShellStore } from '../shell/lcosShellStore';
import { lcosTokens } from '../ui/lcosTokens';

import type { CanvasNodeBodySlotInput } from '@/lcos-seam/types';
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
  const density = useLcosDensity();
  const presentation = useLcosNodePresentation();
  const ref = useLcosReferenceStore((state) => state.nodeEntityRefs.get(input.nodeId));
  const title = titleOf(input.data as Readonly<Record<string, unknown>>);
  const pose = resolveGlythPresentation({
    ...(ref?.descriptor?.active === undefined ? {} : { active: ref.descriptor.active }),
    ...(ref?.descriptor?.waiting === undefined ? {} : { waiting: ref.descriptor.waiting }),
    ...(presentation?.phase === undefined ? {} : { phase: presentation.phase }),
  });
  const isMark = density === 'mark';
  const size = isMark ? 34 : 92;
  const left = isMark ? (121 - size) / 2 : 9;
  const top = isMark ? 16 : 0;

  const openWorkView = (): void => {
    if (!ref || ref.entityType !== 'conversation') return;
    useLcosShellStore.getState().openWindow('conversation', `工作台 · ${title}`, ref.entityId);
  };

  return (
    <div
      data-lcos-species-body
      data-lcos-species="glyth"
      data-lcos-glyth-body
      data-lcos-glyth-shape="blob"
      data-lcos-glyth-tone="ink"
      data-lcos-glyth-pose={pose}
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
      aria-label={`${title} · ${pose} · 双击打开会话工作台`}
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
