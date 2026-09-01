import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { CurationCommandService } from '../src/curation-command-service.js'
import { SqliteMetadataRepository } from '../src/metadata-repository.js'
import { createMvpSampleSnapshot } from '../src/mvp-sample-project.js'
import { PresentationApplicationService } from '../src/presentation-application-service.js'
import { createTextArtifact } from '../src/text-artifact-service.js'

const roots: string[] = []
const repositories: SqliteMetadataRepository[] = []

afterEach(() => {
  for (const repository of repositories.splice(0)) repository.close()
  for (const root of roots.splice(0)) void Promise.resolve().then(() => { try { rmSync(root, { recursive: true, force: true }) } catch { /* best effort */ } })
})

function setup() {
  const dbRoot = mkdtempSync(join(tmpdir(), 'lcos-curation-command-db-'))
  const projectRoot = mkdtempSync(join(tmpdir(), 'lcos-curation-command-project-'))
  roots.push(dbRoot, projectRoot)
  const repository = new SqliteMetadataRepository(join(dbRoot, 'metadata.sqlite'))
  repositories.push(repository)
  const snapshot = createMvpSampleSnapshot(projectRoot, '2026-08-02T09:00:00.000Z')
  repository.save(snapshot)
  const presentations = new PresentationApplicationService(repository, repository)
  const service = new CurationCommandService({ repository, presentations })
  return { repository, snapshot, projectId: String(snapshot.project.id), service }
}

describe('Curation command (Phase E)', () => {
  it('creates and revises a managed text with immutable revision files', async () => {
    const { repository, snapshot, projectId, service } = setup()
    const rootScope = snapshot.scopes.find((scope) => scope.kind === 'root')!.id
    const created = await service.createText(projectId, { scopeId: String(rootScope), title: 'Agent Note', body: 'v1 content' })
    expect(created.artifactId).toMatch(/^artifact-text-|^text-/)
    expect(created.viewId).toBeTruthy()
    expect(created.revisionId).toBeTruthy()

    const revised = await service.updateText(projectId, { artifactId: created.artifactId }, 'v2 content')
    expect(revised.outcome).toBe('applied')
    if (revised.outcome !== 'applied') throw new Error('expected applied outcome')
    expect(revised.artifactId).toBe(created.artifactId)
    expect(revised.revisionId).not.toBe(created.revisionId)
    const artifact = repository.getArtifact(created.artifactId)!
    expect(artifact.currentRevisionId).toBe(revised.revisionId)
    const previous = repository.getArtifactRevision(created.revisionId)!
    expect(previous.status).toBe('superseded')
    const fileRecord = repository.getFileRecord(String(previous.fileRecordId))!
    expect(existsSync(fileRecord.observedPath)).toBe(true)
  })

  it('migrates a legacy notes/text-uuid.md on first revise', async () => {
    const { repository, snapshot, projectId, service } = setup()
    const rootScope = snapshot.scopes.find((scope) => scope.kind === 'root')!.id
    const created = await createTextArtifact(repository, projectId as never, {
      title: 'Legacy Note',
      body: 'legacy body',
      scopeId: String(rootScope),
    })
    // Simulate the legacy layout: move the file to notes/text-<id>.md directly.
    const legacyPath = join(repository.getProject(projectId)!.rootPath, '.creative-os', 'notes', `${created.artifactId}.md`)
    const current = repository.getFileRecord(created.fileRecordId!)!
    const { mkdir, rename } = await import('node:fs/promises')
    await mkdir(join(repository.getProject(projectId)!.rootPath, '.creative-os', 'notes'), { recursive: true })
    await rename(current.observedPath, legacyPath)
    repository.upsertFileRecord({ ...current, observedPath: legacyPath })

    const revised = await service.updateText(projectId, { artifactId: created.artifactId }, 'migrated content')
    expect(revised.outcome).toBe('applied')
    if (revised.outcome !== 'applied') throw new Error('expected applied outcome')
    expect(revised.legacyMigrated).toBe(true)
    const previousFile = repository.getFileRecord(created.fileRecordId!)!
    expect(previousFile.observedPath).not.toBe(legacyPath)
    expect(existsSync(previousFile.observedPath)).toBe(true)
  })

  it('persists relation provenance', async () => {
    const { repository, snapshot, projectId } = setup()
    const brief = snapshot.artifacts.find((artifact) => artifact.id === 'artifact-brief')!
    repository.upsertRelation({
      id: 'relation-provenance-test',
      projectId: projectId as never,
      sourceEntityType: 'artifact',
      sourceEntityId: brief.id,
      targetEntityType: 'artifact',
      targetEntityId: 'artifact-script',
      kind: 'reference',
      origin: 'agent',
      createdBy: 'codex',
      confidence: 0.82,
      createdAt: '2026-08-02T09:00:00.000Z',
      updatedAt: '2026-08-02T09:00:00.000Z',
    })
    const loaded = repository.getRelation('relation-provenance-test')!
    expect(loaded.origin).toBe('agent')
    expect(loaded.createdBy).toBe('codex')
    expect(loaded.confidence).toBe(0.82)
  })

  it('applies a full curation patch with receipts, relations and presentation CAS', async () => {
    const { repository, snapshot, projectId, service } = setup()
    const rootScope = snapshot.scopes.find((scope) => scope.kind === 'root')!.id
    const receipt = await service.applyPatch(projectId, {
      schemaVersion: 0,
      operationId: 'op-full-1',
      projectId,
      scopeId: String(rootScope),
      createTexts: [{ clientRef: 'summary-1', title: 'Summary', body: 'patch body' }],
      relations: [{ from: { clientRef: 'summary-1' }, to: { entityId: 'artifact-brief' }, label: '来源于', origin: 'agent' }],
    })
    expect(receipt.applied).toBe(true)
    expect(receipt.completedSteps).toHaveLength(2)
    const createdStep = receipt.completedSteps.find((step) => step.step === 'createText')!
    const relationStep = receipt.completedSteps.find((step) => step.step === 'relation')!
    expect(createdStep.viewId).toBeTruthy()
    expect(relationStep.relationId).toBeTruthy()
    const relation = repository.getRelation(relationStep.relationId!)!
    expect(relation.sourceEntityId).toBe(createdStep.viewId)
    expect(relation.kind).toBe('来源于')
    expect(relation.origin).toBe('agent')
  })

  it('preserves trusted SurfaceElements when a curation patch edits the same Presentation', async () => {
    const { snapshot, projectId, service } = setup()
    const rootScope = snapshot.scopes.find((scope) => scope.kind === 'root')!.id
    const memberViewId = String(snapshot.artifactViews[0]!.id)
    const seeded = service['deps'].presentations.save(projectId, {
      presentationId: 'presentation:context:scope-mvp-root-components',
      scopeId: String(rootScope),
      capability: 'context',
      renderer: 'context',
      state: {
        memberViewIds: [memberViewId],
        hiddenViewIds: [],
        positions: {},
        hierarchy: { parentByViewId: { [memberViewId]: null }, orderByParent: { '': [memberViewId] } },
        presentationEdges: [],
        pinnedViewIds: [],
        emphasisByViewId: {},
        surfaceElements: [{
          id: 'surface:region:curation-safe', projectId, surface: 'context', type: 'region',
          bounds: { x: 80, y: 90, w: 320, h: 210 },
        }],
      },
      expectedVersion: 0,
      updatedBy: 'web',
    })
    const receipt = await service.applyPatch(projectId, {
      schemaVersion: 0, operationId: 'op-preserve-surface-elements', projectId, scopeId: String(rootScope),
      createTexts: [], relations: [],
      presentation: { presentationId: seeded.id, expectedVersion: seeded.version, pin: [memberViewId] },
    })
    expect(receipt.applied).toBe(true)
    const loaded = service['deps'].presentations.get(projectId, seeded.id)
    expect(loaded?.state.surfaceElements).toEqual(seeded.state.surfaceElements)
    expect(loaded?.state.pinnedViewIds).toEqual([memberViewId])
  })

  it('returns the same receipt on operation replay and fails cleanly on presentation CAS conflict', async () => {
    const { repository, snapshot, projectId, service } = setup()
    const rootScope = snapshot.scopes.find((scope) => scope.kind === 'root')!.id
    // Seed a context presentation so the patch has something to conflict against.
    service['deps'].presentations.save(projectId, {
      presentationId: 'presentation:context:scope-mvp-root',
      scopeId: String(rootScope),
      capability: 'context',
      renderer: 'context',
      state: {
        memberViewIds: [],
        hiddenViewIds: [],
        positions: {},
        hierarchy: { parentByViewId: {}, orderByParent: {} },
        presentationEdges: [],
        pinnedViewIds: [],
        emphasisByViewId: {},
      },
      expectedVersion: 0,
      updatedBy: 'web',
    })
    const patch = {
      schemaVersion: 0 as const,
      operationId: 'op-replay',
      projectId,
      scopeId: String(rootScope),
      createTexts: [{ clientRef: 'a', title: 'A', body: 'x' }],
      relations: [],
      presentation: {
        presentationId: 'presentation:context:scope-mvp-root',
        expectedVersion: 999,
        addMembers: [{ clientRef: 'a' }],
      },
    }
    const failed = await service.applyPatch(projectId, patch)
    expect(failed.applied).toBe(false)
    // HU-1A: 预验证阶段即拦截，0 mutation
    expect(failed.failedStep?.step).toBe('validate')
    expect(failed.failedStep?.error).toContain('STALE_PRESENTATION_VERSION')
    expect(failed.completedSteps).toHaveLength(0)

    const replay = await service.applyPatch(projectId, patch)
    expect(replay.operationId).toBe('op-replay')
    expect(replay.createdAt).toBe(failed.createdAt)
  })
})
