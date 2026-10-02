import { resolveDropIntent } from './dropIntentResolver';
import type { DropPayload, DropResolution, DropTargetRegistration } from './dropTypes';

/** Shared by the actual pointer transport and its isolated browser tests. */
export function resolveDropPointerTarget(
  payload: DropPayload,
  candidate: DropTargetRegistration | undefined,
  source: { readonly native: boolean; readonly rightCarry: boolean; readonly blockedReason?: string },
): { readonly target?: DropTargetRegistration; readonly resolution?: DropResolution } {
  if (!candidate || (source.native && candidate.kind === 'canvas')) return {};
  const resolution = source.blockedReason
    ? { status: 'ineligible' as const, targetId: candidate.targetId, reason: source.blockedReason }
    : source.rightCarry && candidate.kind === 'canvas'
      ? { status: 'ineligible' as const, targetId: candidate.targetId, reason: '原对象保留在现场；请拖到会话、输入框或轨道目标' }
      : resolveDropIntent(payload, candidate);
  return { target: candidate, resolution };
}
