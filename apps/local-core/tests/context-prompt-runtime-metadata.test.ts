import { describe, expect, it } from 'vitest'

import { compileContextPromptV1 } from '../src/context-prompt-serializer.js'
import { contextPromptFixture } from './context-prompt-fixture.js'

describe('Context prompt runtime metadata split', () => {
  it('keeps selection, user task, run constraints and target in the dynamic tail only', () => {
    const manifest = contextPromptFixture()
    const first = compileContextPromptV1({ manifest, userTask: 'Task A', outputIntent: 'analyze', selectionArtifactIds: ['brief'], runConstraints: ['run-a'] })
    const second = compileContextPromptV1({ manifest, userTask: 'Task B', outputIntent: 'create', selectionArtifactIds: ['feedback'], runConstraints: ['run-b'] })
    expect(second.stablePrefixHash).toBe(first.stablePrefixHash)
    expect(second.dynamicTailHash).not.toBe(first.dynamicTailHash)
    expect(first.stablePrefix).not.toContain('Task A')
    expect(first.stablePrefix).not.toContain('run-a')
  })

  it('does not serialize common cache-killer runtime fields into the stable prefix', () => {
    const compiled = compileContextPromptV1({ manifest: contextPromptFixture(), userTask: 'x', outputIntent: 'analyze' })
    for (const forbidden of ['generated_at', 'current_time', 'session_id', 'run_id', 'retry_count', 'heartbeat', 'runtime port', 'process id', 'viewport']) {
      expect(compiled.stablePrefix.toLowerCase()).not.toContain(forbidden)
    }
  })
})
