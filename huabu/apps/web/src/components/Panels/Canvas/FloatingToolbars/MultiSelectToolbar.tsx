// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { MoreHorizontal, MoveRight, Trash2 } from 'lucide-react';
import { useCallback, useMemo, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import {
  ACCENT_NONE_TOKEN,
  ACCENT_PICKER_OPTIONS_WITH_TRANSPARENT,
} from '@huabu/shared';
import {
  type AlignDirection,
  DEFAULT_EDGE_STROKE_TOKEN,
  getSelectionBounds,
  getNodeSize,
  isAlwaysAutoHeightNodeType,
  resolveHeightMode,
} from '@huabu/shared/canvas-engine';

import { CanvasFloatingPopover } from '@/components/Common/CanvasFloatingPopover';
import {
  FloatingToolbar,
  FLOATING_TOOLBAR_CLASS,
} from '@/components/Common/FloatingToolbar';
import { useIsNotMouse } from '@/hooks/useInputMode';
import { translateColorOptions } from '@/i18n/colors';
import useCanvasStore from '@/store/canvasStore';
import { resolveGeometryEdit } from '@/utils/node/geometry';
import { getEdgeIdsBetweenSelectedNodes } from '@/utils/selection';

import type { CanvasNode } from '@/components/Nodes/types';
import type { CanvasEdgeId, CanvasNodeId } from '@huabu/shared';
import type { ReactNode } from 'react';
import '@/lcos/ui/nearfield/fallbackCommandSurface.css';

/** Sentinel token representing "no accent". */
const ACCENT_NONE = ACCENT_NONE_TOKEN;

interface GeometryToolbarItem {
  nodeId: CanvasNodeId;
  size: { width: number; height: number | 'auto' | undefined };
}

/**
 * A floating toolbar that appears horizontally centred above the
 * multi-selection bounding box when two or more nodes are selected.
 */
export interface MultiSelectToolbarProps {
  readonly suppressed?: boolean;
  readonly contextMenuRequest?: number;
  readonly onAlign?: ((direction: AlignDirection) => void) | undefined;
  readonly onSpread?: (() => void) | undefined;
  readonly onTidy?: () => void;
  readonly onDistribute?: ((axis: 'x'|'y') => void) | undefined;
  readonly deleteDisabledReason?: string;
  readonly moveDisabledReason?: string;
  readonly selectionAction?: ReactNode;
  /** Keep direct canvas resizing while omitting numeric geometry from host menus. */
  readonly hideGeometrySize?: boolean;
  /** Hide a style editor when the host body does not consume the native node field. */
  readonly showFontSize?: boolean;
  /** Hide native accent styling when any selected host owns its own surface. */
  readonly showAccentColor?: boolean;
  /** Omit host actions whose existing disabled reason says they cannot act on this selection. */
  readonly hideDisabledActions?: boolean;
  /** LCOS uses the same geometry/format commands with its host presentation. */
  readonly presentation?: 'huabu' | 'lcos';
}

export const MultiSelectToolbar = ({ deleteDisabledReason, moveDisabledReason, selectionAction, hideGeometrySize = false, showFontSize = true, showAccentColor = true, hideDisabledActions = false, presentation = 'huabu', suppressed = false, contextMenuRequest = 0, onAlign, onSpread, onTidy, onDistribute }: MultiSelectToolbarProps = {}) => {
  const { t } = useTranslation();
  const [detailsOpen, setDetailsOpen] = useState(false);
  useEffect(() => { if (contextMenuRequest) setDetailsOpen(true); }, [contextMenuRequest]);
  useEffect(() => { if (suppressed) setDetailsOpen(false); }, [suppressed]);
  const nodes = useCanvasStore((s) => s.nodes);
  const edges = useCanvasStore((s) => s.edges);
  const alignSelectedNodes = useCanvasStore((s) => s.alignSelectedNodes);
  const spreadSelectedNodes = useCanvasStore((s) => s.spreadSelectedNodes);
  const executeCommands = useCanvasStore((s) => s.executeCommands);
  const setNodeGeometry = useCanvasStore((s) => s.setNodeGeometry);
  const setNoteHeightMode = useCanvasStore((s) => s.setNoteHeightMode);
  const beginGesture = useCanvasStore((s) => s.beginGesture);
  const deleteNodes = useCanvasStore((s) => s.deleteNodes);
  const setMoveSelectionDialogOpen = useCanvasStore(
    (s) => s.setMoveSelectionDialogOpen,
  );
  const isNotMouse = useIsNotMouse();

  const selectedNodes = useMemo(
    () => nodes.filter((n) => n.selected) as CanvasNode[],
    [nodes],
  );
  const hasPortalSelection = selectedNodes.some(
    (node) => node.type === 'canvasRef',
  );
  const hasManagedSizeSelection = selectedNodes.some(
    (node) => node.type === 'canvasRef' || node.type === 'frameRef',
  );
  const hasNonMovableSelection = selectedNodes.some((node) =>
    ['spacePreview', 'canvasRef', 'frameRef', 'nodeRef'].includes(
      node.type ?? '',
    ),
  );

  // Edges whose endpoints are both in the node selection participate in
  // multi-selection styling. This matches the derived edge highlighting in
  // Canvas without turning those edges into independently selected objects.
  const selectedInternalEdges = useMemo(() => {
    const edgeIds = new Set(
      getEdgeIdsBetweenSelectedNodes(
        selectedNodes.map((node) => node.id),
        edges,
      ),
    );
    return edges.filter((edge) => edgeIds.has(edge.id));
  }, [edges, selectedNodes]);

  // Determine the common accent among selected nodes (empty string if mixed)
  const commonAccent = useMemo(() => {
    if (selectedNodes.length === 0) return ACCENT_NONE;
    const first = selectedNodes[0].data?.style?.accent ?? null;
    const allSame = selectedNodes.every(
      (n) => (n.data?.style?.accent ?? null) === first,
    );
    return allSame ? (first ?? ACCENT_NONE) : ACCENT_NONE;
  }, [selectedNodes]);

  const textFlowSelection = useMemo(() => {
    if (selectedNodes.length === 0) return null;
    if (!selectedNodes.every((n) => isAlwaysAutoHeightNodeType(n.type ?? ''))) {
      return null;
    }
    const first = selectedNodes[0].data?.style?.fontSize ?? 16;
    const allSame = selectedNodes.every(
      (n) => Math.round(n.data?.style?.fontSize ?? 16) === Math.round(first),
    );
    return { fontSize: allSame ? first : null };
  }, [selectedNodes]);

  const hasTextFlowSelection = useMemo(
    () => selectedNodes.some((n) => isAlwaysAutoHeightNodeType(n.type ?? '')),
    [selectedNodes],
  );
  const hasBoxSelection = useMemo(
    () => selectedNodes.some((n) => !isAlwaysAutoHeightNodeType(n.type ?? '')),
    [selectedNodes],
  );
  const hasMixedTextAndBoxSelection = hasTextFlowSelection && hasBoxSelection;

  // Always include the "Transparent" swatch so users can revert a node
  // back to the default (no-accent / neutral surface) state. Hiding it
  // for non-text selections used to be the design (the assumption being
  // that other types "need a solid background"), but in practice every
  // node defaults to a null accent and the picker had no way to express
  // that state — once a coloured swatch was clicked it could not be
  // undone.
  const accentPickerOptions = useMemo(
    () => translateColorOptions(ACCENT_PICKER_OPTIONS_WITH_TRANSPARENT, t),
    [t],
  );

  // Common width / height across selected nodes. `null` when the
  // selected nodes do not all share the same value — the size picker
  // shows a "—" placeholder and the user can fill in either field to
  // apply just that dimension uniformly.
  const commonSize = useMemo(() => {
    if (selectedNodes.length === 0) return { width: null, height: null };
    const sizes = selectedNodes.map((n) => getNodeSize(n));
    const firstW = sizes[0].width;
    const firstH = sizes[0].height;
    const sameW =
      firstW > 0 &&
      sizes.every((s) => Math.round(s.width) === Math.round(firstW));
    const sameH =
      firstH > 0 &&
      sizes.every((s) => Math.round(s.height) === Math.round(firstH));
    return {
      width: sameW ? firstW : null,
      height: sameH ? firstH : null,
    };
  }, [selectedNodes]);

  const hasGeometrySizeControl = !hideGeometrySize && !hasManagedSizeSelection;
  const hasFontSizeControl = showFontSize && textFlowSelection !== null;
  const hasAccentColorControl = showAccentColor && !hasPortalSelection;
  const hasMoveControl = !hasNonMovableSelection;
  const hasDeleteControl = isNotMouse || presentation === 'lcos';
  // LCOS cross-space manipulation is owned by Semantic Drop / Rail / Portal.
  // Huabu's MoveSelectionModal physically moves native canvas nodes to another
  // canvas and therefore must stay a Huabu-only product action.
  const showMoveControl = presentation !== 'lcos'
    && hasMoveControl
    && (!hideDisabledActions || moveDisabledReason === undefined);
  const showDeleteControl = hasDeleteControl && (!hideDisabledActions || deleteDisabledReason === undefined);
  const hasVisibleDetailControls = hasGeometrySizeControl || hasFontSizeControl || hasAccentColorControl
    || showMoveControl || showDeleteControl;

  // Note auto-fit toggle: only exposed when *every* selected node is a
  // note AND they all share the same auto/fixed state. Mixed states
  // would make a single toggle ambiguous, so we hide it instead.
  const noteAutoState = useMemo(() => {
    if (selectedNodes.length === 0) return null;
    if (!selectedNodes.every((n) => n.type === 'note')) return null;
    // Read ownership through the shared resolver: an auto note now
    // carries a materialized `style.height`, so the presence of a number
    // no longer distinguishes the two modes.
    const firstAuto = resolveHeightMode(selectedNodes[0]) === 'auto';
    const allSame = selectedNodes.every(
      (n) => (resolveHeightMode(n) === 'auto') === firstAuto,
    );
    return allSame ? { active: firstAuto } : null;
  }, [selectedNodes]);

  // "Last pinned height" memory is owned by the shared `noteHeightMemory`
  // module (populated by `useTrackNoteFixedHeight` on each NoteNode), so
  // this toolbar doesn't need a parallel per-node map — `setNoteHeightMode`
  // reads from the same source whether the toggle was fired here, from the
  // single-select toolbar, or from the corner affordance.
  const toggleNotesAutoHeight = useCallback(() => {
    if (!noteAutoState) return;
    setNoteHeightMode(
      selectedNodes.map((n) => n.id),
      noteAutoState.active ? 'fixed' : 'auto',
    );
  }, [noteAutoState, selectedNodes, setNoteHeightMode]);

  // Compute bounding box of selected nodes in flow (absolute) coordinates.
  // Returned as a `CanvasFloatingPopover` anchor rect. Uses the shared
  // `getSelectionBounds` helper so the anchor stays in lock-step with
  // the multi-select resizer's outline.
  const anchor = useMemo(() => {
    if (selectedNodes.length < 2) return null;
    const bounds = getSelectionBounds(selectedNodes, nodes);
    if (!bounds) return null;
    return {
      x: bounds.minX,
      y: bounds.minY,
      width: bounds.width,
      height: bounds.height,
    };
  }, [selectedNodes, nodes]);

  const detailControls = <>
      {(hasGeometrySizeControl || hasFontSizeControl || hasAccentColorControl || showMoveControl || showDeleteControl)
        && <FloatingToolbar.Divider />}

      {/* Size editor: set width / height of every selected node. */}
      {hasGeometrySizeControl && (
        <FloatingToolbar.SizePicker
          width={commonSize.width}
          height={textFlowSelection ? null : commonSize.height}
          showHeight={!textFlowSelection && !hasMixedTextAndBoxSelection}
          onApply={({ width, height }) => {
            if (selectedNodes.length === 0) return;
            if (width === undefined && height === undefined) return;
            // Resolve per-node via the shared helper, which:
            //  - falls back to each node's existing width when only height
            //    was edited (and skips nodes whose width can't be resolved);
            //  - reads each node's height *ownership* when the user didn't
            //    enter a height, so a width-only edit never pins an auto
            //    node (its `style.height` is a number in both modes).
            const items = selectedNodes
              .map((node): GeometryToolbarItem | null => {
                const resolved = resolveGeometryEdit(node, {
                  width,
                  height,
                });
                if (!resolved) return null;
                return {
                  nodeId: node.id as CanvasNodeId,
                  size: {
                    width: resolved.width,
                    height: resolved.height,
                  },
                };
              })
              .filter((item): item is GeometryToolbarItem => item !== null);
            if (items.length === 0) return;
            // SET_NODE_GEOMETRY uses snapshot:'caller' — open a gesture so
            // the resize folds into one undo entry and the store doesn't warn.
            beginGesture('SET_NODE_GEOMETRY');
            setNodeGeometry(
              items.map(({ nodeId, size }) => ({
                nodeId,
                size,
              })),
            );
          }}
          heightAuto={
            noteAutoState
              ? {
                  active: noteAutoState.active,
                  onToggle: toggleNotesAutoHeight,
                }
              : undefined
          }
        />
      )}

      {hasFontSizeControl && textFlowSelection && (
        <FloatingToolbar.NumberInput
          label="Font"
          ariaLabel="Font size"
          name="font-size"
          value={textFlowSelection.fontSize}
          min={8}
          max={160}
          onApply={(fontSize) => {
            executeCommands([
              {
                type: 'MERGE_NODE_DATA',
                patches: selectedNodes.map((node) => ({
                  nodeId: node.id as CanvasNodeId,
                  patch: {
                    style: { ...(node.data.style ?? {}), fontSize },
                  },
                })),
              },
            ]);
          }}
        />
      )}

      {(hasAccentColorControl || showMoveControl || showDeleteControl) && <FloatingToolbar.Divider />}

      {/* Accent color for selected nodes and the edges between them. */}
      {hasAccentColorControl && (
        <FloatingToolbar.ColorPicker
          colors={accentPickerOptions}
          value={commonAccent}
          onSelect={(token) => {
            const accent = token === ACCENT_NONE ? null : token;
            if (selectedNodes.length === 0) return;

            executeCommands([
              {
                type: 'MERGE_NODE_DATA',
                patches: selectedNodes.map((node) => ({
                  nodeId: node.id as CanvasNodeId,
                  patch: {
                    style: { ...node.data?.style, accent },
                  },
                })),
              },
              ...(selectedInternalEdges.length > 0
                ? [
                    {
                      type: 'SET_EDGE_STYLE' as const,
                      edges: selectedInternalEdges.map((edge) => ({
                        edge: edge.id as CanvasEdgeId,
                        style: {
                          stroke: accent ?? DEFAULT_EDGE_STROKE_TOKEN,
                        },
                      })),
                    },
                  ]
                : []),
            ]);
          }}
          title={t('toolbar.accentColor')}
        />
      )}

      {showMoveControl && (
        <>
          <FloatingToolbar.Divider />
          <FloatingToolbar.ActionButton
            title={moveDisabledReason ?? t('moveSelection.action')}
            disabled={moveDisabledReason !== undefined}
            onClick={() => { if (moveDisabledReason === undefined) setMoveSelectionDialogOpen(true); }}
          >
            <MoveRight />
          </FloatingToolbar.ActionButton>
        </>
      )}

      {/* Non-mouse only: mouse users have keyboard Delete / Backspace. */}
      {showDeleteControl && (
        <>
          <FloatingToolbar.Divider />
          <FloatingToolbar.ActionButton
            title={deleteDisabledReason ?? t('toolbar.deleteSelected')}
            disabled={deleteDisabledReason !== undefined}
            tone="danger"
            onClick={() => {
              if (selectedNodes.length === 0 || deleteDisabledReason !== undefined) return;
              deleteNodes(selectedNodes.map((n) => n.id));
            }}
          >
            <Trash2 />
          </FloatingToolbar.ActionButton>
        </>
      )}
  </>;

  return (
    <CanvasFloatingPopover
      anchor={anchor}
      open={selectedNodes.length >= 2 && !suppressed}
      offset={12}
      side="top"
      className={presentation === 'lcos' ? `${FLOATING_TOOLBAR_CLASS} lcos-fallback-command-surface` : FLOATING_TOOLBAR_CLASS}
    >
      {/* Align & distribute — collapsed into a single popover trigger
          to keep the multi-select toolbar compact. Houses the 6 align
          actions in a 3×2 grid plus the Spread Apart action. */}
      <FloatingToolbar.AlignPicker
        onAlign={onAlign ?? ((direction) => alignSelectedNodes(direction))}
        onSpread={onSpread ?? (() => spreadSelectedNodes())}
        onTidy={onTidy} onDistribute={onDistribute}
      />

      {selectionAction}
      {presentation === 'lcos' ? (
        hasVisibleDetailControls && <FloatingToolbar.Popover label="所选对象的更多操作" trigger={<MoreHorizontal size={17} />}
          triggerData={{ 'data-lcos-selection-more': true }}
          open={detailsOpen} onOpenChange={setDetailsOpen} placement="bottom-end"
          triggerClassName="lcos-selection-more" className="lcos-selection-details">
          {detailControls}
        </FloatingToolbar.Popover>
      ) : detailControls}
    </CanvasFloatingPopover>
  );
};
