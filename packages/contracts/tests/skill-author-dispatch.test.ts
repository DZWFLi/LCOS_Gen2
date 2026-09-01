import { describe, expect, it } from 'vitest'
import { validateSkillAuthorResult } from '../src/skill-author-dispatch'

const validResult = {
  schemaVersion: 1,
  kind: 'skill-proposal',
  agentletId: 'lcos-skill-author',
  draft: { skillId: 'summarize-notes', name: 'summarize-notes', description: 'd', content: '---\nname: x\n---\n# x\n' },
  methodFact: { methods: ['m'], facts: [] },
  source: { runId: 'run-1', prompt: 'p', intent: 'analyze', orderedReferenceCount: 0, provider: 'codex', runCompletedAt: '2026-08-30T00:00:00.000Z' },
  summary: 'skill draft',
}

describe('SkillAuthorResult schema validation (fail-close)', () => {
  it('accepts a structurally valid result', () => {
    expect(() => validateSkillAuthorResult(validResult)).not.toThrow()
  })

  it('rejects wrong kind / agentletId', () => {
    expect(() => validateSkillAuthorResult({ ...validResult, kind: 'reorganize-proposal' })).toThrow('kind must be')
    expect(() => validateSkillAuthorResult({ ...validResult, agentletId: 'lcos-project-curator' })).toThrow('agentletId must be')
  })

  it('rejects missing draft content / methodFact (invalid_output path)', () => {
    const badDraft = { ...validResult, draft: { skillId: 'x', name: 'x', description: 'd', content: '' } }
    expect(() => validateSkillAuthorResult(badDraft)).toThrow('Draft content is required')
    const badMf = { ...validResult, methodFact: { methods: [], facts: [] } }
    expect(() => validateSkillAuthorResult(badMf)).not.toThrow()
    const missingMf = { ...validResult, methodFact: undefined }
    expect(() => validateSkillAuthorResult(missingMf)).toThrow('methodFact is required')
  })

  it('rejects missing source runId', () => {
    const bad = { ...validResult, source: { ...validResult.source, runId: '' } }
    expect(() => validateSkillAuthorResult(bad)).toThrow('Source runId is required')
  })
})