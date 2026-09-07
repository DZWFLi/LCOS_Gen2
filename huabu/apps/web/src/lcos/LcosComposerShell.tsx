// Compact Composer shell (Phase A04, reshaped by user ruling 2026-09-02) —
// the visible home of the composer draft: the ordered Reference chips and
// the prompt input live in ONE compact bottom-center card, per the frozen
// F-COMPOSER shape (references are part of the composer, not a free-floating
// canvas strip).
//
// Phase A scope: chips (pick-ordered, per-chip removal) + a real single-line
// prompt input (no submit logic yet — the full composer state machine,
// receiver, and voice land with C06, which takes over this shell). The shell
// hides entirely when the draft is empty AND the input is unfocused
// (no Christmas tree).

import { overlayZ } from '@local-creative-os/web-gen2';
import React, { useState } from 'react';

import { useLcosReferenceStore } from './lcosReferenceState';

import type { CoreEntityRefLike } from './referenceBridge';

const ACCENT = '#2e90ff';

export const LcosComposerShell: React.FC = () => {
  const orderedEntityRefs = useLcosReferenceStore(
    (state) => state.draft.orderedEntityRefs,
  );
  const nodeEntityRefs = useLcosReferenceStore(
    (state) => state.nodeEntityRefs,
  );
  const [prompt, setPrompt] = useState('');
  const [focused, setFocused] = useState(false);

  const hasChips = orderedEntityRefs.length > 0;
  if (!hasChips && !focused && prompt === '') return null;

  const labelOf = (ref: CoreEntityRefLike, index: number): string => {
    for (const [, entityRef] of nodeEntityRefs) {
      if (
        entityRef.entityType === ref.entityType &&
        entityRef.entityId === ref.entityId
      ) {
        return `${entityLabel(entityRef)}  #${index + 1}`;
      }
    }
    return `${ref.entityType} · ${shortId(ref.entityId)}  #${index + 1}`;
  };

  return (
    /* eslint-disable-next-line jsx-a11y/no-static-element-interactions */
    <div
      data-lcos-composer=""
      style={{
        position: 'absolute',
        bottom: 56,
        left: '50%',
        transform: 'translateX(-50%)',
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
        padding: '8px 10px',
        borderRadius: 12,
        background: 'rgba(255, 255, 255, 0.95)',
        border: `1px solid ${ACCENT}44`,
        boxShadow: '0 4px 16px rgba(0,0,0,0.10)',
        pointerEvents: 'auto',
        zIndex: overlayZ('composer'),
        width: 360,
        maxWidth: '80vw',
        boxSizing: 'border-box',
      }}
      onMouseDown={(e) => e.stopPropagation()}
    >
      {hasChips && (
        <div
          data-lcos-reference-strip=""
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            flexWrap: 'wrap',
          }}
        >
          <span
            style={{
              fontSize: 11,
              fontWeight: 600,
              color: '#1e40af',
              whiteSpace: 'nowrap',
            }}
          >
            {`引用 (${orderedEntityRefs.length})`}
          </span>
          {orderedEntityRefs.map((ref, index) => (
            <ReferenceChip
              key={`${ref.entityType}:${ref.entityId}`}
              label={labelOf(ref, index)}
              onRemove={() => removeRef(ref)}
            />
          ))}
        </div>
      )}
      <input
        data-lcos-composer-input=""
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        placeholder={
          hasChips
            ? '输入指令，引用已就绪…'
            : '输入指令，或按住 Ctrl 点击对象加入引用…'
        }
        style={{
          width: '100%',
          boxSizing: 'border-box',
          border: 'none',
          outline: 'none',
          fontSize: 13,
          color: '#191919',
          background: 'transparent',
          padding: '2px 0',
        }}
      />
    </div>
  );
};

function removeRef(ref: CoreEntityRefLike): void {
  useLcosReferenceStore.setState((state) => ({
    draft: {
      ...state.draft,
      orderedEntityRefs: state.draft.orderedEntityRefs.filter(
        (x) =>
          !(x.entityType === ref.entityType && x.entityId === ref.entityId),
      ),
    },
  }));
}

function entityLabel(ref: CoreEntityRefLike): string {
  return ref.entityType === 'artifact' ? 'Artifact' : ref.entityType;
}

function shortId(id: string): string {
  return id.length > 8 ? `${id.slice(0, 8)}…` : id;
}

const ReferenceChip: React.FC<{ label: string; onRemove: () => void }> = ({
  label,
  onRemove,
}) => (
  <span
    style={{
      display: 'inline-flex',
      alignItems: 'center',
      gap: 4,
      fontSize: 11,
      color: '#1e40af',
      background: 'rgba(46, 144, 255, 0.10)',
      border: '1px solid rgba(46, 144, 255, 0.25)',
      borderRadius: 8,
      padding: '2px 6px',
      whiteSpace: 'nowrap',
    }}
  >
    {label}
    <button
      type="button"
      aria-label={`移除引用 ${label}`}
      onClick={onRemove}
      style={{
        all: 'unset',
        cursor: 'pointer',
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: 14,
        height: 14,
        borderRadius: 999,
        color: '#5b7bb8',
        fontSize: 12,
        lineHeight: 1,
      }}
      onMouseEnter={(e) => {
        (e.currentTarget as HTMLButtonElement).style.background =
          'rgba(46,144,255,0.18)';
      }}
      onMouseLeave={(e) => {
        (e.currentTarget as HTMLButtonElement).style.background = 'transparent';
      }}
    >
      ×
    </button>
  </span>
);
