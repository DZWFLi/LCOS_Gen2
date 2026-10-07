// ProfessionalWindowStage — route-level 专业窗口舞台（Figma window 5388:27165 / Chrome 5387:331）。
// Stage 是唯一 Window topology + geometry producer；body 数据来自 Core。
// 多个 window region 保持独立，只有显式 group 才共享 tab chrome。

import {
  clampProfessionalRectV1,
  deriveProfessionalWindowEnvironmentV1,
  resizeProfessionalRectV1,
} from '@local-creative-os/web-gen2';
import { X } from 'lucide-react';
import { Fragment, useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react';

import { useCloseOnEscape } from '@/hooks/useCloseOnEscape';
import { useCanvasAttentionStore } from '@/store/canvasAttentionStore';


import { ArchiveBody } from './ArchiveBody';
import { ArtifactReaderBody } from './ArtifactReaderBody';
import { AssemblyBody } from './AssemblyBody';
import { CollectionWorkViewBody } from './CollectionWorkViewBody';
import { ConversationWorkViewBody } from './ConversationWorkViewBody';
import { NativeNodePreviewBody } from './NativeNodePreviewBody';
import { PortalPreviewBody, type PortalTargetResolution } from './PortalPreviewBody';
import { clampProfessionalSplitRatio, professionalSplitLimits, professionalSplitRatioAtPoint, sameProfessionalRegionLayout } from './professionalGestureGeometry';
import { beginProfessionalPointerGesture } from './professionalPointerGesture';
import { visibleWindowIdsForStage, currentProfessionalViewport, useProfessionalViewport } from './professionalStageVisibility';
import { resolveProfessionalWindowDropTarget, sameProfessionalDropTarget, type ProfessionalWindowDropAction, type ProfessionalWindowDropRegionTarget } from './professionalWindowDropTarget';
import {
  deriveProfessionalStageRegionPlacementsV1,
  professionalFloatingBoundsV1,
  PROFESSIONAL_STAGE_MIN_HEIGHT,
  PROFESSIONAL_STAGE_MIN_WIDTH,
} from './professionalWindowStageLayout';
import { professionalDockWidth } from './professionalWindowStageLayout';
import { RetainedReaderBody } from './RetainedReaderBody';
import { RuntimeDoctorBody } from './RuntimeDoctorBody';
import { RunWorkViewBody } from './RunWorkViewBody';
import { composerInputKey } from '../composer/composerInputJourney';
import { composerHasVisibleWindowOwner } from '../composer/composerPresentationOwner';
import { useLcosReferenceStore } from '../lcosReferenceState';
import { useLcosShellStore, type LcosWindow } from '../shell/lcosShellStore';
import { activeWindowIdForRegion, createWindowRegion, normalizeWindowRegion, windowIdsForRegion } from '../shell/windowRegionTopology';
import { LcosWindowChrome } from '../ui/families/LcosWindowChrome';
import { lcosGlassStyle, lcosTokens } from '../ui/lcosTokens';
import { LcosButton } from '../ui/primitives/LcosButton';
import { ReaderContentTabsView } from '../ui/professional/ReaderContentTabsView';
import './professional-window-stage.css';

import type { LcosWindowRegion, WindowRegionInput } from '../shell/windowRegionTopology';
import type { AssemblyTargetRefV1 } from '@local-creative-os/contracts';
import type { ProfessionalRectV1, ProfessionalResizeHandleV1 } from '@local-creative-os/web-gen2';

/** R2-B：8 向 resize 的命中区（透明但可点；视觉克制，是否舒服交给用户手测）。 */
const RESIZE_HANDLE_CLASS: Readonly<Record<ProfessionalResizeHandleV1, string>> = {
  n: 'left-2 right-2 top-0 h-1.5 cursor-ns-resize',
  s: 'left-2 right-2 bottom-0 h-1.5 cursor-ns-resize',
  e: 'top-2 bottom-2 right-0 w-1.5 cursor-ew-resize',
  w: 'top-2 bottom-2 left-0 w-1.5 cursor-ew-resize',
  ne: 'right-0 top-0 h-3.5 w-3.5 cursor-nesw-resize',
  nw: 'left-0 top-0 h-3.5 w-3.5 cursor-nwse-resize',
  se: 'right-0 bottom-0 h-3.5 w-3.5 cursor-nwse-resize',
  sw: 'left-0 bottom-0 h-3.5 w-3.5 cursor-nesw-resize',
};

const RESIZE_HANDLES: readonly ProfessionalResizeHandleV1[] = ['n', 'ne', 'e', 'se', 's', 'sw', 'w', 'nw'];

export interface ProfessionalWindowStageProps {
  readonly projectId: string;
  /** Core-derived resolver; absent in isolated tests/legacy callers. */
  readonly resolvePortalTarget?: (canvasId: string, workspaceId?: string, sourceNodeId?: string) => PortalTargetResolution | undefined;
  /** Shell-owned navigation into an already resolved Workspace. */
  readonly onOpenPortalTarget?: (target: PortalTargetResolution, signal?: AbortSignal) => Promise<boolean>;
}

interface ProfessionalRegionEntry {
  readonly region: LcosWindowRegion;
  readonly windows: readonly LcosWindow[];
  readonly activeWindow: LcosWindow;
  readonly preferredWidth: number;
}

interface WindowDropPreview {
  readonly action: ProfessionalWindowDropAction | { readonly kind: 'float'; readonly rect: ProfessionalRectV1 };
  readonly label: string;
}

interface WindowGestureStyle {
  readonly left: string;
  readonly top: string;
  readonly right: string;
  readonly bottom: string;
  readonly width: string;
  readonly height: string;
}

function preferredWidthFor(window: LcosWindow): number {
  return window.bodyKey === 'reader' ? 1120
    : window.bodyKey === 'native-preview' ? 980
    : window.bodyKey === 'collection' ? 720
    : window.bodyKey === 'assembly' ? (window.composerOriginKey ? 1000 : 420) : window.bodyKey === 'portal-preview' ? 472 : 520;
}

const currentViewport = currentProfessionalViewport;

function materializeRegionEntries(
  windows: readonly LcosWindow[],
  windowRegions: readonly WindowRegionInput[],
): readonly ProfessionalRegionEntry[] {
  const windowsById = new Map(windows.map((window) => [window.id, window]));
  const assignedIds = new Set(windowRegions.flatMap(windowIdsForRegion));
  const effectiveRegions: readonly LcosWindowRegion[] = [
    ...windowRegions.map(normalizeWindowRegion),
    ...windows
      .filter((window) => !assignedIds.has(window.id))
      .map((window) => createWindowRegion(`region-${window.id}`, [window.id], window.id)),
  ];

  return effectiveRegions.flatMap((region) => {
    const regionWindows = windowIdsForRegion(region)
      .map((windowId) => windowsById.get(windowId))
      .filter((window): window is LcosWindow => window !== undefined);
    const firstGroup = region.groups[0];
    const firstGroupWindows = firstGroup?.windowIds.map((id) => windowsById.get(id)).filter((window): window is LcosWindow => window !== undefined) ?? [];
    const activeWindow = firstGroupWindows.find((window) => window.id === firstGroup?.activeWindowId) ?? firstGroupWindows.at(-1) ?? windowsById.get(activeWindowIdForRegion(region) ?? '') ?? regionWindows[regionWindows.length - 1];
    return activeWindow === undefined
      ? []
      : [{
          region,
          windows: regionWindows,
          activeWindow,
          preferredWidth: region.splitDirection === 'vertical'
            ? Math.max(720, ...region.groups.map((group) => preferredWidthFor(windowsById.get(group.activeWindowId) ?? activeWindow)))
            : preferredWidthFor(activeWindow),
        }];
  });
}

export function ProfessionalWindowStage({ projectId, resolvePortalTarget, onOpenPortalTarget }: ProfessionalWindowStageProps): React.JSX.Element {
  const windows = useLcosShellStore((s) => s.windows);
  const windowRegions = useLcosShellStore((s) => s.windowRegions);
  const activateWindow = useLcosShellStore((s) => s.activateWindow);
  const closeWindow = useLcosShellStore((s) => s.closeWindow);
  const requestLocate = useLcosShellStore((s) => s.requestLocate);
  const publishWindowEnvironment = useLcosShellStore((s) => s.publishWindowEnvironment);
  const clearWindowEnvironment = useLcosShellStore((s) => s.clearWindowEnvironment);
  const composerOpen = useLcosShellStore((s) => s.composerOpen);
  const composerReceiver = useLcosShellStore((s) => s.composerTarget?.receiverConversationId);
  const composerFocusVersion = useLcosShellStore((s) => s.composerFocusVersion);
  const viewport = useProfessionalViewport();
  const [dropPreview, setDropPreview] = useState<WindowDropPreview | null>(null);
  const suppressTabClickRef = useRef(false);
  const regionElements = useRef(new Map<string, HTMLDivElement>());
  const [readerSlots, setReaderSlots] = useState<ReadonlyMap<string, HTMLElement>>(new Map());
  const readerSlotCallbacks = useRef(new Map<string, (element: HTMLDivElement | null) => void>());
  const assemblyDockedWindowIds = useRef(new Set<string>());
  const slotRef = (id: string): ((element: HTMLDivElement | null) => void) => {
    let callback = readerSlotCallbacks.current.get(id);
    if (callback === undefined) {
      callback = (element) => setReaderSlots((current) => {
        if (current.get(id) === (element ?? undefined)) return current;
        const next = new Map(current);
        if (element === null) next.delete(id); else next.set(id, element);
        return next;
      });
      readerSlotCallbacks.current.set(id, callback);
    }
    return callback;
  };
  useLayoutEffect(() => {
    const ids = new Set(windows.map((item) => item.id));
    for (const id of readerSlotCallbacks.current.keys()) if (!ids.has(id)) readerSlotCallbacks.current.delete(id);
  }, [windows]);

  const splitterCleanupRef = useRef<(() => void) | null>(null);
  const gestureCleanupRef = useRef<(() => void) | null>(null);
  useLayoutEffect(() => () => {
    splitterCleanupRef.current?.(); splitterCleanupRef.current = null;
    gestureCleanupRef.current?.(); gestureCleanupRef.current = null;
  }, [projectId]);
  const active = windows.find((window) => window.active) ?? windows[windows.length - 1];
  const previousComposerFocusVersion = useRef(composerFocusVersion);
  useLayoutEffect(() => {
    // Restored/opened windows own attention until the user returns to canvas.
    // Preserve selection; only its floating chrome yields to the active surface.
    const explicitlyResumedComposer = previousComposerFocusVersion.current !== composerFocusVersion;
    previousComposerFocusVersion.current = composerFocusVersion;
    if (!active?.id) return;
    if (explicitlyResumedComposer) {
      const state = useLcosShellStore.getState();
      const visibleIds = visibleWindowIdsForStage(
        state.windows, state.windowRegions, currentProfessionalViewport(),
      ).windowIds;
      if (state.composerOpen && !composerHasVisibleWindowOwner(state.composerTarget, state.windows, visibleIds)) return;
    }
    useCanvasAttentionStore.getState().setCanvasEngaged(false);
  }, [active?.id, composerFocusVersion]);
  const regionEntries = useMemo(
    () => materializeRegionEntries(windows, windowRegions),
    [windowRegions, windows],
  );
  const visibility = useMemo(() => visibleWindowIdsForStage(windows, windowRegions, viewport), [windows, windowRegions, viewport]);
  const compact = visibility.compact;
  const visibleEntries = useMemo(() => {
    const visibleIds = new Set(visibility.windowIds);
    return regionEntries.filter((entry) => windowIdsForRegion(entry.region).some((id) => visibleIds.has(id)));
  }, [regionEntries, visibility.windowIds]);
  // Assembly defaults to the fixed right bay while keeping geometry in the existing Stage/store owner.
  useLayoutEffect(() => {
    const live = useLcosShellStore.getState();
    const liveWindowIds = new Set(windows.map((window) => window.id));
    for (const id of assemblyDockedWindowIds.current) {
      if (!liveWindowIds.has(id)) assemblyDockedWindowIds.current.delete(id);
    }
    for (const window of windows) {
      if (window.bodyKey !== 'assembly' || assemblyDockedWindowIds.current.has(window.id)) continue;
      const region = live.windowRegions.find((item) => windowIdsForRegion(item).includes(window.id));
      if (region === undefined) continue;
      assemblyDockedWindowIds.current.add(window.id);
      if (normalizeWindowRegion(region).layout !== 'docked-right') {
        live.detachWindowToDockRight(window.id, region.dockWidth ?? preferredWidthFor(window));
      }
    }
  }, [windowRegions, windows]);
  const activeRegionId = active === undefined
    ? undefined
    : regionEntries.find((entry) => windowIdsForRegion(entry.region).includes(active.id))?.region.id;
  const inlineComposerOpen = composerOpen && active?.bodyKey === 'conversation'
    && active.target !== undefined && composerReceiver === active.target;

  const returnReaderToSource = useCallback((reader: LcosWindow): void => {
    if (reader.bodyKey !== 'reader' || reader.target === undefined) {
      closeWindow(reader.id);
      return;
    }
    const references = useLcosReferenceStore.getState().nodeEntityRefs;
    const exactSource = reader.readerSource;
    const exactRef = exactSource === undefined ? undefined : references.get(exactSource.nodeId);
    let nodeId = exactRef?.entityType === 'artifact' && exactRef.entityId === reader.target
      ? exactSource?.nodeId
      : undefined;
    if (nodeId === undefined) {
      for (const [candidateNodeId, ref] of references) {
        if (ref.entityType === 'artifact' && ref.entityId === reader.target) {
          nodeId = candidateNodeId;
          break;
        }
      }
    }
    const surface = nodeId === exactSource?.nodeId && exactSource !== undefined
      ? exactSource.surface
      : useLcosShellStore.getState().activeSurface;
    closeWindow(reader.id);
    requestLocate(nodeId === undefined
      ? { reqId: `reader-return-${crypto.randomUUID()}`, surface, status: 'unprojected' }
      : { reqId: `reader-return-${crypto.randomUUID()}`, surface, nodeId, status: 'projected' });
  }, [closeWindow, requestLocate]);
  const placements = useMemo(() => {
    if (compact) return new Map(visibleEntries.map((entry) => [
      entry.region.id, professionalFloatingBoundsV1(viewport),
    ] as const));
    return new Map(
      deriveProfessionalStageRegionPlacementsV1({
        viewport,
        regions: visibleEntries.map((entry) => ({
          regionId: entry.region.id,
          layout: entry.region.layout,
          preferredWidth: entry.preferredWidth,
          bodyKey: entry.activeWindow.bodyKey,
          ...(entry.region.rect === undefined ? {} : { rect: entry.region.rect }),
          ...(entry.region.dockWidth === undefined ? {} : { dockWidth: entry.region.dockWidth }),
        })),
      }).map((placement) => [placement.regionId, placement.rect] as const),
    );
  }, [compact, visibleEntries, viewport]);

  /** 当前实际生效的区域几何（显式 placement 优先，否则读 DOM 的 CSS 默认值）。 */
  const rectFor = useCallback((regionId: string): ProfessionalRectV1 | undefined => {
    const placement = placements.get(regionId);
    if (placement !== undefined) return placement;
    const element = regionElements.current.get(regionId);
    if (element === undefined) return undefined;
    const r = element.getBoundingClientRect();
    return { x: r.x, y: r.y, width: r.width, height: r.height };
  }, [placements]);

  /**
   * R2-B move / resize 手势。
   *
   * 拖拽期间只写 DOM style（不逐帧 setState），pointerup 才把最终几何提交进
   * `windowRegions` —— 几何真相仍只有 store 一份，body 不保存 x/y/dock，
   * 全程不碰 Canvas camera / selection。
   */
  const publishDuringGesture = useRef<(() => void) | null>(null);

  const beginWindowGesture = useCallback((
    event: React.PointerEvent<HTMLElement>,
    region: LcosWindowRegion,
    kind: 'move' | 'resize' | 'tab',
    handle?: ProfessionalResizeHandleV1,
    tabWindowId?: string,
  ): void => {
    if (event.button !== 0 || event.isPrimary === false) return;
    const targetElement = event.target as HTMLElement;
    const tabId = kind === 'tab'
      ? tabWindowId ?? targetElement.closest<HTMLElement>('[data-lcos-window-tab-value]')?.getAttribute('data-lcos-window-tab-value') ?? undefined
      : undefined;
    if (kind === 'tab' && tabId === undefined) return;
    if (kind === 'move' && targetElement.closest('button,input,textarea,select,a,[contenteditable="true"]') !== null) return;
    splitterCleanupRef.current?.();
    gestureCleanupRef.current?.();
    const sourceProjectId = useLcosShellStore.getState().projectId;
    const sourceRegion = useLcosShellStore.getState().windowRegions.find((item) => item.id === region.id);
    if (sourceRegion === undefined) return;
    const isCurrent = (): boolean => useLcosShellStore.getState().projectId === sourceProjectId
      && currentViewport().width === viewportBounds.width && currentViewport().height === viewportBounds.height
      && sameProfessionalRegionLayout(sourceRegion, useLcosShellStore.getState().windowRegions.find((item) => item.id === region.id));
    const element = regionElements.current.get(region.id);
    const startRect = rectFor(region.id);
    if (element === undefined || startRect === undefined) return;
    event.preventDefault();
    event.stopPropagation();
    const viewportBounds = currentViewport();
    const floatingBounds = professionalFloatingBoundsV1(viewportBounds);
    const initialStyle: WindowGestureStyle = {
      left: element.style.left, top: element.style.top, right: element.style.right,
      bottom: element.style.bottom, width: element.style.width, height: element.style.height,
    };
    const gesture: {
      pointerId: number;
      startRect: ProfessionalRectV1;
      latest: ProfessionalRectV1;
      startX: number;
      startY: number;
      moved: boolean;
      docked: boolean;
      handle: ProfessionalResizeHandleV1;
      kind: 'move' | 'resize' | 'tab';
      tabWindowId?: string;
      target?: ProfessionalWindowDropAction;
      floatRect?: ProfessionalRectV1;
    } = {
      pointerId: event.pointerId, startRect, startX: event.clientX, startY: event.clientY,
      latest: startRect, moved: false, docked: region.layout === 'docked-right',
      handle: handle ?? 'se', kind, ...(tabId === undefined ? {} : { tabWindowId: tabId }),
    };

    const restoreStyle = (): void => {
      element.style.left = initialStyle.left; element.style.top = initialStyle.top;
      element.style.right = initialStyle.right; element.style.bottom = initialStyle.bottom;
      element.style.width = initialStyle.width; element.style.height = initialStyle.height;
    };
    const dropRegions = (): readonly ProfessionalWindowDropRegionTarget[] => useLcosShellStore.getState().windowRegions.flatMap((currentRegion) => {
      const entry = { region: currentRegion };
      const host = regionElements.current.get(entry.region.id);
      if (!host || host.inert || getComputedStyle(host).display === 'none') return [];
      const bounds = host.getBoundingClientRect();
      if (bounds.width <= 0 || bounds.height <= 0) return [];
      const panes = [...host.querySelectorAll<HTMLElement>('[data-lcos-window-pane]')].map((pane) => {
        const paneBounds = pane.getBoundingClientRect();
        const groupId = pane.getAttribute('data-lcos-window-pane');
        return groupId === null || paneBounds.width <= 0 || paneBounds.height <= 0
          ? undefined
          : { groupId, rect: { x: paneBounds.x, y: paneBounds.y, width: paneBounds.width, height: paneBounds.height },
            tabs: [...pane.querySelectorAll<HTMLElement>('[data-lcos-window-tab-value]')].flatMap((tab) => {
              const windowId = tab.getAttribute('data-lcos-window-tab-value');
              const r = tab.getBoundingClientRect();
              return windowId && r.width > 0 ? [{ windowId, rect: { x: r.x, y: r.y, width: r.width, height: r.height } }] : [];
            }),
          };
      }).filter((pane): pane is NonNullable<typeof pane> => pane !== undefined);
      const groups = panes.length > 0 ? panes : entry.region.groups.map((group) => ({
        groupId: group.id,
        rect: { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height },
      }));
      return [{
        regionId: entry.region.id,
        rect: { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height },
        groups,
        canSplit: entry.region.groups.length === 1 && groups.length === 1,
      }];
    }).reverse().sort((a, b) => {
      const aZ = Number.parseInt(getComputedStyle(regionElements.current.get(a.regionId) ?? element).zIndex, 10) || 0;
      const bZ = Number.parseInt(getComputedStyle(regionElements.current.get(b.regionId) ?? element).zIndex, 10) || 0;
      return bZ - aZ;
    });

    const showPreview = (action: ProfessionalWindowDropAction | { readonly kind: 'float'; readonly rect: ProfessionalRectV1 }): void => {
      const label = action.kind === 'dock-right' ? '停靠到右侧'
        : action.kind === 'group' ? '并入此窗口组'
          : action.kind === 'split' ? action.direction === 'vertical'
            ? action.sourceFirst ? '在左侧分屏' : '在右侧分屏'
            : action.sourceFirst ? '在上方分屏' : '在下方分屏'
            : '拆出为浮动窗口';
      setDropPreview({ action, label });
    };

    const onMove = (moveEvent: PointerEvent): void => {
      if (moveEvent.pointerId !== gesture.pointerId) return;
      const delta = { x: moveEvent.clientX - gesture.startX, y: moveEvent.clientY - gesture.startY };
      if (!gesture.moved && Math.hypot(delta.x, delta.y) < 4) return;
      gesture.moved = true;
      if (gesture.kind === 'tab') {
        const action = resolveProfessionalWindowDropTarget({
          x: moveEvent.clientX, y: moveEvent.clientY, sourceRegionId: region.id, allowSourceRegion: true,
          viewport: viewportBounds, preferredDockWidth: startRect.width, regions: dropRegions(),
        });
        gesture.target = action;
        const floatRect = clampProfessionalRectV1({
          x: moveEvent.clientX - startRect.width / 2, y: moveEvent.clientY - 24,
          width: startRect.width, height: startRect.height,
        }, floatingBounds, PROFESSIONAL_STAGE_MIN_WIDTH, PROFESSIONAL_STAGE_MIN_HEIGHT);
        gesture.floatRect = floatRect;
        showPreview(action ?? { kind: 'float', rect: floatRect });
        return;
      }
      const bounds = gesture.kind === 'move' ? floatingBounds : gesture.docked ? viewportBounds : floatingBounds;
      const next = gesture.kind === 'move'
        ? clampProfessionalRectV1(
            { ...startRect, x: startRect.x + delta.x, y: startRect.y + delta.y },
            bounds, PROFESSIONAL_STAGE_MIN_WIDTH, PROFESSIONAL_STAGE_MIN_HEIGHT,
          )
        : resizeProfessionalRectV1(
            startRect, gesture.handle, delta, bounds,
            PROFESSIONAL_STAGE_MIN_WIDTH, PROFESSIONAL_STAGE_MIN_HEIGHT,
          );
      if (gesture.docked && gesture.kind === 'resize') {
        const width = professionalDockWidth(viewportBounds, viewportBounds.x + viewportBounds.width - next.x);
        gesture.latest = { x: viewportBounds.x + viewportBounds.width - width, y: startRect.y, width, height: startRect.height };
      } else gesture.latest = next;
      if (gesture.kind === 'move' || gesture.kind === 'resize') {
        element.style.left = `${gesture.latest.x}px`; element.style.top = `${gesture.latest.y}px`;
        element.style.right = ''; element.style.bottom = '';
        element.style.width = `${gesture.latest.width}px`; element.style.height = `${gesture.latest.height}px`;
      }
      if (gesture.kind === 'move') {
        const action = resolveProfessionalWindowDropTarget({
          x: moveEvent.clientX, y: moveEvent.clientY, sourceRegionId: region.id,
          viewport: viewportBounds, preferredDockWidth: gesture.latest.width, regions: dropRegions(),
        });
        gesture.target = action;
        if (action !== undefined) showPreview(action);
        else setDropPreview(null);
      }
      publishDuringGesture.current?.();
    };

    const restore = (): void => {
      // Cancellation after a source mutation must render the NEW store geometry,
      // not write a stale inline rectangle over the new layout.
      if (isCurrent()) restoreStyle();
      else {
        const live = useLcosShellStore.getState();
        if (live.projectId === sourceProjectId) {
          const entries = materializeRegionEntries(live.windows, live.windowRegions);
          const current = entries.find((entry) => entry.region.id === region.id);
          if (current !== undefined) {
            const view = currentViewport();
            const visible = visibleWindowIdsForStage(live.windows, live.windowRegions, view);
            const next = visible.compact ? professionalFloatingBoundsV1(view) : deriveProfessionalStageRegionPlacementsV1({ viewport: view,
              regions: entries.map((entry) => ({ regionId: entry.region.id, layout: entry.region.layout, preferredWidth: entry.preferredWidth,
                bodyKey: entry.activeWindow.bodyKey, rect: entry.region.rect, dockWidth: entry.region.dockWidth })) }).find((item) => item.regionId === region.id)?.rect;
            if (next !== undefined) Object.assign(element.style, { left: `${next.x}px`, top: `${next.y}px`, right: '', bottom: '', width: `${next.width}px`, height: `${next.height}px` });
          }
        }
      }
      setDropPreview(null);
      publishDuringGesture.current?.();
      gestureCleanupRef.current = null;
    };
    const onUp = (upEvent: PointerEvent): void => {
      const oldTarget = gesture.target;
      const inside = upEvent.clientX >= viewportBounds.x && upEvent.clientY >= viewportBounds.y
        && upEvent.clientX <= viewportBounds.x + viewportBounds.width
        && upEvent.clientY <= viewportBounds.y + viewportBounds.height;
      if (!inside || !gesture.moved) { restore(); return; }
      const freshTarget = gesture.kind === 'resize' ? undefined : resolveProfessionalWindowDropTarget({
        x: upEvent.clientX, y: upEvent.clientY, sourceRegionId: region.id,
        allowSourceRegion: gesture.kind === 'tab', viewport: viewportBounds,
        preferredDockWidth: gesture.kind === 'tab' ? startRect.width : gesture.latest.width, regions: dropRegions(),
      });
      if (gesture.kind !== 'resize' && !sameProfessionalDropTarget(oldTarget, freshTarget)) { restore(); return; }
      // Include a pointerup's final coordinates for geometry, but never silently
      // reinterpret a new destination without the previous matching preview.
      onMove(upEvent);
      restoreStyle();
      setDropPreview(null);
      gestureCleanupRef.current = null;
      const store = useLcosShellStore.getState();
      if (gesture.kind === 'resize') {
        if (gesture.docked) store.setWindowRegionDockWidth(region.id, gesture.latest.width);
        else store.setWindowRegionRect(region.id, gesture.latest);
      } else if (gesture.kind === 'move') {
        if (freshTarget?.kind === 'dock-right') store.dockWindowRegionRight(region.id, freshTarget.rect.width);
        else if (freshTarget?.kind === 'group') store.groupWindowRegionInto(region.id, freshTarget.regionId, freshTarget.groupId);
        else if (freshTarget?.kind === 'split') store.splitWindowRegionInto(region.id, freshTarget.regionId, freshTarget.groupId, freshTarget.direction, freshTarget.sourceFirst);
        else store.floatWindowRegionAt(region.id, gesture.latest);
      } else if (gesture.tabWindowId !== undefined) {
        suppressTabClickRef.current = true;
        // Cleared by the next pointerdown/click rather than a timer racing click dispatch.
        if (freshTarget?.kind === 'dock-right') store.detachWindowToDockRight(gesture.tabWindowId, freshTarget.rect.width);
        else if (freshTarget?.kind === 'group') store.moveWindowToGroup(gesture.tabWindowId, freshTarget.regionId, freshTarget.groupId, freshTarget.beforeWindowId);
        else if (freshTarget?.kind === 'split') store.splitWindowToGroup(gesture.tabWindowId, freshTarget.regionId, freshTarget.groupId, freshTarget.direction, freshTarget.sourceFirst);
        else store.detachWindowToRegion(gesture.tabWindowId, gesture.floatRect ?? gesture.latest);
        store.activateWindow(gesture.tabWindowId);
      }
      publishDuringGesture.current?.();
    };
    gestureCleanupRef.current = beginProfessionalPointerGesture({
      start: event, capture: kind === 'tab' ? targetElement.closest<HTMLElement>('[data-lcos-window-tab-value]') ?? event.currentTarget : event.currentTarget, document, window,
      isCurrent, onMove, onCommit: onUp, onCancel: restore,
    });
  }, [rectFor]);

  const beginSplitGesture = (event: React.PointerEvent<HTMLElement>, region: LcosWindowRegion): void => {
    if (event.button !== 0 || event.isPrimary === false || region.splitDirection === undefined) return;
    splitterCleanupRef.current?.(); gestureCleanupRef.current?.();
    const host = event.currentTarget.parentElement;
    if (host === null) return;
    const direction = region.splitDirection;
    const bounds = host.getBoundingClientRect();
    const rect = { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height };
    const panes = [...host.querySelectorAll<HTMLElement>('[data-lcos-window-pane]')];
    const originals = panes.map((pane) => pane.style.flex);
    const sourceProjectId = useLcosShellStore.getState().projectId;
    const startViewport = currentViewport();
    const source = useLcosShellStore.getState().windowRegions.find((item) => item.id === region.id);
    if (source === undefined) return;
    const isCurrent = (): boolean => sourceProjectId === useLcosShellStore.getState().projectId
      && currentViewport().width === startViewport.width && currentViewport().height === startViewport.height
      && sameProfessionalRegionLayout(source, useLcosShellStore.getState().windowRegions.find((item) => item.id === region.id));
    const restore = (): void => {
      if (isCurrent()) panes.forEach((pane, index) => { pane.style.flex = originals[index] ?? ''; });
      else {
        const current = useLcosShellStore.getState().windowRegions.find((item) => item.id === region.id);
        if (current && current.groups.length === 2 && current.splitDirection) {
          const latest = host.getBoundingClientRect();
          const ratio = clampProfessionalSplitRatio(current.splitRatio ?? 0.5, current.splitDirection === 'vertical' ? latest.width : latest.height, current.splitDirection);
          if (panes[0]) panes[0].style.flex = `${ratio} 1 0%`;
          if (panes[1]) panes[1].style.flex = `${1 - ratio} 1 0%`;
        }
      }
      splitterCleanupRef.current = null; publishDuringGesture.current?.();
    };
    const update = (sample: { clientX: number; clientY: number }): number => {
      const ratio = professionalSplitRatioAtPoint(rect, direction, { x: sample.clientX, y: sample.clientY });
      if (panes[0]) panes[0].style.flex = `${ratio} 1 0%`;
      if (panes[1]) panes[1].style.flex = `${1 - ratio} 1 0%`;
      publishDuringGesture.current?.();
      return ratio;
    };
    event.preventDefault(); event.stopPropagation();
    splitterCleanupRef.current = beginProfessionalPointerGesture({
      start: event, capture: event.currentTarget, document, window, isCurrent,
      onMove: update,
      onCommit: (sample) => {
        const ratio = update(sample); restore();
        useLcosShellStore.getState().setWindowRegionSplitRatio(region.id, ratio);
      },
      onCancel: restore,
    });
  };

  useLayoutEffect(() => {
    if (windows.length === 0 || visibleEntries.length === 0) {
      clearWindowEnvironment();
      return undefined;
    }

    const publish = (): void => {
      const regions = visibleEntries.flatMap((entry) => {
        const element = regionElements.current.get(entry.region.id);
        if (element === undefined) return [];
        const rect = element.getBoundingClientRect();
        return [{
          regionId: entry.region.id,
          layout: entry.region.layout,
          rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
        }];
      });
      if (regions.length === 0) {
        clearWindowEnvironment();
        return;
      }
      publishWindowEnvironment(deriveProfessionalWindowEnvironmentV1({
        viewport,
        activeRegionId,
        regions,
      }));
    };

    let publishFrame: number | undefined;
    const schedulePublish = (): void => {
      if (publishFrame !== undefined) return;
      publishFrame = window.requestAnimationFrame(() => { publishFrame = undefined; publish(); });
    };
    publishDuringGesture.current = schedulePublish;
    publish();
    const observer = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(publish);
    for (const entry of visibleEntries) {
      const element = regionElements.current.get(entry.region.id);
      if (element !== undefined) observer?.observe(element);
    }
    window.addEventListener('scroll', publish, true);
    return () => {
      if (publishDuringGesture.current === schedulePublish) publishDuringGesture.current = null;
      if (publishFrame !== undefined) window.cancelAnimationFrame(publishFrame);
      observer?.disconnect();
      window.removeEventListener('scroll', publish, true);
    };
  }, [activeRegionId, clearWindowEnvironment, publishWindowEnvironment, visibleEntries, viewport, windows.length]);

  const returnComposerFromWindow = (item: LcosWindow): boolean => {
    const originKey = item.composerOriginKey;
    const current = useLcosShellStore.getState();
    if (originKey === undefined || current.projectId !== projectId
      || composerInputKey(current.composerTarget) !== originKey) return false;

    if (item.bodyKey === 'assembly') {
      // An Assembly Composer owns its own window; end the picker mode in place.
      if (current.composerTarget?.nodeId.startsWith('assembly:')) {
        if (!current.resumeComposer(originKey)) return false;
        const owner = useLcosShellStore.getState().windows.find((window) => window.id === item.id);
        if (owner) useLcosShellStore.getState().openAssembly(
          owner.assemblyTargetRef ?? { kind: 'main' }, owner.title, owner.assemblyFollowsWorksite ?? false,
        );
        return true;
      }

    }

    if (item.bodyKey !== 'assembly' && item.bodyKey !== 'reader') return false;
    // Close only the borrowed Assembly/Reader before asking the original
    // Conversation/Canvas owner to reclaim the same input.
    closeWindow(item.id);
    if (!useLcosShellStore.getState().resumeComposer(originKey)) return false;
    const restored = useLcosShellStore.getState();
    const visibleIds = visibleWindowIdsForStage(
      restored.windows, restored.windowRegions, currentProfessionalViewport(),
    ).windowIds;
    if (!composerHasVisibleWindowOwner(restored.composerTarget, restored.windows, visibleIds)) {
      useCanvasAttentionStore.getState().setCanvasEngaged(true);
    }
    return true;
  };
  const returnReader = (reader: LcosWindow): void => {
    if (reader.composerOriginKey === undefined) {
      returnReaderToSource(reader);
      return;
    }
    if (!returnComposerFromWindow(reader)) closeWindow(reader.id);
  };
  const close = (item: LcosWindow): void => {
    if (item.bodyKey === 'reader') returnReader(item);
    else if (item.bodyKey === 'assembly' && item.composerOriginKey !== undefined) {
      if (!returnComposerFromWindow(item)) closeWindow(item.id);
    }
    else closeWindow(item.id);
  };

  // Esc 栈：Professional Stage 只关闭全局前景窗口；inline Composer 仍先消费一次 Esc.
  useCloseOnEscape(windows.length > 0 && !inlineComposerOpen, () => {
    if (active === undefined) return;
    if (active.bodyKey === 'reader') returnReader(active);
    else close(active);
  });
  const activate = (id: string): void => {
    useCanvasAttentionStore.getState().setCanvasEngaged(false);
    activateWindow(id);
  };
  const handleChromePointer = (event: React.PointerEvent<HTMLElement>, region: LcosWindowRegion): void => {
    if (event.button !== 0) return;
    suppressTabClickRef.current = false;
    const tab = (event.target as HTMLElement).closest<HTMLElement>('[data-lcos-window-tab-value]');
    if (tab !== null && event.pointerType === 'touch') return;
    if (tab !== null) beginWindowGesture(event, region, 'tab', undefined, tab.getAttribute('data-lcos-window-tab-value') ?? undefined);
    else beginWindowGesture(event, region, 'move');
  };
  const consumeDraggedTabClick = (event: React.MouseEvent<HTMLElement>): void => {
    if (!suppressTabClickRef.current || !(event.target as HTMLElement).closest('[data-lcos-window-tab-value]')) return;
    suppressTabClickRef.current = false;
    event.preventDefault(); event.stopPropagation();
  };
  const body = (item: LcosWindow): React.JSX.Element => <ProfessionalBody
    key={`${projectId}:${item.id}`} projectId={projectId} bodyKey={item.bodyKey}
    onClose={() => close(item)}
    {...(item.composerOriginKey === undefined ? {} : { composerOriginKey: item.composerOriginKey,
      onReturnComposer: () => { returnComposerFromWindow(item); } })}
    {...(item.target === undefined ? {} : { target: item.target })}
    {...(item.targetKind === undefined ? {} : { targetKind: item.targetKind })}
    {...(item.portalWorkspaceId === undefined ? {} : { portalWorkspaceId:item.portalWorkspaceId })}
    {...(item.portalSourceNodeId === undefined ? {} : { portalSourceNodeId:item.portalSourceNodeId })}
    {...(item.assemblyTargetRef === undefined ? {} : { assemblyTargetRef: item.assemblyTargetRef })}
    {...(item.bodyKey !== 'portal-preview' || resolvePortalTarget === undefined ? {} : {
      portalTargetResolution: item.targetKind === 'canvas' && item.target !== undefined && item.portalWorkspaceId !== undefined ? resolvePortalTarget(item.target,item.portalWorkspaceId,item.portalSourceNodeId) ?? null : null,
    })}
    {...(onOpenPortalTarget === undefined ? {} : { onOpenPortalTarget })}
    {...(item.readerRevisionId === undefined ? {} : { readerRevisionId: item.readerRevisionId })}
    {...(item.bodyKey !== 'reader' ? {} : { onReturnReaderSource: () => returnReaderToSource(item) })}
  />;

  if (windows.length === 0) return <div data-lcos-professional-stage data-empty="true" className="hidden" aria-hidden />;
  const visibleIds = new Set(visibility.windowIds);
  return (
    <div data-lcos-professional-stage data-compact={compact ? 'true' : undefined} className="pointer-events-none fixed inset-0 z-40">
      {regionEntries.map((entry) => {
        const { region, windows: regionWindows } = entry;
        const regionActive = regionWindows.find((item) => item.id === activeWindowIdForRegion(region)) ?? entry.activeWindow;
        const isGlobalActive = regionWindows.some((item) => item.id === active?.id);
        const regionVisible = regionWindows.some((item) => visibleIds.has(item.id));
        const readerShell = regionWindows.every((item) => item.bodyKey === 'reader');
        const placement = placements.get(region.id) ?? professionalFloatingBoundsV1(viewport);
        const docked = !compact && region.layout === 'docked-right';
        const groups = region.groups;
        const split = !compact && groups.length === 2;
        const direction = region.splitDirection ?? 'vertical';
        const span = direction === 'vertical' ? placement.width : Math.max(0, placement.height - (readerShell ? 48 : 0));
        const ratio = clampProfessionalSplitRatio(region.splitRatio ?? 0.5, span, direction);
        const limits = professionalSplitLimits(span, direction);
        const primaryPaneId = `lcos-professional-pane-${groups[0]?.id ?? region.id}`;
        return <div key={region.id}
          ref={(element) => { if (element === null) regionElements.current.delete(region.id); else regionElements.current.set(region.id, element); }}
          data-lcos-window-region-id={region.id} data-lcos-window-layout={region.layout}
          data-lcos-window-active-body={regionActive.bodyKey}
          inert={!regionVisible || undefined} aria-hidden={!regionVisible || undefined}
          className={`lcos-professional-region ${readerShell ? 'lcos-reader-window-shell' : ''}`}
          onPointerDownCapture={(event) => {
            useCanvasAttentionStore.getState().setCanvasEngaged(false);
            if (event.button === 0) suppressTabClickRef.current = false;
            if (!(event.target as HTMLElement).closest('[data-lcos-window-pane]') && !isGlobalActive) activate(regionActive.id);
          }}
          style={{ left: placement.x, top: placement.y, width: placement.width, height: placement.height,
            display: regionVisible ? undefined : 'none', borderRadius: docked ? 0 : regionActive.bodyKey === 'assembly' ? 18 : 16,
            background: lcosTokens.color.surface, zIndex: isGlobalActive ? 2 : 1 }}>
          {readerShell && <div data-lcos-window-drag-handle="enabled" onPointerDown={(event) => handleChromePointer(event, region)} onClickCapture={consumeDraggedTabClick}>
            <LcosWindowChrome layout={split || compact || regionWindows.length > 1 ? '分组' : docked ? '停靠' : '浮动'} title={regionActive.title}
              tabs={compact ? windows.map((item) => ({ key: item.bodyKey, value: item.id, label: item.title, selected: item.id === active?.id })) : undefined}
              onSelectTab={activate}
              primaryActions={<button type="button" data-lcos-window-icon-button aria-label="关闭窗口" onClick={() => close(regionActive)}><X className="h-4 w-4" /></button>} />
          </div>}
          <div className="lcos-professional-panes" style={{ flexDirection: split && direction === 'vertical' ? 'row' : 'column' }}>
            {groups.map((group, index) => {
              const members = group.windowIds.flatMap((id) => { const item = regionWindows.find((window) => window.id === id); return item ? [item] : []; });
              const selected = members.find((item) => item.id === group.activeWindowId) ?? members.at(-1);
              if (selected === undefined) return null;
              const paneVisible = regionVisible && (!compact || members.some((item) => item.id === active?.id));
              const tabs = (compact ? windows : members).map((item) => ({ key: item.bodyKey, value: item.id, label: item.title, selected: item.id === (compact ? active?.id : selected.id) }));
              return <Fragment key={group.id}>
                {/* eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions -- W3C APG Window Splitter treats a focusable separator as the widget (https://www.w3.org/WAI/ARIA/apg/patterns/windowsplitter/). */}
                {index === 1 && split && <div role="separator" tabIndex={0} data-lcos-window-splitter
                  className="lcos-professional-splitter" aria-label="调整分屏比例" aria-orientation={direction === 'horizontal' ? 'horizontal' : 'vertical'}
                  aria-controls={primaryPaneId}
                  aria-valuemin={Math.round(limits.min * 100)} aria-valuemax={Math.round(limits.max * 100)} aria-valuenow={Math.round(ratio * 100)}
                  onPointerDown={(event) => beginSplitGesture(event, region)}
                  onKeyDown={(event) => {
                    if (event.nativeEvent.isComposing || event.ctrlKey || event.metaKey || event.altKey) return;
                    const delta = event.shiftKey ? 0.1 : 0.05;
                    const minus = event.key === (direction === 'horizontal' ? 'ArrowUp' : 'ArrowLeft');
                    const plus = event.key === (direction === 'horizontal' ? 'ArrowDown' : 'ArrowRight');
                    const next = event.key === 'Home' ? limits.min : event.key === 'End' ? limits.max : minus ? ratio - delta : plus ? ratio + delta : undefined;
                    if (next === undefined) return;
                    event.preventDefault(); event.stopPropagation();
                    useLcosShellStore.getState().setWindowRegionSplitRatio(region.id, clampProfessionalSplitRatio(next, span, direction));
                  }} />}
                <section id={`lcos-professional-pane-${group.id}`} data-lcos-window-pane={group.id} className="lcos-professional-pane" aria-label={selected.title}
                  hidden={!paneVisible} inert={!paneVisible || undefined}
                  onFocusCapture={() => activate(selected.id)} onPointerDownCapture={() => activate(selected.id)}
                  style={{ display: paneVisible ? 'flex' : 'none', flex: split ? `${index === 0 ? ratio : 1 - ratio} 1 0%` : '1 1 100%' }}>
                  {readerShell ? !compact && <div className="lcos-reader-pane-tabs" data-lcos-window-drag-handle="enabled"
                    onPointerDown={(event) => handleChromePointer(event, region)} onClickCapture={consumeDraggedTabClick}>
                    <ReaderContentTabsView label={`阅读组 ${index + 1}`} items={members.map((item) => ({ id: item.id,
                      label: item.title.replace(/^阅读\s*·\s*/, ''), selected: item.id === selected.id }))} onActivate={activate} />
                  </div> : <div {...(selected.bodyKey === 'assembly' ? { 'data-lcos-assembly-fixed-right': 'true' } : {
                    'data-lcos-window-drag-handle': 'enabled',
                    onPointerDown: (event: React.PointerEvent<HTMLDivElement>) => handleChromePointer(event, region),
                    onClickCapture: consumeDraggedTabClick,
                  })}>
                    <LcosWindowChrome layout={compact || members.length > 1 ? '分组' : docked ? '停靠' : '浮动'} title={selected.title}
                      tabs={compact || members.length > 1 ? tabs : undefined} onSelectTab={activate}
                      primaryActions={<button type="button" data-lcos-window-icon-button aria-label="关闭窗口" onClick={() => close(selected)}><X className="h-4 w-4" /></button>} />
                  </div>}
                  <div className="lcos-professional-reader-slots">
                    {members.filter((item) => item.bodyKey === 'reader').map((item) => <div key={item.id}
                      ref={slotRef(item.id)} data-lcos-window-body="reader" data-lcos-window-target={item.target}
                      hidden={item.id !== selected.id} className="lcos-professional-body-slot" />)}
                    {selected.bodyKey !== 'reader' && <div data-lcos-window-body={selected.bodyKey} data-lcos-window-target={selected.target}
                      className="lcos-professional-body-slot" style={{ background: lcosTokens.color.canvas }}>{body(selected)}</div>}
                  </div>
                  {readerShell && split && <footer className="lcos-reader-pane-footer" data-side={index === 0 ? 'start' : 'end'}>
                    {index === 0 ? <LcosButton type="button" appearance="oreo" variant="secondary" data-lcos-reader-merge-groups
                      onClick={() => useLcosShellStore.getState().mergeWindowRegionGroups(region.id)}>合回同一窗口</LcosButton>
                      : <LcosButton type="button" appearance="oreo" variant="secondary" data-lcos-reader-detach-group onClick={() => {
                        const pane = regionElements.current.get(region.id)?.querySelector<HTMLElement>(`[data-lcos-window-pane="${CSS.escape(group.id)}"]`);
                        if (!pane) return;
                        const rect = pane.getBoundingClientRect();
                        const next = clampProfessionalRectV1({ x: rect.x, y: rect.y, width: rect.width, height: rect.height },
                          professionalFloatingBoundsV1(currentViewport()), PROFESSIONAL_STAGE_MIN_WIDTH, PROFESSIONAL_STAGE_MIN_HEIGHT);
                        useLcosShellStore.getState().detachWindowGroupToRegion(region.id, group.id, next);
                      }}>拆出这一组</LcosButton>}
                  </footer>}
                </section>
              </Fragment>;
            })}
          </div>
          {(docked ? (['w'] as const) : RESIZE_HANDLES).map((handle) => <button key={handle} type="button"
            data-lcos-window-resize={handle} aria-label={docked ? '调整停靠宽度' : `调整窗口 · ${handle}`}
            className={`absolute z-10 rounded-sm bg-transparent hover:bg-black/5 ${RESIZE_HANDLE_CLASS[handle]}`}
            onPointerDown={(event) => beginWindowGesture(event, region, 'resize', handle)} />)}
        </div>;
      })}
      {windows.filter((item) => item.bodyKey === 'reader').map((item) => <RetainedReaderBody key={`${projectId}:${item.id}`}
        slot={readerSlots.get(item.id)} visible={visibleIds.has(item.id)} onActivate={() => activate(item.id)}>{body(item)}</RetainedReaderBody>)}
      {dropPreview !== null && (() => {
        const rect = dropPreview.action.kind === 'float' ? dropPreview.action.rect : dropPreview.action.previewRect;
        return <div data-lcos-window-drop-preview aria-live="polite" className="pointer-events-none fixed rounded-xl border border-slate-500/70 bg-slate-500/[0.04]"
          style={{ left: rect.x, top: rect.y, width: rect.width, height: rect.height, zIndex: 60 }}>
          <span className="absolute top-2 whitespace-nowrap rounded-md bg-slate-900/80 px-2 py-1 text-xs text-white"
            style={dropPreview.action.kind === 'dock-right' ? { right: 36, top: '50%', transform: 'translateY(-50%)' } : { left: 8 }}>{dropPreview.label}</span>
        </div>;
      })()}
    </div>
  );
}

function ProfessionalBody({
  onClose,
  projectId,
  bodyKey,
  target,
  targetKind,
  assemblyTargetRef,
  portalTargetResolution,
  portalWorkspaceId,
  portalSourceNodeId,
  onOpenPortalTarget,
  readerRevisionId,
  onReturnReaderSource,
  composerOriginKey,
  onReturnComposer,
}: {
  projectId: string;
  bodyKey: string;
  onClose: () => void;
  target?: string;
  targetKind?: 'canvas';
  assemblyTargetRef?: AssemblyTargetRefV1;
  portalTargetResolution?: PortalTargetResolution | null;
  portalWorkspaceId?: string;
  portalSourceNodeId?: string;
  onOpenPortalTarget?: (target: PortalTargetResolution, signal?: AbortSignal) => Promise<boolean>;
  readerRevisionId?: string;
  onReturnReaderSource?: () => void;
  composerOriginKey?: string;
  onReturnComposer?: () => void;
}): React.JSX.Element {
  switch (bodyKey) {
    case 'assembly':
      return (
        <AssemblyBody
          projectId={projectId}
          targetRef={assemblyTargetRef ?? { kind: 'main' }}
          {...(composerOriginKey === undefined ? {} : { composerOriginKey })}
          {...(onReturnComposer === undefined ? {} : { onReturnComposer })}
        />
      );
    case 'reader':
      return (
        <ArtifactReaderBody
          projectId={projectId}
          artifactId={target}
          {...(composerOriginKey === undefined ? {} : { composerOriginKey })}
          {...(onReturnComposer === undefined ? {} : { onReturnToComposer: onReturnComposer })}
          {...(readerRevisionId === undefined ? {} : { revisionId: readerRevisionId })}
          {...(onReturnReaderSource === undefined ? {} : { onReturnToSource: onReturnReaderSource })}
        />
      );
    case 'run-review':
      return <RunWorkViewBody key={`${projectId}:${target ?? ''}`} projectId={projectId} runId={target} />;
    case 'archive':
      return <ArchiveBody projectId={projectId} />;
    case 'conversation':
      return <ConversationWorkViewBody projectId={projectId} connectedConversationId={target} />;
    case 'collection':
      return <CollectionWorkViewBody projectId={projectId} collectionId={target} />;
    case 'native-preview':
      return <NativeNodePreviewBody nodeId={target} onClose={onClose} />;
    case 'portal-preview':
      return (
        <PortalPreviewBody
          onClose={onClose}
          workspaceId={portalWorkspaceId}
          sourceNodeId={portalSourceNodeId}
          projectId={projectId}
          target={target}
          {...(targetKind ? { targetKind } : {})}
          {...(portalTargetResolution === undefined ? {} : { portalTargetResolution })}
          {...(onOpenPortalTarget === undefined ? {} : { onOpenPortalTarget })}
        />
      );
    case 'runtime-doctor':
      return <RuntimeDoctorBody onClose={onClose} />;
    case 'capture-inbox':
    case 'connector-source':
      // 尚无生产 caller；若由旧状态恢复，只给用户可理解的不可用状态。
      return (
        <div className="flex h-full min-h-[220px] items-center justify-center">
          <span className="text-sm" style={{ color: lcosTokens.color.muted }}>
            此工具当前不可用
          </span>
        </div>
      );
    default:
      return <></>;
  }
}

// 供 stage body 共享玻璃语言
export { lcosGlassStyle };
