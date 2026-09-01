import { describe, expect, it } from 'vitest'
import { normalizeSurfaceSelectionV0, validateDotGlyphV0 } from '../src/index.js'

describe('B0 selection contract', () => {
  it('deduplicates refs without expanding aggregate membership', () => {
    const selection = normalizeSurfaceSelectionV0({
      schemaVersion: 0,
      projectId: 'project-a',
      surfaceId: 'tap:arrange',
      entityRefs: [
        { type: 'scope', id: 'collection-a' },
        { type: 'scope', id: 'collection-a' },
        { type: 'view', id: 'view-1' },
      ],
      updatedAt: '2026-08-14T00:00:00.000Z',
    })
    expect(selection.entityRefs).toEqual([
      { type: 'scope', id: 'collection-a' },
      { type: 'view', id: 'view-1' },
    ])
    expect(selection.anchorRef).toEqual({ type: 'view', id: 'view-1' })
  })
})

describe('DotGlyphV0', () => {
  it('accepts only unique cells inside the canonical 16x16 grid', () => {
    expect(validateDotGlyphV0({
      schemaVersion: 0,
      grid: '16x16',
      cells: [{ x: 2, y: 2, level: 2 }, { x: 13, y: 13, level: 3 }],
      semanticTags: ['context'],
    })).toBe(true)
    expect(validateDotGlyphV0({
      schemaVersion: 0,
      grid: '16x16',
      cells: [{ x: 16, y: 2, level: 2 }],
      semanticTags: [],
    })).toBe(false)
  })
})
