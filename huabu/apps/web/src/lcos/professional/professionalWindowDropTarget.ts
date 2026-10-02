import type { ProfessionalRectV1 } from '@local-creative-os/web-gen2';
import { professionalDockWidth } from './professionalWindowStageLayout';
import { sameProfessionalRect, PROFESSIONAL_SPLITTER_SIZE, PROFESSIONAL_PANE_MIN_WIDTH, PROFESSIONAL_PANE_MIN_HEIGHT } from './professionalGestureGeometry';

export interface ProfessionalWindowDropGroupTarget {
  readonly groupId: string;
  readonly rect: ProfessionalRectV1;
  readonly tabs?: readonly { readonly windowId: string; readonly rect: ProfessionalRectV1 }[];
}

export interface ProfessionalWindowDropRegionTarget {
  readonly regionId: string;
  readonly rect: ProfessionalRectV1;
  readonly groups: readonly ProfessionalWindowDropGroupTarget[];
  readonly canSplit: boolean;
}

export type ProfessionalWindowDropAction =
  | { readonly kind: 'dock-right'; readonly rect: ProfessionalRectV1; readonly previewRect: ProfessionalRectV1 }
  | { readonly kind: 'group'; readonly regionId: string; readonly groupId: string; readonly beforeWindowId?: string | null; readonly rect: ProfessionalRectV1; readonly previewRect: ProfessionalRectV1 }
  | { readonly kind: 'split'; readonly regionId: string; readonly groupId: string; readonly direction: 'horizontal' | 'vertical'; readonly sourceFirst: boolean; readonly rect: ProfessionalRectV1; readonly previewRect: ProfessionalRectV1 };

const EDGE_DOCK_DISTANCE = 28;
const SPLIT_BAND_RATIO = 0.22;

function contains(rect: ProfessionalRectV1, x: number, y: number): boolean {
  return x >= rect.x && x <= rect.x + rect.width && y >= rect.y && y <= rect.y + rect.height;
}

function splitPreviewRect(rect: ProfessionalRectV1, direction: 'horizontal' | 'vertical', sourceFirst: boolean): ProfessionalRectV1 {
  if (direction === 'vertical') {
    const width = (rect.width - PROFESSIONAL_SPLITTER_SIZE) / 2;
    return { x: sourceFirst ? rect.x : rect.x + width + PROFESSIONAL_SPLITTER_SIZE, y: rect.y, width, height: rect.height };
  }
  const height = (rect.height - PROFESSIONAL_SPLITTER_SIZE) / 2;
  return { x: rect.x, y: sourceFirst ? rect.y : rect.y + height + PROFESSIONAL_SPLITTER_SIZE, width: rect.width, height };
}

/** Hit-tests real target rectangles. Region order is caller-controlled z-order (front to back). */
export function resolveProfessionalWindowDropTarget(input: {
  readonly x: number;
  readonly y: number;
  readonly sourceRegionId: string;
  readonly allowSourceRegion?: boolean;
  readonly viewport: ProfessionalRectV1;
  readonly preferredDockWidth: number;
  readonly regions: readonly ProfessionalWindowDropRegionTarget[];
}): ProfessionalWindowDropAction | undefined {
  const { x, y, viewport } = input;
  if (![x, y, viewport.width, viewport.height].every(Number.isFinite) || !contains(viewport, x, y)) return undefined;
  const viewportRight = viewport.x + viewport.width;
  const target = input.regions.find((candidate) => (input.allowSourceRegion || candidate.regionId !== input.sourceRegionId) && contains(candidate.rect, x, y));
  if (target === undefined && x >= viewportRight - EDGE_DOCK_DISTANCE && y >= viewport.y && y <= viewport.y + viewport.height) {
    const width = professionalDockWidth(viewport, input.preferredDockWidth);
    return {
      kind: 'dock-right', rect: { x: viewportRight - width, y: viewport.y, width, height: viewport.height },
      // Keep the edge as the hit zone, but preview the full region that will
      // actually be occupied after drop. A 28px strip reads like a pointer
      // affordance, not a layout preview.
      previewRect: { x: viewportRight - width, y: viewport.y, width, height: viewport.height },
    };
  }
  if (target === undefined) return undefined;
  const pane = target.groups.find((group) => contains(group.rect, x, y));
  const targetGroup = pane;
  if (targetGroup === undefined) return undefined;

  const rect = targetGroup.rect;
  // Tab-strip drops reorder/merge, never split at the pane's top edge.
  const tab = targetGroup.tabs?.find((item) => contains(item.rect, x, y));
  if (tab !== undefined) {
    const index = targetGroup.tabs!.indexOf(tab);
    const beforeWindowId = x < tab.rect.x + tab.rect.width / 2 ? tab.windowId : targetGroup.tabs?.[index + 1]?.windowId ?? null;
    return { kind: 'group', regionId: target.regionId, groupId: targetGroup.groupId, rect, previewRect: rect,
      ...(beforeWindowId === undefined ? {} : { beforeWindowId }) };
  }
  const left = x - rect.x;
  const right = rect.x + rect.width - x;
  const top = y - rect.y;
  const bottom = rect.y + rect.height - y;
  const verticalBand = Math.min(64, rect.width * SPLIT_BAND_RATIO);
  const horizontalBand = Math.min(64, rect.height * SPLIT_BAND_RATIO);
  const candidates = [
    { distance: left, threshold: verticalBand, side: 'left' as const },
    { distance: right, threshold: verticalBand, side: 'right' as const },
    { distance: top, threshold: horizontalBand, side: 'top' as const },
    { distance: bottom, threshold: horizontalBand, side: 'bottom' as const },
  ].filter((candidate) => candidate.distance <= candidate.threshold).sort((a, b) => a.distance - b.distance);
  const edge = candidates[0];
  if (target.canSplit && target.groups.length === 1 && edge !== undefined) {
    const direction = edge.side === 'left' || edge.side === 'right' ? 'vertical' : 'horizontal';
    const sourceFirst = edge.side === 'left' || edge.side === 'top';
    const fits = direction === 'vertical' ? rect.width >= 2 * PROFESSIONAL_PANE_MIN_WIDTH + PROFESSIONAL_SPLITTER_SIZE
      : rect.height >= 2 * PROFESSIONAL_PANE_MIN_HEIGHT + PROFESSIONAL_SPLITTER_SIZE;
    if (!fits) return { kind: 'group', regionId: target.regionId, groupId: targetGroup.groupId, rect, previewRect: rect };
    return {
      kind: 'split', regionId: target.regionId, groupId: targetGroup.groupId,
      direction, sourceFirst, rect: splitPreviewRect(rect, direction, sourceFirst), previewRect: splitPreviewRect(rect, direction, sourceFirst),
    };
  }
  return { kind: 'group', regionId: target.regionId, groupId: targetGroup.groupId, rect, previewRect: rect };
}

/** Commit only the destination that was actually previewed. Geometry is compared
 * too: a moved/closed/replaced target must not reinterpret the same pointerup. */
export function sameProfessionalDropTarget(a: ProfessionalWindowDropAction | undefined, b: ProfessionalWindowDropAction | undefined): boolean {
  if (a === undefined || b === undefined) return a === b;
  if (a.kind !== b.kind || !sameProfessionalRect(a.previewRect, b.previewRect)) return false;
  if (a.kind === 'dock-right') return b.kind === 'dock-right';
  if (b.kind === 'dock-right' || a.regionId !== b.regionId || a.groupId !== b.groupId) return false;
  if (a.kind === 'group') return b.kind === 'group' && a.beforeWindowId === b.beforeWindowId;
  return b.kind === 'split' && a.direction === b.direction && a.sourceFirst === b.sourceFirst;
}
