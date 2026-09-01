/** Canonical LCOS dot-matrix visual identity contract. */
export type DotGlyphCellLevelV0 = 1 | 2 | 3

export interface DotGlyphCellV0 {
  readonly x: number
  readonly y: number
  readonly level: DotGlyphCellLevelV0
}

export type DotGlyphMotionPresetV0 = 'none' | 'pulse' | 'scan' | 'flow'

/**
 * Agent/system generated glyphs use one fixed 16×16 logical grid. Renderers own
 * color/material/glow; the producer only describes semantic cells.
 */
export interface DotGlyphV0 {
  readonly schemaVersion: 0
  readonly grid: '16x16'
  readonly cells: readonly DotGlyphCellV0[]
  readonly semanticTags: readonly string[]
  readonly motionPreset?: DotGlyphMotionPresetV0
}

export function validateDotGlyphV0(glyph: DotGlyphV0): boolean {
  if (glyph.grid !== '16x16') return false
  if (glyph.cells.length > 256) return false
  const seen = new Set<string>()
  for (const cell of glyph.cells) {
    if (!Number.isInteger(cell.x) || !Number.isInteger(cell.y) || cell.x < 0 || cell.x > 15 || cell.y < 0 || cell.y > 15) return false
    if (cell.level !== 1 && cell.level !== 2 && cell.level !== 3) return false
    const key = `${cell.x}:${cell.y}`
    if (seen.has(key)) return false
    seen.add(key)
  }
  return true
}
