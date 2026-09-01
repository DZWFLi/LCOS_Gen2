import { KNOWN_FILE_FORMATS_V0 } from './file-format-registry.js'
import { SEARCH_CONTENT_EXTRACTOR_IDS } from './search-artifact-body.js'
import type { SemanticProviderRegistry } from './semantic-provider-registry.js'

export type SearchFormatCoverageStatusV0 = 'SUPPORTED' | 'UNSUPPORTED'

export interface SearchFormatCoverageRowV0 {
  readonly extension: string
  readonly mimeType: string
  readonly status: SearchFormatCoverageStatusV0
  readonly extractorId?: string
  readonly condition?: string
  readonly reason: string
}

/**
 * S10 explicit policy matrix. Every file format known to file-format-registry must appear here
 * exactly once. Missing rows fail the S10 gate. Unsupported means exactly that: no placeholder
 * extractor and no "planned support" state.
 */
const COVERAGE_POLICY: Readonly<Record<string, Omit<SearchFormatCoverageRowV0, 'extension' | 'mimeType'>>> = {
  '.md': { status: 'SUPPORTED', extractorId: SEARCH_CONTENT_EXTRACTOR_IDS.plainText, reason: 'UTF-8 text evidence.' },
  '.txt': { status: 'SUPPORTED', extractorId: SEARCH_CONTENT_EXTRACTOR_IDS.plainText, reason: 'UTF-8 text evidence.' },
  '.csv': { status: 'SUPPORTED', extractorId: SEARCH_CONTENT_EXTRACTOR_IDS.plainText, reason: 'CSV is indexed as real text evidence; no table semantics are claimed.' },
  '.json': { status: 'SUPPORTED', extractorId: SEARCH_CONTENT_EXTRACTOR_IDS.plainText, reason: 'JSON source text is directly indexable.' },
  '.yaml': { status: 'SUPPORTED', extractorId: SEARCH_CONTENT_EXTRACTOR_IDS.plainText, reason: 'YAML source text is directly indexable.' },
  '.yml': { status: 'SUPPORTED', extractorId: SEARCH_CONTENT_EXTRACTOR_IDS.plainText, reason: 'YAML source text is directly indexable.' },
  '.xml': { status: 'SUPPORTED', extractorId: SEARCH_CONTENT_EXTRACTOR_IDS.plainText, reason: 'XML source text is directly indexable.' },
  '.html': { status: 'SUPPORTED', extractorId: SEARCH_CONTENT_EXTRACTOR_IDS.plainText, reason: 'HTML source text is indexed as text; DOM semantics are not claimed.' },

  '.png': { status: 'SUPPORTED', extractorId: SEARCH_CONTENT_EXTRACTOR_IDS.ocrEvidence, condition: 'persisted OCR evidence exists', reason: 'Uses explicit RapidOCR evidence; no filename/vision fallback.' },
  '.jpg': { status: 'SUPPORTED', extractorId: SEARCH_CONTENT_EXTRACTOR_IDS.ocrEvidence, condition: 'persisted OCR evidence exists', reason: 'Uses explicit RapidOCR evidence.' },
  '.jpeg': { status: 'SUPPORTED', extractorId: SEARCH_CONTENT_EXTRACTOR_IDS.ocrEvidence, condition: 'persisted OCR evidence exists', reason: 'Uses explicit RapidOCR evidence.' },
  '.webp': { status: 'SUPPORTED', extractorId: SEARCH_CONTENT_EXTRACTOR_IDS.ocrEvidence, condition: 'persisted OCR evidence exists', reason: 'Uses explicit RapidOCR evidence.' },
  '.gif': { status: 'SUPPORTED', extractorId: SEARCH_CONTENT_EXTRACTOR_IDS.ocrEvidence, condition: 'persisted OCR evidence exists', reason: 'Uses explicit RapidOCR evidence; animation semantics are not claimed.' },
  '.bmp': { status: 'SUPPORTED', extractorId: SEARCH_CONTENT_EXTRACTOR_IDS.ocrEvidence, condition: 'persisted OCR evidence exists', reason: 'Uses explicit RapidOCR evidence.' },
  '.tif': { status: 'UNSUPPORTED', reason: 'Current OcrService does not accept TIFF; no visual embedding provider is registered.' },
  '.tiff': { status: 'UNSUPPORTED', reason: 'Current OcrService does not accept TIFF; no visual embedding provider is registered.' },
  '.svg': { status: 'UNSUPPORTED', reason: 'No SVG text/visual extractor is registered; do not treat XML markup or filename as visual semantics.' },

  '.pdf': { status: 'SUPPORTED', extractorId: SEARCH_CONTENT_EXTRACTOR_IDS.pdfTextLayer, condition: 'PDF has an extractable text layer', reason: 'pdfjs-dist page text extraction; scan-only PDFs honestly yield empty body.' },
  '.doc': { status: 'UNSUPPORTED', reason: 'Legacy binary Word has no real extractor in Local Core.' },
  '.docx': { status: 'SUPPORTED', extractorId: SEARCH_CONTENT_EXTRACTOR_IDS.ooxml, reason: 'OOXML word/document.xml text runs.' },
  '.ppt': { status: 'UNSUPPORTED', reason: 'Legacy binary PowerPoint has no real extractor in Local Core.' },
  '.pptx': { status: 'SUPPORTED', extractorId: SEARCH_CONTENT_EXTRACTOR_IDS.ooxml, reason: 'OOXML slide text runs with page separators.' },
  '.xls': { status: 'UNSUPPORTED', reason: 'Legacy binary Excel has no real extractor in Local Core.' },
  '.xlsx': { status: 'UNSUPPORTED', reason: 'No spreadsheet content extractor is registered in the current v0.15 search index.' },

  '.zip': { status: 'UNSUPPORTED', reason: 'Generic archives are resources/packages, not flattened into search body without an explicit extractor.' },
  '.mp3': { status: 'UNSUPPORTED', reason: 'No speech/audio transcription extractor is registered.' },
  '.wav': { status: 'UNSUPPORTED', reason: 'No speech/audio transcription extractor is registered.' },
  '.m4a': { status: 'UNSUPPORTED', reason: 'No speech/audio transcription extractor is registered.' },
  '.mp4': { status: 'UNSUPPORTED', reason: 'No video transcript/visual extractor is registered.' },
  '.mov': { status: 'UNSUPPORTED', reason: 'No video transcript/visual extractor is registered.' },
  '.webm': { status: 'UNSUPPORTED', reason: 'No video transcript/visual extractor is registered.' },
  '.psd': { status: 'UNSUPPORTED', reason: 'No PSD text/visual extractor is registered.' },
  '.ai': { status: 'UNSUPPORTED', reason: 'No Illustrator/PostScript content extractor is registered.' },
}

export const SEARCH_FORMAT_COVERAGE_V0: readonly SearchFormatCoverageRowV0[] = KNOWN_FILE_FORMATS_V0.map((format) => {
  const policy = COVERAGE_POLICY[format.extension]
  if (policy === undefined) {
    return {
      extension: format.extension,
      mimeType: format.mimeType,
      status: 'UNSUPPORTED' as const,
      reason: 'MISSING_COVERAGE_POLICY',
    }
  }
  return { extension: format.extension, mimeType: format.mimeType, ...policy }
})

export function validateSearchFormatCoverage(registry: SemanticProviderRegistry): string[] {
  const errors: string[] = []
  const known = new Set(KNOWN_FILE_FORMATS_V0.map((format) => format.extension))
  const policyKeys = Object.keys(COVERAGE_POLICY)
  for (const extension of policyKeys) {
    if (!known.has(extension)) errors.push(`Coverage policy contains unknown extension: ${extension}`)
  }
  if (new Set(policyKeys).size !== policyKeys.length) errors.push('Coverage policy has duplicate extensions.')
  for (const row of SEARCH_FORMAT_COVERAGE_V0) {
    if (row.reason === 'MISSING_COVERAGE_POLICY') errors.push(`Missing explicit coverage policy: ${row.extension}`)
    if (row.status === 'SUPPORTED') {
      if (row.extractorId === undefined) {
        errors.push(`SUPPORTED row has no extractorId: ${row.extension}`)
        continue
      }
      const extractor = registry.contentExtractor(row.extractorId)
      if (extractor === undefined) {
        errors.push(`Registered extractor missing for ${row.extension}: ${row.extractorId}`)
        continue
      }
      const resolved = registry.resolveContentExtractor({ mimeType: row.mimeType, extension: row.extension })
      if (resolved?.id !== row.extractorId) {
        errors.push(`Extractor resolution mismatch for ${row.extension}: expected ${row.extractorId}, got ${resolved?.id ?? 'none'}`)
      }
    } else if (row.extractorId !== undefined) {
      errors.push(`UNSUPPORTED row must not declare extractorId: ${row.extension}`)
    }
  }
  return errors
}
