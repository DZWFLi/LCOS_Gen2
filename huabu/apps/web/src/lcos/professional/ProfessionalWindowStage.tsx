// ProfessionalWindowStage — route-level 专业窗口舞台（Figma window 5388:27165 / Chrome 5387:331）。
// Stage 是唯一 Window topology + geometry producer；body 数据来自 Core。
// 多个 window region 保持独立，只有显式 group 才共享 tab chrome。

import { X } from 'lucide-react';
import { useLayoutEffect, useMemo, useRef, useState } from 'react';

import { useCloseOnEscape } from '@/hooks/useCloseOnEscape';

import { deriveProfessionalWindowEnvironmentV1 } from '@local-creative-os/web-gen2';

import { ArtifactReaderBody } from './ArtifactReaderBody';
import { AssemblyBody } from './AssemblyBody';
import { ConversationWorkViewBody } from './ConversationWorkViewBody';
import { PortalPreviewBody } from './PortalPreviewBody';
import { deriveProfessionalStageRegionPlacementsV1 } from './professionalWindowStageLayout';
import { useLcosShellStore, type LcosWindow, type LcosWindowRegion } from '../shell/lcosShellStore';
import { LcosWindowChrome } from '../ui/families';
import { lcosGlassStyle, lcosTokens } from '../ui/lcosTokens';

import type { AssemblyTargetRefV1 } from '@local-creative-os/contracts';
import type { ProfessionalRectV1 } from '@local-creative-os/web-gen2';

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
    if (regionEntries.length <= 1) return new Map<string, ProfessionalRectV1>();
    return new Map(
      deriveProfessionalStageRegionPlacementsV1({
        viewport,
        regions: regionEntries.map((entry) => ({
          regionId: entry.region.id,
          layout: entry.region.layout,
          preferredWidth: entry.preferredWidth,
        })),
      }).map((placement) => [placement.regionId, placement.rect] as const),
    );
  }, [regionEntries, viewport]);

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
      {regionEntries.map((entry) => {
        const { region, windows: regionWindows, activeWindow, preferredWidth } = entry;
        const placement = placements.get(region.id);
        const isGlobalActive = active?.id === activeWindow.id;
        const multiRegion = regionEntries.length > 1;
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
            <LcosWindowChrome
              layout={regionWindows.length > 1 ? '分组' : region.layout === 'docked-right' ? '停靠' : '浮动'}
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
                <button
                  type="button"
                  data-lcos-window-icon-button
                  aria-label="关闭窗口"
                  onClick={() => closeWindow(activeWindow.id)}
                >
                  <X className="h-4 w-4" />
                </button>
              }
            />

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
