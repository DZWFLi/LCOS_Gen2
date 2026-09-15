import type { DropRect, DropTargetRegistration } from './dropTypes';

function contains(
  rect: DropRect,
  point: { readonly x: number; readonly y: number },
): boolean {
  return (
    point.x >= rect.left &&
    point.y >= rect.top &&
    point.x <= rect.left + rect.width &&
    point.y <= rect.top + rect.height
  );
}

/**
 * Ephemeral live target registry. It contains DOM-derived geometry only for
 * the current host render; it is never persisted and never writes Core truth.
 */
export class DropTargetRegistry {
  private readonly targets = new Map<string, DropTargetRegistration>();

  register(target: DropTargetRegistration): () => void {
    this.targets.set(target.targetId, target);
    return () => this.unregister(target.targetId);
  }

  unregister(targetId: string): void {
    this.targets.delete(targetId);
  }

  replace(targets: readonly DropTargetRegistration[]): void {
    this.targets.clear();
    for (const target of targets) this.targets.set(target.targetId, target);
  }

  clear(): void {
    this.targets.clear();
  }

  get(targetId: string): DropTargetRegistration | undefined {
    return this.targets.get(targetId);
  }

  snapshot(): readonly DropTargetRegistration[] {
    return [...this.targets.values()].sort(
      (a, b) => b.priority - a.priority || a.targetId.localeCompare(b.targetId),
    );
  }

  hitTest(point: {
    readonly x: number;
    readonly y: number;
  }): DropTargetRegistration | undefined {
    return this.snapshot().find(
      (target) => target.enabled && contains(target.rect, point),
    );
  }
}

export function rectFromDomRect(
  rect: Pick<DOMRect, 'left' | 'top' | 'width' | 'height'>,
): DropRect {
  return {
    left: rect.left,
    top: rect.top,
    width: rect.width,
    height: rect.height,
  };
}
