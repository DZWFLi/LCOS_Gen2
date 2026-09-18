// ProfessionalWindowStage — route-level 专业窗口舞台（Figma window 5388:27165 / Chrome 5387:331）。
// Stage 是唯一 Window topology + geometry producer；body 数据来自 Core。
// 多个 window region 保持独立，只有显式 group 才共享 tab chrome。

import { Columns2, Group, Pin, Ungroup, X } from 'lucide-react';
import { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react';

import { useCloseOnEscape } from '@/hooks/useCloseOnEscape';

import {
  clampProfessionalRectV1,
  deriveProfessionalWindowEnvironmentV1,
  resizeProfessionalRectV1,
} from '@local-creative-os/web-gen2';

import { ArtifactReaderBody } from './ArtifactReaderBody';
import { AssemblyBody } from './AssemblyBody';
import { ConversationWorkViewBody } from './ConversationWorkViewBody';
import { PortalPreviewBody } from './PortalPreviewBody';
import {
  deriveProfessionalStageRegionPlacementsV1,
  professionalFloatingBoundsV1,
  PROFESSIONAL_STAGE_MIN_HEIGHT,
  PROFESSIONAL_STAGE_MIN_WIDTH,
} from './professionalWindowStageLayout';
import { useLcosShellStore, type LcosWindow, type LcosWindowRegion } from '../shell/lcosShellStore';
import { LcosWindowChrome } from '../ui/families';
import { lcosGlassStyle, lcosTokens } from '../ui/lcosTokens';

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
}

interface ProfessionalRegionEntry {
  readonly region: LcosWindowRegion;
  readonly windows: readonly LcosWindow[];
  readonly activeWindow: LcosWindow;
  readonly preferredWidth: number;
}

function preferredWidthFor(window: LcosWindow): number {
  return window.bodyKey === 'reader' ? 1120 : window.bodyKey === 'assembly' ? 640 : 520;
}

function currentViewport(): ProfessionalRectV1 {
  if (typeof window === 'undefined') return { x: 0, y: 0, width: 0, height: 0 };
  return {
    x: 0,
    y: 0,
    width: window.innerWidth || document.documentElement.clientWidth || 0,
    height: window.innerHeight || document.documentElement.clientHeight || 0,
  };
}

function materializeRegionEntries(
  windows: readonly LcosWindow[],
  windowRegions: readonly LcosWindowRegion[],
): readonly ProfessionalRegionEntry[] {
  const windowsById = new Map(windows.map((window) => [window.id, window]));
  const assignedIds = new Set(windowRegions.flatMap((region) => region.windowIds));
  const effectiveRegions: readonly LcosWindowRegion[] = [
    ...windowRegions,
    ...windows
      .filter((window) => !assignedIds.has(window.id))
      .map((window) => ({
        id: `region-${window.id}`,
        layout: 'floating' as const,
        windowIds: [window.id],
        activeWindowId: window.id,
      })),
  ];

  return effectiveRegions.flatMap((region) => {
    const regionWindows = region.windowIds
      .map((windowId) => windowsById.get(windowId))
      .filter((window): window is LcosWindow => window !== undefined);
    const activeWindow = windowsById.get(region.activeWindowId) ?? regionWindows[regionWindows.length - 1];
    return activeWindow === undefined
      ? []
      : [{
          region,
          windows: regionWindows,
          activeWindow,
          preferredWidth: preferredWidthFor(activeWindow),
        }];
  });
}

export function ProfessionalWindowStage({ projectId }: ProfessionalWindowStageProps): React.JSX.Element {
  const windows = useLcosShellStore((s) => s.windows);
  const windowRegions = useLcosShellStore((s) => s.windowRegions);
  const activateWindow = useLcosShellStore((s) => s.activateWindow);
  const closeWindow = useLcosShellStore((s) => s.closeWindow);
  const publishWindowEnvironment = useLcosShellStore((s) => s.publishWindowEnvironment);
  const clearWindowEnvironment = useLcosShellStore((s) => s.clearWindowEnvironment);
  const composerOpen = useLcosShellStore((s) => s.composerOpen);
  const composerReceiver = useLcosShellStore((s) => s.composerTarget?.receiverConversationId);
  const [viewport, setViewport] = useState<ProfessionalRectV1>(currentViewport);
  const regionElements = useRef(new Map<string, HTMLDivElement>());
  const active = windows.find((window) => window.active) ?? windows[windows.length - 1];
  const regionEntries = useMemo(
    () => materializeRegionEntries(windows, windowRegions),
    [windowRegions, windows],
  );
  const activeRegionId = active === undefined
    ? undefined
    : regionEntries.find((entry) => entry.region.windowIds.includes(active.id))?.region.id;
  const inlineComposerOpen = composerOpen && active?.bodyKey === 'conversation'
    && active.target !== undefined && composerReceiver === active.target;
  const placements = useMemo(() => {
    // 单区域且无用户几何/dock 时沿用既有 CSS 默认摆放（与 R2-A 行为逐字一致）。
    const hasExplicitGeometry = regionEntries.some((entry) =>
      entry.region.rect !== undefined
      || entry.region.dockWidth !== undefined
      || entry.region.layout === 'docked-right');
    if (regionEntries.length <= 1 && !hasExplicitGeometry) return new Map<string, ProfessionalRectV1>();
    return new Map(
      deriveProfessionalStageRegionPlacementsV1({
        viewport,
        regions: regionEntries.map((entry) => ({
          regionId: entry.region.id,
          layout: entry.region.layout,
          preferredWidth: entry.preferredWidth,
          ...(entry.region.rect === undefined ? {} : { rect: entry.region.rect }),
          ...(entry.region.dockWidth === undefined ? {} : { dockWidth: entry.region.dockWidth }),
        })),
      }).map((placement) => [placement.regionId, placement.rect] as const),
    );
  }, [regionEntries, viewport]);

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
  const beginWindowGesture = useCallback((
    event: React.PointerEvent<HTMLElement>,
    region: LcosWindowRegion,
    kind: 'move' | 'resize',
    handle?: ProfessionalResizeHandleV1,
  ): void => {
    if (event.button !== 0) return;
    // chrome 上的按钮 / tab 不触发移动（它们有自己的点击语义）。
    if (kind === 'move' && (event.target as HTMLElement).closest('button') !== null) return;
    const element = regionElements.current.get(region.id);
    const startRect = rectFor(region.id);
    if (element === undefined || startRect === undefined) return;
    event.preventDefault();
    event.stopPropagation();
    const viewportBounds = currentViewport();
    // floating 用与派生摆放一致的边距包围盒；docked 固定满视口（只有左缘宽度可变）。
    const bounds = region.layout === 'docked-right'
      ? viewportBounds
      : professionalFloatingBoundsV1(viewportBounds);
    const gesture = {
      startRect,
      startX: event.clientX,
      startY: event.clientY,
      latest: startRect,
      docked: region.layout === 'docked-right',
      handle: handle ?? 'se' as ProfessionalResizeHandleV1,
      kind,
    };
    const onMove = (moveEvent: PointerEvent): void => {
      const delta = { x: moveEvent.clientX - gesture.startX, y: moveEvent.clientY - gesture.startY };
      const next = gesture.kind === 'move'
        ? clampProfessionalRectV1(
            { ...startRect, x: startRect.x + delta.x, y: startRect.y + delta.y },
            bounds,
            PROFESSIONAL_STAGE_MIN_WIDTH,
            PROFESSIONAL_STAGE_MIN_HEIGHT,
          )
        : resizeProfessionalRectV1(
            startRect,
            gesture.handle,
            delta,
            bounds,
            PROFESSIONAL_STAGE_MIN_WIDTH,
            PROFESSIONAL_STAGE_MIN_HEIGHT,
          );
      if (gesture.docked) {
        // 停靠区固定贴右缘并满高：只有左缘 resize 有意义，宽度由左缘推出。
        const width = Math.min(
          bounds.width,
          Math.max(PROFESSIONAL_STAGE_MIN_WIDTH, bounds.x + bounds.width - next.x),
        );
        gesture.latest = { x: bounds.x + bounds.width - width, y: bounds.y, width, height: bounds.height };
      } else {
        gesture.latest = next;
      }
      element.style.left = `${gesture.latest.x}px`;
      element.style.top = `${gesture.latest.y}px`;
      element.style.width = `${gesture.latest.width}px`;
      element.style.height = `${gesture.latest.height}px`;
    };
    const onUp = (): void => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
      const store = useLcosShellStore.getState();
      if (gesture.docked) store.setWindowRegionDockWidth(region.id, gesture.latest.width);
      else store.setWindowRegionRect(region.id, gesture.latest);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
  }, [rectFor]);

  /** 显式停靠 / 取消停靠（取消停靠时把当前几何留作 floating 几何，窗口不跳走）。 */
  const toggleRegionDock = useCallback((region: LcosWindowRegion): void => {
    const store = useLcosShellStore.getState();
    if (region.layout === 'docked-right') {
      const current = rectFor(region.id);
      if (current !== undefined) store.setWindowRegionRect(region.id, current);
      store.setWindowRegionLayout(region.id, 'floating');
      return;
    }
    store.setWindowRegionLayout(region.id, 'docked-right');
  }, [rectFor]);

  useLayoutEffect(() => {
    const updateViewport = (): void => {
      const next = currentViewport();
      setViewport((previous) =>
        previous.width === next.width && previous.height === next.height ? previous : next,
      );
    };
    updateViewport();
    window.addEventListener('resize', updateViewport);
    return () => window.removeEventListener('resize', updateViewport);
  }, []);

  useLayoutEffect(() => {
    if (windows.length === 0 || regionEntries.length === 0) {
      clearWindowEnvironment();
      return undefined;
    }

    const publish = (): void => {
      const regions = regionEntries.flatMap((entry) => {
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

    publish();
    const observer = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(publish);
    for (const entry of regionEntries) {
      const element = regionElements.current.get(entry.region.id);
      if (element !== undefined) observer?.observe(element);
    }
    window.addEventListener('scroll', publish, true);
    return () => {
      observer?.disconnect();
      window.removeEventListener('scroll', publish, true);
    };
  }, [activeRegionId, clearWindowEnvironment, publishWindowEnvironment, regionEntries, viewport, windows.length]);

  // Esc 栈：Professional Stage 只关闭全局前景窗口；inline Composer 仍先消费一次 Esc。
  useCloseOnEscape(windows.length > 0 && !inlineComposerOpen, () => {
    if (active) closeWindow(active.id);
  });

  if (windows.length === 0) return <div data-lcos-professional-stage data-empty="true" className="hidden" aria-hidden />;

  return (
    <div data-lcos-professional-stage className="pointer-events-none fixed inset-0 z-40">
      {regionEntries.map((entry, regionIndex) => {
        const { region, windows: regionWindows, activeWindow, preferredWidth } = entry;
        const placement = placements.get(region.id);
        const isGlobalActive = active?.id === activeWindow.id;
        const multiRegion = regionEntries.length > 1;
        // 显式分组的目标：前一个区域（2 个区域时即“另一个”）；不存在则按钮 disabled。
        const groupTarget = regionIndex > 0 ? regionEntries[regionIndex - 1] : undefined;
        const docked = region.layout === 'docked-right';
        return (
          <div
            key={region.id}
            ref={(element) => {
              if (element === null) regionElements.current.delete(region.id);
              else regionElements.current.set(region.id, element);
            }}
            data-lcos-window-region-id={region.id}
            data-lcos-window-layout={region.layout}
            className="pointer-events-auto absolute flex flex-col rounded-2xl"
            onPointerDownCapture={() => {
              if (!isGlobalActive) activateWindow(activeWindow.id);
            }}
            style={{
              ...(placement === undefined
                ? {
                    right: region.layout === 'docked-right' ? 0 : 24,
                    top: region.layout === 'docked-right' ? 0 : 88,
                    width: `min(${preferredWidth}px, calc(100vw - 48px))`,
                  }
                : {
                    left: placement.x,
                    top: placement.y,
                    width: placement.width,
                    height: placement.height,
                  }),
              maxWidth: 'calc(100vw - 48px)',
              maxHeight: region.layout === 'docked-right' ? '100vh' : 'calc(100vh - 140px)',
              border: '1px solid var(--lcos-window-border)',
              boxShadow: 'var(--lcos-window-shadow)',
              background: lcosTokens.color.surface,
              borderRadius: region.layout === 'docked-right' ? 0 : 16,
              overflow: 'hidden',
              zIndex: isGlobalActive ? 2 : 1,
            }}
          >
            {/* R2-B：标题栏是移动手势的抓手（chrome 上的按钮/tab 不触发移动）。 */}
            <div
              data-lcos-window-drag-handle={docked ? 'disabled' : 'enabled'}
              onPointerDown={(event) => {
                if (docked) return;
                beginWindowGesture(event, region, 'move');
              }}
            >
              <LcosWindowChrome
                layout={regionWindows.length > 1 ? '分组' : docked ? '停靠' : '浮动'}
                title={activeWindow.title}
                tabs={regionWindows.length > 1
                  ? regionWindows.map((window) => ({
                      key: window.bodyKey,
                      value: window.id,
                      label: window.title,
                      selected: window.id === region.activeWindowId,
                    }))
                  : undefined}
                onSelectTab={(id) => activateWindow(id)}
                actions={
                  <>
                    <button
                      type="button"
                      data-lcos-window-icon-button
                      data-lcos-window-dock-toggle
                      aria-label={docked ? '取消停靠' : '停靠到右侧'}
                      title={docked ? '取消停靠（回到浮动）' : '停靠到右侧'}
                      onClick={() => toggleRegionDock(region)}
                    >
                      {docked ? <Columns2 className="h-4 w-4" /> : <Pin className="h-4 w-4" />}
                    </button>
                    <button
                      type="button"
                      data-lcos-window-icon-button
                      data-lcos-window-group
                      aria-label="并入上一个区域"
                      title={groupTarget === undefined ? '没有可并入的相邻区域' : '并入上一个区域（显式分组为 tab）'}
                      disabled={groupTarget === undefined}
                      onClick={() => {
                        if (groupTarget === undefined) return;
                        useLcosShellStore.getState().groupWindowRegions(region.id, groupTarget.region.id);
                      }}
                    >
                      <Group className="h-4 w-4" />
                    </button>
                    <button
                      type="button"
                      data-lcos-window-icon-button
                      data-lcos-window-ungroup
                      aria-label="取消分组"
                      title={regionWindows.length > 1 ? '取消分组（拆出当前窗口）' : '当前区域只有一个窗口'}
                      disabled={regionWindows.length < 2}
                      onClick={() => useLcosShellStore.getState().ungroupWindowRegion(region.id)}
                    >
                      <Ungroup className="h-4 w-4" />
                    </button>
                    <button
                      type="button"
                      data-lcos-window-icon-button
                      aria-label="关闭窗口"
                      onClick={() => closeWindow(activeWindow.id)}
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </>
                }
              />
            </div>

            {/* R2-B：8 向 resize 命中区；停靠区只有左缘 resize（贴右缘满高，宽度由左缘推）。 */}
            {(docked ? (['w'] as const) : RESIZE_HANDLES).map((handle) => (
              <button
                key={handle}
                type="button"
                data-lcos-window-resize={handle}
                aria-label={docked ? '调整停靠宽度' : `调整窗口 · ${handle}`}
                className={`absolute z-10 rounded-sm bg-transparent hover:bg-black/5 ${RESIZE_HANDLE_CLASS[handle]}`}
                onPointerDown={(event) => beginWindowGesture(event, region, 'resize', handle)}
              />
            ))}

            {/* Figma 360×280 minimum includes the 48px chrome, so multi-region body floor is 232px. */}
            <div
              className={`${multiRegion ? 'min-h-[232px]' : 'min-h-[240px]'} flex-1 overflow-y-auto`}
              style={{ background: lcosTokens.color.canvas }}
            >
              <ProfessionalBody
                projectId={projectId}
                bodyKey={activeWindow.bodyKey}
                {...(activeWindow.target === undefined ? {} : { target: activeWindow.target })}
                {...(activeWindow.targetKind === undefined ? {} : { targetKind: activeWindow.targetKind })}
                {...(activeWindow.assemblyTargetRef === undefined
                  ? {}
                  : { assemblyTargetRef: activeWindow.assemblyTargetRef })}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}

function ProfessionalBody({
  projectId,
  bodyKey,
  target,
  targetKind,
  assemblyTargetRef,
}: {
  projectId: string;
  bodyKey: string;
  target?: string;
  targetKind?: 'canvas';
  assemblyTargetRef?: AssemblyTargetRefV1;
}): React.JSX.Element {
  switch (bodyKey) {
    case 'assembly':
      return (
        <AssemblyBody
          projectId={projectId}
          targetRef={assemblyTargetRef ?? { kind: 'main' }}
        />
      );
    case 'reader':
      return <ArtifactReaderBody projectId={projectId} artifactId={target} />;
    case 'conversation':
      return <ConversationWorkViewBody projectId={projectId} connectedConversationId={target} />;
    case 'portal-preview':
      return <PortalPreviewBody projectId={projectId} target={target} {...(targetKind ? { targetKind } : {})} />;
    case 'runtime-doctor':
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
