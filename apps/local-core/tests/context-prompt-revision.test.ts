import { describe, expect, it } from 'vitest'

import { compileContextPromptV1 } from '../src/context-prompt-serializer.js'
import { contextPromptFixture } from './context-prompt-fixture.js'

describe('Context prompt revision semantics', () => {
  it('changes stable identity when the Saved Context Current revision changes', () => {
    const base = contextPromptFixture()
    const first = compileContextPromptV1({ manifest: base, userTask: 'x', outputIntent: 'analyze' })
    const nextIdentity = 'saved:brief:rev-brief-v2'
    const changed = contextPromptFixture({
      orderedItems: base.orderedItems?.map((item) => item.artifactId === 'brief'
        ? { ...item, identity: nextIdentity, revisionId: 'rev-brief-v2', contentHash: 'hash-brief-v2', content: 'Updated brief.' }
        : item),
      cachePlan: {
        ...base.cachePlan!,
        stableItemIdentities: base.cachePlan!.stableItemIdentities.map((identity) => identity === 'saved:brief:rev-brief' ? nextIdentity : identity),
      },
    })
    const second = compileContextPromptV1({ manifest: changed, userTask: 'x', outputIntent: 'analyze' })
    expect(second.stablePrefixHash).not.toBe(first.stablePrefixHash)
  })

  it('keeps a pinned Saved Context revision stable while task-local/current data changes', () => {
    const base = contextPromptFixture()
    const first = compileContextPromptV1({ manifest: base, userTask: 'x', outputIntent: 'analyze' })
    const changed = contextPromptFixture({
      orderedItems: [...(base.orderedItems ?? []), {
        role: 'target', identity: 'brief-current-v2', title: 'Brief', artifactId: 'brief', revisionId: 'rev-brief-v2',
        mimeType: 'text/markdown', contentHash: 'hash-brief-v2', content: 'New current revision that is not pinned into Saved Context.',
      }],
      target: {
        artifactId: 'brief', revisionId: 'rev-brief-v2', fileRecordId: 'file-v2', title: 'Brief', kind: 'markdown',
        mimeType: 'text/markdown', contentHash: 'hash-brief-v2', availability: 'available',
      },
    })
    const second = compileContextPromptV1({ manifest: changed, userTask: 'Revise it', outputIntent: 'revise' })
    expect(second.stablePrefixHash).toBe(first.stablePrefixHash)
    expect(second.dynamicTailHash).not.toBe(first.dynamicTailHash)
  })
})
