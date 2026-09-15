import { FIGMA_SOURCE_GEOMETRY, FIGMA_SOURCE_NODE_IDS } from './sourceFigmaGeometry';
import { SourceMarker } from './SourceMarker';
import { lcosTokens } from '../../ui/lcosTokens';

import type { SourceMorphologyProps } from './sourceTypes';
import type { JSX } from 'react';

export function TextSourceMorphology(props: SourceMorphologyProps): JSX.Element {
  const isMark = props.density === 'mark';
  const statement = props.preview?.trim() || props.title;
  const exactTypography =
    props.density === 'summary' ||
    props.density === 'working' ||
    props.density === 'reading';

  return (
    <div
      data-lcos-source-visual="text"
      data-figma-node-id={FIGMA_SOURCE_NODE_IDS.text}
      className="relative h-full w-full overflow-visible"
    >
      <span
        data-lcos-node-preview
        className={isMark ? 'line-clamp-1' : 'line-clamp-2'}
        style={{
          position: 'absolute',
          left: 0,
          top: 0,
          width: '100%',
          color: lcosTokens.color.text,
          fontSize: exactTypography ? 37 : 14,
          lineHeight: exactTypography ? '58px' : '20px',
          fontWeight: 500,
          letterSpacing: '-0.02em',
          whiteSpace: 'pre-line',
        }}
      >
        {statement}
      </span>
      {!isMark && (
        <span
          style={{
            position: 'absolute',
            left: 0,
            top: FIGMA_SOURCE_GEOMETRY.text.captionTop,
            width: '100%',
            color: lcosTokens.color.muted,
            fontSize: 12,
            lineHeight: '19px',
          }}
        >
          {props.secondary || props.title}
        </span>
      )}
      <SourceMarker size={11} tone="green" right={0} top={3} />
    </div>
  );
}
