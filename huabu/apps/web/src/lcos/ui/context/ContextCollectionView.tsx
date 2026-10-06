import { motion, useReducedMotion } from 'motion/react';

import thingIcon from './assets/context-thing.svg';
import { ContextCollectionFace } from './ContextCollectionFace';
import { PRESENTATION_EXIT, PRESENTATION_SPRING, presentationPose } from '../spatial/presentationMotion';
import { useDescendantFocus } from '../spatial/useDescendantFocus';

import type { ContextCollectionFaceProps } from './ContextCollectionFace';
import './context-spatial.css';

export type { ContextCollectionOrganization, ContextCollectionRendition } from './ContextCollectionFace';

export interface ContextCollectionViewProps extends ContextCollectionFaceProps {
  /** Transitional selector for the current production/e2e contract. */
  readonly legacyAtlasKind?: string;
  /** Atlas keyboard/pointer focus, separate from the current worksite identity. */
  readonly selected?: boolean;
  readonly atlasVisualKind?: ContextCollectionFaceProps['atlasVisualKind'];
}

export function ContextCollectionView({
  title,
  sourceLabel,
  memberLabels,
  members,
  onRemoveMember,
  spaceAction,
  memberSummary, primaryPreview, secondaryPreview, memberControls,
  hideEmptyPreviews,
  organization,
  rendition = '总览',
  previewUrl,
  secondaryPreviewUrl,
  previewFit,
  secondaryPreviewFit,
  disabled = false,
  disabledReason,
  active = false,
  folderVisual = false,
  action,
  legacyAtlasKind,
  selected = false,
  atlasVisualKind = 'collection',
  onActivate,
  activationLabel,
}: ContextCollectionViewProps): React.JSX.Element {
  const reducedMotion = Boolean(useReducedMotion());
  const focus = useDescendantFocus();
  return (
    <div
      data-lcos-context-collection-slot
      data-active={active ? 'true' : undefined}
      data-disabled={disabled ? 'true' : undefined}
      data-focused={selected || focus.focused ? 'true' : undefined}
      aria-current={active ? 'location' : undefined}
      aria-disabled={disabled || undefined}
      onFocusCapture={focus.onFocusCapture}
      onBlurCapture={focus.onBlurCapture}
      className="lcos-context-collection-slot"
    >
      <motion.div
        data-lcos-family="collection-surface"
        data-lcos-organize={organization}
        data-lcos-rendition={rendition}
        data-lcos-variant={active ? 'selected' : rendition}
        {...(legacyAtlasKind === undefined ? {} : { 'data-lcos-atlas-card': legacyAtlasKind })}
        data-lcos-context-collection
        data-atlas-kind={atlasVisualKind}
        data-empty-preview-suppressed={hideEmptyPreviews || (!previewUrl && !secondaryPreviewUrl && !primaryPreview && !secondaryPreview) ? 'true' : undefined}
        data-organization={organization}
        data-active={active ? 'true' : undefined}
        data-disabled={disabled ? 'true' : undefined}
        data-rendition={rendition}
        className="lcos-context-collection"
        initial={reducedMotion ? false : { opacity: 0, y: 36, scale: 0.96 }}
        animate={presentationPose(reducedMotion, focus.focused, disabled)}
        exit={{ opacity: 0, y: reducedMotion ? 0 : 36, scale: reducedMotion ? 1 : 0.96, transition: reducedMotion ? { duration: 0 } : PRESENTATION_EXIT }}
        whileHover={reducedMotion || disabled ? undefined : { y: -8, scale: 1.025 }}
        transition={reducedMotion ? { duration: 0 } : PRESENTATION_SPRING}
      >
        <ContextCollectionFace primaryPreview={primaryPreview} secondaryPreview={secondaryPreview} memberControls={memberControls} title={title} active={active} selected={selected} folderVisual={folderVisual} folderFocusWithin={focus.focused} organization={organization} atlasVisualKind={atlasVisualKind} rendition={rendition}
          {...(sourceLabel === undefined ? {} : { sourceLabel })}
          {...(memberLabels === undefined ? {} : { memberLabels })}
          {...(members === undefined ? {} : { members })}
          {...(onRemoveMember === undefined ? {} : { onRemoveMember })}
          {...(spaceAction === undefined ? {} : { spaceAction })}
          {...(memberSummary === undefined ? {} : { memberSummary })}
          {...(hideEmptyPreviews === undefined ? {} : { hideEmptyPreviews })}
          {...(previewUrl === undefined ? {} : { previewUrl })}
          {...(secondaryPreviewUrl === undefined ? {} : { secondaryPreviewUrl })}
          {...(previewFit === undefined ? {} : { previewFit })}
          {...(secondaryPreviewFit === undefined ? {} : { secondaryPreviewFit })}
          disabled={disabled}
          {...(disabledReason === undefined ? {} : { disabledReason })}
          {...(action === undefined ? {} : { action })}
          {...(onActivate === undefined ? {} : { onActivate })}
          {...(activationLabel === undefined ? {} : { activationLabel })}
          unspecifiedGlyph={<img src={thingIcon} alt="" draggable={false} />} />
      </motion.div>
    </div>
  );
}
