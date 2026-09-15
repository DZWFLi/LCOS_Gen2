import { FileText, Film, Link2 } from 'lucide-react';

import { AudioSourceMorphology } from './AudioSourceMorphology';
import { DocumentSourceMorphology } from './DocumentSourceMorphology';
import { ImageSourceMorphology } from './ImageSourceMorphology';
import { TextSourceMorphology } from './TextSourceMorphology';
import { lcosTokens } from '../../ui/lcosTokens';

import type { SourceMorphologyProps } from './sourceTypes';
import type { JSX } from 'react';

function GenericSourceMorphology(props: SourceMorphologyProps): JSX.Element {
  const icon =
    props.family === 'web' ? (
      <Link2 className="h-4 w-4" aria-hidden />
    ) : props.family === 'video' ? (
      <Film className="h-4 w-4" aria-hidden />
    ) : (
      <FileText className="h-4 w-4" aria-hidden />
    );
  return (
    <div
      data-lcos-source-visual={props.family}
      className="flex h-full w-full flex-col gap-2 rounded-xl p-3"
      style={{
        background: lcosTokens.color.surface,
        border: `1px solid ${lcosTokens.color.borderSubtle}`,
      }}
    >
      <div className="flex items-center gap-2" style={{ color: lcosTokens.color.muted }}>
        {icon}
        <span className="text-[10px] uppercase tracking-[0.08em]">
          {props.family}
        </span>
      </div>
      <span
        className="line-clamp-2 text-sm font-semibold"
        style={{ color: lcosTokens.color.text }}
      >
        {props.title}
      </span>
      {props.preview && (
        <span
          data-lcos-node-preview
          className="line-clamp-3 text-[11px]"
          style={{ color: lcosTokens.color.muted }}
        >
          {props.preview}
        </span>
      )}
    </div>
  );
}

export function SourceMorphology(props: SourceMorphologyProps): JSX.Element {
  switch (props.family) {
    case 'text':
      return <TextSourceMorphology {...props} />;
    case 'document':
      return <DocumentSourceMorphology {...props} />;
    case 'image':
      return <ImageSourceMorphology {...props} />;
    case 'audio':
      return <AudioSourceMorphology {...props} />;
    default:
      return <GenericSourceMorphology {...props} />;
  }
}
