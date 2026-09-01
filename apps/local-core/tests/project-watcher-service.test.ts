import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import type { FileObservationService } from '../src/file-observation-service.js'
import { ProjectWatcherService } from '../src/project-watcher-service.js'
import { SqliteMetadataRepository } from '../src/metadata-repository.js'
import { createMvpSampleSnapshot } from '../src/mvp-sample-project.js'

const roots: string[] = []
const repositories: SqliteMetadataRepository[] = []
const watchers: ProjectWatcherService[] = []

afterEach(() => {
  for (const watcher of watchers.splice(0)) watcher.stop()
  for (const repository of repositories.splice(0)) repository.close()
  for (const root of roots.splice(0)) void Promise.resolve().then(() => { try { rmSync(root, { recursive: true, force: true }) } catch { /* best effort */ } })
})

describe('ProjectWatcherService (red-zone Watcher)', () => {
  it('refreshes every file record of a project on demand', async () => {
    const dbRoot = mkdtempSync(join(tmpdir(), 'lcos-watcher-db-'))
    const projectRoot = mkdtempSync(join(tmpdir(), 'lcos-watcher-project-'))
    roots.push(dbRoot, projectRoot)
    const repository = new SqliteMetadataRepository(join(dbRoot, 'metadata.sqlite'))
    repositories.push(repository)
    const snapshot = createMvpSampleSnapshot(projectRoot, '2026-08-03T12:00:00.000Z')
    repository.save(snapshot)
    const calls: string[] = []
    const observation = {
      refresh: async (id: { toString(): string }) => { calls.push(String(id)) },
    } as unknown as FileObservationService
    const watcher = new ProjectWatcherService(repository, observation)
    watchers.push(watcher)

    await watcher.refreshProject(String(snapshot.project.id))
    expect(calls).toHaveLength(snapshot.fileRecords.length)
  })

  it('attaches to project roots and flips FileRecord availability when the file changes', async () => {
    const dbRoot = mkdtempSync(join(tmpdir(), 'lcos-watcher-db-'))
    const projectRoot = mkdtempSync(join(tmpdir(), 'lcos-watcher-project-'))
    roots.push(dbRoot, projectRoot)
    const repository = new SqliteMetadataRepository(join(dbRoot, 'metadata.sqlite'))
    repositories.push(repository)
    const snapshot = createMvpSampleSnapshot(projectRoot, '2026-08-03T12:00:00.000Z')
    repository.save(snapshot)
    const watcher = new ProjectWatcherService(
      repository,
      new (await import('../src/file-observation-service.js')).FileObservationService(repository),
      400,
    )
    watchers.push(watcher)
    watcher.refreshProjectList()

    const firstRecord = snapshot.fileRecords[0]!
    writeFileSync(firstRecord.observedPath, `${firstRecord.observedPath}\nchanged-${Date.now()}\n`, 'utf8')

    const deadline = Date.now() + 5_000
    let availability: string | undefined
    while (Date.now() < deadline) {
      availability = repository.getFileRecord(String(firstRecord.id))?.availability
      if (availability === 'stale' || availability === 'unreadable') break
      await new Promise((resolve) => setTimeout(resolve, 150))
    }
    expect(['stale', 'unreadable']).toContain(availability)
  })
})
