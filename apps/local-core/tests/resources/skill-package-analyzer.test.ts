import { describe, expect, it } from 'vitest'

import type { ResourceDescriptorV0 } from '@local-creative-os/contracts'

import { AnalyzerRegistry } from '../../src/resources/analyzers/analyzer-registry.js'
import { SkillPackageAnalyzer } from '../../src/resources/analyzers/skill-package-analyzer.js'

function packageDescriptor(): ResourceDescriptorV0 {
  return {
    schemaVersion: '0',
    id: 'descriptor-pkg',
    projectId: 'project-test',
    resourceId: 'resource-pkg',
    artifactId: 'artifact-pkg',
    sourceRevisionId: 'revision-pkg',
    source: { kind: 'directory', originalName: 'my-skill' },
    display: { title: 'my-skill' },
    detectedKinds: [],
    capabilities: [],
    inputs: [],
    outputs: [],
    constraints: [],
    entrypoints: [],
    readFirst: [],
    understanding: { status: 'pending', warnings: [], analyzerVersion: 'fast-v0' },
    trust: { level: 'untrusted', readable: true, executable: false, requiresApproval: false },
  }
}

const manifest = JSON.stringify({
  schemaVersion: '0',
  resourceId: 'resource-pkg',
  rootName: 'my-skill',
  files: [
    { path: 'SKILL.md', size: 10, contentHash: 'a' },
    { path: 'README.md', size: 10, contentHash: 'b' },
    { path: 'mcp.json', size: 10, contentHash: 'c' },
    { path: 'scripts/run.js', size: 10, contentHash: 'd' },
  ],
})

describe('SkillPackageAnalyzer (U3)', () => {
  it('detects a standard skill package with name, entrypoints and readFirst', async () => {
    const registry = new AnalyzerRegistry([new SkillPackageAnalyzer()])
    const readFile = async (path: string): Promise<string | undefined> => {
      if (path === 'SKILL.md') return '---\nname: my-skill\ndescription: Does creative work\ninputs:\n  - script\noutputs:\n  - shots\n---\n# Instructions\n\nRead carefully.'
      if (path === 'README.md') return '# my-skill'
      return undefined
    }
    const draft = await registry.analyze({ descriptor: packageDescriptor(), content: manifest, readFile })
    expect(draft.detectedKinds.map((kind) => kind.kind)).toContain('skill_package')
    expect(draft.understanding.status).toBe('ready')
    expect(draft.understanding.summary).toContain('my-skill')
    expect(draft.entrypoints.some((entry) => entry.value === 'SKILL.md')).toBe(true)
    expect(draft.entrypoints.some((entry) => entry.value === 'mcp.json' && entry.kind === 'mcp')).toBe(true)
    expect(draft.inputs).toEqual(['script'])
    expect(draft.outputs).toEqual(['shots'])
    expect(draft.readFirst).toContain('SKILL.md')
  })

  it('reports partial for a package without SKILL.md', async () => {
    const registry = new AnalyzerRegistry([new SkillPackageAnalyzer()])
    const draft = await registry.analyze({
      descriptor: packageDescriptor(),
      content: JSON.stringify({ schemaVersion: '0', rootName: 'plain', files: [{ path: 'data.txt', size: 1, contentHash: 'x' }] }),
      readFile: async () => undefined,
    })
    expect(draft.detectedKinds[0]?.kind).toBe('unknown_package')
    expect(draft.understanding.status).toBe('partial')
  })
})
