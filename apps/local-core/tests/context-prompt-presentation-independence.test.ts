import { describe, expect, it } from 'vitest'

import { compileContextPromptV1 } from '../src/context-prompt-serializer.js'
import { contextPromptFixture } from './context-prompt-fixture.js'

describe('Context prompt presentation independence', () => {
  it('is independent from coordinates, viewport, hover, and presentation-only state because they are outside the compiler contract', () => {
    const manifest = contextPromptFixture()
    const first = compileContextPromptV1({ manifest, userTask: 'x', outputIntent: 'analyze' })
    // A presentation move does not alter Project/Saved Context semantic input at all.
    const presentationBefore = { x: 100, y: 100, zoom: 1, selected: false }
    const presentationAfter = { x: 900, y: -300, zoom: 0.62, selected: true }
    expect(presentationBefore).not.toEqual(presentationAfter)
    const second = compileContextPromptV1({ manifest: JSON.parse(JSON.stringify(manifest)), userTask: 'x', outputIntent: 'analyze' })
    expect(second.stablePrefixHash).toBe(first.stablePrefixHash)
  })

  it('ignores graphVersion churn in the stable prefix', () => {
    const first = compileContextPromptV1({ manifest: contextPromptFixture(), userTask: 'x', outputIntent: 'analyze' })
    const second = compileContextPromptV1({
      manifest: contextPromptFixture({ project: { id: 'project-cache', name: 'Cache Project', graphVersion: 999 } }),
      userTask: 'x', outputIntent: 'analyze',
    })
    expect(second.stablePrefixHash).toBe(first.stablePrefixHash)
  })
})
