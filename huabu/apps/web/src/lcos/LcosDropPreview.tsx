// LcosDropPreview — canvas-level drop preview (Phase A06 visible layer).
//
// Reads the Semantic Drop machine state from LcosDropStore. Once a dwell
// resolves into a preview it renders a non-interactive affordance at the
// destination that states what WILL happen (F-ROOT-11: never a second taxonomy
// picker). pointer-events:none so it never fights the dropping gesture.
//
// It renders nothing until a preview exists — no Santa-tree chrome on idle.

import { overlayZ } from '@local-creative-os/web-gen2';
import React from 'react';

import { useLcosDropStore } from './lcosDropState';

import type { DropPayload } from '@local-creative-os/web-gen2';


const ACCENT = '#2e90ff';

function payloadAction(payload: DropPayload): string {
  switch (payload.kind) {
    case 'object':
      return `放置 ${payload.entityType}·${shortId(payload.entityId)}`;
    case 'file':
      return `导入文件 ${payload.name}`;
    case 'text':
      return '落位文本片段';
    case 'url':
      return '落位链接';
    case 'assembly':
      return `组装 ${shortId(payload.itemId)}`;
  }
}

function shortId(id: string): string {
  return id.length > 12 ? `${id.slice(0, 12)}…` : id;
}

export const LcosDropPreview: React.FC = () => {
  const state = useLcosDropStore((s) => s.state);
  const resolution = useLcosDropStore((s) => s.resolution);
  const targets = useLcosDropStore((s) => s.targets);
  if (state.status !== 'preview') return null;

  const { destination, payload } = state;
  const target = targets().find((item) => item.targetId === destination.targetId);
  const targetLabel = target?.label ?? destination.targetId;
  const ineligible = resolution?.status === 'ineligible';

  return (
    <div
      data-lcos-drop-preview=""
      style={{
        position: 'absolute',
        left: destination.previewPoint.x,
        top: destination.previewPoint.y,
        transform: 'translate(-50%, -50%)',
        padding: '6px 10px',
        borderRadius: 8,
        background: ineligible ? 'rgba(158, 73, 62, 0.92)' : ACCENT,
        color: '#fff',
        fontSize: 12,
        fontWeight: 600,
        boxShadow: '0 4px 14px rgba(0,0,0,0.18)',
        pointerEvents: 'none',
        whiteSpace: 'nowrap',
        zIndex: overlayZ('drop-preview'),
      }}
    >
      {ineligible
        ? `暂不可放置 · ${resolution.reason}`
        : `${payloadAction(payload)} → ${targetLabel}`}
    </div>
  );
};
