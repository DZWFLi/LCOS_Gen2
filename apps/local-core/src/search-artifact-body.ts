/**
 * Artifact current-body extraction for search / semantic indexing.
 *
 * S9/S10 convergence:
 * - extraction is registered through ContentExtractor providers;
 * - PDF / OOXML / OCR evidence behavior is preserved;
 * - plain structured text (CSV/JSON/YAML/XML/HTML) is now indexed as real text evidence;
 * - unsupported formats return empty body and remain title-searchable only.
 */
import { open, readFile } from 'node:fs/promises'

import { extensionOf } from './file-format-registry.js'
import {
  SemanticProviderRegistry,
  type ContentExtractionInputV1,
  type ContentExtractor,
} from './semantic-provider-registry.js'

export interface ArtifactBodyFileRecord {
  readonly mimeType?: string
  readonly observedPath?: string
}

/** PDF 页文本提取的页数上限（写路径同步提文本的保护；超大 PDF 截断不失败）。 */
const PDF_EXTRACT_PAGE_LIMIT = 200
/** 单页提取文本字符上限。 */
const PDF_PAGE_CHAR_LIMIT = 20_000

const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
const PPTX_MIME = 'application/vnd.openxmlformats-officedocument.presentationml.presentation'
/** OOXML 单部件文本字符上限（docx document.xml / pptx 单 slide）。 */
const OOXML_PART_CHAR_LIMIT = 60_000
const PPTX_SLIDE_LIMIT = 200

/** S10: plain text / structured-text formats that have real UTF-8 evidence extraction. */
const PLAIN_TEXT_MIME_TYPES = new Set([
  'text/markdown',
  'text/plain',
  'text/csv',
  'application/json',
  'application/yaml',
  'application/xml',
  'text/html',
])

/** OCR service currently accepts these bitmap formats; TIFF/SVG are intentionally not claimed. */
const OCR_EVIDENCE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif', '.bmp'])

export const SEARCH_CONTENT_EXTRACTOR_IDS = Object.freeze({
  plainText: 'plain-text',
  pdfTextLayer: 'pdf-text-layer',
  ooxml: 'ooxml-docx-pptx',
  ocrEvidence: 'image-ocr-evidence',
})

export interface OcrEvidenceLookup {
  (projectId: string, artifactId: string): string | undefined
}

async function readTextPrefix(observedPath: string | undefined, maxChars: number): Promise<string> {
  if (observedPath === undefined) return ''
  try {
    const handle = await open(observedPath, 'r')
    try {
      const buffer = Buffer.alloc(maxChars * 4 + 4)
      const { bytesRead } = await handle.read(buffer, 0, buffer.byteLength, 0)
      return buffer.subarray(0, bytesRead).toString('utf8')
    } finally {
      await handle.close()
    }
  } catch {
    return ''
  }
}

/**
 * B6 P1-A：OOXML（docx/pptx）静态正文提取。
 * fflate 解 zip 容器 → docx word/document.xml / pptx slide XML text runs.
 * 损坏/非标容器 → 空串（诚实缺席，标题块仍可检索）。
 */
export async function extractOoxmlText(observedPath: string, kind: 'docx' | 'pptx'): Promise<string> {
  const { unzipSync, strFromU8 } = await import('fflate')
  const bytes = new Uint8Array(await readFile(observedPath))
  const entries = unzipSync(bytes, { filter: (file) => kind === 'docx'
    ? file.name === 'word/document.xml'
    : file.name.startsWith('ppt/slides/slide') && file.name.endsWith('.xml') })
  if (kind === 'docx') {
    const data = entries['word/document.xml']
    if (data === undefined) return ''
    const xml = strFromU8(data).slice(0, OOXML_PART_CHAR_LIMIT * 4)
    return xml
      .replace(/<w:p[ >]/g, '\n<w:p ')
      .replace(/<\/w:p>/g, '\n')
      .replace(/<[^>]+>/g, '')
      .replace(/[ \t]+/g, ' ')
      .replace(/\n\s*\n+/g, '\n')
      .trim()
      .slice(0, OOXML_PART_CHAR_LIMIT)
  }
  const slideNumbers = Object.keys(entries)
    .map((name) => Number(/^ppt\/slides\/slide(\d+)\.xml$/.exec(name)?.[1] ?? Number.NaN))
    .filter((n) => Number.isInteger(n))
    .sort((a, b) => a - b)
    .slice(0, PPTX_SLIDE_LIMIT)
  const slides: string[] = []
  for (const slideNumber of slideNumbers) {
    const xml = strFromU8(entries[`ppt/slides/slide${slideNumber}.xml`]!).slice(0, OOXML_PART_CHAR_LIMIT * 4)
    const text = xml
      .replace(/<\/a:p>/g, '\n')
      .replace(/<[^>]+>/g, '')
      .replace(/[ \t]+/g, ' ')
      .replace(/\n\s*\n+/g, '\n')
      .trim()
      .slice(0, OOXML_PART_CHAR_LIMIT)
    slides.push(text)
  }
  return slides.join('\f')
}

/** PDF text-layer extraction; scan-only PDFs honestly produce empty text. */
export async function extractPdfPageText(observedPath: string): Promise<string> {
  const { getDocument } = await import('pdfjs-dist')
  const data = new Uint8Array(await readFile(observedPath))
  const doc = await getDocument({ data, useSystemFonts: true }).promise
  try {
    const pageCount = Math.min(doc.numPages, PDF_EXTRACT_PAGE_LIMIT)
    const pages: string[] = []
    for (let pageNumber = 1; pageNumber <= pageCount; pageNumber += 1) {
      const page = await doc.getPage(pageNumber)
      try {
        const content = await page.getTextContent()
        const text = content.items
          .map((item) => ('str' in item ? item.str : ''))
          .join(' ')
          .replace(/\s+/g, ' ')
          .trim()
          .slice(0, PDF_PAGE_CHAR_LIMIT)
        pages.push(text)
      } finally {
        void page.cleanup()
      }
    }
    return pages.join('\f')
  } finally {
    await doc.destroy().catch(() => undefined)
  }
}

class PlainTextContentExtractor implements ContentExtractor {
  readonly id = SEARCH_CONTENT_EXTRACTOR_IDS.plainText

  supports(input: Pick<ContentExtractionInputV1, 'mimeType' | 'extension'>): number {
    return PLAIN_TEXT_MIME_TYPES.has(input.mimeType) ? 1 : 0
  }

  async extract(input: ContentExtractionInputV1): Promise<string> {
    return readTextPrefix(input.observedPath, input.maxChars)
  }
}

class PdfTextLayerContentExtractor implements ContentExtractor {
  readonly id = SEARCH_CONTENT_EXTRACTOR_IDS.pdfTextLayer

  supports(input: Pick<ContentExtractionInputV1, 'mimeType' | 'extension'>): number {
    return input.mimeType === 'application/pdf' ? 1 : 0
  }

  async extract(input: ContentExtractionInputV1): Promise<string> {
    try {
      return await extractPdfPageText(input.observedPath)
    } catch {
      return ''
    }
  }
}

class OoxmlContentExtractor implements ContentExtractor {
  readonly id = SEARCH_CONTENT_EXTRACTOR_IDS.ooxml

  supports(input: Pick<ContentExtractionInputV1, 'mimeType' | 'extension'>): number {
    return input.mimeType === DOCX_MIME || input.mimeType === PPTX_MIME ? 1 : 0
  }

  async extract(input: ContentExtractionInputV1): Promise<string> {
    try {
      return await extractOoxmlText(input.observedPath, input.mimeType === DOCX_MIME ? 'docx' : 'pptx')
    } catch {
      return ''
    }
  }
}

class OcrEvidenceContentExtractor implements ContentExtractor {
  readonly id = SEARCH_CONTENT_EXTRACTOR_IDS.ocrEvidence

  supports(input: Pick<ContentExtractionInputV1, 'mimeType' | 'extension'>): number {
    return input.mimeType.startsWith('image/') && OCR_EVIDENCE_EXTENSIONS.has(input.extension) ? 1 : 0
  }

  async extract(input: ContentExtractionInputV1): Promise<string> {
    if (input.ocrEvidence === undefined || input.projectId === undefined || input.artifactId === undefined) return ''
    return input.ocrEvidence(input.projectId, input.artifactId) ?? ''
  }
}

export function createDefaultSearchContentExtractorRegistry(): SemanticProviderRegistry {
  return new SemanticProviderRegistry({ contentExtractors: createDefaultSearchContentExtractors() })
}

export function createDefaultSearchContentExtractors(): readonly ContentExtractor[] {
  return [
    new PlainTextContentExtractor(),
    new PdfTextLayerContentExtractor(),
    new OoxmlContentExtractor(),
    new OcrEvidenceContentExtractor(),
  ]
}

const DEFAULT_SEARCH_CONTENT_EXTRACTORS = createDefaultSearchContentExtractorRegistry()

/**
 * Read an artifact's current textual evidence for indexing.
 * Unsupported formats return empty body. Title indexing remains available elsewhere.
 */
export async function readArtifactIndexBody(input: {
  readonly fileRecord: ArtifactBodyFileRecord | undefined
  readonly maxChars?: number
  readonly ocrEvidence?: OcrEvidenceLookup
  readonly projectId?: string
  readonly artifactId?: string
  readonly providers?: SemanticProviderRegistry
}): Promise<string> {
  const fileRecord = input.fileRecord
  if (fileRecord === undefined || fileRecord.observedPath === undefined) return ''
  const mimeType = fileRecord.mimeType ?? ''
  const extension = extensionOf(fileRecord.observedPath)
  const providers = input.providers ?? DEFAULT_SEARCH_CONTENT_EXTRACTORS
  const extractor = providers.resolveContentExtractor({ mimeType, extension })
  if (extractor === undefined) return ''
  return extractor.extract({
    mimeType,
    extension,
    observedPath: fileRecord.observedPath,
    maxChars: input.maxChars ?? 200_000,
    ...(input.ocrEvidence === undefined ? {} : { ocrEvidence: input.ocrEvidence }),
    ...(input.projectId === undefined ? {} : { projectId: input.projectId }),
    ...(input.artifactId === undefined ? {} : { artifactId: input.artifactId }),
  })
}
