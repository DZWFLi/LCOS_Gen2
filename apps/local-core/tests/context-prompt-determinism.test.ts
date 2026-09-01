import { describe, expect, it } from 'vitest'

import { compileContextPromptV1 } from '../src/context-prompt-serializer.js'
import { contextPromptFixture } from './context-prompt-fixture.js'

describe('ContextPromptSerializerV1 determinism', () => {
  it('compiles legacy schema v0 manifests that only persisted the project id', () => {
    const manifest = { project: { id: 'project-legacy' }, lockedElements: ['keep'] }
    const compiled = compileContextPromptV1({ manifest, userTask: 'Analyze', outputIntent: 'analyze' })
    expect(compiled.stablePrefix).toContain('project-name: project-legacy')
  })

  it('reproduces byte-identical stable prefixes and hashes across repeated reload-style compilations', () => {
    const input = {
      manifest: contextPromptFixture(),
      userTask: 'Continue the current task.',
      outputIntent: 'analyze' as const,
    }
    const first = compileContextPromptV1(input)
    for (let index = 0; index < 100; index += 1) {
      const next = compileContextPromptV1({
        ...input,
        manifest: JSON.parse(JSON.stringify(input.manifest)),
      })
      expect(next.stablePrefix).toBe(first.stablePrefix)
      expect(next.stablePrefixHash).toBe(first.stablePrefixHash)
      expect(next.snapshotId).toBe(first.snapshotId)
    }
  })

  it('normalizes CRLF and Unicode composition without changing the stable identity', () => {
    const firstManifest = contextPromptFixture()
    const secondManifest = contextPromptFixture({
      orderedItems: firstManifest.orderedItems?.map((item, index) => index === 0
        ? { ...item, title: 'Cafe\u0301', content: 'Line one\r\nLine two' }
        : item),
    })
    const thirdManifest = contextPromptFixture({
      orderedItems: firstManifest.orderedItems?.map((item, index) => index === 0
        ? { ...item, title: 'Café', content: 'Line one\nLine two' }
        : item),
    })
    expect(compileContextPromptV1({ manifest: secondManifest, userTask: 'x', outputIntent: 'analyze' }).stablePrefixHash)
      .toBe(compileContextPromptV1({ manifest: thirdManifest, userTask: 'x', outputIntent: 'analyze' }).stablePrefixHash)
  })

  it('does not let a task-local target role change the Saved Context prefix', () => {
    const base = contextPromptFixture()
    const stableBrief = base.orderedItems?.[0]!
    const withTarget = contextPromptFixture({
      target: {
        artifactId: 'brief', revisionId: 'rev-brief', fileRecordId: 'file-brief',
        title: 'Brief', kind: 'markdown', mimeType: 'text/markdown', contentHash: 'hash-brief', availability: 'available',
      },
      orderedItems: [...(base.orderedItems ?? []), { ...stableBrief, role: 'target', identity: 'brief-task-target' }],
    })
    const first = compileContextPromptV1({ manifest: base, userTask: 'Analyze', outputIntent: 'analyze' })
    const second = compileContextPromptV1({ manifest: withTarget, userTask: 'Revise', outputIntent: 'revise' })
    expect(second.stablePrefixHash).toBe(first.stablePrefixHash)
    expect(second.dynamicTailHash).not.toBe(first.dynamicTailHash)
    expect(second.dynamicTail).not.toContain('A stable project brief.')
  })
})
