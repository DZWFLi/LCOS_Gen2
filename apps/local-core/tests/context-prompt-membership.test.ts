import { describe, expect, it } from 'vitest'

import { compileContextPromptV1 } from '../src/context-prompt-serializer.js'
import { contextPromptFixture } from './context-prompt-fixture.js'

describe('Context prompt Saved Context membership', () => {
  it('changes the stable prefix when membership changes', () => {
    const base = contextPromptFixture()
    const first = compileContextPromptV1({ manifest: base, userTask: 'x', outputIntent: 'analyze' })
    const third = {
      role: 'context' as const, identity: 'saved:new:rev-new', title: 'New Member', artifactId: 'new', revisionId: 'rev-new',
      mimeType: 'text/plain', contentHash: 'hash-new', content: 'New stable context.',
    }
    const secondManifest = contextPromptFixture({
      orderedItems: [...(base.orderedItems ?? []), third],
      cachePlan: { ...base.cachePlan!, stableItemIdentities: [...base.cachePlan!.stableItemIdentities, third.identity] },
    })
    const second = compileContextPromptV1({ manifest: secondManifest, userTask: 'x', outputIntent: 'analyze' })
    expect(second.stablePrefixHash).not.toBe(first.stablePrefixHash)
    expect(second.snapshotId).not.toBe(first.snapshotId)
  })

  it('preserves Saved Context membership order instead of sorting by artifact id', () => {
    const base = contextPromptFixture()
    const reversed = contextPromptFixture({
      cachePlan: { ...base.cachePlan!, stableItemIdentities: [...base.cachePlan!.stableItemIdentities].reverse() },
    })
    const first = compileContextPromptV1({ manifest: base, userTask: 'x', outputIntent: 'analyze' })
    const second = compileContextPromptV1({ manifest: reversed, userTask: 'x', outputIntent: 'analyze' })
    expect(second.stablePrefixHash).not.toBe(first.stablePrefixHash)
    expect(first.stablePrefix.indexOf('Brief')).toBeLessThan(first.stablePrefix.indexOf('Feedback'))
    expect(second.stablePrefix.indexOf('Feedback')).toBeLessThan(second.stablePrefix.indexOf('Brief'))
  })
})
