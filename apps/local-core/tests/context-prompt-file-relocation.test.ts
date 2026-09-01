import { copyFileSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { compileContextPromptV1 } from '../src/context-prompt-serializer.js'
import { ContextManifestService } from '../src/context-manifest-service.js'
import { SqliteMetadataRepository } from '../src/metadata-repository.js'
import { createMvpSampleSnapshot, MVP_SAMPLE_PROJECT_ID } from '../src/mvp-sample-project.js'

const roots: string[] = []
const repositories: SqliteMetadataRepository[] = []
afterEach(() => {
  for (const repository of repositories.splice(0)) repository.close()
  for (const root of roots.splice(0)) { try { rmSync(root, { recursive: true, force: true }) } catch { /* best effort */ } }
})

describe('Context prompt file relocation', () => {
  it('does not change stable semantic prefix when only FileRecord.observedPath moves', async () => {
    const projectRoot = mkdtempSync(join(tmpdir(), 'lcos-cache-relocation-project-'))
    const dbRoot = mkdtempSync(join(tmpdir(), 'lcos-cache-relocation-db-'))
    const movedRoot = mkdtempSync(join(tmpdir(), 'lcos-cache-relocation-moved-'))
    roots.push(projectRoot, dbRoot, movedRoot)
    const repository = new SqliteMetadataRepository(join(dbRoot, 'metadata.sqlite'))
    repositories.push(repository)
    const snapshot = createMvpSampleSnapshot(projectRoot, '2026-08-18T00:00:00.000Z')
    repository.save(snapshot)
    const brief = snapshot.artifacts.find((artifact) => artifact.title === 'Brief')!
    const revision = snapshot.artifactRevisions.find((item) => String(item.id) === String(brief.currentRevisionId))!
    const record = snapshot.fileRecords.find((item) => String(item.id) === String(revision.fileRecordId))!
    const service = new ContextManifestService(repository)
    const build = () => service.build(MVP_SAMPLE_PROJECT_ID, {
      stableContextItems: [{ artifactId: String(brief.id), revisionId: String(revision.id) }],
      savedContextId: 'context-relocation',
      promptRouteId: 'context_build@v1',
    })
    const firstManifest = await build()
    const first = compileContextPromptV1({ manifest: firstManifest, userTask: 'x', outputIntent: 'analyze' })

    const movedPath = join(movedRoot, basename(record.observedPath))
    copyFileSync(record.observedPath, movedPath)
    repository.updateFileObservation({ ...record, observedPath: movedPath, observedAt: '2026-08-18T01:00:00.000Z' })

    const secondManifest = await build()
    const second = compileContextPromptV1({ manifest: secondManifest, userTask: 'x', outputIntent: 'analyze' })
    expect(second.stablePrefixHash).toBe(first.stablePrefixHash)
    expect(second.stablePrefix).not.toContain(projectRoot)
    expect(second.stablePrefix).not.toContain(movedRoot)
  })
})
