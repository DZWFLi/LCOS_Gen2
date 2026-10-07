import type { RailwayDestinationV1 } from '@local-creative-os/contracts';
import type { DropResolution } from '../drop/dropTypes';
import type { SemanticDropState } from '@local-creative-os/web-gen2';
import { resolveDropIntent } from '../drop/dropIntentResolver';
import type { DropTargetCandidate } from '../drop/dropTypes';

export type RailwayReceivePresentation =
  | 'rest'
  | 'receive'
  | 'receive-eligible'
  | 'receive-hot'
  | 'ineligible'
  | 'committing';

/** Present the existing Core source identity; labels never determine a space's kind. */
export function railwayDestinationGlyph(
  destination: RailwayDestinationV1,
): 'normal' | 'collection' | 'context' | 'workflow' | 'project' {
  if (destination.role === 'receiver') return 'normal';
  const kind = destination.sourceRef?.kind;
  if (kind === 'collection' || kind === 'context' || kind === 'workflow') return kind;
  if (destination.surface === 'context' || destination.surface === 'workflow') return destination.surface;
  return 'project';
}

/** Same admission predicate for the live target and its visible feedback.
 * Spatial carriers use their original membership owner; no canvas is required. */
export function railwayDestinationCanReceive(
  destination: RailwayDestinationV1,
  currentCanvasId: string | null | undefined,
): boolean {
  return destination.available && (destination.receiveTarget !== undefined
    || (destination.accepts.length > 0 && destination.canvasId !== currentCanvasId));
}

export interface RailwayReceivePresentationInput {
  readonly targetId: string;
  readonly enabled: boolean;
  readonly dropState: SemanticDropState;
  readonly resolution: DropResolution | null;
  /** Exact semantic candidate for this rendered receiver, from the live registry projection. */
  readonly candidate?: DropTargetCandidate;
}

/**
 * Projects the one shared Semantic Drop machine into one Railway target.
 * It never re-evaluates payload taxonomy: eligibility comes only from the
 * retained DropIntentResolver result for the exact live target.
 */
export function railwayReceivePresentation(
  input: RailwayReceivePresentationInput,
): RailwayReceivePresentation {
  if (!input.enabled) return 'ineligible';
  if (input.dropState.status === 'idle') return 'rest';
  // `failed` intentionally has no target identity. Painting every destination
  // as failed would invent ownership; the container shows that reason once.
  if (input.dropState.status === 'failed') return 'rest';

  const activeTargetId =
    input.dropState.status === 'preview' || input.dropState.status === 'committing'
      ? input.dropState.destination.targetId
      : undefined;

  if (activeTargetId !== input.targetId) {
    const candidateResolution = 'payload' in input.dropState && input.candidate?.targetId === input.targetId
      ? resolveDropIntent(input.dropState.payload, input.candidate)
      : undefined;
    // Missing candidate data must never paint a receiver as eligible. This
    // keeps non-active destinations honest while the source is still moving.
    if (candidateResolution?.status !== 'ready') return 'ineligible';
    return input.dropState.status === 'tracking' || input.dropState.status === 'dwell' ? 'receive' : 'receive-eligible';
  }
  if (input.resolution?.status === 'ineligible') return 'ineligible';
  if (input.dropState.status === 'committing') return 'committing';
  return input.resolution?.status === 'ready' ? 'receive-hot' : 'receive';
}

export function railwayReceiveLabel(
  presentation: RailwayReceivePresentation,
  unavailableReason?: string,
): string {
  switch (presentation) {
    case 'rest':
      return '拖入素材即可接收';
    case 'receive':
      return '正在寻找接收目标';
    case 'receive-eligible':
      return '可接收，移到此处';
    case 'receive-hot':
      return '松开后接收到这里';
    case 'committing':
      return '正在写入项目';
    case 'ineligible':
      return unavailableReason ?? '当前素材不能接收到这里';
  }
}
