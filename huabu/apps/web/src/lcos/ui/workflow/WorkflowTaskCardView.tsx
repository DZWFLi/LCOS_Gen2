import { ArrowUpRight, Paperclip, X } from 'lucide-react';
import { motion, useReducedMotion } from 'motion/react';
import { useRef } from 'react';


import { WorkflowTaskCardFace, workflowTaskSecondary } from './WorkflowTaskCardFace';
import { PRESENTATION_EXIT, PRESENTATION_SPRING, presentationPose } from '../spatial/presentationMotion';
import { useDescendantFocus } from '../spatial/useDescendantFocus';

import type { WorkflowTaskCardFaceProps } from './WorkflowTaskCardFace';
import type { ReactNode } from 'react';
import './workflow-hand.css';

export type { WorkflowTaskCardVisualState } from './WorkflowTaskCardFace';

export interface WorkflowTaskCardViewProps extends WorkflowTaskCardFaceProps {
  readonly draggable?: boolean;
  readonly onDragStartCapture?: React.DragEventHandler<HTMLElement>;
  readonly onDragEndCapture?: React.DragEventHandler<HTMLElement>;
  /** Single pointer activation only changes local preview presentation. */
  readonly onPreview?: () => void;
  readonly onClosePreview?: () => void;
  /** Double click / Enter delegates navigation to the canonical target owner. */
  readonly onEnter?: () => void;
  readonly entryHint?: string;
  /** Exact workspace selected by the existing target resolver. */
  readonly entryTargetLabel?: string;
  /** Honest target state; onEnter may still exist to surface a fail-close reason. */
  readonly entryAvailable?: boolean;
  /** Draft membership is projected from the existing Composer reference owner. */
  readonly alreadyInDraft?: boolean;
  /** Existing target owner supplies explicit choices for multiple real workspaces. */
  readonly entryControl?: ReactNode;
  /** Read-only facts from the existing Warehouse projection; absent facts stay absent. */
  readonly previewFacts?: readonly string[];
  /** Transitional selector for the current production/e2e contract. */
  readonly legacyWorkflowKind?: string;
}

export function WorkflowTaskCardView({
  title,
  summary,
  previewUrl,
  state,
  onUse,
  onPreview,
  onClosePreview,
  draggable = false,
  onDragStartCapture,
  onDragEndCapture,
  onEnter,
  entryHint,
  entryTargetLabel,
  entryAvailable = false,
  alreadyInDraft = false,
  entryControl,
  previewFacts = [],
  disabledReason,
  dataSource,
  dataEntity,
  legacyWorkflowKind,
}: WorkflowTaskCardViewProps): React.JSX.Element {
  const card = useRef<HTMLElement>(null);
  const closePreview = (): void => {
    onClosePreview?.();
    card.current?.focus({ preventScroll: true });
  };
  const reducedMotion = Boolean(useReducedMotion());
  const focus = useDescendantFocus();
  const disabled = state === '不可用';
  const previewAllowed = onPreview !== undefined && !disabled;
  const enterAllowed = onEnter !== undefined && !disabled;
  const useAllowed = onUse !== undefined && !disabled && !alreadyInDraft;
  const secondary = workflowTaskSecondary({title, state, ...(summary === undefined ? {} : {summary}), ...(disabledReason === undefined ? {} : {disabledReason})});
  return (
    <div className="lcos-workflow-task-slot" data-card-state={state} onFocusCapture={focus.onFocusCapture} onBlurCapture={focus.onBlurCapture}>
      <motion.article
        ref={card}
        data-lcos-family="task-card"
        data-lcos-variant={state}
        {...(legacyWorkflowKind === undefined ? {} : { 'data-lcos-workflow-card': legacyWorkflowKind })}
        data-lcos-workflow-task-card
        data-state={state}
        data-preview={state === '预览' ? 'true' : undefined}
        data-entry-available={entryAvailable ? 'true' : 'false'}
        className="lcos-workflow-task-card"
        draggable={draggable}
        onDragStartCapture={onDragStartCapture}
        onDragEndCapture={onDragEndCapture}
        tabIndex={disabled ? -1 : 0}
        role="group"
        aria-roledescription="工作流任务卡"
        aria-disabled={disabled || undefined}
        aria-label={`${title} · ${secondary}${entryHint ? ` · ${entryHint}` : ''}`}
        onClick={(event) => {
          if (!previewAllowed) return;
          const target = event.target;
          if (target instanceof Element && target.closest('button,a,input,select,textarea')) return;
          onPreview();
        }}
        onDoubleClick={(event) => {
          if (!enterAllowed) return;
          const target = event.target;
          if (target instanceof Element && target.closest('button,a,input,select,textarea')) return;
          event.preventDefault();
          onEnter();
        }}
        onKeyDown={(event) => {
          if (event.key === 'Escape' && state === '预览' && onClosePreview) { event.preventDefault(); event.stopPropagation(); closePreview(); return; }
          if (event.target !== event.currentTarget || disabled) return;
          if (event.key === 'Enter' && enterAllowed) {
            event.preventDefault();
            onEnter();
          } else if (event.key === ' ' && previewAllowed) {
            event.preventDefault();
            onPreview();
          }
        }}
        initial={reducedMotion ? false : { opacity: 0, y: 112, scale: 0.82 }}
        animate={presentationPose(reducedMotion, focus.focused || state === '键盘焦点', disabled)}
        exit={{ opacity: 0, y: reducedMotion ? 0 : 42, scale: reducedMotion ? 1 : 0.8, transition: reducedMotion ? { duration: 0 } : PRESENTATION_EXIT }}
        whileHover={reducedMotion || disabled ? undefined : { y: -8, scale: 1.025 }}
        transition={reducedMotion ? { duration: 0 } : PRESENTATION_SPRING}
      >
        <WorkflowTaskCardFace {...{title, state}}
          {...(summary === undefined ? {} : {summary})}
          {...(previewUrl === undefined ? {} : {previewUrl})}
          {...(!useAllowed || state === '预览' ? {} : {onUse})}
          {...(disabledReason === undefined ? {} : {disabledReason})}
          {...(dataSource === undefined ? {} : {dataSource})}
          {...(dataEntity === undefined ? {} : {dataEntity})} />
        {state === '预览' && <div className="lcos-workflow-card-preview" role="group" aria-label={`${title} · 预览操作`}>
          <button type="button" className="lcos-workflow-preview-close" aria-label="返回手牌" onClick={closePreview}><X size={16} aria-hidden /></button>
          <strong className="lcos-workflow-preview-title">{title}</strong>
          <span>{summary ?? '这张卡用于进入工作流现场。需要在输入框使用方法时，请选择已有的方法文件。'}</span>
          {previewFacts.map((fact) => <span key={fact}>{fact}</span>)}
          {useAllowed && <button type="button" onClick={(event) => {
            const rect = event.currentTarget.getBoundingClientRect();
            onUse?.({ x: rect.x, y: rect.y, width: rect.width, height: rect.height });
          }}><Paperclip size={16} aria-hidden />加入当前草稿</button>}
          {entryControl ?? <button type="button" onClick={onEnter} disabled={!entryAvailable}
            title={entryTargetLabel ? `进入工作流现场：${entryTargetLabel}` : entryHint}>
            <ArrowUpRight size={16} aria-hidden />
            <span className="lcos-workflow-entry-label">{entryTargetLabel ? `进入「${entryTargetLabel}」` : '打开工作流现场'}</span>
          </button>}
        </div>}
      </motion.article>
    </div>
  );
}
