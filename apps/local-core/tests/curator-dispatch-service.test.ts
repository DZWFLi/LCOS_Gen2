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
import { CuratorDispatchService } from '../src/curator-dispatch-service.js'

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
  const dir = await mkdtemp(join(tmpdir(), 'lcos-curator-'))
  cleanup.push(dir)
  const projectRoot = join(dir, 'root')
  await mkdir(projectRoot, { recursive: true })
  const metadata = new SqliteMetadataRepository(join(dir, 'metadata.sqlite'))
  metadata.createProject({ id: 'curator-project' as never, name: 'Curator', rootPath: projectRoot })
  const viewA = await createTextArtifact(metadata, 'curator-project' as never, { body: 'A', scopeId: 'scope-curator-project-root' as never })
  const viewB = await createTextArtifact(metadata, 'curator-project' as never, { body: 'B', scopeId: 'scope-curator-project-root' as never })
  const presentation = new PresentationApplicationService(metadata, metadata)
  presentation.save('curator-project', {
    presentationId: 'presentation-1',
    scopeId: 'scope-curator-project-root',
    capability: 'context',
    renderer: 'graph',
    state: state([viewA.viewId, viewB.viewId]),
    expectedVersion: 0,
    updatedBy: 'web',
  })
  const reorganize = new ReorganizeService(metadata, presentation, new MutationSafetyService(metadata, presentation))
  const service = new CuratorDispatchService({ repository: metadata, reorganize })
  return { dir, metadata, presentation, reorganize, service, viewA, viewB }
}

afterEach(async () => {
  for (const path of cleanup.splice(0)) void rm(path, { recursive: true, force: true, maxRetries: 3 }).catch(() => { /* best effort */ })
})

describe('CuratorDispatchService (P0-C semantic execution bridge)', () => {
  it('dispatch requires a configured agentlet runtime (fail-close UNAVAILABLE)', async () => {
    const { service } = await disposable()
    expect(() => service.dispatch({
      schemaVersion: 1,
      projectId: 'curator-project',
      presentationId: 'presentation-1',
      surfaceKind: 'context',
      surfaceId: 'scope-curator-project-root',
      selectionViewIds: [],
      intent: '按内容关系分组',
    })).toThrow('UNAVAILABLE: agentlet runtime is not configured.')
  })

  it('ingest a valid result persists a ReorganizeProposalV0 via ReorganizeService (proposal lifecycle reused)', async () => {
    const { service, viewA, viewB, presentation } = await disposable()
    const now = new Date().toISOString()
    const positionPatch = { [viewA.viewId]: { x: 100, y: 100 }, [viewB.viewId]: { x: 320, y: 100 } }
    const result = {
      schemaVersion: 1,
      kind: 'reorganize-proposal',
      agentletId: 'lcos-project-curator',
      proposal: {
        schemaVersion: 0,
        id: 'reorg-curator-1',
        projectId: 'curator-project',
        presentationId: 'presentation-1',
        baseVersion: 0,
        status: 'pending',
        mergeCandidates: [],
        removeMemberViewIds: [],
        artifactDeleteCandidates: [],
        positionPatch,
        layoutIntent: { engine: 'manual', preservePinned: true },
        createdAt: now,
      },
      summary: '已生成安全位置梳理提案',
      positionPlan: positionPatch,
    }
    const ingested = service.ingest('curator-project', 'agentlet-session', result)
    expect(ingested.ok).toBe(true)
    expect(ingested.proposalId.length).toBeGreaterThan(0)
    // preview 存在（ghost 可消费）
    expect(ingested.preview.positionChanges).toBe(2)
    // ReorganizeService 持有该 proposal（通过 preview 访问证明持久化成功）
    expect(ingested.preview.proposalId).toBe(ingested.proposalId)
    // canvas 未被直接修改（proposal 只提出方案，未 apply）
    const after = presentation.get('curator-project', 'presentation-1')
    expect(after?.state.memberViewIds).toEqual([viewA.viewId, viewB.viewId])
  })

  it('ingest an invalid output fails closed (no ghost, no canvas mutation)', async () => {
    const { service, viewA, viewB, presentation } = await disposable()
    const invalid = {
      schemaVersion: 1,
      kind: 'reorganize-proposal',
      agentletId: 'lcos-project-curator',
      proposal: {
        schemaVersion: 0,
        id: 'reorg-curator-bad',
        projectId: 'curator-project',
        presentationId: 'presentation-1',
        // baseVersion 缺失 → schema validation fail
        status: 'pending',
        mergeCandidates: [],
        removeMemberViewIds: [],
        artifactDeleteCandidates: [],
        createdAt: new Date().toISOString(),
      },
      summary: '非法提案',
    }
    expect(() => service.ingest('curator-project', 'agentlet-session', invalid)).toThrow('CURATOR_INVALID_OUTPUT')
    // canvas 未被修改
    const after = presentation.get('curator-project', 'presentation-1')
    expect(after?.state.memberViewIds).toEqual([viewA.viewId, viewB.viewId])
  })
})