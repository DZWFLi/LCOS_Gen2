import { mkdtemp, mkdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { SqliteMetadataRepository } from '../src/metadata-repository.js'
import { PresentationApplicationService } from '../src/presentation-application-service.js'
import { CurationCommandService } from '../src/curation-command-service.js'

const cleanup: string[] = []

async function disposable() {
  const dir = await mkdtemp(join(tmpdir(), 'lcos-curation-receipt-'))
  cleanup.push(dir)
  const projectRoot = join(dir, 'root')
  await mkdir(projectRoot, { recursive: true })
  const metadata = new SqliteMetadataRepository(join(dir, 'metadata.sqlite'))
  metadata.createProject({ id: 'curation-project' as never, name: 'Curation', rootPath: projectRoot })
  const presentations = new PresentationApplicationService(metadata, metadata)
  const service = new CurationCommandService({ repository: metadata, presentations })
  return { dir, metadata, presentations, service }
}

afterEach(async () => {
  for (const path of cleanup.splice(0)) void rm(path, { recursive: true, force: true, maxRetries: 3 }).catch(() => { /* best effort */ })
})

const scopeId = 'scope-curation-project-root'

describe('Curation receipts + prevalidation (HU-1A)', () => {
  it('persists applied receipt across repository restart (same operationId returns same receipt)', async () => {
    const { dir, service } = await disposable()
    const operationId = 'curation-restart-1'
    const patch = {
      schemaVersion: 0,
      operationId,
      projectId: 'curation-project',
      scopeId,
      createTexts: [{ clientRef: 'a', body: '第一段' }],
      relations: [],
    } as never
    const first = await service.applyPatch('curation-project', patch)
    expect(first.applied).toBe(true)

    // 重启：新 repository + 新 service
    const reopened = new SqliteMetadataRepository(join(dir, 'metadata.sqlite'))
    const reopenedService = new CurationCommandService({
      repository: reopened,
      presentations: new PresentationApplicationService(reopened, reopened),
    })
    const retry = await reopenedService.applyPatch('curation-project', patch)
    expect(retry.operationId).toBe(operationId)
    expect(retry.applied).toBe(true)
    expect(retry.completedSteps).toEqual(first.completedSteps)
    // 且没有重复创建节点
    expect(reopened.getArtifacts('curation-project')).toHaveLength(1)
  })

  it('prevalidation rejects duplicate clientRef with zero mutation', async () => {
    const { service, metadata } = await disposable()
    const result = await service.applyPatch('curation-project', {
      schemaVersion: 0,
      operationId: 'curation-dupe-1',
      projectId: 'curation-project',
      scopeId,
      createTexts: [
        { clientRef: 'x', body: '甲' },
        { clientRef: 'x', body: '乙' },
      ],
      relations: [],
    } as never)
    expect(result.applied).toBe(false)
    expect(result.failedStep?.step).toBe('validate')
    expect(metadata.getArtifacts('curation-project')).toHaveLength(0)
  })

  it('prevalidation rejects unknown relation endpoint with zero mutation', async () => {
    const { service, metadata } = await disposable()
    const result = await service.applyPatch('curation-project', {
      schemaVersion: 0,
      operationId: 'curation-rel-1',
      projectId: 'curation-project',
      scopeId,
      createTexts: [{ clientRef: 'a', body: '甲' }],
      relations: [
        { from: { clientRef: 'a' }, to: { entityId: 'missing-view' }, kind: 'informs' },
      ],
    } as never)
    expect(result.applied).toBe(false)
    expect(result.failedStep?.step).toBe('validate')
    expect(metadata.getArtifacts('curation-project')).toHaveLength(0)
    expect(metadata.getRelations('curation-project')).toHaveLength(0)
  })

  it('prevalidation rejects stale presentation version with zero mutation', async () => {
    const { service, metadata, presentations } = await disposable()
    presentations.save('curation-project', {
      presentationId: 'presentation-1',
      scopeId,
      capability: 'context',
      renderer: 'graph',
      state: { memberViewIds: [], hiddenViewIds: [], positions: {}, hierarchy: { parentByViewId: {}, orderByParent: {} }, presentationEdges: [], pinnedViewIds: [], emphasisByViewId: {} },
      expectedVersion: 0,
      updatedBy: 'web',
    })
    const first = await service.applyPatch('curation-project', {
      schemaVersion: 0,
      operationId: 'curation-pres-ok-1',
      projectId: 'curation-project',
      scopeId,
      createTexts: [{ clientRef: 'a', body: '甲' }],
      relations: [],
      presentation: {
        presentationId: 'presentation-1',
        expectedVersion: 0,
        addMembers: [{ clientRef: 'a' }],
      },
    } as never)
    expect(first.applied).toBe(true)
    expect(metadata.getArtifacts('curation-project')).toHaveLength(1)

    // 第二次用过期版本号 → 预验证失败，0 mutation
    const stale = await service.applyPatch('curation-project', {
      schemaVersion: 0,
      operationId: 'curation-pres-stale-1',
      projectId: 'curation-project',
      scopeId,
      createTexts: [{ clientRef: 'b', body: '乙' }],
      relations: [],
      presentation: {
        presentationId: 'presentation-1',
        expectedVersion: 0,
        addMembers: [{ clientRef: 'b' }],
      },
    } as never)
    expect(stale.applied).toBe(false)
    expect(stale.failedStep?.error).toContain('STALE_PRESENTATION_VERSION')
    expect(metadata.getArtifacts('curation-project')).toHaveLength(1)
  })

  it('persists failed receipt so retry with same operationId does not re-execute', async () => {
    const { service, metadata } = await disposable()
    const patch = {
      schemaVersion: 0,
      operationId: 'curation-fail-1',
      projectId: 'curation-project',
      scopeId,
      createTexts: [{ clientRef: 'x', body: '甲' }],
      relations: [],
    } as never
    // 先让预验证失败：scope 不存在
    const badScope = await service.applyPatch('curation-project', { ...patch, scopeId: 'scope-nope' })
    expect(badScope.applied).toBe(false)
    // 修正 scope 重试（同 operationId）→ 仍返回失败 receipt，不执行
    const retry = await service.applyPatch('curation-project', patch)
    expect(retry.applied).toBe(false)
    expect(metadata.getArtifacts('curation-project')).toHaveLength(0)
  })
})
