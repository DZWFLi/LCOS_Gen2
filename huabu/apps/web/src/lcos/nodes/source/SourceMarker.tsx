import { lcosTokens } from '../../ui/lcosTokens';

import type { JSX } from 'react';

export function SourceMarker({
  size,
  tone,
  right,
  top,
}: {
  readonly size: number;
  readonly tone: 'amber' | 'green';
  readonly right: number;
  readonly top: number;
}): JSX.Element {
  return (
    <span
      data-lcos-source-corner-marker
      aria-hidden
      style={{
        position: 'absolute',
        right,
        top,
        width: size,
        height: size,
        borderRadius: 3,
        background:
          tone === 'amber'
            ? lcosTokens.color.mainMarkerAmber
            : lcosTokens.color.mainMarkerGreen,
        border: `1.5px solid ${lcosTokens.color.surface}`,
        boxSizing: 'border-box',
        zIndex: 2,
      }}
    />
  );
}
