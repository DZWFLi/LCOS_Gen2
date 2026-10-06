import { useLayoutEffect, useRef, useState } from 'react';

import { avoidHudWindows, isActualHudRectAvailable } from './hudWindowGeometry';
import { useHudObstacleRects } from './useHudObstacleRects';
import { useHudViewport } from './useHudViewport';
import { useLcosShellStore } from '../shell/lcosShellStore';

import type { ProfessionalRectV1 } from '@local-creative-os/web-gen2';

export interface HudPositionResolution {
  readonly rect: ProfessionalRectV1;
  readonly available: boolean;
}

/** Size is measured from the current HUD only; no window or camera state is produced. */
export function useAvoidingHudPosition(preferred: { x: number; y: number; width: number; height: number }, align: { x?: 'start' | 'center'; y?: 'start' | 'center' | 'end' } = {}, avoidSelector?: string,
  sizeOverride?: { readonly width: number; readonly height: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState<{ width: number; height: number }>();
  const measuredSize = useRef<{ width: number; height: number } | undefined>(undefined);
  // The project identity is a permanent shell peer. Keep placement priority
  // one-way: floating HUDs yield to it, while its own ref is excluded below.
  const peerSelector = avoidSelector
    ? `${avoidSelector}, [data-lcos-shell-project-cluster]`
    : '[data-lcos-shell-project-cluster]';
  const peerRects = useHudObstacleRects(peerSelector, ref);
  const environment = useLcosShellStore((state) => state.windowEnvironment);
  const viewport = useHudViewport();
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    const measure = (): void => { const rect = element.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return;
      // A centered fixed HUD can report sub-pixel rounding noise after each
      // placement. Ignore that noise rather than feeding it back into layout.
      const width = Math.round(rect.width * 64) / 64;
      const height = Math.round(rect.height * 64) / 64;
      if (measuredSize.current?.width === width && measuredSize.current.height === height) return;
      measuredSize.current = { width, height };
      setSize(measuredSize.current);
    };
    measure();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
    observer?.observe(element);
    return () => observer?.disconnect();
  });
  const measured = { ...preferred, ...size, ...sizeOverride };
  const resolve = (dimensions: { readonly width: number; readonly height: number }): HudPositionResolution => {
    const candidate = { ...preferred, ...dimensions,
      x: preferred.x - (align.x === 'center' ? dimensions.width / 2 : 0),
      y: preferred.y - (align.y === 'end' ? dimensions.height : align.y === 'center' ? dimensions.height / 2 : 0),
    };
    const rect = avoidHudWindows(candidate, environment, viewport, peerRects);
    const obstacles = [...(environment?.occupiedRects ?? []), ...peerRects];
    const safe = environment?.safeRect ?? { x: 0, y: 0, width: viewport.width, height: viewport.height };
    return { rect, available: isActualHudRectAvailable(rect, dimensions, safe, obstacles) };
  };
  return { ref, rect: resolve(measured).rect, measuredSize: size, resolve };
}
