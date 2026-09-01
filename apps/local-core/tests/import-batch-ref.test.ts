import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { ImportBatchRefV1 } from '@local-creative-os/contracts'
import { afterEach, describe, expect, it } from 'vitest'

import { createMvpSampleSnapshot } from '../src/mvp-sample-project.js'
import { SqliteMetadataRepository } from '../src/metadata-repository.js'

const cleanup: string[] = []
afterEach(async () => {
  for (const path of cleanup.splice(0)) void rm(path, { recursive: true, force: true }).catch(() => { /* best effort */ })
})

describe('ImportBatchRefV1 persistence', () => {
  it('survives reload, resolves the latest batch, and is idempotent across HTTP-style retries', async () => {
    const root = await mkdtemp(join(tmpdir(), 'lcos-import-batch-'))
    cleanup.push(root)
    const databasePath = join(root, 'metadata.sqlite')
    const repository = new SqliteMetadataRepository(databasePath)
    const snapshot = createMvpSampleSnapshot(join(root, 'project'))
    repository.save(snapshot)

    const first: ImportBatchRefV1 = {
      schemaVersion: 1,
      id: 'import-batch-first',
      projectId: String(snapshot.project.id),
      sourceKind: 'file_drop',
      status: 'completed',
      scopeId: String(snapshot.scopes[0]!.id),
      importRequestIds: ['req-a', 'req-b'],
      artifactIds: ['artifact-brief', 'artifact-script'],
      revisionIds: ['revision-brief', 'revision-script'],
      viewIds: ['view-brief', 'view-script'],
      createdAt: '2026-08-17T08:00:00.000Z',
      completedAt: '2026-08-17T08:00:01.000Z',
    }
    repository.saveImportBatch(first)
    // A retried POST gets a new server completedAt; this must remain idempotent.
    repository.saveImportBatch({ ...first, completedAt: '2026-08-17T08:00:09.000Z' })

    const second: ImportBatchRefV1 = {
      ...first,
      id: 'import-batch-second',
      importRequestIds: ['req-c'],
      artifactIds: ['artifact-feedback'],
      revisionIds: ['revision-feedback'],
      viewIds: ['view-feedback'],
      createdAt: '2026-08-17T08:01:00.000Z',
      completedAt: '2026-08-17T08:01:01.000Z',
    }
    repository.saveImportBatch(second)

    expect(repository.getImportBatch(String(snapshot.project.id), first.id)).toEqual(first)
    expect(repository.getLatestImportBatch(String(snapshot.project.id))).toEqual(second)
    expect(repository.listImportBatches(String(snapshot.project.id))).toEqual([second, first])

    const reopened = new SqliteMetadataRepository(databasePath)
    expect(reopened.getLatestImportBatch(String(snapshot.project.id))).toEqual(second)
    expect(() => reopened.saveImportBatch({ ...first, artifactIds: ['artifact-other'] })).toThrow('IMPORT_BATCH_IDEMPOTENCY_CONFLICT')
  })
})
