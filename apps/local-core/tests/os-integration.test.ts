import { describe, expect, it } from 'vitest'
import { revealRegisteredPath } from '../src/os-integration.js'

describe('revealRegisteredPath', () => {
  it('rejects relative paths', async () => {
    const result = await revealRegisteredPath('relative/path')
    expect(result.ok).toBe(false)
    expect(result.error).toBeDefined()
  })

  it('rejects non-existent absolute paths', async () => {
    const result = await revealRegisteredPath('C:\\definitely-not-a-lcos-project-20260811')
    expect(result.ok).toBe(false)
    expect(result.error).toContain('does not exist')
  })
})
