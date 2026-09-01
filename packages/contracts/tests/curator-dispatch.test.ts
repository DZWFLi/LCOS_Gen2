import { describe, expect, it } from 'vitest'
import { validateCuratorReorganizeResult } from '../src/curator-dispatch'

const validResult = {
  schemaVersion: 1,
  kind: 'reorganize-proposal',
  agentletId: 'lcos-project-curator',
  proposal: {
    schemaVersion: 0,
    id: 'reorg-1',
    projectId: 'p1',
    presentationId: 'presentation:context:s1',
    baseVersion: 0,
    status: 'pending',
    mergeCandidates: [],
    removeMemberViewIds: [],
    artifactDeleteCandidates: [],
    createdAt: '2026-08-30T00:00:00.000Z',
  },
  summary: 'safe reorder proposal',
}

describe('CuratorReorganizeResult schema validation (fail-close)', () => {
  it('accepts a structurally valid result', () => {
    expect(() => validateCuratorReorganizeResult(validResult)).not.toThrow()
  })

  it('rejects non-object root', () => {
    expect(() => validateCuratorReorganizeResult('nope')).toThrow('Curator result must be an object.')
    expect(() => validateCuratorReorganizeResult(null)).toThrow()
  })

  it('rejects wrong schemaVersion / kind / agentletId', () => {
    expect(() => validateCuratorReorganizeResult({ ...validResult, schemaVersion: 2 })).toThrow('schemaVersion must be 1')
    expect(() => validateCuratorReorganizeResult({ ...validResult, kind: 'skill-proposal' })).toThrow('kind must be')
    expect(() => validateCuratorReorganizeResult({ ...validResult, agentletId: 'lcos-skill-author' })).toThrow('agentletId must be')
  })

  it('rejects missing summary / proposal baseVersion (invalid_output path)', () => {
    expect(() => validateCuratorReorganizeResult({ ...validResult, summary: '' })).toThrow('summary is required')
    const bad = { ...validResult, proposal: { ...validResult.proposal, baseVersion: undefined } }
    expect(() => validateCuratorReorganizeResult(bad)).toThrow('baseVersion must be an integer')
  })
})