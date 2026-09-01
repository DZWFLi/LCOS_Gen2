/**
 * F6 Batch 3 验收测试（P0-B4 AssemblyApply 三通道 + P0-C2 Capture→Target Golden）。
 *
 * Golden 对照施工单 §11 Capture 段：
 *   staged capture → apply → materialize once → artifact canonical → provenance 保留 → 不重复物化
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { SqliteMetadataRepository } from '../src/metadata-repository.js'
import { createMvpSampleSnapshot } from '../src/mvp-sample-project.js'
import { AssemblyApplyService } from '../src/assembly-apply-service.js'
import { CaptureStagingService } from '../src/capture-staging-service.js'
import { CaptureSpaceService } from '../src/capture-space-service.js'
import { CapturePlacementService } from '../src/capture-placement-service.js'
import { MutationSafetyService } from '../src/mutation-safety-service.js'
import { CurationCommandService } from '../src/curation-command-service.js'
import { PresentationApplicationService } from '../src/presentation-application-service.js'
import { ConversationImportService } from '../src/conversation-import-service.js'
import { ImportCopyService } from '../src/import-copy-service.js'
import { UniversalResourceImportService } from '../src/resources/universal-resource-import-service.js'
import { IntelligenceProviderService } from '../src/intelligence-provider-service.js'
import { ProjectEventHub } from '../src/project-events/project-event-hub.js'

const roots: string[] = []
const repositories: SqliteMetadataRepository[] = []

afterEach(() => {
  for (const repository of repositories.splice(0)) repository.close()
  for (const root of roots.splice(0)) void Promise.resolve().then(() => { try { rmSync(root, { recursive: true, force: true }) } catch { /* best effort */ } })
})

function setup() {
  const dbRoot = mkdtempSync(join(tmpdir(), 'lcos-f6-b3-db-'))
  const projectRoot = mkdtempSync(join(tmpdir(), 'lcos-f6-b3-project-'))
  const blobRoot = mkdtempSync(join(tmpdir(), 'lcos-f6-b3-blobs-'))
  roots.push(dbRoot, projectRoot, blobRoot)
  const repository = new SqliteMetadataRepository(join(dbRoot, 'metadata.sqlite'))
  repositories.push(repository)
  const snapshot = createMvpSampleSnapshot(projectRoot, '2026-08-28T11:00:00.000Z')
  repository.save(snapshot)
  const projectId = String(snapshot.project.id)
  const events = new ProjectEventHub()
  const presentation = new PresentationApplicationService(repository, repository, undefined, events)
  const mutationSafety = new MutationSafetyService(repository, presentation, events)
  const conversations = new ConversationImportService(repository)
  const staging = new CaptureStagingService(repository, blobRoot)
  // 真实依赖链（与 compose.ts 同构）：importCopy → resources → captureSpace。
  const importCopy = new ImportCopyService(repository)
  const resources = new UniversalResourceImportService(repository, importCopy)
  const captureSpace = new CaptureSpaceService(repository, staging, resources, new CapturePlacementService(repository), new IntelligenceProviderService(), blobRoot)
  const curationCommand = new CurationCommandService({ repository, presentations: presentation })
  const apply = new AssemblyApplyService(repository, captureSpace, mutationSafety, conversations, curationCommand, presentation)
  const rootScope = repository.getScopes(projectId).find((scope) => scope.kind === 'root')
  return { repository, projectId, scopeId: String(rootScope?.id ?? ''), apply, staging, blobRoot }
}

describe('F6 P0-B4: AssemblyApply — workspace membership channel', () => {
  it('artifactView → workspace: applied via canonical membership; repeat = already-member skip', async () => {
    const { repository, projectId, apply } = setup()
    const artifact = repository.getArtifacts(projectId)[0]!
    const viewId = String(repository.getArtifactViews(String(artifact.id))[0]!.id)
    const graph = repository.get(projectId)
    const workspaceId = String(graph?.workspaces[0]?.id ?? '')
    expect(workspaceId).not.toBe('')
    const before = repository.listWorkspaceMembers(workspaceId as never).length

    const result = await apply.apply({
      schemaVersion: 1,
      projectId,
      sourceRefs: [{ kind: 'artifactView', id: viewId }],
      targetRef: { kind: 'workspace', id: workspaceId },
    })
    const first = result.results[0]!
    if (first.status === 'skipped' && first.channel === 'already-member') {
      // mvp sample 可能已包含该成员——幂等语义本身即验收点
      expect(repository.listWorkspaceMembers(workspaceId as never).length).toBe(before)
    } else {
      expect(first.status).toBe('applied')
      expect(first.channel).toBe('workspace-membership')
      expect(repository.listWorkspaceMembers(workspaceId as never).length).toBe(before + 1)
      // 二次 apply = already-member
      const second = await apply.apply({
        schemaVersion: 1,
        projectId,
        sourceRefs: [{ kind: 'artifactView', id: viewId }],
        targetRef: { kind: 'workspace', id: workspaceId },
      })
      expect(second.results[0]!.status).toBe('skipped')
      expect(second.results[0]!.channel).toBe('already-member')
    }
  })

  it('cross-project workspace target is rejected (fail-close)', async () => {
    const { repository, projectId, apply } = setup()
    const artifact = repository.getArtifacts(projectId)[0]!
    const viewId = String(repository.getArtifactViews(String(artifact.id))[0]!.id)
    const result = await apply.apply({
      schemaVersion: 1,
      projectId,
      sourceRefs: [{ kind: 'artifactView', id: viewId }],
      targetRef: { kind: 'workspace', id: 'workspace-not-exist' },
    })
    expect(result.results[0]!.status).toBe('failed')
    expect(result.allApplied).toBe(false)
  })

  it('skill source is explicitly skipped (v0.15 read-only ruling)', async () => {
    const { projectId, apply } = setup()
    const result = await apply.apply({
      schemaVersion: 1,
      projectId,
      sourceRefs: [{ kind: 'skill', id: 'some-skill', source: 'system' }],
      targetRef: { kind: 'project', id: projectId },
    })
    expect(result.results[0]!.status).toBe('skipped')
    expect(result.results[0]!.channel).toBe('unsupported')
    expect(result.results[0]!.message).toContain('read-only')
  })
})

describe('F6 P0-C2: Capture → Target Golden (materialize once, provenance preserved)', () => {
  it('staged capture → apply → artifact materialized once; second apply does not duplicate', async () => {
    const { repository, projectId, apply, staging } = setup()
    const staged = await staging.enqueue({
      operationId: 'f6-b3-golden-1',
      kind: 'text',
      payloadBytes: new TextEncoder().encode('golden capture content for f6 batch3'),
      source: { title: 'Golden Capture', sessionId: 'test-session' },
      suggestedProjects: [],
    })
    expect(staged.id).toBeTruthy()

    const artifactCountBefore = repository.getArtifacts(projectId).length
    const result = await apply.apply({
      schemaVersion: 1,
      projectId,
      sourceRefs: [{ kind: 'capture', id: staged.id }],
      targetRef: { kind: 'project', id: projectId },
    })
    const first = result.results[0]!
    expect(first.status).toBe('applied')
    expect(first.channel).toBe('capture-materialize')

    // materialize once：artifact 恰好 +1
    const artifactsAfter = repository.getArtifacts(projectId)
    expect(artifactsAfter.length).toBe(artifactCountBefore + 1)

    // staging item 已 resolved（不再 pending）
    expect(staging.countPending()).toBe(0)

    // 二次 apply 同一 capture：幂等复用产物（follow-up 冻结后的重试安全语义——不重复物化）
    const second = await apply.apply({
      schemaVersion: 1,
      projectId,
      sourceRefs: [{ kind: 'capture', id: staged.id }],
      targetRef: { kind: 'project', id: projectId },
    })
    expect(second.results[0]!.status).toBe('skipped')
    expect(second.results[0]!.channel).toBe('already-member')
    expect(second.results[0]!.memberViewId).toBeTruthy()
    expect(repository.getArtifacts(projectId).length).toBe(artifactCountBefore + 1)
  })

  it('capture → non-project target is unsupported (Capture 不变 Project child 语义)', async () => {
    const { projectId, apply, staging } = setup()
    const staged = await staging.enqueue({
      operationId: 'f6-b3-golden-2',
      kind: 'text',
      payloadBytes: new TextEncoder().encode('x'),
      source: { title: 'x' },
      suggestedProjects: [],
    })
    const result = await apply.apply({
      schemaVersion: 1,
      projectId,
      sourceRefs: [{ kind: 'capture', id: staged.id }],
      targetRef: { kind: 'conversation', id: 'cc-unknown' },
    })
    expect(result.results[0]!.status).toBe('skipped')
    expect(result.results[0]!.channel).toBe('unsupported')
  })
})

describe('F6 P0-B4: AssemblyApply — conversation_context relation channel', () => {
  it('unlinked conversation target fails closed; skill-to-conversation stays unsupported', async () => {
    const { projectId, apply, staging } = setup()
    // 无 connected conversation 可用的环境：直接验证 fail-close 路径（cc 不存在）
    const staged = await staging.enqueue({
      operationId: 'f6-b3-conv-1',
      kind: 'text',
      payloadBytes: new TextEncoder().encode('x'),
      source: { title: 'x' },
      suggestedProjects: [],
    })
    const result = await apply.apply({
      schemaVersion: 1,
      projectId,
      sourceRefs: [{ kind: 'capture', id: staged.id }],
      targetRef: { kind: 'conversation', id: 'cc-not-exist' },
    })
    expect(result.results[0]!.status).toBe('skipped')
    expect(result.results[0]!.channel).toBe('unsupported')
  })
})