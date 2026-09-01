import { describe, expect, it, vi } from 'vitest'

import { BoundaryEvaluatorService } from '../src/boundary-evaluator-service.js'
import type { IntelligenceProviderService } from '../src/intelligence-provider-service.js'

function intelligence(value: Record<string, unknown> | undefined) {
  return {
    generateStructured: vi.fn(async () => value === undefined ? undefined : ({ value, providerId: 'test-utility', model: 'test-model' })),
  } as unknown as IntelligenceProviderService
}

describe('BoundaryEvaluatorService', () => {
  it('stays silent without new evidence and does not call a model', async () => {
    const provider = intelligence({ shouldShow: true, confidence: 1, reason: 'should not be called' })
    const service = new BoundaryEvaluatorService(provider)
    const result = await service.evaluate('project-a', { kind: 'context', evidenceKey: '', evidence: [] })
    expect(result.shouldShow).toBe(false)
    expect((provider.generateStructured as ReturnType<typeof vi.fn>)).not.toHaveBeenCalled()
  })

  it('shows only a confident positive semantic judgement', async () => {
    const provider = intelligence({ shouldShow: true, confidence: 0.81, reason: '出现了新的项目决定和未决问题。' })
    const service = new BoundaryEvaluatorService(provider)
    const result = await service.evaluate('project-a', {
      kind: 'context',
      evidenceKey: 'context:decision-1',
      evidence: [{ id: 'decision-1', label: '客户确认保留方案 B', source: 'decision' }],
    })
    expect(result).toMatchObject({ shouldShow: true, confidence: 0.81, providerId: 'test-utility', model: 'test-model' })
  })

  it('fails closed when confidence is below threshold or provider is unavailable', async () => {
    const weak = await new BoundaryEvaluatorService(intelligence({ shouldShow: true, confidence: 0.4, reason: 'weak' })).evaluate('project-a', {
      kind: 'workflow', evidenceKey: 'workflow:run-1', evidence: [{ id: 'run-1', label: '一次执行', source: 'run' }],
    })
    expect(weak.shouldShow).toBe(false)

    const unavailable = await new BoundaryEvaluatorService(intelligence(undefined)).evaluate('project-a', {
      kind: 'workflow', evidenceKey: 'workflow:run-2', evidence: [{ id: 'run-2', label: '重复执行', source: 'run' }],
    })
    expect(unavailable).toMatchObject({ shouldShow: false, confidence: 0 })
  })
})
