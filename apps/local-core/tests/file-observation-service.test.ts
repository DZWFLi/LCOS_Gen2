import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { GraphVersion, ProjectGraphSnapshot } from '@local-creative-os/contracts'
import { afterEach, describe, expect, it } from 'vitest'

import { FileObservationService } from '../src/file-observation-service.js'
import { FileRegistryService, TrustedFileSelectionRegistry } from '../src/file-registry-service.js'
import { SqliteMetadataRepository } from '../src/metadata-repository.js'

const cleanup: string[] = []

afterEach(() => {
  for (const directory of cleanup.splice(0)) void Promise.resolve().then(() => { try { rmSync(directory, { recursive: true, force: true }) } catch { /* best effort */ } })
})

function createFixture() {
  const directory = mkdtempSync(join(tmpdir(), 'file-observation-'))
  cleanup.push(directory)
  const sourcePath = join(directory, 'source.md')
  writeFileSync(sourcePath, '# original\n', 'utf8')
  const repository = new SqliteMetadataRepository(join(directory, 'metadata.sqlite'), { disposableOnly: true })
  const now = '2026-07-27T00:00:00.000Z'
  const projectId = 'disposable-file-observation' as ProjectGraphSnapshot['project']['id']
  repository.save({
    schemaVersion: 5,
    graphVersion: 1 as GraphVersion,
    project: { id: projectId, name: 'File Observation', rootPath: directory, graphVersion: 1 as GraphVersion, createdAt: now, updatedAt: now },
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
  return { directory, sourcePath, projectId, repository, selections: new TrustedFileSelectionRegistry() }
}

async function registerFixtureSource(fixture: ReturnType<typeof createFixture>) {
  const registry = new FileRegistryService(fixture.repository, fixture.selections)
  const selection = fixture.selections.registerTrustedPath(fixture.sourcePath)
  return registry.registerSource(fixture.projectId, { selectionId: selection.id, title: 'Observed Source' })
}

describe('FileObservationService', () => {
  it('marks externally modified files stale without creating a new revision', async () => {
    const fixture = createFixture()
    const registered = await registerFixtureSource(fixture)
    const beforeRevisions = fixture.repository.getArtifactRevisions(String(registered.artifact.id))
    const beforeGraphVersion = fixture.repository.getProject(String(fixture.projectId))?.graphVersion
    writeFileSync(fixture.sourcePath, '# externally modified\nextra\n', 'utf8')

    const result = await new FileObservationService(fixture.repository).refresh(registered.fileRecord.id)

    expect(result.revisionCreated).toBe(false)
    expect(result.fileRecord.availability).toBe('stale')
    expect(result.fileRecord.observedHash).not.toBe(registered.revision.contentHash)
    expect(result.artifact?.availability).toBe('stale')
    expect(fixture.repository.getArtifactRevisions(String(registered.artifact.id))).toEqual(beforeRevisions)
    expect(fixture.repository.getArtifactRevision(String(registered.revision.id))?.contentHash).toBe(registered.revision.contentHash)
    expect(fixture.repository.getProject(String(fixture.projectId))?.graphVersion).toBe(beforeGraphVersion)
    fixture.repository.close()
  })

  it('marks deleted files missing without changing the frozen revision hash', async () => {
    const fixture = createFixture()
    const registered = await registerFixtureSource(fixture)
    rmSync(fixture.sourcePath)

    const result = await new FileObservationService(fixture.repository).refresh(registered.fileRecord.id)

    expect(result.fileRecord.availability).toBe('missing')
    expect(result.artifact?.availability).toBe('missing')
    expect(fixture.repository.getArtifactRevision(String(registered.revision.id))?.contentHash).toBe(registered.revision.contentHash)
    expect(fixture.repository.getArtifactRevisions(String(registered.artifact.id))).toHaveLength(1)
    fixture.repository.close()
  })

  it('reports non-file paths as unreadable and does not report the artifact current', async () => {
    const fixture = createFixture()
    const registered = await registerFixtureSource(fixture)
    rmSync(fixture.sourcePath)
    mkdirSync(fixture.sourcePath)

    const result = await new FileObservationService(fixture.repository).refresh(registered.fileRecord.id)

    expect(result.fileRecord.availability).toBe('unreadable')
    expect(result.artifact?.availability).toBe('stale')
    expect(fixture.repository.getArtifactRevisions(String(registered.artifact.id))).toHaveLength(1)
    fixture.repository.close()
  })

  it('returns to current when the observed hash matches the frozen revision hash', async () => {
    const fixture = createFixture()
    const registered = await registerFixtureSource(fixture)
    writeFileSync(fixture.sourcePath, '# externally modified\n', 'utf8')
    await new FileObservationService(fixture.repository).refresh(registered.fileRecord.id)
    writeFileSync(fixture.sourcePath, '# original\n', 'utf8')

    const result = await new FileObservationService(fixture.repository).refresh(registered.fileRecord.id)

    expect(result.fileRecord.availability).toBe('current')
    expect(result.fileRecord.observedHash).toBe(registered.revision.contentHash)
    expect(result.artifact?.availability).toBe('available')
    expect(fixture.repository.getArtifactRevisions(String(registered.artifact.id))).toHaveLength(1)
    fixture.repository.close()
  })
})
