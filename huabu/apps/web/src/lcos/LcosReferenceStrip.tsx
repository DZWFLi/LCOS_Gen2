// Reference Strip (Phase A04) — the visible face of the composer draft's
// ordered references. Rendered as a canvas-level host overlay (bottom-center
// pill row) so it follows the "Composer references are explicit and ordered"
// rule: entries appear in pick order, each removable with one click, and the
// strip hides completely when the draft is empty (no Christmas tree).
//
// Phase A scope: read-only presentation + per-item removal. The full
// Composer (prompt/receiver/target) lands with C06; this strip is the A04
// "GUI consumer" of the reference controller.

import React from 'react';

import { useLcosReferenceStore } from './lcosReferenceState';
import type { CoreEntityRefLike } from './referenceBridge';

const ACCENT = '#2e90ff';

export const LcosReferenceStrip: React.FC = () => {
  // Stable slice selectors only: orderedNodeReferences() allocates a fresh
  // array per call, which makes zustand's shallow equality see a change on
  // every store notification and loops React into "Maximum update depth
  // exceeded". Subscribe to the raw draft slice instead and derive display
  // data in the render body.
  const orderedEntityRefs = useLcosReferenceStore(
    (state) => state.draft.orderedEntityRefs,
  );
  const nodeEntityRefs = useLcosReferenceStore(
    (state) => state.nodeEntityRefs,
  );

  if (orderedEntityRefs.length === 0) return null;

  // Resolve labels from the FIRST node carrying this entity; fall back to the
  // id-based label when the projection is gone (entity deleted from canvas
  // but still in the draft until removed).
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
    <div
      data-lcos-reference-strip=""
      style={{
        position: 'absolute',
        bottom: 56,
        left: '50%',
        transform: 'translateX(-50%)',
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        padding: '6px 10px',
        borderRadius: 999,
        background: 'rgba(255, 255, 255, 0.92)',
        border: `1px solid ${ACCENT}44`,
        boxShadow: '0 4px 16px rgba(0,0,0,0.10)',
        pointerEvents: 'auto',
        zIndex: 40,
        maxWidth: '80vw',
        overflow: 'hidden',
      }}
    >
      <span
        style={{
          fontSize: 11,
          fontWeight: 600,
          color: '#1e40af',
          whiteSpace: 'nowrap',
          paddingRight: 4,
        }}
      >
        References ({orderedEntityRefs.length})
      </span>
      {orderedEntityRefs.map((ref, index) => (
        <ReferenceChip
          key={`${ref.entityType}:${ref.entityId}`}
          label={labelOf(ref, index)}
          onRemove={() => removeRef(ref)}
        />
      ))}
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
      aria-label={`Remove reference ${label}`}
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
