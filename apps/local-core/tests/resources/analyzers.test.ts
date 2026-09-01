import { afterEach, describe, expect, it, vi } from 'vitest'

import type { ResourceDescriptorV0 } from '@local-creative-os/contracts'

import { AnalyzerRegistry } from '../../src/resources/analyzers/analyzer-registry.js'
import { FallbackAnalyzer } from '../../src/resources/analyzers/fallback-analyzer.js'
import { JsonAnalyzer } from '../../src/resources/analyzers/json-analyzer.js'
import { LinkAnalyzer } from '../../src/resources/analyzers/link-analyzer.js'
import { MarkdownAnalyzer } from '../../src/resources/analyzers/markdown-analyzer.js'
import { TextAnalyzer } from '../../src/resources/analyzers/text-analyzer.js'
import { YamlAnalyzer } from '../../src/resources/analyzers/yaml-analyzer.js'

afterEach(() => {
  vi.unstubAllGlobals()
})

function descriptor(overrides: Partial<ResourceDescriptorV0> = {}): ResourceDescriptorV0 {
  return {
    schemaVersion: '0',
    id: 'descriptor-test',
    projectId: 'project-test',
    resourceId: 'resource-test',
    artifactId: 'artifact-test',
    sourceRevisionId: 'revision-test',
    source: { kind: 'file' },
    display: { title: 'test' },
    detectedKinds: [],
    capabilities: [],
    inputs: [],
    outputs: [],
    constraints: [],
    entrypoints: [],
    readFirst: [],
    understanding: { status: 'pending', warnings: [], analyzerVersion: 'fast-v0' },
    trust: { level: 'untrusted', readable: true, executable: false, requiresApproval: false },
    ...overrides,
  }
}

describe('Analyzer Registry (U2)', () => {
  it('marks MD brief/script/feedback/skill candidates with evidence and confidence 0..1', async () => {
    const registry = new AnalyzerRegistry([new MarkdownAnalyzer(), new FallbackAnalyzer()])
    const input = {
      descriptor: descriptor({ source: { kind: 'file', originalName: 'brief.md', extension: '.md' } }),
      content: '# Brief\n\n## Objective\nLaunch campaign.\n\n## Feedback\nKeep the title.',
    }
    const draft = await registry.analyze(input)
    const kinds = draft.detectedKinds.map((kind) => kind.kind)
    expect(kinds).toContain('brief_candidate')
    expect(kinds).toContain('feedback_candidate')
    expect(draft.understanding.analyzerVersion).toBe('markdown-v0')
    for (const kind of draft.detectedKinds) {
      expect(kind.confidence).toBeGreaterThanOrEqual(0)
      expect(kind.confidence).toBeLessThanOrEqual(1)
      expect(kind.evidence.length).toBeGreaterThan(0)
    }
  })

  it('detects skill_document from SKILL.md', async () => {
    const registry = new AnalyzerRegistry([new MarkdownAnalyzer(), new FallbackAnalyzer()])
    const draft = await registry.analyze({
      descriptor: descriptor({ source: { kind: 'file', originalName: 'SKILL.md', extension: '.md' } }),
      content: '---\nname: my-skill\n---\n# Instructions\n\nUse carefully.',
    })
    expect(draft.detectedKinds.map((kind) => kind.kind)).toContain('skill_document')
  })

  it('extracts JSON manifest and tool_config candidates without copying full content', async () => {
    const registry = new AnalyzerRegistry([new JsonAnalyzer(), new FallbackAnalyzer()])
    const draft = await registry.analyze({
      descriptor: descriptor({ source: { kind: 'file', originalName: 'tools.json', extension: '.json' } }),
      content: '{"name":"storyboard-skill","version":"0.1","tools":["a","b"],"inputs":["script"],"outputs":["shots"]}',
    })
    const kinds = draft.detectedKinds.map((kind) => kind.kind)
    expect(kinds).toContain('manifest')
    expect(kinds).toContain('skill_manifest')
    expect(draft.inputs).toEqual(['script'])
    expect(draft.understanding.summary).toContain('object{')
  })

  it('reports invalid JSON without throwing', async () => {
    const registry = new AnalyzerRegistry([new JsonAnalyzer()])
    const draft = await registry.analyze({
      descriptor: descriptor({ source: { kind: 'file', originalName: 'bad.json', extension: '.json' } }),
      content: '{ not json',
    })
    expect(draft.detectedKinds[0]?.kind).toBe('invalid_json')
    expect(draft.understanding.status).toBe('partial')
  })

  it('parses a safe YAML subset with nested maps and lists', async () => {
    const registry = new AnalyzerRegistry([new YamlAnalyzer(), new FallbackAnalyzer()])
    const draft = await registry.analyze({
      descriptor: descriptor({ source: { kind: 'file', originalName: 'config.yaml', extension: '.yaml' } }),
      content: [
        'name: demo-skill',
        'version: "1.0"',
        'tools:',
        '  - name: read',
        '    args: [path, limit]',
        'steps:',
        '  - analyze',
      ].join('\n'),
    })
    expect(draft.detectedKinds.map((kind) => kind.kind)).toContain('workflow_definition')
    expect(draft.understanding.status).toBe('ready')
  })

  it('rejects unsafe YAML (anchors, tags, multi-document)', async () => {
    const registry = new AnalyzerRegistry([new YamlAnalyzer()])
    for (const content of ['a: &x 1\nb: *x', 'a: !tag value', '---\na: 1\n---\nb: 2']) {
      const draft = await registry.analyze({
        descriptor: descriptor({ source: { kind: 'file', originalName: 'bad.yaml', extension: '.yaml' } }),
        content,
      })
      expect(draft.detectedKinds[0]?.kind).toBe('invalid_yaml')
    }
  })

  it('extracts link metadata on successful fetch and degrades to partial on failure', async () => {
    const registry = new AnalyzerRegistry([new LinkAnalyzer()])
    const linkDescriptor = descriptor({
      source: {
        kind: 'url',
        originalName: 'example.com.link.md',
        normalizedUrl: 'https://example.com/page',
        domain: 'example.com',
      },
      display: { title: 'example.com' },
    })

    vi.stubGlobal('fetch', vi.fn(async () => new Response(
      '<html><head><title>Example Page</title><meta property="og:description" content="A demo page"></head></html>',
      { status: 200, headers: { 'content-type': 'text/html' } },
    )))
    const ready = await registry.analyze({ descriptor: linkDescriptor, content: '' })
    expect(ready.understanding.status).toBe('ready')
    expect(ready.understanding.summary).toContain('Example Page')

    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('network disabled') }))
    const partial = await registry.analyze({ descriptor: linkDescriptor, content: '' })
    expect(partial.understanding.status).toBe('partial')
    expect(partial.understanding.warnings.length).toBeGreaterThan(0)
  })

  it('plain text analyzer reports lines and first line', async () => {
    const registry = new AnalyzerRegistry([new TextAnalyzer()])
    const draft = await registry.analyze({
      descriptor: descriptor({ source: { kind: 'file', originalName: 'notes.txt', extension: '.txt' } }),
      content: 'First line.\nSecond line.',
    })
    expect(draft.detectedKinds[0]?.kind).toBe('plain_text')
    expect(draft.readFirst[0]).toContain('First line.')
  })
})
