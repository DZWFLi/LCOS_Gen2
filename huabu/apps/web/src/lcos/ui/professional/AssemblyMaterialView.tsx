import { useState } from 'react';

import { ContextCollectionFace } from '../context/ContextCollectionFace';
import { LcosButton } from '../primitives/LcosButton';
import { WorkflowTaskCardFace } from '../workflow/WorkflowTaskCardFace';
import { Gen1TextDocument } from './donor/Gen1TextDocument';
import './professional-assembly.css';

import type { AssemblyMaterialShape } from './assemblyPresentation';
import type { ContextCollectionOrganization } from '../context/ContextCollectionFace';
import type { ReactNode } from 'react';

export interface AssemblyMaterialViewProps {
  readonly title: string;
  readonly familyLabel: string;
  readonly previewUrl?: string;
  readonly secondaryPreviewUrl?: string;
  readonly fallbackGlyph: ReactNode;
  readonly excerpt?: string;
  readonly feedback?: ReactNode;
  readonly shape?: AssemblyMaterialShape;
  readonly organization?: ContextCollectionOrganization;
  readonly aspectRatio?: number;
  readonly referenced?: boolean;
  readonly onUse?: () => void;
}
/** C01 object bodies reuse the adopted folder and workflow faces, not generic information cards. */
export function AssemblyMaterialView({ title, familyLabel, previewUrl, secondaryPreviewUrl, fallbackGlyph,
  excerpt, feedback, shape = 'file', organization = '未指定', aspectRatio, referenced = false, onUse,
}: AssemblyMaterialViewProps): React.JSX.Element {
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const hasPreview = Boolean(previewUrl) && failedUrl !== previewUrl;
  const ratio = typeof aspectRatio === 'number' && Number.isFinite(aspectRatio) && aspectRatio > 0 ? aspectRatio : shape === 'image' ? 1.5 : undefined;
  return <div data-lcos-assembly-material data-shape={shape} aria-label={`${title} · ${familyLabel}`}
    data-preview-available={hasPreview} className="lcos-assembly-material-view">
    {shape === 'context' ? <div className="lcos-context-collection lcos-assembly-context" data-rendition="装配" data-organization={organization}>
      <ContextCollectionFace title={title} organization={organization} rendition="装配"
        {...(organization === '未指定' ? { memberSummary: familyLabel } : {})}
        {...(previewUrl ? { previewUrl } : {})} {...(secondaryPreviewUrl ? { secondaryPreviewUrl } : {})}
        unspecifiedGlyph={fallbackGlyph} />
    </div> : shape === 'workflow' ? <div className="lcos-workflow-task-card lcos-assembly-workflow" data-state={referenced ? '草稿中' : '静息'}>
      <WorkflowTaskCardFace title={title} summary={familyLabel} state={referenced ? '草稿中' : '静息'}
        {...(previewUrl ? { previewUrl } : {})} {...(onUse ? { onUse } : {})} />
    </div> : <div className={`lcos-assembly-material-body is-${shape}`} style={ratio ? { aspectRatio: ratio } : undefined}>
      {hasPreview ? <img key={`${previewUrl}:${attempt}`} src={previewUrl} alt={title} draggable={false} decoding="async"
        onError={() => setFailedUrl(previewUrl ?? null)} className="lcos-assembly-preview-image" />
        : excerpt !== undefined ? <div className="lcos-assembly-preview-excerpt">{excerpt === '' ? <span className="lcos-assembly-empty-text">空文本</span> : <Gen1TextDocument text={excerpt} />}</div>
          : <div className="lcos-assembly-preview-unavailable">
            <span aria-hidden="true" className="lcos-assembly-material-glyph">{fallbackGlyph}</span>
            <span className="lcos-assembly-preview-reason"><span>{familyLabel}</span>
              <small>{failedUrl === previewUrl && failedUrl !== null ? '预览读取失败' : '尚无缩略预览'}</small></span>
            {failedUrl !== null && failedUrl === previewUrl ? <LcosButton appearance="oreo" variant="ghost" onClick={() => {
              setFailedUrl(null); setAttempt((current) => current + 1);
            }}>重试预览</LcosButton> : null}
          </div>}
    </div>}
    {feedback}
  </div>;
}
