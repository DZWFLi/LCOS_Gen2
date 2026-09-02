// LcosDropPreview — canvas-level drop preview (Phase A06 visible layer).
//
// Reads the Semantic Drop machine state from LcosDropStore. Once a dwell
// resolves into a preview it renders a non-interactive affordance at the
// destination that states what WILL happen (F-ROOT-11: never a second taxonomy
// picker). pointer-events:none so it never fights the dropping gesture.
//
// It renders nothing until a preview exists — no Santa-tree chrome on idle.

import React from 'react';

import type { DropPayload } from '@local-creative-os/web-gen2';

import { useLcosDropStore } from './lcosDropState';

const ACCENT = '#2e90ff';

const SURFACE_LABEL: Record<string, string> = {
  'surface:left-dock': '左侧导航坞',
  'surface:bottom-dock': '底部停靠区',
};

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
  if (state.status !== 'preview') return null;

  const { destination, payload } = state;
  const label = SURFACE_LABEL[destination.surface] ?? destination.surface;

  return (
    <div
      data-lcos-drop-preview=""
      style={{
        position: 'absolute',
        left: destination.place.x,
        top: destination.place.y,
        transform: 'translate(-50%, -50%)',
        padding: '6px 10px',
        borderRadius: 8,
        background: ACCENT,
        color: '#fff',
        fontSize: 12,
        fontWeight: 600,
        boxShadow: '0 4px 14px rgba(0,0,0,0.18)',
        pointerEvents: 'none',
        whiteSpace: 'nowrap',
        zIndex: 30,
      }}
    >
      {payloadAction(payload)} → {label}
    </div>
  );
};