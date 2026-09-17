import type { InteractionPhase } from './nodePresentation.js';

export const GLYTH_SHAPE_KEYS = [
  'blob',
  'pebble',
  'squircle',
  'tablet',
  'wedge',
  'hex',
  'cloud',
  'teardrop',
] as const;
export type GlythShapeKey = (typeof GLYTH_SHAPE_KEYS)[number];

export const GLYTH_IDENTITY_TONES = ['ink', 'violet', 'teal', 'amber'] as const;
export type GlythIdentityTone = (typeof GLYTH_IDENTITY_TONES)[number];

export type GlythPresentationPose = 'idle' | 'listening' | 'working' | 'curious';

export interface GlythIdentity {
  readonly shape: GlythShapeKey;
  readonly tone: GlythIdentityTone;
}

export interface GlythPresentationInput {
  readonly active?: boolean;
  readonly waiting?: boolean;
  readonly phase?: InteractionPhase;
}

export function stableGlythHash(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

/**
 * Donor mechanism retained for a future Figma identity-variant surface.
 * Current Main production visual is deliberately NOT driven by this function:
 * Figma 5388:119 only authorizes the dark blob anchor today.
 */
export function resolveGlythIdentity(conversationId: string): GlythIdentity {
  const hash = stableGlythHash(conversationId);
  return {
    shape: GLYTH_SHAPE_KEYS[hash % GLYTH_SHAPE_KEYS.length] ?? 'blob',
    tone: GLYTH_IDENTITY_TONES[(hash >>> 3) % GLYTH_IDENTITY_TONES.length] ?? 'ink',
  };
}

export function resolveGlythPresentation(
  input: GlythPresentationInput,
): GlythPresentationPose {
  if (input.waiting === true) return 'curious';
  if (input.active === true) return 'working';
  if (
    input.phase === 'selected' ||
    input.phase === 'hover' ||
    input.phase === 'editing'
  ) {
    return 'listening';
  }
  return 'idle';
}

/**
 * Collaboration Contract V1 → Glyth 呈现输入（Gate 4：Glyth 只消费 6 用户态）。
 * needs_user → waiting（attention）；working/thinking → active；其余 → 默认 idle。
 * undefined（投影未加载/不可用）→ 空输入，调用方回退到既有 descriptor 行为。
 */
export function glythInputFromCollaborationState(
  state: import('@local-creative-os/contracts').CollaborationUserStateV1 | undefined,
): GlythPresentationInput {
  if (state === 'needs_user') return { waiting: true };
  if (state === 'working' || state === 'thinking') return { active: true };
  return {};
}