import { describe, expect, it } from 'vitest'

import { compileContextPromptV1 } from '../src/context-prompt-serializer.js'
import { contextPromptFixture } from './context-prompt-fixture.js'

describe('Context prompt fragment anchors', () => {
  it('changes the stable prefix when a logical Source Fragment anchor changes', () => {
    const base = contextPromptFixture()
    const first = compileContextPromptV1({ manifest: base, userTask: 'x', outputIntent: 'analyze' })
    const changedIdentity = 'saved:feedback:rev-feedback:pdf:p6-p8'
    const changed = contextPromptFixture({
      orderedItems: base.orderedItems?.map((item) => item.artifactId === 'feedback'
        ? { ...item, identity: changedIdentity, sourceAnchor: 'pdf:p6-p8' }
        : item),
      cachePlan: {
        ...base.cachePlan!,
        stableItemIdentities: base.cachePlan!.stableItemIdentities.map((identity) => identity.includes('feedback') ? changedIdentity : identity),
      },
    })
    const second = compileContextPromptV1({ manifest: changed, userTask: 'x', outputIntent: 'analyze' })
    expect(second.stablePrefixHash).not.toBe(first.stablePrefixHash)
    expect(second.stablePrefix).toContain('anchor: pdf:p6-p8')
  })
})
