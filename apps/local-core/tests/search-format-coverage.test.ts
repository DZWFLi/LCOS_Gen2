import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { KNOWN_FILE_FORMATS_V0 } from '../src/file-format-registry.js'
import {
  createDefaultSearchContentExtractorRegistry,
  readArtifactIndexBody,
} from '../src/search-artifact-body.js'
import { SEARCH_FORMAT_COVERAGE_V0, validateSearchFormatCoverage } from '../src/search-format-coverage.js'

const cleanup: string[] = []

afterEach(async () => {
  for (const path of cleanup.splice(0)) await rm(path, { recursive: true, force: true })
})

describe('S10 search format coverage', () => {
  it('covers every known format explicitly and every SUPPORTED row resolves to a real extractor', () => {
    const registry = createDefaultSearchContentExtractorRegistry()
    expect(SEARCH_FORMAT_COVERAGE_V0.map((row) => row.extension).sort())
      .toEqual(KNOWN_FILE_FORMATS_V0.map((row) => row.extension).sort())
    expect(SEARCH_FORMAT_COVERAGE_V0.every((row) => row.status === 'SUPPORTED' || row.status === 'UNSUPPORTED')).toBe(true)
    expect(SEARCH_FORMAT_COVERAGE_V0.some((row) => row.reason.includes('MISSING_COVERAGE_POLICY'))).toBe(false)
    expect(validateSearchFormatCoverage(registry)).toEqual([])
  })

  it('indexes JSON/YAML/CSV/XML/HTML as real text evidence', async () => {
    const root = await mkdtemp(join(tmpdir(), 'lcos-format-text-'))
    cleanup.push(root)
    const cases = [
      ['sample.json', 'application/json', '{"hello":"json-evidence"}'],
      ['sample.yaml', 'application/yaml', 'hello: yaml-evidence'],
      ['sample.csv', 'text/csv', 'name,value\nhello,csv-evidence'],
      ['sample.xml', 'application/xml', '<root>xml-evidence</root>'],
      ['sample.html', 'text/html', '<p>html-evidence</p>'],
    ] as const
    for (const [name, mimeType, content] of cases) {
      const path = join(root, name)
      await writeFile(path, content, 'utf8')
      const body = await readArtifactIndexBody({ fileRecord: { observedPath: path, mimeType } })
      expect(body).toContain(content.split('evidence')[0]!)
      expect(body).toContain('evidence')
    }
  })

  it('uses persisted OCR evidence for supported bitmap formats and stays empty for unsupported TIFF', async () => {
    const root = await mkdtemp(join(tmpdir(), 'lcos-format-image-'))
    cleanup.push(root)
    const png = join(root, 'frame.png')
    const tif = join(root, 'scan.tif')
    await writeFile(png, Buffer.from([0]))
    await writeFile(tif, Buffer.from([0]))

    const ocr = await readArtifactIndexBody({
      fileRecord: { observedPath: png, mimeType: 'image/png' },
      projectId: 'p1',
      artifactId: 'a1',
      ocrEvidence: () => '真实 OCR evidence',
    })
    expect(ocr).toBe('真实 OCR evidence')

    const unsupported = await readArtifactIndexBody({
      fileRecord: { observedPath: tif, mimeType: 'image/tiff' },
      projectId: 'p1',
      artifactId: 'a2',
      ocrEvidence: () => 'should not be used',
    })
    expect(unsupported).toBe('')
  })
})
