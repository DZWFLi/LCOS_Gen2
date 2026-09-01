import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { ContextManifestService } from '../src/context-manifest-service.js'
import { SqliteMetadataRepository } from '../src/metadata-repository.js'
import { createMvpSampleSnapshot, MVP_SAMPLE_PROJECT_ID } from '../src/mvp-sample-project.js'

const temporaryDirectories: string[] = []
const repositories: SqliteMetadataRepository[] = []

afterEach(() => {
  for (const repository of repositories.splice(0)) repository.close()
  for (const directory of temporaryDirectories.splice(0)) void Promise.resolve().then(() => { try { rmSync(directory, { recursive: true, force: true }) } catch { /* best effort */ } })
})

describe('ContextManifestService', () => {
  it('builds a deterministic path-free manifest from Project Truth', async () => {
    const sampleRoot = mkdtempSync(join(tmpdir(), 'lcos-manifest-sample-'))
    const databaseRoot = mkdtempSync(join(tmpdir(), 'lcos-manifest-db-'))
    temporaryDirectories.push(sampleRoot, databaseRoot)
    const repository = new SqliteMetadataRepository(join(databaseRoot, 'metadata.sqlite'))
    repositories.push(repository)
    const snapshot = createMvpSampleSnapshot(sampleRoot, '2026-07-29T00:00:00.000Z')
    repository.save(snapshot)
    const service = new ContextManifestService(repository)
    const script = snapshot.artifacts.find((artifact) => artifact.title === 'Script')!

    const first = await service.build(MVP_SAMPLE_PROJECT_ID, { targetArtifactId: String(script.id) })
    const second = await service.build(MVP_SAMPLE_PROJECT_ID, { targetArtifactId: String(script.id) })
    const serialized = JSON.stringify(first)

    expect(first.id).toBe(second.id)
    expect(first.manifestHash).toBe(second.manifestHash)
    expect(first.renderedManifestHash).toBe(second.renderedManifestHash)
    expect(repository.getContextManifest(first.id)).toMatchObject({
      id: first.id,
      manifestHash: first.manifestHash,
      schemaVersion: 0,
    })
    expect(first.target?.title).toBe('Script')
    expect(first.references.map((reference) => reference.title)).toContain('Reference Image')
    expect(first.orderedItems).toContainEqual(expect.objectContaining({
      role: 'context',
      title: 'Brief',
    }))
    expect(first.feedback.some((item) => item.title === 'Feedback Notes')).toBe(true)
    expect(first.lockedElements).toContain('the MVP path focused on project understanding and handoff.')
    expect(first.orderedItems.some((item) => item.role === 'decision')).toBe(true)
    expect(first.renderedMarkdown).toContain('PortaSplit demo script')
    expect(serialized).not.toContain(sampleRoot)
    expect(serialized).not.toContain('observedPath')
  })

  it('freezes explicitly selected Canvas artifacts into context', async () => {
    const sampleRoot = mkdtempSync(join(tmpdir(), 'lcos-manifest-selection-'))
    const databaseRoot = mkdtempSync(join(tmpdir(), 'lcos-manifest-selection-db-'))
    temporaryDirectories.push(sampleRoot, databaseRoot)
    const repository = new SqliteMetadataRepository(join(databaseRoot, 'metadata.sqlite'))
    repositories.push(repository)
    const snapshot = createMvpSampleSnapshot(sampleRoot, '2026-07-29T00:00:00.000Z')
    repository.save(snapshot)
    const brief = snapshot.artifacts.find((artifact) => artifact.title === 'Brief')!

    const manifest = await new ContextManifestService(repository).build(MVP_SAMPLE_PROJECT_ID, {
      contextArtifactIds: [String(brief.id)],
    })

    expect(manifest.orderedItems).toContainEqual(expect.objectContaining({
      role: 'context',
      identity: String(brief.id),
      title: 'Brief',
    }))
  })

  it('freezes an explicitly selected Base Revision instead of silently using Current', async () => {
    const sampleRoot = mkdtempSync(join(tmpdir(), 'lcos-manifest-base-'))
    const databaseRoot = mkdtempSync(join(tmpdir(), 'lcos-manifest-base-db-'))
    temporaryDirectories.push(sampleRoot, databaseRoot)
    const repository = new SqliteMetadataRepository(join(databaseRoot, 'metadata.sqlite'))
    repositories.push(repository)
    const snapshot = createMvpSampleSnapshot(sampleRoot, '2026-07-29T00:00:00.000Z')
    repository.save(snapshot)
    const target = snapshot.artifacts.find((artifact) => artifact.title === 'Script')!
    const base = snapshot.artifactRevisions.find((revision) => String(revision.artifactId) === String(target.id))!

    const manifest = await new ContextManifestService(repository).build(MVP_SAMPLE_PROJECT_ID, {
      targetArtifactId: String(target.id),
      targetRevisionId: String(base.id),
    })

    expect(manifest.target?.revisionId).toBe(String(base.id))
    expect(manifest.currentRevision?.revisionId).toBe(String(base.id))
  })
})

it('freezes Saved Context order, pinned revision and fragment anchor into a dedicated cache plan', async () => {
  const sampleRoot = mkdtempSync(join(tmpdir(), 'lcos-manifest-cache-sample-'))
  const databaseRoot = mkdtempSync(join(tmpdir(), 'lcos-manifest-cache-db-'))
  temporaryDirectories.push(sampleRoot, databaseRoot)
  const repository = new SqliteMetadataRepository(join(databaseRoot, 'metadata.sqlite'))
  repositories.push(repository)
  const snapshot = createMvpSampleSnapshot(sampleRoot, '2026-07-29T00:00:00.000Z')
  repository.save(snapshot)
  const brief = snapshot.artifacts.find((artifact) => artifact.title === 'Brief')!
  const feedback = snapshot.artifacts.find((artifact) => artifact.title === 'Feedback Notes')!
  const briefRevision = snapshot.artifactRevisions.find((revision) => String(revision.artifactId) === String(brief.id))!
  const feedbackRevision = snapshot.artifactRevisions.find((revision) => String(revision.artifactId) === String(feedback.id))!

  const manifest = await new ContextManifestService(repository).build(MVP_SAMPLE_PROJECT_ID, {
    savedContextId: 'context-cache-fixture',
    stableContextItems: [
      { artifactId: String(feedback.id), revisionId: String(feedbackRevision.id), sourceAnchor: 'pdf:p3-p5' },
      { artifactId: String(brief.id), revisionId: String(briefRevision.id) },
    ],
    contextArtifactIds: [String(brief.id)],
    promptRouteId: 'context_build@v1',
    promptSkillId: 'lcos-curator',
    promptSkillVersion: '4.3',
    capabilityProfileId: 'context-build-v1',
  })

  expect(manifest.cachePlan).toMatchObject({
    savedContextId: 'context-cache-fixture',
    focusArtifactIds: [String(brief.id)],
    routeId: 'context_build@v1',
    skillId: 'lcos-curator',
    skillVersion: '4.3',
    capabilityProfileId: 'context-build-v1',
  })
  expect(manifest.cachePlan?.stableItemIdentities).toHaveLength(2)
  const stable = manifest.cachePlan!.stableItemIdentities.map((identity) => manifest.orderedItems.find((item) => item.identity === identity)!)
  expect(stable.map((item) => item.artifactId)).toEqual([String(feedback.id), String(brief.id)])
  expect(stable[0]).toMatchObject({ revisionId: String(feedbackRevision.id), sourceAnchor: 'pdf:p3-p5', role: 'context' })
  expect(stable[1]).toMatchObject({ revisionId: String(briefRevision.id), role: 'context' })
  // The same Brief may also be current focus, but the Saved Context copy keeps its own stable identity/role.
  expect(stable[1]!.identity).toMatch(/^saved:/)
})
