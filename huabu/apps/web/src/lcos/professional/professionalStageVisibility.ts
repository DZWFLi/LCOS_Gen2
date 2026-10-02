import { useLayoutEffect, useState } from 'react';

import { createWindowRegion, normalizeWindowRegion, windowIdsForRegion } from '../shell/windowRegionTopology';
import { needsCompactProfessionalStageV1, deriveProfessionalStageRegionPlacementsV1 } from './professionalWindowStageLayout';

import { PROFESSIONAL_SPLITTER_SIZE, PROFESSIONAL_PANE_MIN_WIDTH, PROFESSIONAL_PANE_MIN_HEIGHT } from './professionalGestureGeometry';

import type { ProfessionalRectV1 } from '@local-creative-os/web-gen2';
import type { LcosWindow } from '../shell/lcosShellStore';
import type { WindowRegionInput } from '../shell/windowRegionTopology';

export function currentProfessionalViewport(): ProfessionalRectV1 {
  if (typeof window === 'undefined') return { x: 0, y: 0, width: 0, height: 0 };
  return {
    x: 0,
    y: 0,
    width: window.innerWidth || document.documentElement.clientWidth || 0,
    height: window.innerHeight || document.documentElement.clientHeight || 0,
  };
}

/** Shared viewport source and resize lifecycle for Stage and its overlay callers. */
export function useProfessionalViewport(): ProfessionalRectV1 {
  const [viewport, setViewport] = useState(currentProfessionalViewport);
  useLayoutEffect(() => {
    const updateViewport = (): void => {
      const next = currentProfessionalViewport();
      setViewport((previous) => previous.width === next.width && previous.height === next.height ? previous : next);
    };
    updateViewport();
    window.addEventListener('resize', updateViewport);
    return () => window.removeEventListener('resize', updateViewport);
  }, []);
  return viewport;
}

function preferredWidthFor(window: LcosWindow): number {
  return window.bodyKey === 'reader' ? 1120 : window.bodyKey === 'assembly' ? (window.composerOriginKey ? 1000 : 640) : window.bodyKey === 'portal-preview' ? 472 : 520;
}

/**
 * The single visibility projection used by both ProfessionalWindowStage and
 * canvas-local overlay owners. It mirrors Stage's synthesized singleton
 * regions for windows that predate/are not yet assigned to a saved region.
 */
export function visibleWindowIdsForStage(
  windows: readonly LcosWindow[],
  regions: readonly WindowRegionInput[],
  viewport: ProfessionalRectV1,
): { readonly compact: boolean; readonly windowIds: readonly string[] } {
  const windowsById = new Map(windows.map((window) => [window.id, window]));
  const assignedIds = new Set(regions.flatMap(windowIdsForRegion));
  const effectiveRegions = [
    ...regions.map(normalizeWindowRegion),
    ...windows
      .filter((window) => !assignedIds.has(window.id))
      .map((window) => createWindowRegion(`region-${window.id}`, [window.id], window.id)),
  ];

  const regionEntries = effectiveRegions.flatMap((region) => region.groups.flatMap((group) => {
    const groupWindows = group.windowIds
      .map((windowId) => windowsById.get(windowId))
      .filter((window): window is LcosWindow => window !== undefined);
    const activeWindow = groupWindows.find((window) => window.id === group.activeWindowId)
      ?? groupWindows[groupWindows.length - 1];
    return activeWindow === undefined ? [] : [{ region, activeWindow, preferredWidth: preferredWidthFor(activeWindow) }];
  }));
  const layoutEntries = effectiveRegions.flatMap((region) => {
    const groups = regionEntries.filter((entry) => entry.region.id === region.id);
    if (groups.length === 0) return [];
    const preferredWidth = Math.max(...groups.map((entry) => entry.preferredWidth),
      region.splitDirection === 'vertical' ? 720 : 0);
    return [{
      regionId: region.id,
      layout: region.layout,
      preferredWidth,
      bodyKey: groups[0]?.activeWindow.bodyKey,
      ...(region.rect === undefined ? {} : { rect: region.rect }),
      ...(region.dockWidth === undefined ? {} : { dockWidth: region.dockWidth }),
    }];
  });
  const placements = new Map(deriveProfessionalStageRegionPlacementsV1({ viewport, regions: layoutEntries })
    .map((entry) => [entry.regionId, entry.rect]));
  const compact = effectiveRegions.some((region) => {
    if (region.splitDirection === undefined || region.groups.length < 2) return false;
    const rect = placements.get(region.id);
    if (rect === undefined) return false;
    const readerShell = windowIdsForRegion(region).every((id) => windowsById.get(id)?.bodyKey === 'reader');
    // Measure the same effective geometry as Stage, including its shared Reader
    // chrome and splitter. Saved/default dimensions alone miss docked rows.
    return region.splitDirection === 'vertical'
      ? rect.width < PROFESSIONAL_PANE_MIN_WIDTH * 2 + PROFESSIONAL_SPLITTER_SIZE
      : rect.height - (readerShell ? 48 : 0) < PROFESSIONAL_PANE_MIN_HEIGHT * 2 + PROFESSIONAL_SPLITTER_SIZE;
  }) || needsCompactProfessionalStageV1(viewport, layoutEntries);

  if (compact) {
    const activeWindow = windows.find((window) => window.active) ?? windows[windows.length - 1];
    return { compact, windowIds: activeWindow === undefined ? [] : [activeWindow.id] };
  }
  return { compact, windowIds: regionEntries.map(({ activeWindow }) => activeWindow.id) };
}
