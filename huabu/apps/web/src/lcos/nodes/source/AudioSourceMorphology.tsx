import { useEffect, useState } from 'react';

import {
  FIGMA_AUDIO_ACTIVE_BAR_COUNT,
  FIGMA_AUDIO_BAR_HEIGHTS,
  FIGMA_AUDIO_USED_WIDTH,
  FIGMA_SOURCE_GEOMETRY,
  FIGMA_SOURCE_NODE_IDS,
} from './sourceFigmaGeometry';
import { lcosTokens } from '../../ui/lcosTokens';

import type { SourceMorphologyProps } from './sourceTypes';
import type { JSX } from 'react';

function formatDuration(seconds: number | undefined): string | undefined {
  if (seconds === undefined || !Number.isFinite(seconds) || seconds <= 0) {
    return undefined;
  }
  const whole = Math.floor(seconds);
  const minutes = Math.floor(whole / 60);
  const rest = whole % 60;
  return `${minutes.toString().padStart(2, '0')}:${rest.toString().padStart(2, '0')}`;
}

export function AudioSourceMorphology(props: SourceMorphologyProps): JSX.Element {
  const [mediaDurationSec, setMediaDurationSec] = useState<number | undefined>(
    props.durationSec,
  );
  useEffect(() => {
    setMediaDurationSec(props.durationSec);
  }, [props.durationSec, props.mediaSrc]);
  const duration = formatDuration(mediaDurationSec);

  return (
    <div
      data-lcos-source-visual="audio"
      data-figma-node-id={FIGMA_SOURCE_NODE_IDS.audio}
      className="relative h-full w-full overflow-visible"
    >
      <div
        data-lcos-waveform="exact"
        aria-hidden
        className="absolute left-0 top-0 flex h-[50px] items-center overflow-visible"
        style={{
          width: FIGMA_AUDIO_USED_WIDTH,
          gap: FIGMA_SOURCE_GEOMETRY.audio.barGap,
        }}
      >
        {FIGMA_AUDIO_BAR_HEIGHTS.map((height, index) => (
          <span
            key={index}
            data-lcos-wave-bar
            style={{
              display: 'block',
              flex: '0 0 2px',
              width: 2,
              height,
              borderRadius: 1,
              background:
                index < FIGMA_AUDIO_ACTIVE_BAR_COUNT
                  ? lcosTokens.color.mainWaveActive
                  : lcosTokens.color.mainWaveTail,
            }}
          />
        ))}
      </div>
      {props.mediaSrc && (
        <audio
          data-lcos-audio-metadata
          src={props.mediaSrc}
          preload="metadata"
          aria-hidden="true"
          className="hidden"
          onLoadedMetadata={(event) => {
            const value = event.currentTarget.duration;
            if (Number.isFinite(value) && value > 0) setMediaDurationSec(value);
          }}
          onDurationChange={(event) => {
            const value = event.currentTarget.duration;
            if (Number.isFinite(value) && value > 0) setMediaDurationSec(value);
          }}
        >
          <track kind="captions" />
        </audio>
      )}
      {props.density !== 'mark' && (
        <span
          className="line-clamp-1"
          style={{
            position: 'absolute',
            left: 0,
            top: FIGMA_SOURCE_GEOMETRY.audio.captionTop,
            width: 220,
            color: lcosTokens.color.muted,
            fontSize: 12,
            lineHeight: '19px',
          }}
        >
          {props.title}
          {duration ? ` · ${duration}` : ''}
        </span>
      )}
    </div>
  );
}
