import { createHash } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { PersistedContextManifestV0 } from '@local-creative-os/contracts'
import type { Run, RuntimeDispatch } from '@local-creative-os/domain'
import { afterEach, describe, expect, it } from 'vitest'

import { SqliteMetadataRepository } from '../src/metadata-repository.js'
import { createMvpSampleSnapshot } from '../src/mvp-sample-project.js'
import { ProcessProjectionService } from '../src/process-projection-service.js'

const cleanup: string[] = []

afterEach(async () => {
  for (const path of cleanup.splice(0)) void rm(path, { recursive: true, force: true }).catch(() => { /* best effort */ })
})

describe('ProcessProjectionService', () => {
  it('returns at most three canonical Run projections with real view relationships', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'lcos-process-projection-'))
    cleanup.push(directory)
    const repository = new SqliteMetadataRepository(join(directory, 'metadata.sqlite'))
    const snapshot = createMvpSampleSnapshot(directory, '2026-08-04T09:00:00.000Z')
    repository.save(snapshot)
    const target = snapshot.artifacts[0]!
    const context = snapshot.artifacts[1]!
    try {
      for (let index = 0; index < 5; index += 1) {
      const manifestJson = JSON.stringify({
        schemaVersion: 0,
        sequence: index,
        target: { artifactId: String(target.id) },
        references: [{ artifactId: String(context.id) }],
      })
      const manifestId = `manifest-projection-${index}` as PersistedContextManifestV0['id']
      repository.createContextManifest({
        id: manifestId,
        projectId: snapshot.project.id,
        schemaVersion: 0,
        targetArtifactId: target.id,
        targetRevisionId: target.currentRevisionId,
        canonicalJson: manifestJson,
        manifestHash: createHash('sha256').update(manifestJson).digest('hex'),
        createdAt: `2026-08-04T09:0${index}:00.000Z`,
      })
      const run: Run = {
        id: `run-projection-${index}` as Run['id'],
        projectId: snapshot.project.id,
        workspaceId: snapshot.workspaces[0]!.id,
        targetArtifactId: target.id,
        targetRevisionId: target.currentRevisionId,
        contextManifestId: manifestId,
        provider: 'codex',
        requestedProvider: 'codex',
        outputIntent: 'revise',
        returnGroupId: `return-group-${index}`,
        status: index === 4 ? 'running' : 'completed',
        instruction: `Run ${index}`,
        createdAt: `2026-08-04T09:0${index}:00.000Z`,
        updatedAt: `2026-08-04T09:0${index}:00.000Z`,
      }
      repository.createRunWithDispatch(run, {
        id: `dispatch-projection-${index}` as RuntimeDispatch['id'],
        runId: run.id,
        provider: 'codex',
        idempotencyKey: String(run.id),
        status: 'bound',
        attemptCount: 1,
        createdAt: run.createdAt,
        updatedAt: run.updatedAt,
      })
      }

      const result = new ProcessProjectionService(repository).project(snapshot.project.id)
      expect(result).toHaveLength(3)
      expect(result.every((item) => item.schemaVersion === 1 && item.kind === 'run')).toBe(true)
      expect(result.at(-1)?.runId).toBe('run-projection-4')
      expect(result.at(-1)?.targetViewIds).toContain(String(snapshot.artifactViews[0]!.id))
      expect(result.at(-1)?.contextViewIds).toContain(String(snapshot.artifactViews[1]!.id))
      expect(result.some((item) => item.runId === String(snapshot.checkpoints[0]?.id))).toBe(false)
    } finally {
      repository.close()
    }
  })
})
