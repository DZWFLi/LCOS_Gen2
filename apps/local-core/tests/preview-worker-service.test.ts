import { existsSync, mkdtempSync, rmSync, unlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { GraphVersion, ProjectGraphSnapshot } from '@local-creative-os/contracts'
import { afterEach, describe, expect, it } from 'vitest'

import { FileRegistryService, TrustedFileSelectionRegistry } from '../src/file-registry-service.js'
import { SqliteMetadataRepository } from '../src/metadata-repository.js'
import { PreviewCacheService } from '../src/preview-cache-service.js'
import { PreviewWorkerService } from '../src/preview-worker-service.js'

const cleanup: string[] = []

afterEach(() => {
  for (const directory of cleanup.splice(0)) void Promise.resolve().then(() => { try { rmSync(directory, { recursive: true, force: true }) } catch { /* best effort */ } })
})

async function createRegisteredSource(fileName = 'source.md', body: string | Buffer = '# preview source\n') {
  const directory = mkdtempSync(join(tmpdir(), 'preview-worker-'))
  cleanup.push(directory)
  const sourcePath = join(directory, fileName)
  writeFileSync(sourcePath, body, 'utf8')
  const repository = new SqliteMetadataRepository(join(directory, 'metadata.sqlite'), { disposableOnly: true })
  const projectId = 'disposable-preview-worker' as ProjectGraphSnapshot['project']['id']
  const now = '2026-07-28T00:00:00.000Z'
  repository.save({
    schemaVersion: 5,
    graphVersion: 1 as GraphVersion,
    project: {
      id: projectId,
      name: 'Preview Worker',
      rootPath: directory,
      graphVersion: 1 as GraphVersion,
      createdAt: now,
      updatedAt: now,
    },
    scopes: [],
    workspaces: [],
    artifacts: [],
    artifactViews: [],
    relations: [],
    notes: [],
    artifactRevisions: [],
    fileRecords: [],
    checkpoints: [],
  })
  const selections = new TrustedFileSelectionRegistry()
  const registered = await new FileRegistryService(repository, selections).registerSource(
    projectId,
    { selectionId: selections.registerTrustedPath(sourcePath).id },
  )
  const cacheService = new PreviewCacheService(repository, { cacheRoot: join(directory, 'preview-cache') })
  const worker = new PreviewWorkerService(repository, { cacheService })
  return { repository, projectId, registered, worker, sourcePath }
}

function minimalPdf(): Buffer {
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 240 160] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    '<< /Length 38 >>\nstream\nBT /F1 18 Tf 24 80 Td (LCOS PDF) Tj ET\nendstream',
  ]
  let body = '%PDF-1.4\n'
  const offsets = [0]
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(body, 'ascii'))
    body += `${index + 1} 0 obj\n${object}\nendobj\n`
  })
  const xref = Buffer.byteLength(body, 'ascii')
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
  body += offsets.slice(1).map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`
  return Buffer.from(body, 'ascii')
}

describe('PreviewWorkerService', () => {
  it('generates a ready markdown PreviewRecord through PreviewCacheService', async () => {
    const fixture = await createRegisteredSource()

    const result = await fixture.worker.generate({
      projectId: fixture.projectId,
      revisionId: fixture.registered.revision.id,
      previewProfile: 'thumbnail',
    })

    expect(result.reused).toBe(false)
    expect(result.record.status).toBe('ready')
    expect(result.record.rendererId).toBe('markdown')
    expect(existsSync(result.record.cachePath)).toBe(true)
    fixture.repository.close()
  })

  it('renders a PDF thumbnail in Node without configuring a browser worker', async () => {
    const fixture = await createRegisteredSource('source.pdf', minimalPdf())

    const result = await fixture.worker.generate({
      projectId: fixture.projectId,
      revisionId: fixture.registered.revision.id,
      previewProfile: 'thumbnail',
    })

    expect(result.record.status).toBe('ready')
    expect(result.record.rendererId).toBe('pdf')
    expect(existsSync(result.record.cachePath)).toBe(true)
    fixture.repository.close()
  })

  it('records failed instead of ready when the source file is missing', async () => {
    const fixture = await createRegisteredSource()
    unlinkSync(fixture.sourcePath)

    const result = await fixture.worker.generate({
      projectId: fixture.projectId,
      revisionId: fixture.registered.revision.id,
      previewProfile: 'thumbnail',
    })

    expect(result.record.status).toBe('failed')
    expect(result.record.cachePath).toBe('')
    expect(fixture.repository.getPreviewRecords(String(fixture.projectId))).toHaveLength(1)
    fixture.repository.close()
  })

  it('does not publish ready when aborted before generation starts', async () => {
    const fixture = await createRegisteredSource()
    const controller = new AbortController()
    controller.abort()

    await expect(fixture.worker.generate({
      projectId: fixture.projectId,
      revisionId: fixture.registered.revision.id,
      previewProfile: 'thumbnail',
      signal: controller.signal,
    })).rejects.toThrow()

    expect(fixture.repository.getPreviewRecords(String(fixture.projectId))).toEqual([])
    fixture.repository.close()
  })
})
