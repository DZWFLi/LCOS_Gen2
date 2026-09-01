import { mkdtemp, mkdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { PresentationStateV0 } from '@local-creative-os/contracts'
import { afterEach, describe, expect, it } from 'vitest'
import { SqliteMetadataRepository } from '../src/metadata-repository.js'
import { PresentationApplicationService } from '../src/presentation-application-service.js'
import { ReorganizeService } from '../src/reorganize-service.js'
import { createTextArtifact } from '../src/text-artifact-service.js'
import { MutationSafetyService } from '../src/mutation-safety-service.js'

const cleanup: string[] = []

function state(memberViewIds: string[]): PresentationStateV0 {
  return {
    memberViewIds,
    hiddenViewIds: [],
    positions: {},
    hierarchy: { parentByViewId: {}, orderByParent: {} },
    presentationEdges: [],
    pinnedViewIds: [],
    emphasisByViewId: {},
  }
}

async function disposable() {
  const dir = await mkdtemp(join(tmpdir(), 'lcos-reorganize-'))
  cleanup.push(dir)
  const projectRoot = join(dir, 'root')
  await mkdir(projectRoot, { recursive: true })
  const metadata = new SqliteMetadataRepository(join(dir, 'metadata.sqlite'))
  metadata.createProject({ id: 'reorg-project' as never, name: 'Reorg', rootPath: projectRoot })
  const viewA = await createTextArtifact(metadata, 'reorg-project' as never, { body: 'A', scopeId: 'scope-reorg-project-root' as never })
  const viewB = await createTextArtifact(metadata, 'reorg-project' as never, { body: 'B', scopeId: 'scope-reorg-project-root' as never })
  const viewC = await createTextArtifact(metadata, 'reorg-project' as never, { body: 'C', scopeId: 'scope-reorg-project-root' as never })
  const presentation = new PresentationApplicationService(metadata, metadata)
  const first = presentation.save('reorg-project', {
    presentationId: 'presentation-1',
    scopeId: 'scope-reorg-project-root',
    capability: 'context',
    renderer: 'graph',
    state: state([viewA.viewId, viewB.viewId, viewC.viewId]),
    expectedVersion: 0,
    updatedBy: 'web',
  })
  const service = new ReorganizeService(metadata, presentation, new MutationSafetyService(metadata, presentation))
  return { dir, metadata, presentation, service, first, viewA, viewB, viewC }
}

afterEach(async () => {
  for (const path of cleanup.splice(0)) void rm(path, { recursive: true, force: true, maxRetries: 3 }).catch(() => { /* best effort */ })
})

describe('ReorganizeService (Phase D)', () => {
  it('creates a pending proposal and previews non-destructive changes', async () => {
    const { service, viewB } = await disposable()
    const proposal = service.create({
      projectId: 'reorg-project',
      presentationId: 'presentation-1',
      baseVersion: 0,
      removeMemberViewIds: [viewB.viewId],
    })
    expect(proposal.status).toBe('pending')
    const preview = service.preview(proposal.id)
    expect(preview.willRemovePresentationMembers).toEqual([viewB.viewId])
    expect(preview.destructive).toBe(false)
  })

  it('applies member removal and hierarchy patch, then rollback restores', async () => {
    const { service, presentation, viewA, viewB, viewC } = await disposable()
    const proposal = service.create({
      projectId: 'reorg-project',
      presentationId: 'presentation-1',
      baseVersion: 0,
      removeMemberViewIds: [viewB.viewId],
      hierarchyPatch: { parentByViewId: { [viewC.viewId]: viewA.viewId }, orderByParent: { [viewA.viewId]: [viewC.viewId] } },
    })
    service.apply(proposal.id)
    const after = presentation.get('reorg-project', 'presentation-1')
    expect(after?.state.memberViewIds).toEqual([viewA.viewId, viewC.viewId])
    expect(after?.state.hierarchy.parentByViewId[viewC.viewId]).toBe(viewA.viewId)
    expect(service.get(proposal.id)?.status).toBe('applied')

    service.rollback(proposal.id)
    const restored = presentation.get('reorg-project', 'presentation-1')
    expect(restored?.state.memberViewIds).toEqual([viewA.viewId, viewB.viewId, viewC.viewId])
    expect(restored?.state.hierarchy.parentByViewId[viewC.viewId]).toBeUndefined()
  })


  it('persists presentation-only position patches and rollback restores the prior spatial state', async () => {
    const { service, presentation, viewA, viewB } = await disposable()
    const current = presentation.get('reorg-project', 'presentation-1')!
    presentation.save('reorg-project', {
      presentationId: current.id,
      scopeId: current.scopeId,
      capability: current.capability,
      renderer: current.renderer,
      state: { ...current.state, positions: { [viewA.viewId]: { x: 12, y: 18 }, [viewB.viewId]: { x: 220, y: 36 } } },
      expectedVersion: current.version,
      updatedBy: 'web',
    })
    const base = presentation.get('reorg-project', 'presentation-1')!
    const proposal = service.create({
      projectId: 'reorg-project',
      presentationId: 'presentation-1',
      baseVersion: base.version,
      layoutIntent: { engine: 'elk', preservePinned: true },
      positionPatch: { [viewA.viewId]: { x: 100, y: 140 }, [viewB.viewId]: { x: 360, y: 140 } },
    })
    expect(service.preview(proposal.id).positionChanges).toBe(2)
    service.apply(proposal.id)
    expect(presentation.get('reorg-project', 'presentation-1')?.state.positions[viewA.viewId]).toEqual({ x: 100, y: 140 })
    expect(presentation.get('reorg-project', 'presentation-1')?.state.positions[viewB.viewId]).toEqual({ x: 360, y: 140 })
    service.rollback(proposal.id)
    expect(presentation.get('reorg-project', 'presentation-1')?.state.positions[viewA.viewId]).toEqual({ x: 12, y: 18 })
    expect(presentation.get('reorg-project', 'presentation-1')?.state.positions[viewB.viewId]).toEqual({ x: 220, y: 36 })
  })

  it('broad apply never hard-deletes artifacts; destructive candidates stay as preview hints', async () => {
    const { service, metadata, viewA } = await disposable()
    const proposal = service.create({
      projectId: 'reorg-project',
      presentationId: 'presentation-1',
      baseVersion: 0,
      artifactDeleteCandidates: [{ artifactId: viewA.artifactId, reason: 'test' }],
    })
    const preview = service.preview(proposal.id)
    expect(preview.destructive).toBe(true)
    // apply 不再需要 confirmDestructive，也不再执行删除
    service.apply(proposal.id)
    expect(service.get(proposal.id)?.status).toBe('applied')
    expect(metadata.getArtifact(viewA.artifactId)).toBeDefined()
  })

  it('fails closed when Presentation changed after proposal creation', async () => {
    const { service, presentation } = await disposable()
    const proposal = service.create({ projectId: 'reorg-project', presentationId: 'presentation-1', baseVersion: 0 })
    const current = presentation.get('reorg-project', 'presentation-1')!
    presentation.save('reorg-project', {
      presentationId: current.id,
      scopeId: current.scopeId,
      capability: current.capability,
      renderer: current.renderer,
      state: current.state,
      expectedVersion: current.version,
      updatedBy: 'web',
    })
    expect(() => service.apply(proposal.id)).toThrow(/STALE_PRESENTATION/)
    expect(service.get(proposal.id)?.status).toBe('pending')
  })

  it('rollback is blocked when presentation changed after apply (safe revert)', async () => {
    const { service, presentation, viewB } = await disposable()
    const proposal = service.create({
      projectId: 'reorg-project',
      presentationId: 'presentation-1',
      baseVersion: 0,
      removeMemberViewIds: [viewB.viewId],
    })
    service.apply(proposal.id)
    // 用户在 apply 后又改了 presentation（version 前进）
    const current = presentation.get('reorg-project', 'presentation-1')!
    presentation.save('reorg-project', {
      presentationId: current.id,
      scopeId: current.scopeId,
      capability: current.capability,
      renderer: current.renderer,
      state: current.state,
      expectedVersion: current.version,
      updatedBy: 'web',
    })
    expect(() => service.rollback(proposal.id)).toThrow(/Revert blocked|TOUCHED_STATE_CHANGED/)
    expect(service.get(proposal.id)?.status).toBe('applied')
  })

  it('rollback restores presentation via change set when untouched', async () => {
    const { service, presentation, viewA, viewB, viewC } = await disposable()
    const proposal = service.create({
      projectId: 'reorg-project',
      presentationId: 'presentation-1',
      baseVersion: 0,
      removeMemberViewIds: [viewB.viewId],
      hierarchyPatch: { parentByViewId: { [viewC.viewId]: viewA.viewId }, orderByParent: { [viewA.viewId]: [viewC.viewId] } },
    })
    service.apply(proposal.id)
    service.rollback(proposal.id)
    const restored = presentation.get('reorg-project', 'presentation-1')
    expect(restored?.state.memberViewIds).toEqual([viewA.viewId, viewB.viewId, viewC.viewId])
    expect(restored?.state.hierarchy.parentByViewId[viewC.viewId]).toBeUndefined()
  })


  it('accepts an applied proposal and closes the whole-ChangeSet review', async () => {
    const { service } = await disposable()
    const proposal = service.create({ projectId: 'reorg-project', presentationId: 'presentation-1', baseVersion: 0 })
    service.apply(proposal.id)
    const accepted = service.accept(proposal.id)
    expect(accepted.status).toBe('accepted')
    expect(service.list('reorg-project').find((item) => item.id === proposal.id)?.status).toBe('accepted')
    expect(() => service.rollback(proposal.id)).toThrow(/Only applied proposals/)
  })

  it('rejects proposal', async () => {
    const { service } = await disposable()
    const proposal = service.create({ projectId: 'reorg-project', presentationId: 'presentation-1', baseVersion: 0 })
    const rejected = service.reject(proposal.id)
    expect(rejected.status).toBe('rejected')
  })

  it('persists proposals across restart', async () => {
    const { dir } = await disposable()
    const path = join(dir, 'metadata.sqlite')
    const first = new SqliteMetadataRepository(path)
    const presentation = new PresentationApplicationService(first, first)
    const service = new ReorganizeService(first, presentation, new MutationSafetyService(first, presentation))
    const proposal = service.create({ projectId: 'reorg-project', presentationId: 'presentation-1', baseVersion: 0 })
    first.close()
    const second = new SqliteMetadataRepository(path)
    const reopenedPresentation = new PresentationApplicationService(second, second)
    const reopened = new ReorganizeService(second, reopenedPresentation, new MutationSafetyService(second, reopenedPresentation))
    expect(reopened.get(proposal.id)?.status).toBe('pending')
  })
})
