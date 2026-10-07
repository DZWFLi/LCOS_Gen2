// GEN1 donor: SpatialMarkerLayer / spatial-marker.css @ LCOS-local-creativeOS 3e99769.
// Thin GEN2 adaptation: morphology only. Geometry, camera and target truth stay with Huabu + locatorGeometry.
import type { CSSProperties } from 'react';

import '../ui/nearfield/spatial-cursor.css';

export interface LcosSpatialCursorMarkProps {
  readonly surface: 'main' | 'context' | 'workflow';
  readonly phase: 'near-edge' | 'edge' | 'arrival';
  readonly angleDeg?: number;
  readonly progress?: number;
  readonly accent?: string;
  readonly badge?: number;
  readonly label?: string;
  readonly labelPlacement?: 'left' | 'right' | 'above' | 'below';
}

type CursorStyle = CSSProperties & {
  '--lcos-spatial-cursor-angle'?: string;
  '--lcos-spatial-cursor-progress'?: number;
  '--lcos-spatial-cursor-accent'?: string;
  '--lcos-spatial-cursor-opacity'?: string;
  '--lcos-spatial-cursor-ray-length'?: string;
};

/**
 * One visual family for world pin → near-edge cue → edge cursor → arrival.
 * It deliberately owns no pointer, target, camera or persistence state.
 */
export function LcosSpatialCursorMark({
  surface,
  phase,
  angleDeg = 0,
  progress = 1,
  accent,
  badge,
  label,
  labelPlacement = 'below',
}: LcosSpatialCursorMarkProps): React.JSX.Element {
  const safeProgress = Math.max(0, Math.min(1, progress));
  const style: CursorStyle = {
    '--lcos-spatial-cursor-angle': `${angleDeg}deg`,
    '--lcos-spatial-cursor-progress': safeProgress,
    '--lcos-spatial-cursor-opacity': `${0.36 + 0.58 * safeProgress}`,
    '--lcos-spatial-cursor-ray-length': `${5 + 8 * safeProgress}px`,
    ...(accent ? { '--lcos-spatial-cursor-accent': accent } : {}),
  };
  return (
    <span
      data-lcos-spatial-cursor
      data-lcos-spatial-cursor-surface={surface}
      data-lcos-spatial-cursor-phase={phase}
      data-lcos-spatial-cursor-label-placement={labelPlacement}
      style={style}
      aria-hidden="true"
    >
      {phase !== 'arrival' && <span data-lcos-spatial-cursor-ray />}
      <span data-lcos-spatial-cursor-glyph />
      {badge !== undefined && badge > 1 && <b data-lcos-spatial-cursor-badge>{badge > 99 ? '99+' : badge}</b>}
      {label && <span data-lcos-spatial-cursor-label>{label}</span>}
    </span>
  );
}
