import { Image as ImageIcon } from 'lucide-react';

import { FIGMA_SOURCE_GEOMETRY, FIGMA_SOURCE_NODE_IDS } from './sourceFigmaGeometry';
import { SourceMarker } from './SourceMarker';
import { lcosTokens } from '../../ui/lcosTokens';

import type { SourceMorphologyProps } from './sourceTypes';
import type { JSX } from 'react';

export function ImageSourceMorphology(props: SourceMorphologyProps): JSX.Element {
  const compact =
    (props.worldWidth ?? FIGMA_SOURCE_GEOMETRY.image.width) <= 240;
  const markerSize = compact ? 9 : 11;
  const mediaRadius = compact
    ? FIGMA_SOURCE_GEOMETRY.imageThumbnail.radius
    : FIGMA_SOURCE_GEOMETRY.image.radius;

  return (
    <div
      data-lcos-source-visual="image"
      data-figma-node-id={
        compact
          ? FIGMA_SOURCE_NODE_IDS.imageThumbnail
          : FIGMA_SOURCE_NODE_IDS.image
      }
      className="relative h-full w-full overflow-visible"
    >
      <div
        data-lcos-source-media
        className="absolute inset-0 overflow-hidden"
        style={{
          borderRadius: mediaRadius,
          background: lcosTokens.color.elevated,
          boxShadow: compact
            ? lcosTokens.color.mainImageShadowSmall
            : lcosTokens.color.mainImageShadow,
        }}
      >
        {props.mediaSrc ? (
          <img
            src={props.mediaSrc}
            alt={props.title}
            className="pointer-events-none h-full w-full border-0 object-cover"
          />
        ) : (
          <div
            className="flex h-full w-full items-center justify-center"
            style={{ color: lcosTokens.color.muted }}
          >
            <ImageIcon size={28} strokeWidth={1.5} aria-hidden />
          </div>
        )}
      </div>
      <SourceMarker
        size={markerSize}
        tone={compact ? 'green' : 'amber'}
        right={compact ? 0 : -3}
        top={compact ? -4 : -5}
      />
      {props.density !== 'mark' && (
        <span
          className="line-clamp-1"
          style={{
            position: 'absolute',
            left: 0,
            top: compact
              ? FIGMA_SOURCE_GEOMETRY.imageThumbnail.captionTop
              : FIGMA_SOURCE_GEOMETRY.image.captionTop,
            width: '100%',
            color: lcosTokens.color.muted,
            fontSize: 12,
            lineHeight: '19px',
          }}
        >
          {props.title}
          {props.secondary ? ` · ${props.secondary}` : ''}
        </span>
      )}
    </div>
  );
}
