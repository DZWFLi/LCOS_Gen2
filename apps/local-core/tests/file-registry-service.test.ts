import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { GraphVersion, ProjectGraphSnapshot } from '@local-creative-os/contracts'
import { afterEach, describe, expect, it } from 'vitest'

import {
  FileRegistryService,
  TrustedFileSelectionRegistry,
} from '../src/file-registry-service.js'
import { SqliteMetadataRepository } from '../src/metadata-repository.js'

const cleanup: string[] = []

afterEach(() => {
  for (const directory of cleanup.splice(0)) void Promise.resolve().then(() => { try { rmSync(directory, { recursive: true, force: true }) } catch { /* best effort */ } })
})

function createFixture(): {
  directory: string
  databasePath: string
  sourcePath: string
  sourceBytes: Buffer
  repository: SqliteMetadataRepository
  selections: TrustedFileSelectionRegistry
} {
  const directory = mkdtempSync(join(tmpdir(), 'file-registry-'))
  cleanup.push(directory)
  const sourcePath = join(directory, 'source.md')
  const sourceBytes = Buffer.from('# immutable source\n', 'utf8')
  writeFileSync(sourcePath, sourceBytes)
  const databasePath = join(directory, 'metadata.sqlite')
  const repository = new SqliteMetadataRepository(databasePath, { disposableOnly: true })
  const now = '2026-07-26T00:00:00.000Z'
  const projectId = 'disposable-file-registry' as ProjectGraphSnapshot['project']['id']
  repository.save({
    schemaVersion: 5,
    graphVersion: 1 as GraphVersion,
    project: {
      id: projectId,
      name: 'File Registry',
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
  return {
    directory,
    databasePath,
    sourcePath,
    sourceBytes,
    repository,
    selections: new TrustedFileSelectionRegistry(),
  }
}

describe('FileRegistryService', () => {
  it('atomically creates FileRecord, Artifact, Initial Revision, and currentRevisionId', async () => {
    const fixture = createFixture()
    const service = new FileRegistryService(fixture.repository, fixture.selections)
    const selection = fixture.selections.registerTrustedPath(fixture.sourcePath)

    const result = await service.registerSource(
      'disposable-file-registry' as ProjectGraphSnapshot['project']['id'],
      { selectionId: selection.id, title: 'Source Brief' },
    )

    expect(result.fileRecord.observedPath).toBe(fixture.sourcePath)
    expect(result.artifact.currentRevisionId).toBe(result.revision.id)
    expect(result.revision.fileRecordId).toBe(result.fileRecord.id)
    expect(result.revision.contentHash).toBe(result.fileRecord.observedHash)
    expect(result.revision.source).toBe('import')
    expect(result.revision.status).toBe('current')
    expect(fixture.repository.getFileRecord(String(result.fileRecord.id))).toEqual(result.fileRecord)
    expect(fixture.repository.getArtifact(String(result.artifact.id))).toEqual(result.artifact)
    expect(fixture.repository.getArtifactRevision(String(result.revision.id))).toEqual(result.revision)
    expect(readFileSync(fixture.sourcePath)).toEqual(fixture.sourceBytes)
    fixture.repository.close()
  })

  it('restores registered source identity after repository restart without changing source bytes', async () => {
    const fixture = createFixture()
    const service = new FileRegistryService(fixture.repository, fixture.selections)
    const selection = fixture.selections.registerTrustedPath(fixture.sourcePath)
    const registered = await service.registerSource(
      'disposable-file-registry' as ProjectGraphSnapshot['project']['id'],
      { selectionId: selection.id },
    )
    fixture.repository.close()

    const reopened = new SqliteMetadataRepository(fixture.databasePath, { disposableOnly: true })
    const restored = reopened.get('disposable-file-registry')
    reopened.close()

    expect(restored?.fileRecords.map((record) => record.id)).toEqual([registered.fileRecord.id])
    expect(restored?.artifacts[0].currentRevisionId).toBe(registered.revision.id)
    expect(restored?.artifactRevisions[0].fileRecordId).toBe(registered.fileRecord.id)
    expect(readFileSync(fixture.sourcePath)).toEqual(fixture.sourceBytes)
  })
})
