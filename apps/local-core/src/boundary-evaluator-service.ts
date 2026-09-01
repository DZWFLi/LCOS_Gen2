import type { BoundaryEvaluationRequestV1, BoundaryEvaluationResultV1 } from '@local-creative-os/contracts'
import type { IntelligenceProviderService } from './intelligence-provider-service.js'

const BOUNDARY_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['shouldShow', 'confidence', 'reason'],
  properties: {
    shouldShow: { type: 'boolean' },
    confidence: { type: 'number', minimum: 0, maximum: 1 },
    reason: { type: 'string', minLength: 1, maxLength: 180 },
  },
} as const

function confidence(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0
}

/**
 * S8: The browser still owns cooldown/evidence eligibility. Core performs one
 * low-frequency semantic judgement only after that deterministic gate passes.
 * No result is persisted: a Boundary Hint is presentation state, not Project Truth.
 */
export class BoundaryEvaluatorService {
  constructor(private readonly intelligence: IntelligenceProviderService) {}

  async evaluate(projectId: string, input: BoundaryEvaluationRequestV1, signal?: AbortSignal): Promise<BoundaryEvaluationResultV1> {
    if (!input.evidenceKey || input.evidence.length === 0) {
      return { schemaVersion: 1, kind: input.kind, shouldShow: false, confidence: 0, reason: '没有新的可判断证据。' }
    }
    const system = input.kind === 'context'
      ? [
          'You are a low-frequency boundary evaluator for a project context workspace.',
          'Show a hint only when the supplied new evidence contains durable project context worth explicitly reviewing: decisions, changed constraints, important evidence, open questions, or a meaningful handoff.',
          'Do not show generic reminders just because several items exist. Prefer silence when uncertain.',
          'Return JSON only.',
        ].join(' ')
      : [
          'You are a low-frequency boundary evaluator for a project workflow workspace.',
          'Show a hint only when the supplied evidence suggests a genuinely repeated method, judgement pattern, execution sequence, skill, or handoff worth reviewing for workflow reuse.',
          'One isolated task is not a reusable workflow. Prefer silence when uncertain.',
          'Return JSON only.',
        ].join(' ')
    const generated = await this.intelligence.generateStructured('utility', {
      schemaName: `lcos_boundary_${input.kind}_v1`,
      schema: BOUNDARY_SCHEMA,
      system,
      input: {
        projectId,
        kind: input.kind,
        evidence: input.evidence.slice(0, 8),
        ...(input.reflection ? { currentReflection: input.reflection } : {}),
      },
      timeoutMs: 5_000,
      ...(signal ? { signal } : {}),
    })
    if (!generated) {
      return { schemaVersion: 1, kind: input.kind, shouldShow: false, confidence: 0, reason: '低频判断暂不可用，保持静默。' }
    }
    const value = generated.value
    const score = confidence(value.confidence)
    const modelDecision = value.shouldShow === true
    const shouldShow = modelDecision && score >= 0.62
    return {
      schemaVersion: 1,
      kind: input.kind,
      shouldShow,
      confidence: score,
      reason: typeof value.reason === 'string' && value.reason.trim() ? value.reason.trim() : shouldShow ? '检测到值得复盘的新模式。' : '当前证据不足以打断工作。',
      providerId: generated.providerId,
      ...(generated.model ? { model: generated.model } : {}),
    }
  }
}
