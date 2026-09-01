import { createHash } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import type { PersistedContextManifestV0 } from '@local-creative-os/contracts'
import type {
  ArtifactReturn,
  ArtifactRevision,
  FileRecord,
  Run,
  RuntimeBinding,
  RuntimeDispatch,
} from '@local-creative-os/domain'

import {
  RuntimeLifecycleConflictError,
  SqliteMetadataRepository,
} from '../src/metadata-repository.js'
import { createMvpSampleSnapshot } from '../src/mvp-sample-project.js'
import { RuntimeReviewService } from '../src/runtime-review-service.js'

const roots: string[] = []
const repositories: SqliteMetadataRepository[] = []
const now = '2026-07-29T18:00:00.000Z'

afterEach(() => {
  for (const repository of repositories.splice(0)) repository.close()
  for (const root of roots.splice(0)) void Promise.resolve().then(() => { try { rmSync(root, { recursive: true, force: true }) } catch { /* best effort */ } })
})

function setup() {
  const dbRoot = mkdtempSync(join(tmpdir(), 'lcos-review-db-'))
  const projectRoot = mkdtempSync(join(tmpdir(), 'lcos-review-project-'))
  roots.push(dbRoot, projectRoot)
  const databasePath = join(dbRoot, 'metadata.sqlite')
  const repository = new SqliteMetadataRepository(databasePath)
  repositories.push(repository)
  const snapshot = createMvpSampleSnapshot(projectRoot, now)
  repository.save(snapshot)
  const target = snapshot.artifacts[1]!
  const base = snapshot.artifactRevisions.find((revision) => revision.id === target.currentRevisionId)!
  const canonicalJson = JSON.stringify({ schemaVersion: 0, project: { id: snapshot.project.id } })
  const manifestHash = createHash('sha256').update(canonicalJson).digest('hex')
  const manifest: PersistedContextManifestV0 = {
    id: `manifest-${manifestHash}` as PersistedContextManifestV0['id'],
    projectId: snapshot.project.id,
    schemaVersion: 0,
    targetArtifactId: target.id,
    targetRevisionId: base.id,
    canonicalJson,
    manifestHash,
    createdAt: now,
  }
  repository.createContextManifest(manifest)
  const run: Run = {
    id: 'run-review-one' as Run['id'],
    projectId: snapshot.project.id,
    workspaceId: snapshot.workspaces[0]!.id,
    targetArtifactId: target.id,
    targetRevisionId: base.id,
    contextManifestId: manifest.id,
    provider: 'workbuddy',
    status: 'running',
    instruction: 'Revise the script.',
    createdAt: now,
    updatedAt: now,
  }
  const dispatch: RuntimeDispatch = {
    id: 'dispatch-review-one' as RuntimeDispatch['id'],
    runId: run.id,
    provider: 'workbuddy',
    idempotencyKey: String(run.id),
    status: 'bound',
    attemptCount: 1,
    createdAt: now,
    updatedAt: now,
  }
  repository.createRunWithDispatch(run, dispatch)
  const binding: RuntimeBinding = {
    id: 'binding-review-one' as RuntimeBinding['id'],
    runId: run.id,
    provider: 'workbuddy',
    externalTaskId: 'task-review-one',
    providerStatus: 'review',
    lastSyncedAt: now,
    finalizePending: false,
    createdAt: now,
    updatedAt: now,
  }
  repository.createRuntimeBinding(binding)
  const contentHash = createHash('sha256').update('draft').digest('hex')
  const fileRecord: FileRecord = {
    id: 'file-review-draft' as FileRecord['id'],
    projectId: snapshot.project.id,
    observedPath: join(projectRoot, '.creative-os', 'runtime', 'run-review-one', 'staging', 'draft.md'),
    observedHash: contentHash as FileRecord['observedHash'],
    size: 5,
    modifiedAt: now,
    mimeType: 'text/markdown',
    availability: 'current',
    observedAt: now,
  }
  const draft: ArtifactRevision = {
    id: 'revision-review-draft' as ArtifactRevision['id'],
    artifactId: target.id,
    fileRecordId: fileRecord.id,
    parentRevisionId: base.id,
    contentHash: fileRecord.observedHash,
    source: 'run',
    runId: run.id,
    status: 'draft',
    createdAt: now,
  }
  const artifactReturn: ArtifactReturn = {
    id: 'return-review-one' as ArtifactReturn['id'],
    runId: run.id,
    targetArtifactId: target.id,
    baseRevisionId: base.id,
    returnedFileId: fileRecord.id,
    contentHash: fileRecord.observedHash,
    canonicalPath: fileRecord.observedPath,
    action: 'created',
    status: 'pending_review',
    draftRevisionId: draft.id,
    createdAt: now,
    updatedAt: now,
  }
  repository.createRuntimeDraft(fileRecord, draft, artifactReturn)
  return { databasePath, repository, snapshot, target, base, run, artifactReturn, draft }
}

describe('RuntimeReviewService', () => {
  it('derives review as presentation state without changing the canonical Run status', () => {
    const { repository, run } = setup()
    const review = new RuntimeReviewService(repository).getRunReview(run.id)
    expect(review.presentationPhase).toBe('review')
    expect(review.run.status).toBe('running')
    expect(review.capabilities).toEqual({
      schemaVersion: 1,
      accept: { enabled: true },
      reject: { enabled: true },
      retry: { enabled: true },
    })
    expect(review.binding?.providerStatus).toBe('review')
  })

  it('accepts with CAS and atomically advances Current while preserving revision history', () => {
    const { repository, target, base, artifactReturn, draft } = setup()
    const result = new RuntimeReviewService(repository, () => now).accept(artifactReturn.id, {
      expectedBaseRevisionId: base.id,
    })
    expect(result.artifactReturn.status).toBe('adopted')
    expect(result.previousRevision.status).toBe('superseded')
    expect(result.currentRevision).toMatchObject({ id: draft.id, status: 'current' })
    expect(result.run.status).toBe('completed')
    expect(repository.getArtifact(String(target.id))?.currentRevisionId).toBe(draft.id)
    expect(repository.getRuntimeBinding(result.run.id)?.finalizePending).toBe(true)
  })

  it('rejects stale Accept without partial updates', () => {
    const { repository, target, artifactReturn, draft } = setup()
    expect(() => new RuntimeReviewService(repository).accept(artifactReturn.id, {
      expectedBaseRevisionId: draft.id,
    })).toThrow(RuntimeLifecycleConflictError)
    expect(repository.getArtifactReturn(artifactReturn.id)?.status).toBe('pending_review')
    expect(repository.getArtifactRevision(String(draft.id))?.status).toBe('draft')
    expect(repository.getArtifact(String(target.id))?.currentRevisionId).not.toBe(draft.id)
  })

  it('rejects the Return but retains the Draft as auditable evidence', () => {
    const { repository, target, artifactReturn, draft } = setup()
    const currentBefore = repository.getArtifact(String(target.id))?.currentRevisionId
    const result = new RuntimeReviewService(repository, () => now).reject(artifactReturn.id)
    expect(result.artifactReturn.status).toBe('rejected')
    expect(result.draftRevision).toMatchObject({ id: draft.id, status: 'draft' })
    expect(result.run.status).toBe('completed')
    expect(repository.getArtifact(String(target.id))?.currentRevisionId).toBe(currentBefore)
  })

  it('retries by rejecting the old Return and creating a new planned Run linked by retryOfRunId', () => {
    const { repository, artifactReturn, run } = setup()
    const result = new RuntimeReviewService(repository, () => now, () => 'retry-one')
      .retry(artifactReturn.id, { instruction: 'Try a tighter revision.' })
    expect(result.previousReturn.status).toBe('rejected')
    expect(result.previousRun.status).toBe('completed')
    expect(result.run).toMatchObject({
      id: 'run-retry-one',
      retryOfRunId: run.id,
      status: 'created',
      instruction: 'Try a tighter revision.',
    })
    expect(result.dispatch).toMatchObject({
      runId: 'run-retry-one',
      idempotencyKey: 'run-retry-one',
      status: 'planned',
    })
  })

  it('recovers accepted and retry lifecycle state after restart', () => {
    const { databasePath, repository, artifactReturn, base } = setup()
    new RuntimeReviewService(repository, () => now).accept(artifactReturn.id, {
      expectedBaseRevisionId: base.id,
    })
    repository.close()
    repositories.splice(repositories.indexOf(repository), 1)
    const recovered = new SqliteMetadataRepository(databasePath)
    repositories.push(recovered)
    expect(recovered.getArtifactReturn(artifactReturn.id)?.status).toBe('adopted')
    expect(recovered.getRun(artifactReturn.runId)?.status).toBe('completed')
  })

  it('blocks generic Artifact mutation from changing Current', () => {
    const { repository, snapshot, target, draft } = setup()
    expect(() => repository.applyMutations({
      baseVersion: snapshot.graphVersion,
      ops: [{
        type: 'upsert_artifact',
        artifact: { ...target, currentRevisionId: draft.id },
      }],
    }, String(snapshot.project.id))).toThrow(RuntimeLifecycleConflictError)
    expect(repository.getArtifact(String(target.id))?.currentRevisionId).toBe(target.currentRevisionId)
  })
})
