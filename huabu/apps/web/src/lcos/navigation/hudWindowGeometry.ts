import { placeLocatorAnchorOutsideObstacles, rectsOverlapV1, toScreenRect,
  type ProfessionalRectV1, type ProfessionalWindowEnvironmentV1 } from '@local-creative-os/web-gen2';

import { avoidNearbyControls } from '@/components/Common/boundedPopoverAvoidance';

/** Availability is checked against the rendered dimensions, never the solver's safe-area clamp. */
export function isActualHudRectAvailable(candidate: ProfessionalRectV1,
  dimensions: Pick<ProfessionalRectV1, 'width' | 'height'>, safeRect: ProfessionalRectV1,
  obstacles: readonly ProfessionalRectV1[]): boolean {
  const actual = { ...candidate, ...dimensions };
  const insideSafeRect = actual.x >= safeRect.x && actual.y >= safeRect.y
    && actual.x + actual.width <= safeRect.x + safeRect.width
    && actual.y + actual.height <= safeRect.y + safeRect.height;
  return insideSafeRect && !obstacles.some((obstacle) => rectsOverlapV1(actual, obstacle));
}

/** Screen-space presentation only; the Stage remains the sole environment producer. */
export function avoidHudWindows(preferred: ProfessionalRectV1, environment: ProfessionalWindowEnvironmentV1 | null,
  viewport: { width: number; height: number }, additionalObstacles: readonly ProfessionalRectV1[] = []): ProfessionalRectV1 {
  const safe = environment?.safeRect ?? { x: 0, y: 0, ...viewport };
  const width = Math.min(preferred.width, Math.max(0, safe.width - 16));
  const height = Math.min(preferred.height, Math.max(0, safe.height - 16));
  const halfW = width / 2, halfH = height / 2;
  const anchors = { left: safe.x + halfW, right: safe.x + safe.width - halfW,
    top: safe.y + halfH, bottom: safe.y + safe.height - halfH };
  const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));
  const anchor = { x: clamp(preferred.x + halfW, anchors.left + 8, anchors.right - 8),
    y: clamp(preferred.y + halfH, anchors.top + 8, anchors.bottom - 8) };
  const occupied = [...(environment?.occupiedRects ?? []), ...additionalObstacles].map((rect) => ({ left: rect.x - halfW,
    right: rect.x + rect.width + halfW, top: rect.y - halfH, bottom: rect.y + rect.height + halfH }));
  const placed = placeLocatorAnchorOutsideObstacles(anchor, anchors, occupied, 8);
  const result = { x: placed.x - halfW, y: placed.y - halfH, width, height };
  const obstacles = [...(environment?.occupiedRects ?? []), ...additionalObstacles];
  if (!obstacles.some((obstacle) => rectsOverlapV1(result, obstacle))) return result;

  const fallback = avoidNearbyControls(
    { x: result.x, y: result.y },
    [{ x: 0, y: 0, width, height }],
    obstacles,
    safe,
    Math.hypot(safe.width, safe.height),
  );
  const fallbackRect = { ...result, ...fallback };
  const insideSafeRect = fallbackRect.x >= safe.x && fallbackRect.y >= safe.y
    && fallbackRect.x + fallbackRect.width <= safe.x + safe.width
    && fallbackRect.y + fallbackRect.height <= safe.y + safe.height;
  return insideSafeRect && !obstacles.some((obstacle) => rectsOverlapV1(fallbackRect, obstacle))
    ? fallbackRect
    : result;
}

/** Choose an unobscured rectangle only when the user explicitly requests Fit. No camera reacts to window motion. */
export function cameraFitRect(canvas: ProfessionalRectV1, environment: ProfessionalWindowEnvironmentV1 | null): ProfessionalRectV1 | null {
  const envSafe = environment?.safeRect ?? canvas;
  const left = Math.max(canvas.x + 92, envSafe.x + 16);
  const top = Math.max(canvas.y + 88, envSafe.y + 16);
  const right = Math.min(canvas.x + canvas.width - 48, envSafe.x + envSafe.width - 16);
  const bottom = Math.min(canvas.y + canvas.height - 96, envSafe.y + envSafe.height - 16);
  const initial = { x: left, y: top, width: Math.max(1, right - left), height: Math.max(1, bottom - top) };
  let candidates = [initial];
  for (const obstruction of environment?.occupiedRects ?? []) {
    const obstacle = { x: obstruction.x - 12, y: obstruction.y - 12, width: obstruction.width + 24, height: obstruction.height + 24 };
    candidates = candidates.flatMap((rect) => {
      if (!rectsOverlapV1(rect, obstacle)) return [rect];
      const r = rect.x + rect.width, b = rect.y + rect.height;
      return [
        { ...rect, width: Math.min(r, obstacle.x) - rect.x },
        { ...rect, x: Math.max(rect.x, obstacle.x + obstacle.width), width: r - Math.max(rect.x, obstacle.x + obstacle.width) },
        { ...rect, height: Math.min(b, obstacle.y) - rect.y },
        { ...rect, y: Math.max(rect.y, obstacle.y + obstacle.height), height: b - Math.max(rect.y, obstacle.y + obstacle.height) },
      ].filter((candidate) => candidate.width >= 96 && candidate.height >= 96);
    });
  }
  return candidates.sort((a, b) => b.width * b.height - a.width * a.height)[0] ?? null;
}

export function cameraFitInsets(canvas: ProfessionalRectV1, environment: ProfessionalWindowEnvironmentV1 | null) {
  const fit = cameraFitRect(canvas, environment);
  if (fit === null) return null;
  const safe = toScreenRect(fit);
  return { left: safe.left - canvas.x, top: safe.top - canvas.y,
    right: canvas.x + canvas.width - safe.right, bottom: canvas.y + canvas.height - safe.bottom };
}
