// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

/**
 * Read-only Milkdown surface for AI message bubbles and collapsed note
 * previews.
 *
 * The editor mounts in plain (light) DOM. All Milkdown / Crepe theme
 * rules are scoped under `.milkdown` (see `milkdown-overrides.css`),
 * so no extra style isolation is required around the preview surface.
 *
 * When `enableBlockDrag` is set, the editor is mounted as editable so
 * Crepe's block handle is available, but all input mutations are
 * suppressed via DOM capture handlers. The `previewMode` option
 * additionally disables the floating Toolbar / LinkTooltip / Table
 * chrome so the surface looks genuinely read-only without resorting
 * to CSS hacks.
 *
 * Multi-block drag is delegated to `attachBlockDragListeners` (shared
 * with `MilkdownEditor`); see `blockDrag.ts` for design notes.
 */

import { useCallback, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';

import { resolveArtifactUrl } from '@/api/artifact';
import { toast } from '@/components/Common/Toast';

import { attachBlockDragListeners } from './blockDrag';
import { createMilkdown, type MilkdownInstance } from './createMilkdown';
import { markdownEquals, normalizeMarkdown } from './markdownUtils';

import type { MilkdownBlockDragEvent } from './types';
export interface MilkdownPreviewProps {
  markdown: string;
  className?: string;
  /** Accessible name for the rendered read-only rich-text surface. */
  ariaLabel?: string;
  /**
   * Canvas id used to resolve artifact-key image `src`s (e.g.
   * `art_abc.png`) into fetchable URLs for the rendered `<img>`. When
   * omitted, image srcs render verbatim.
   */
  canvasId?: string;
  /**
   * Show Crepe's block drag handle and call `onBlockDragStart` when the
   * user starts dragging a block out of the editor. Default `false`.
   */
  enableBlockDrag?: boolean;
  /** Fires alongside Crepe's native drag handler when a block drag begins. */
  onBlockDragStart?: (event: MilkdownBlockDragEvent) => void;
  /** Called only after this document has actually been rendered. */
  onRendered?: (markdown: string) => void;
  /** The owner can retry the same content without changing its source version. */
  onError?: (error: Error) => void;
}

/**
 * Keys that we still want to bubble even in drag-only readonly mode.
 *
 * NOTE: `Tab` is intentionally NOT in this set. ProseMirror's keymap
 * treats Tab as an editing verb (indent list item / change nesting /
 * move selection across blocks), so we have to keep the event from
 * reaching the editor. See the dedicated branch in `onKeyDownCapture`
 * below — it stops propagation without calling `preventDefault`, so
 * the browser's native focus navigation still works.
 */
const NAV_KEYS = new Set([
  'ArrowLeft',
  'ArrowRight',
  'ArrowUp',
  'ArrowDown',
  'Home',
  'End',
  'PageUp',
  'PageDown',
  'Escape',
]);

const MODIFIER_KEYS = new Set(['Shift', 'Control', 'Alt', 'Meta']);

function shouldSwallowKey(e: React.KeyboardEvent): boolean {
  if (MODIFIER_KEYS.has(e.key) || NAV_KEYS.has(e.key)) return false;
  // Tab is handled by its own branch in `onKeyDownCapture` — don't
  // route it through the generic preventDefault path here, since that
  // would also block browser focus navigation.
  if (e.key === 'Tab') return false;
  const key = e.key.toLowerCase();
  // Preserve copy / select-all so the user can still pull text out.
  const isCopyOrSelectAll =
    (e.ctrlKey || e.metaKey) && (key === 'c' || key === 'a');
  if (isCopyOrSelectAll) return false;
  return true;
}

export function MilkdownPreview(
  props: MilkdownPreviewProps,
): React.JSX.Element {
  const { t } = useTranslation();
  const {
    markdown,
    className,
    ariaLabel,
    canvasId,
    enableBlockDrag = false,
    onBlockDragStart,
    onRendered,
    onError,
  } = props;
  const resolvedAriaLabel = ariaLabel ?? t('editor.readOnlyContent');

  const containerRef = useRef<HTMLDivElement>(null);
  const instanceRef = useRef<MilkdownInstance | null>(null);
  const lastSyncedRef = useRef<string>(normalizeMarkdown(markdown));
  const latestRef = useRef({ markdown, onRendered, onError });
  latestRef.current = { markdown, onRendered, onError };
  // Keep the latest drag callback in a ref so the mount effect stays
  // stable while still reading fresh closures.
  const onBlockDragStartRef = useRef(onBlockDragStart);
  onBlockDragStartRef.current = onBlockDragStart;
  /** Track latest canvasId so the mount-only editor reads a fresh value. */
  const canvasIdRef = useRef(canvasId);
  canvasIdRef.current = canvasId;
  const ariaLabelRef = useRef(resolvedAriaLabel);
  ariaLabelRef.current = resolvedAriaLabel;

  useEffect(() => {
    let cancelled = false;
    const container = containerRef.current;
    if (!container) return;

    // One light-DOM mount per effect; late cleanup after a drag-mode switch
    // must only remove the obsolete instance, never the new document.
    const mountRoot = document.createElement('div');
    container.append(mountRoot);
    let ownedInstance: MilkdownInstance | null = null;
    const reportError = (reason: unknown) => {
      if (cancelled) return;
      const error = reason instanceof Error ? reason : new Error(String(reason));
      if (latestRef.current.onError) latestRef.current.onError(error);
      else toast(`正文预览载入失败：${error.message}`, { tone: 'danger' });
    };

    // Class hook used by `milkdown-overrides.css` to scope the compact
    // block-handle (single 18px grip, no "+ add" button) to chat-card
    // previews only — the standalone editor keeps the full Crepe handle.
    if (enableBlockDrag) {
      mountRoot.classList.add('milkdown-preview-host');
    }

    const detachDrag = attachBlockDragListeners({
      mountRoot,
      instanceRef,
      onDragStartRef: onBlockDragStartRef,
    });

    void (async () => {
      const initialMarkdown = normalizeMarkdown(latestRef.current.markdown);
      const instance = await createMilkdown({
        root: mountRoot,
        initialMarkdown,
        // When block drag is requested we need the editor in editable
        // mode so Crepe shows the block handle and lets the user
        // initiate a native drag. Input mutations are still blocked by
        // the wrapper's capture handlers below.
        editable: enableBlockDrag,
        ariaLabel: ariaLabelRef.current,
        // Disable Crepe's edit-time chrome (Toolbar / LinkTooltip /
        // Table reorder handles) when the surface is drag-only. See
        // `MilkdownFactoryOptions.previewMode`.
        previewMode: enableBlockDrag,
        toolbarMode: 'none',
        resolveImageSrc: (src) => {
          const id = canvasIdRef.current;
          return id ? resolveArtifactUrl(src, id) : src;
        },
      });

      ownedInstance = instance;
      if (cancelled) {
        await instance.destroy();
        return;
      }

      instance.setAriaLabel(ariaLabelRef.current);
      instanceRef.current = instance;

      const next = normalizeMarkdown(latestRef.current.markdown);
      lastSyncedRef.current = next;
      if (!markdownEquals(initialMarkdown, next)) instance.setMarkdown(next);
      latestRef.current.onRendered?.(latestRef.current.markdown);
    })().catch(reportError);

    return () => {
      cancelled = true;
      detachDrag();
      if (instanceRef.current === ownedInstance) instanceRef.current = null;
      mountRoot.remove();
      if (ownedInstance) void ownedInstance.destroy().catch(() => undefined);
    };
    // Re-mount when drag mode toggles (rare, expected).
  }, [enableBlockDrag]);

  useEffect(() => {
    if (markdownEquals(markdown, lastSyncedRef.current)) return;
    const next = normalizeMarkdown(markdown);
    const instance = instanceRef.current;
    if (!instance) return; // Creation consumes latestRef, including A→B→A.
    lastSyncedRef.current = next;
    instance.setMarkdown(next);
    latestRef.current.onRendered?.(markdown);
  }, [markdown]);

  // The editor mounts asynchronously, so the mount path above applies the
  // initial name. Keep the live textbox in sync when the caller overrides
  // the label or the active language changes without remounting Milkdown.
  useEffect(() => {
    instanceRef.current?.setAriaLabel(resolvedAriaLabel);
  }, [resolvedAriaLabel]);

  // ---- Capture handlers that suppress editing when in drag-only mode ----
  // Installed on the host div so they intercept input verbs before
  // ProseMirror sees them.
  const onBeforeInputCapture = useCallback(
    (e: React.FormEvent<HTMLDivElement>) => {
      if (!enableBlockDrag) return;
      e.preventDefault();
      e.stopPropagation();
    },
    [enableBlockDrag],
  );
  const onKeyDownCapture = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      if (!enableBlockDrag) return;
      // Tab is special: ProseMirror's keymap binds it to indent /
      // change list nesting / move selection between cells, all of
      // which mutate the document. Stop the event from reaching the
      // editor but DON'T call preventDefault — that way the browser
      // still moves keyboard focus to the next focusable element,
      // which is the accessibility-correct behavior for a read-only
      // surface.
      if (e.key === 'Tab') {
        e.stopPropagation();
        return;
      }
      if (!shouldSwallowKey(e)) return;
      e.preventDefault();
      e.stopPropagation();
    },
    [enableBlockDrag],
  );
  const onPasteCapture = useCallback(
    (e: React.ClipboardEvent<HTMLDivElement>) => {
      if (!enableBlockDrag) return;
      e.preventDefault();
      e.stopPropagation();
    },
    [enableBlockDrag],
  );
  const onCutCapture = useCallback(
    (e: React.ClipboardEvent<HTMLDivElement>) => {
      if (!enableBlockDrag) return;
      e.preventDefault();
      e.stopPropagation();
    },
    [enableBlockDrag],
  );
  const onDropCapture = useCallback(
    (e: React.DragEvent<HTMLDivElement>) => {
      if (!enableBlockDrag) return;
      e.preventDefault();
      e.stopPropagation();
    },
    [enableBlockDrag],
  );

  return (
    <div
      ref={containerRef}
      className={className}
      // Surface the read-only nature to assistive tech. In drag mode
      // we still keep the inner ProseMirror `contenteditable=true` so
      // the block-drag handle remains hit-testable, but we capture &
      // swallow every input verb (typing, paste, cut, drop) above —
      // so the visible behavior is read-only. `aria-readonly` lets
      // screen readers convey that to the user. Pure-display mode
      // (no block drag) keeps `aria-readonly` unset because
      // `contenteditable=false` already communicates read-only.
      aria-readonly={enableBlockDrag ? true : undefined}
      onBeforeInputCapture={onBeforeInputCapture}
      onKeyDownCapture={onKeyDownCapture}
      onPasteCapture={onPasteCapture}
      onCutCapture={onCutCapture}
      onDropCapture={onDropCapture}
    />
  );
}
