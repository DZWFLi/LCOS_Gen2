import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import type { ProjectId } from '@local-creative-os/domain'

import { ImportCopyService } from '../../src/import-copy-service.js'
import { SqliteMetadataRepository } from '../../src/metadata-repository.js'
import { ResourceReader } from '../../src/resources/resource-reader.js'
import { UniversalResourceImportService } from '../../src/resources/universal-resource-import-service.js'

const roots: string[] = []
const repositories: SqliteMetadataRepository[] = []

afterEach(() => {
  for (const repository of repositories.splice(0)) repository.close()
  for (const root of roots.splice(0)) void Promise.resolve().then(() => { try { rmSync(root, { recursive: true, force: true }) } catch { /* best effort */ } })
})

async function setup(): Promise<{ readonly reader: ResourceReader; readonly resourceId: string }> {
  const dbRoot = mkdtempSync(join(tmpdir(), 'lcos-reader-db-'))
  const projectRoot = mkdtempSync(join(tmpdir(), 'lcos-reader-project-'))
  roots.push(dbRoot, projectRoot)
  const repository = new SqliteMetadataRepository(join(dbRoot, 'metadata.sqlite'))
  repositories.push(repository)
  repository.createProject({
    id: 'project-reader' as ProjectId,
    name: 'Reader',
    rootPath: projectRoot,
  })
  const scopeId = String(repository.get('project-reader')?.scopes[0]?.id ?? '')
  const service = new UniversalResourceImportService(repository, new ImportCopyService(repository))
  const outcome = await service.importFile('project-reader' as ProjectId, {
    importRequestId: 'doc-1',
    fileName: 'doc.md',
    contentType: 'text/markdown',
    bytes: Buffer.from(Array.from({ length: 200 }, (_, index) => `line ${String(index).padStart(3, '0')}`).join('\n'), 'utf8'),
    scopeId,
    position: { x: 0, y: 0 },
  })
  return { reader: new ResourceReader(repository), resourceId: outcome.resourceId }
}

describe('ResourceReader (U2)', () => {
  it('reads text with offset/limit bounds and truncation flag', async () => {
    const { reader, resourceId } = await setup()
    const result = await reader.read('project-reader', resourceId, { offset: 90, limit: 17, format: 'text' })
    expect(result.format).toBe('text')
    expect(result.data).toBe('line 010\nline 011')
    expect(result.truncated).toBe(true)
    expect(result.contentHash).toBeTruthy()
    expect(result.fileName).toMatch(/\.md$/)
  })

  it('reads raw base64 and json_tree formats', async () => {
    const { reader, resourceId } = await setup()
    const raw = await reader.read('project-reader', resourceId, { limit: 8, format: 'raw' })
    expect(Buffer.from(raw.data, 'base64').toString('utf8')).toBe('line 000')

    const { reader: jsonReader, resourceId: jsonId } = await setupJson()
    const tree = await jsonReader.read('project-reader', jsonId, { format: 'json_tree' })
    const parsed = JSON.parse(tree.data) as { kind: string; keys: string[] }
    expect(parsed.kind).toBe('object')
    expect(parsed.keys).toContain('name')
  })

  it('rejects paths that are not part of the resource', async () => {
    const { reader, resourceId } = await setup()
    await expect(reader.read('project-reader', resourceId, { path: '..\\secret.txt' }))
      .rejects.toThrow(/not part of this resource/)
  })
})

async function setupJson(): Promise<{ readonly reader: ResourceReader; readonly resourceId: string }> {
  const dbRoot = mkdtempSync(join(tmpdir(), 'lcos-reader-json-db-'))
  const projectRoot = mkdtempSync(join(tmpdir(), 'lcos-reader-json-project-'))
  roots.push(dbRoot, projectRoot)
  const repository = new SqliteMetadataRepository(join(dbRoot, 'metadata.sqlite'))
  repositories.push(repository)
  repository.createProject({
    id: 'project-reader' as ProjectId,
    name: 'Reader',
    rootPath: projectRoot,
  })
  const scopeId = String(repository.get('project-reader')?.scopes[0]?.id ?? '')
  const service = new UniversalResourceImportService(repository, new ImportCopyService(repository))
  const outcome = await service.importFile('project-reader' as ProjectId, {
    importRequestId: 'json-1',
    fileName: 'data.json',
    contentType: 'application/json',
    bytes: Buffer.from('{"name":"demo","tools":["a"]}', 'utf8'),
    scopeId,
    position: { x: 0, y: 0 },
  })
  return { reader: new ResourceReader(repository), resourceId: outcome.resourceId }
}
