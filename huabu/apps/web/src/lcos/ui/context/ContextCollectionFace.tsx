import { Network, PanelsTopLeft } from 'lucide-react';

import { PreviewMedia } from '../spatial/PreviewMedia';
import enterIcon from './assets/collection-enter.svg';
import thingIcon from './assets/context-thing.svg';
import timeIcon from './assets/context-time.svg';
import './context-spatial.css';
import FolderComponent from './RareFolderComponent';

import type { PreviewMediaProps } from '../spatial/PreviewMedia';
import type { ReactNode } from 'react';

export type ContextCollectionOrganization = '事情' | '时间' | '未指定';
export type ContextCollectionRendition = '总览' | '主画布' | '装配';
export type ContextAtlasVisualKind = 'collection' | 'scene' | 'context';

export interface ContextCollectionFaceProps {
  readonly title: string;
  readonly active?: boolean;
  /** Exact entity type from the existing producer, separate from organization semantics. */
  readonly sourceLabel?: string;
  readonly memberLabels?: readonly string[];
  readonly members?: readonly { readonly type: 'artifact' | 'note' | 'collection' | 'scope' | 'workspace' | 'conversation' | 'run'; readonly id: string; readonly label: string }[];
  readonly onRemoveMember?: (memberRef: { readonly type: 'artifact' | 'note' | 'collection' | 'scope' | 'workspace' | 'conversation' | 'run'; readonly id: string }) => Promise<boolean>;
  readonly spaceAction?: ReactNode;
  readonly memberSummary?: string;
  readonly primaryPreview?: ReactNode;
  readonly secondaryPreview?: ReactNode;
  readonly memberControls?: ReactNode;
  readonly hideEmptyPreviews?: boolean;
  readonly organization?: ContextCollectionOrganization;
  /** Canonical Warehouse kind; selects a truthful Atlas silhouette. */
  readonly atlasVisualKind?: ContextAtlasVisualKind;
  readonly rendition?: ContextCollectionRendition;
  readonly previewUrl?: string;
  readonly secondaryPreviewUrl?: string;
  readonly previewFit?: PreviewMediaProps['fit'];
  readonly secondaryPreviewFit?: PreviewMediaProps['fit'];
  readonly disabled?: boolean;
  readonly disabledReason?: string;
  readonly action?: ReactNode;
  /** Atlas's selected card is a toggle state; the existing caller owns selection. */
  readonly selected?: boolean;
  /** Enables the directly adopted Rare UI folder presentation for Atlas only. */
  readonly folderVisual?: boolean;
  readonly folderFocusWithin?: boolean;
  readonly onActivate?: () => void;
  readonly activationLabel?: string;
  /** Supplied by the existing host; not an inferred organization. */
  readonly unspecifiedGlyph?: ReactNode;
}

/** Exact Figma-exported Noto Sans SC arrow glyph; the original text node line box is 20×23. */
export function ContextCollectionActionGlyph(): React.JSX.Element {
  return <img src={enterIcon} width={11} height={11} alt="" draggable={false} />;
}

function AtlasKindEmblem({ kind }: { readonly kind: Exclude<ContextAtlasVisualKind, 'collection'> }): React.JSX.Element {
  return <div className="lcos-context-atlas-emblem" aria-hidden="true" data-atlas-emblem={kind}>
    {kind === 'scene' ? <PanelsTopLeft size={30} strokeWidth={1.35} /> : <Network size={30} strokeWidth={1.35} />}
  </div>;
}

/**
 * Figma-derived face shared by the production Motion host and static visual regression.
 * Identity, membership, activation and attention remain inputs, not a second store.
 */
export function ContextCollectionFace({
  title, active = false, selected = false, folderVisual = false, folderFocusWithin = false, organization, atlasVisualKind = 'collection', rendition = '总览', previewUrl, secondaryPreviewUrl,
  previewFit, secondaryPreviewFit, disabled = false, disabledReason,
  action, onActivate, activationLabel, unspecifiedGlyph, sourceLabel,
  memberLabels,
  memberSummary,
  primaryPreview, secondaryPreview, memberControls,
  spaceAction,
}: ContextCollectionFaceProps): React.JSX.Element {
  const organizationLabel = organization === undefined
    ? undefined
    : organization === '未指定' ? '组织未标注' : `按${organization}组织`;
  const label = memberSummary ?? [sourceLabel, organizationLabel].filter((fact): fact is string => fact !== undefined).join(' · ');
  const primaryCardContent = primaryPreview ?? (previewUrl
    ? <PreviewMedia src={previewUrl} label={`${title} 封面`} {...(previewFit === undefined ? {} : { fit: previewFit })} />
    : undefined);
  const secondaryCardContent = secondaryPreview ?? (secondaryPreviewUrl
    ? <PreviewMedia src={secondaryPreviewUrl} label={`${title} 第二份材料预览`} {...(secondaryPreviewFit === undefined ? {} : { fit: secondaryPreviewFit })} />
    : undefined);
  const hasRealCover = Boolean(primaryCardContent || secondaryCardContent);
  return <>
    {folderVisual ? <FolderComponent
      className="lcos-atlas-folder"
      color="blue"
      size="sm"
      selected={selected}
      open={selected}
      focusWithin={folderFocusWithin}
      onActivate={disabled ? undefined : onActivate}
      activationLabel={activationLabel ?? `选中并预览 · ${title}`}
      cardContents={[primaryCardContent, secondaryCardContent]}
    /> : <>
      {onActivate && !disabled ? <button type="button" className="lcos-context-collection-hit"
        aria-label={activationLabel ?? `进入集合 · ${title}`}
        aria-pressed={selected}
        title={activationLabel ?? `进入集合 · ${title}`} onClick={onActivate} /> : null}
      <div className="lcos-context-collection-back" aria-hidden />
      <div className="lcos-context-collection-tab" aria-hidden />
      {primaryCardContent ? <div className="lcos-context-collection-cover cover-a">{primaryCardContent}</div> : null}
      {secondaryCardContent ? <div className="lcos-context-collection-cover cover-b">{secondaryCardContent}</div> : null}
    </>}
    {!hasRealCover && atlasVisualKind !== 'collection' ? <AtlasKindEmblem kind={atlasVisualKind} /> : null}
    {!folderVisual && <>
      <div className="lcos-context-collection-pocket-base" aria-hidden />
      <div className="lcos-context-collection-pocket" aria-hidden />
    </>}
    {active ? <span className="lcos-context-collection-current">当前现场</span> : null}
    <div className="lcos-context-collection-copy">
      {organization !== undefined ? <span className="lcos-context-collection-icon" aria-hidden>
        {organization === '事情' ? <img src={thingIcon} alt="" draggable={false} />
          : organization === '时间' ? <img src={timeIcon} alt="" draggable={false} />
            : unspecifiedGlyph}
      </span> : null}
      <div><strong title={title}>{title}</strong>{label || disabled ? <span title={disabled ? disabledReason : label}>
        {disabled ? disabledReason ?? '目标当前不可用' : label}
      </span> : null}{memberLabels && memberLabels.length > 0 ? <span data-lcos-collection-member-labels title={memberLabels.join(' · ')}>{memberLabels.slice(0, 3).join(' · ')}</span> : null}
      </div>
    </div>
    {memberControls}
    <div className="lcos-context-collection-action">{!disabled ? action : null}{spaceAction}</div>
    {rendition === '总览' ? <div className="lcos-context-collection-depth" aria-hidden /> : null}
  </>;
}
