import { useLayoutEffect, useRef, useState } from 'react';

import { avoidHudWindows } from './hudWindowGeometry';
import { useHudViewport } from './useHudViewport';
import { useHudObstacleRects } from './useHudObstacleRects';
import { useLcosShellStore } from '../shell/lcosShellStore';

/** Size is measured from the current HUD only; no window or camera state is produced. */
export function useAvoidingHudPosition(preferred: { x: number; y: number; width: number; height: number }, align: { x?: 'start' | 'center'; y?: 'start' | 'center' | 'end' } = {}, avoidSelector?: string) {
  const ref = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState<{ width: number; height: number }>();
  const measuredSize = useRef<{ width: number; height: number } | undefined>(undefined);
  const peerRects = useHudObstacleRects(avoidSelector, ref);
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
  const measured = { ...preferred, ...size };
  const rect = avoidHudWindows({ ...measured,
    x: preferred.x - (align.x === 'center' ? measured.width / 2 : 0),
    y: preferred.y - (align.y === 'end' ? measured.height : align.y === 'center' ? measured.height / 2 : 0),
  }, environment, viewport, peerRects);
  return { ref, rect };
}
