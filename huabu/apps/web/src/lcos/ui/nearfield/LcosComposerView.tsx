import { useCallback, useLayoutEffect, useRef } from 'react';

import { ComposerReferenceStrip } from './ComposerReferenceStrip';
import { fitComposerTextarea } from './fitComposerTextarea';
import { LcosNearfieldGlyph } from './LcosNearfieldGlyph';
import { LcosIconButton } from '../primitives/LcosIconButton';
import './nearfield.css';

import type { LcosComposerViewProps } from './composerViewTypes';
import type { JSX } from 'react';

/**
 * Figma 5388:324 + 5280:669. Controlled View, no stores, async calls or synthetic
 * progress. The reference/input surface exposes geometry to the existing drop registry.
 */
export function LcosComposerView(props: LcosComposerViewProps): JSX.Element {
  const editorRef = useRef<HTMLTextAreaElement | null>(null);
  const setEditorRef = useCallback((editor: HTMLTextAreaElement | null) => {
    editorRef.current = editor;
    const externalRef = props.textareaRef;
    if (typeof externalRef === 'function') return externalRef(editor);
    if (externalRef !== undefined && externalRef !== null) externalRef.current = editor;
  }, [props.textareaRef]);
  useLayoutEffect(() => {
    const editor = editorRef.current;
    if (editor !== null) fitComposerTextarea(editor);
  }, [props.text, props.presentation]);
  useLayoutEffect(() => {
    const editor = editorRef.current;
    if (editor === null || typeof ResizeObserver !== 'function') return;
    // Only inline-size changes trigger a refit, not the height this function just changed.
    let width = editor.clientWidth;
    const observer = new ResizeObserver(() => {
      if (editor.clientWidth === width) return;
      width = editor.clientWidth;
      fitComposerTextarea(editor);
    });
    observer.observe(editor);
    return () => observer.disconnect();
  }, []);

  const busy = props.state === 'resolving'
    || props.state === 'sending' || props.state === 'reconciling';
  const emptyReferenceLabel = props.attachAction !== undefined && !props.attachAction.disabled
    ? '拖入材料，或点击 + 添加' : '拖入材料以添加';
  return (
    <div
      className="lcos-composer-view"
      data-lcos-composer
      data-lcos-composer-target={props.targetId}
      data-presentation={props.presentation}
      data-ui-state={props.state}
      data-figma-node-id={props.presentation === 'nearfield' ? '5388:324' : '5280:669'}
      aria-busy={busy}
    >
      <div className="lcos-composer-heading">
        {props.identity !== undefined && (
          <span className="lcos-composer-identity" aria-hidden="true">{props.identity}</span>
        )}
        <div className="lcos-composer-heading-copy">
          <span className="lcos-composer-context-label" data-lcos-composer-context-label>{props.contextLabel}</span>
          {props.receiverAction ? (
            <LcosIconButton
              type="button"
              className="lcos-composer-receiver"
              disabled={props.receiverAction.disabled}
              title={props.receiverAction.disabledReason ?? props.receiverAction.label}
              onClick={props.receiverAction.onClick}
            >
              {props.title}
            </LcosIconButton>
          ) : <span className="lcos-composer-title" title={props.title}>{props.title}</span>}
        </div>
        <LcosIconButton
          type="button"
          className="lcos-composer-close"
          aria-label="关闭 Composer"
          title="关闭（草稿保留）"
          onClick={props.onClose}
        >
          <LcosNearfieldGlyph name="close" size={14} />
        </LcosIconButton>
      </div>

      <div ref={props.referenceSurfaceRef} className="lcos-composer-reference-surface"
        data-lcos-composer-reference-surface data-drop-active={props.referenceDropActive || undefined}>
        <div className="lcos-composer-reference-heading" data-lcos-composer-reference-heading>
          <span>本次引用</span>
          {props.references.length > 0 && <span className="lcos-composer-reference-count">{props.references.length}</span>}
        </div>
        <ComposerReferenceStrip items={props.references} emptyLabel={props.referenceDropActive ? emptyReferenceLabel : undefined} />

        <div className="lcos-composer-editor">
          <textarea
            ref={setEditorRef}
            data-lcos-composer-input
            value={props.text}
            onChange={props.onTextChange}
            onSelect={props.onSelect}
            onKeyDown={props.onKeyDown}
            readOnly={props.readOnly}
            rows={3}
            placeholder={props.placeholder ?? '想一起完成什么？'}
            aria-label="Composer 输入"
          />
          <div className="lcos-composer-tools">
            <div className="lcos-composer-tools-start">
              {props.attachAction && (
                <LcosIconButton type="button" appearance="oreo" variant="secondary" className="lcos-composer-tool-hit"
                  disabled={props.attachAction.disabled}
                  title={props.attachAction.disabledReason ?? props.attachAction.label}
                  aria-label={props.attachAction.label}
                  aria-pressed={props.attachAction.pressed}
                  onClick={props.attachAction.onClick}>
                  {props.attachAction.icon ?? <LcosNearfieldGlyph name="attach" />}
                </LcosIconButton>
              )}
              {props.referencePicker}
              {props.referencePicker === undefined && props.referencePickAction && (
                <LcosIconButton type="button" appearance="oreo" variant="secondary" className="lcos-composer-tool-hit"
                  disabled={props.referencePickAction.disabled}
                  title={props.referencePickAction.disabledReason ?? props.referencePickAction.label}
                  aria-label={props.referencePickAction.label}
                  onClick={props.referencePickAction.onClick}>
                  <LcosNearfieldGlyph name="at" />
                </LcosIconButton>
              )}
            </div>
            <LcosIconButton
              type="button"
              appearance="oreo"
              variant="primary"
              className="lcos-composer-tool-hit lcos-composer-submit"
              disabled={!props.canSubmit}
              aria-label="提交"
              title={props.submitTitle}
              onClick={props.onSubmit}
            >
              <LcosNearfieldGlyph name="send" />
            </LcosIconButton>
          </div>
        </div>
      </div>
      {props.continuationControls !== undefined && <div className="lcos-composer-options">{props.continuationControls}</div>}
      {(props.feedback !== null && props.feedback !== undefined ||
        props.feedbackAction !== undefined) && (
        <div className="lcos-composer-feedback" aria-live="polite">
          {props.feedback}
          {props.feedbackAction && (
            <LcosIconButton type="button" appearance="oreo" variant="secondary" className="lcos-composer-recovery-action"
              aria-label={props.feedbackAction.label}
              disabled={props.feedbackAction.disabled}
              title={props.feedbackAction.disabledReason ?? props.feedbackAction.label}
              onClick={props.feedbackAction.onClick}>
              {props.feedbackAction.label}
            </LcosIconButton>
          )}
        </div>
      )}
    </div>
  );
}
