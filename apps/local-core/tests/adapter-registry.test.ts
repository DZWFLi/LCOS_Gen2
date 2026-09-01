import { describe, expect, it } from 'vitest'

import { AdapterUnsupportedError, defaultRuntimeAdapterRegistry } from '../src/adapter-registry.js'

describe('RuntimeAdapterRegistry (Slice B-3 / RUN-06)', () => {
  it('maps Markdown targets to the markdown revision workflow', () => {
    const profile = defaultRuntimeAdapterRegistry.resolveRevise(
      { kind: 'markdown' },
      { mimeType: 'text/markdown' },
    )
    expect(profile).toMatchObject({
      workflow: 'markdown_script_revision',
      taskType: 'markdown_script_revision',
      fileExtension: '.md',
      mediaType: 'text/markdown',
    })
  })

  it('maps plain-text targets to the markdown revision workflow', () => {
    const profile = defaultRuntimeAdapterRegistry.resolveRevise(
      { kind: 'markdown' },
      { mimeType: 'text/plain' },
    )
    expect(profile.mediaType).toBe('text/markdown')
  })

  it('rejects image targets before dispatch', () => {
    expect(() => defaultRuntimeAdapterRegistry.resolveRevise(
      { kind: 'image' },
      { mimeType: 'image/png' },
    )).toThrow(AdapterUnsupportedError)
  })

  it('rejects PDF and presentation targets before dispatch', () => {
    expect(() => defaultRuntimeAdapterRegistry.resolveRevise(
      { kind: 'pdf' },
      { mimeType: 'application/pdf' },
    )).toThrow(/not supported/)
    expect(() => defaultRuntimeAdapterRegistry.resolveRevise(
      { kind: 'presentation' },
      { mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation' },
    )).toThrow(/not supported/)
  })

  it('resolves create to the open creative_run workflow', () => {
    expect(defaultRuntimeAdapterRegistry.resolveCreate()).toMatchObject({
      workflow: 'creative_run',
      taskType: 'creative_run',
    })
  })

  it('resolves analyze to the zero-output creative_run workflow', () => {
    expect(defaultRuntimeAdapterRegistry.resolveAnalyze()).toMatchObject({
      workflow: 'creative_run',
      taskType: 'creative_run',
    })
  })
})
