import { describe, expect, it } from 'vitest'

import type { ResourceDescriptorV0 } from '@local-creative-os/contracts'

import { ResourceMatcher } from '../../src/resources/resource-matcher.js'

function descriptor(overrides: Partial<ResourceDescriptorV0> & { id: string; resourceId: string; artifactId: string }): ResourceDescriptorV0 {
  return {
    schemaVersion: '0',
    projectId: 'project-test',
    sourceRevisionId: `revision-${overrides.resourceId}`,
    source: { kind: 'file' },
    display: { title: overrides.resourceId },
    detectedKinds: [],
    capabilities: [],
    inputs: [],
    outputs: [],
    constraints: [],
    entrypoints: [],
    readFirst: [],
    understanding: { status: 'ready', warnings: [], analyzerVersion: 'test' },
    trust: { level: 'untrusted', readable: true, executable: false, requiresApproval: false },
    ...overrides,
  }
}

const skill = descriptor({
  id: 'd-skill',
  resourceId: 'resource-skill',
  artifactId: 'artifact-skill',
  detectedKinds: [{ kind: 'skill_package', confidence: 0.9, evidence: [{ source: 'manifest', value: 'SKILL.md' }] }],
  capabilities: [{ name: 'skill_package', confidence: 0.9, evidence: ['SKILL.md'] }],
  inputs: ['script'],
  outputs: ['shots'],
  entrypoints: [{ kind: 'file', value: 'SKILL.md' }],
})

const toolConfig = descriptor({
  id: 'd-tool',
  resourceId: 'resource-tool',
  artifactId: 'artifact-tool',
  detectedKinds: [{ kind: 'tool_config', confidence: 0.7, evidence: [{ source: 'structure', value: 'tools' }] }],
  capabilities: [{ name: 'tool_config', confidence: 0.7, evidence: ['tools field'] }],
})

const reference = descriptor({
  id: 'd-ref',
  resourceId: 'resource-ref',
  artifactId: 'artifact-ref',
  detectedKinds: [{ kind: 'markdown_document', confidence: 0.7, evidence: [{ source: 'filename', value: 'brief.md' }] }],
  capabilities: [{ name: 'brief', confidence: 0.7, evidence: ['brief.md'] }],
})

describe('ResourceMatcher (U4)', () => {
  it('ranks the storyboard skill above tool config and reference for a script task', () => {
    const matches = new ResourceMatcher().match([toolConfig, reference, skill], {
      projectId: 'project-test',
      instruction: 'use the storyboard skill to revise the script',
      outputIntent: 'revise',
    })
    expect(matches[0]?.resourceId).toBe('resource-skill')
    expect(matches[0]?.role).toBe('candidate_skill')
    expect(matches[0]?.requiresApproval).toBe(true)
    expect(matches.filter((match) => match.role === 'candidate_skill')).toHaveLength(1)
  })

  it('does not treat a JSON tool config as an executable skill', () => {
    const matches = new ResourceMatcher().match([toolConfig], {
      projectId: 'project-test',
      instruction: 'tool config for workflow',
    })
    expect(matches[0]?.role).toBe('tool_config')
    expect(matches[0]?.requiresApproval).toBe(false)
  })

  it('filters excluded resources and caps skill candidates', () => {
    const matcher = new ResourceMatcher()
    const matches = matcher.match([skill, reference], {
      projectId: 'project-test',
      instruction: 'use the storyboard skill to revise the script and brief',
    }, { excludedResourceIds: ['resource-skill'] })
    expect(matches.some((match) => match.resourceId === 'resource-skill')).toBe(false)
    expect(matches.some((match) => match.resourceId === 'resource-ref')).toBe(true)

    const manySkills = Array.from({ length: 5 }, (_, index) => descriptor({
      id: `d-${index}`,
      resourceId: `resource-skill-${index}`,
      artifactId: `artifact-skill-${index}`,
      detectedKinds: [{ kind: 'skill_package', confidence: 0.9, evidence: [{ source: 'manifest', value: 'SKILL.md' }] }],
      capabilities: [{ name: 'skill_package', confidence: 0.9, evidence: ['SKILL.md'] }],
      inputs: ['script'],
    }))
    const capped = matcher.match(manySkills, {
      projectId: 'project-test',
      instruction: 'use the storyboard skill to revise the script',
    })
    expect(capped.filter((match) => match.role === 'candidate_skill')).toHaveLength(3)
  })

  it('trusted skills do not require approval', () => {
    const trusted = { ...skill, trust: { level: 'trusted' as const, readable: true, executable: false, requiresApproval: false } }
    const matches = new ResourceMatcher().match([trusted], {
      projectId: 'project-test',
      instruction: 'use the storyboard skill to revise the script',
    })
    expect(matches[0]?.requiresApproval).toBe(false)
  })

  it('converts matches to manifest refs with descriptor hash and reasons', () => {
    const matcher = new ResourceMatcher()
    const matches = matcher.match([skill], {
      projectId: 'project-test',
      instruction: 'use the storyboard skill to revise the script',
    })
    const refs = matcher.toManifestRefs(matches, [skill])
    expect(refs[0]).toMatchObject({
      resourceId: 'resource-skill',
      artifactId: 'artifact-skill',
      role: 'candidate_skill',
      requiresApproval: true,
    })
    expect(refs[0]?.descriptorHash).toMatch(/^[0-9a-f]{64}$/)
    expect(refs[0]?.matchReasons.length).toBeGreaterThan(0)
  })
})
