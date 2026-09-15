import { FIGMA_SOURCE_NODE_IDS } from './sourceFigmaGeometry';
import { lcosTokens } from '../../ui/lcosTokens';

import type { SourceMorphologyProps } from './sourceTypes';
import type { JSX } from 'react';

export function DocumentSourceMorphology(props: SourceMorphologyProps): JSX.Element {
  const isMark = props.density === 'mark';

  return (
    <div
      data-lcos-source-visual="document"
      data-figma-node-id={FIGMA_SOURCE_NODE_IDS.document}
      className="relative h-full w-full overflow-hidden"
      style={{
        borderRadius: 2,
        background: lcosTokens.color.mainPaper,
        boxShadow: lcosTokens.color.mainPaperShadow,
      }}
    >
      <span
        className="line-clamp-1"
        style={{
          position: 'absolute',
          left: 18,
          top: 15,
          width: 186,
          color: lcosTokens.color.text,
          fontSize: isMark ? 13 : 16,
          lineHeight: isMark ? '20px' : '25px',
          fontWeight: 500,
        }}
      >
        {props.title}
      </span>
      {!isMark && props.preview && (
        <span
          data-lcos-node-preview
          className="line-clamp-2"
          style={{
            position: 'absolute',
            left: 18,
            top: 51,
            width: 173,
            color: lcosTokens.color.muted,
            fontSize: 13,
            lineHeight: '21px',
            whiteSpace: 'pre-line',
          }}
        >
          {props.preview}
        </span>
      )}
      {!isMark && (
        <span
          className="line-clamp-1"
          style={{
            position: 'absolute',
            left: 18,
            top: 122,
            width: 178,
            color: lcosTokens.color.muted,
            fontSize: 11,
            lineHeight: '18px',
          }}
        >
          {props.secondary || '文档 · 只读投影'}
        </span>
      )}
    </div>
  );
}
