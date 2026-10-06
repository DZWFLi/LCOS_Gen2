import { useLayoutEffect, useRef, useState } from 'react';

import { lcosHudEdgeOffsets } from './lcosHudPlacement';
import {
  LCOS_SURFACES,
  useLcosShellStore,
  type LcosSurfaceKey,
} from './lcosShellStore';
import { useLcosWorksiteNav } from '../app/useLcosWorksiteNav';
import { useAvoidingHudPosition } from '../navigation/useAvoidingHudPosition';
import { useHudViewport } from '../navigation/useHudViewport';
import { LcosSurfaceDockView } from '../ui/families/LcosSurfaceDockView';
import { lcosTokens } from '../ui/lcosTokens';

import type { FigmaShellGlyphName } from '../ui/FigmaShellGlyph';

// LcosSurfaceDock — 底部常驻现场切换（Figma Main/ProjectShell：SurfaceDock 底 24 常驻）。
// 三现场切换驱动真实 worksite canvasId（切换 = switchCanvas / 首次 = createCanvas + 回写）。
// Assembly 有独立入口；Dock 只呈现三个一级 Surface。

export interface LcosSurfaceDockProps {
  readonly projectId: string;
  readonly canvasBySurface: Readonly<Partial<Record<LcosSurfaceKey, string>>>;
  readonly ensureCanvas: (
    surface: LcosSurfaceKey,
    force?: boolean,
  ) => Promise<string | undefined>;
}

const SURFACE_GLYPH: Readonly<Record<LcosSurfaceKey, FigmaShellGlyphName>> = {
  main: 'root', context: 'context', workflow: 'workflow',
};
const COMPACT_DOCK_SIZE = { width: 178, height: 58 } as const;

export function LcosSurfaceDock({
  projectId,
  canvasBySurface,
  ensureCanvas,
}: LcosSurfaceDockProps): React.JSX.Element {
  const viewport = useHudViewport();
  const activeSurface = useLcosShellStore((s) => s.activeSurface);
  const windowEnvironment = useLcosShellStore((s) => s.windowEnvironment);
  const [compact, setCompact] = useState(false);
  const fullDockSize = useRef<{ width: number; height: number } | undefined>(undefined);
  const { busySurface, transitionError, switchWorksite } = useLcosWorksiteNav({
    projectId,
    canvasBySurface,
    ensureCanvas,
  });
  const handleSwitch = (surface: LcosSurfaceKey): void => {
    void switchWorksite(surface);
  };

  const edgeOffsets = lcosHudEdgeOffsets(windowEnvironment, viewport);
  // R2-B：HUD 在 safe area 内居中，而不是在整个视口内居中。
  // 无窗口 / 只有浮动窗口时 safeRect 不变 → 结果与旧行为逐字相同（仍是视口中心）；
  // 有右侧停靠窗口时 safeRect 变窄 → 底栏自动让开，不会被窗口盖住。
  const safeCenteredLeft = (edgeOffsets.left + (viewport.width - edgeOffsets.right)) / 2;

  const placement = useAvoidingHudPosition(
    { x: safeCenteredLeft, y: viewport.height - edgeOffsets.bottom, width: 178, height: 58 },
    { x: 'center', y: 'end' },
    '[data-lcos-nav-view]',
    compact ? COMPACT_DOCK_SIZE : fullDockSize.current,
  );
  if (!compact && placement.measuredSize) fullDockSize.current = placement.measuredSize;
  const fullPlacement = placement.resolve(fullDockSize.current ?? COMPACT_DOCK_SIZE);
  useLayoutEffect(() => {
    if (!fullDockSize.current) return;
    const shouldCompact = !fullPlacement.available;
    setCompact((current) => current === shouldCompact ? current : shouldCompact);
  }, [fullPlacement.available, placement.measuredSize?.width, placement.measuredSize?.height]);
  return (
    <div ref={placement.ref} className="pointer-events-auto fixed z-40" style={{ left: placement.rect.x, top: placement.rect.y }}>
    <LcosSurfaceDockView
      className="pointer-events-auto"
      style={{ maxWidth: 'calc(100vw - 24px)' }}
      items={LCOS_SURFACES.map(({ key, label }) => ({
        key, label, glyph: SURFACE_GLYPH[key], selected: activeSurface === key,
        busy: busySurface === key, disabled: busySurface !== null,
        title: busySurface !== null
          ? (busySurface === key ? `正在进入${label}` : '现场切换中，请稍候')
          : `${label} · ${canvasBySurface[key] !== undefined ? '现场画布' : '首次进入会建立现场画布'}`,
      }))}
      onSelect={handleSwitch}
      compact={compact}
      feedback={transitionError && (
        <div role="alert" data-lcos-dock-error
          className="absolute bottom-full left-1/2 mb-3 w-max -translate-x-1/2 rounded-2xl px-3 py-1.5 text-xs"
          style={{ maxWidth: 'min(400px, calc(100vw - 32px))',
            background: lcosTokens.color.inverse, color: lcosTokens.color.textOnInverse,
            boxShadow: lcosTokens.glass.shadow }}>
          {transitionError}
        </div>
      )}
    />
    </div>
  );
}
