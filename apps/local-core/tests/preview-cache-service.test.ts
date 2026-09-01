import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { GraphVersion, ProjectGraphSnapshot } from '@local-creative-os/contracts'
import { afterEach, describe, expect, it } from 'vitest'

import { FileRegistryService, TrustedFileSelectionRegistry } from '../src/file-registry-service.js'
import { SqliteMetadataRepository } from '../src/metadata-repository.js'
import { PreviewCacheService } from '../src/preview-cache-service.js'
import { RendererRegistry } from '../src/renderer-registry.js'

const cleanup: string[] = []

afterEach(() => {
  for (const directory of cleanup.splice(0)) void Promise.resolve().then(() => { try { rmSync(directory, { recursive: true, force: true }) } catch { /* best effort */ } })
})

async function createRegisteredSource(mimeSourceName = 'source.md') {
  const directory = mkdtempSync(join(tmpdir(), 'preview-cache-'))
  cleanup.push(directory)
  const sourcePath = join(directory, mimeSourceName)
  writeFileSync(sourcePath, '# preview source\n', 'utf8')
  const repository = new SqliteMetadataRepository(join(directory, 'metadata.sqlite'), { disposableOnly: true })
  const projectId = 'disposable-preview-cache' as ProjectGraphSnapshot['project']['id']
  const now = '2026-07-27T00:00:00.000Z'
  repository.save({
    schemaVersion: 5,
    graphVersion: 1 as GraphVersion,
    project: {
      id: projectId,
      name: 'Preview Cache',
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
  return {
    directory,
    repository,
    cacheRoot: join(directory, 'preview-cache'),
    projectId,
    registered,
  }
}

describe('PreviewCacheService', () => {
  it('publishes ready PreviewRecord via tmp-to-final cache file', async () => {
    const fixture = await createRegisteredSource()
    const service = new PreviewCacheService(fixture.repository, { cacheRoot: fixture.cacheRoot })

    const record = await service.publishReadyPreview(
      fixture.registered.revision.id,
      'thumbnail',
      Buffer.from('preview bytes', 'utf8'),
    )

    expect(record.status).toBe('ready')
    expect(record.rendererId).toBe('markdown')
    expect(record.rendererVersion).toBe('1')
    expect(record.sourceContentHash).toBe(fixture.registered.revision.contentHash)
    expect(existsSync(record.cachePath)).toBe(true)
    expect(fixture.repository.getPreviewRecordByCacheKey(record.cacheKey)).toEqual(record)
    fixture.repository.close()
  })

  it('reuses cache key for identical source hash, renderer, version, and profile', async () => {
    const fixture = await createRegisteredSource()
    const service = new PreviewCacheService(fixture.repository, { cacheRoot: fixture.cacheRoot })

    const first = await service.publishReadyPreview(fixture.registered.revision.id, 'thumbnail', Buffer.from('one'))
    const second = await service.publishReadyPreview(fixture.registered.revision.id, 'thumbnail', Buffer.from('two'))

    expect(second.id).toBe(first.id)
    expect(second.cacheKey).toBe(first.cacheKey)
    expect(fixture.repository.getPreviewRecords(String(fixture.projectId))).toHaveLength(1)
    fixture.repository.close()
  })

  it('misses cache when renderer version changes', async () => {
    const fixture = await createRegisteredSource()
    const v1 = new PreviewCacheService(fixture.repository, {
      cacheRoot: fixture.cacheRoot,
      rendererRegistry: new RendererRegistry([{
        id: 'markdown',
        version: '1',
        supportedMimeTypes: ['text/markdown'],
        previewProfiles: ['thumbnail'],
        outputMimeType: 'text/plain',
      }]),
    })
    const v2 = new PreviewCacheService(fixture.repository, {
      cacheRoot: fixture.cacheRoot,
      rendererRegistry: new RendererRegistry([{
        id: 'markdown',
        version: '2',
        supportedMimeTypes: ['text/markdown'],
        previewProfiles: ['thumbnail'],
        outputMimeType: 'text/plain',
      }]),
    })

    const first = await v1.publishReadyPreview(fixture.registered.revision.id, 'thumbnail', Buffer.from('one'))
    const second = await v2.publishReadyPreview(fixture.registered.revision.id, 'thumbnail', Buffer.from('two'))

    expect(second.cacheKey).not.toBe(first.cacheKey)
    expect(fixture.repository.getPreviewRecords(String(fixture.projectId))).toHaveLength(2)
    fixture.repository.close()
  })

  it('records unsupported formats without ready preview', async () => {
    const fixture = await createRegisteredSource('source.bin')
    const service = new PreviewCacheService(fixture.repository, { cacheRoot: fixture.cacheRoot })

    const record = await service.publishReadyPreview(
      fixture.registered.revision.id,
      'thumbnail',
      Buffer.from('ignored'),
    )

    expect(record.status).toBe('unsupported')
    expect(record.cachePath).toBe('')
    expect(record.errorMessage).toContain('Unsupported mime type')
    expect(fixture.repository.getPreviewRecords(String(fixture.projectId))).toHaveLength(1)
    fixture.repository.close()
  })

  it('deleting Preview cache preserves Project Truth', async () => {
    const fixture = await createRegisteredSource()
    const service = new PreviewCacheService(fixture.repository, { cacheRoot: fixture.cacheRoot })
    const before = fixture.repository.get(String(fixture.projectId))
    const record = await service.publishReadyPreview(fixture.registered.revision.id, 'thumbnail', Buffer.from('preview'))

    await service.deleteCacheFile(record)
    fixture.repository.deletePreviewRecords(String(fixture.projectId))
    const after = fixture.repository.get(String(fixture.projectId))

    expect(existsSync(record.cachePath)).toBe(false)
    expect(after).toEqual(before)
    expect(fixture.repository.getPreviewRecords(String(fixture.projectId))).toEqual([])
    fixture.repository.close()
  })
})
