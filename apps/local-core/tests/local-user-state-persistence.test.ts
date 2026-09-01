import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { CommandDraftV1, ProviderSessionBindingV1 } from '@local-creative-os/contracts'
import { afterEach, describe, expect, it } from 'vitest'

import { ActiveContextStore } from '../src/active-context-store.js'
import { ContextProposalStore } from '../src/context-proposal-store.js'
import { SqliteMetadataRepository } from '../src/metadata-repository.js'
import { createMvpSampleSnapshot } from '../src/mvp-sample-project.js'

const cleanup: string[] = []
afterEach(async () => {
  for (const path of cleanup.splice(0)) void rm(path, { recursive: true, force: true }).catch(() => { /* best effort */ })
})

describe('Gate F local user state persistence', () => {
  it('persists Project + Workspace ActiveContext and CanvasContextSnapshot across Core restart', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'lcos-active-context-'))
    cleanup.push(directory)
    const databasePath = join(directory, 'metadata.sqlite')
    const graph = createMvpSampleSnapshot(join(directory, 'project'), '2026-08-04T00:00:00.000Z')
    const workspaceId = String(graph.workspaces[0]!.id)
    const first = graph.artifactViews[0]!
    const second = graph.artifactViews[1]!

    let metadata = new SqliteMetadataRepository(databasePath)
    metadata.save(graph)
    let store = new ActiveContextStore(metadata)
    const saved = store.update(String(graph.project.id), graph, {
      workspaceId,
      scopeId: String(first.scopeId),
      selectedViewIds: [String(first.id), String(second.id)],
      pinnedContextIds: [String(second.id)],
      excludedContextIds: [],
      viewport: { x: 32, y: 64, zoom: 0.8 },
      visibleViewIds: [String(first.id), String(second.id)],
      expectedVersion: 0,
      updatedBy: 'web',
    })
    expect(saved.workspaceId).toBe(workspaceId)
    expect(saved.nodes?.length).toBeGreaterThan(0)
    expect(saved.relations).toBeDefined()
    metadata.close()

    metadata = new SqliteMetadataRepository(databasePath)
    store = new ActiveContextStore(metadata)
    const restored = store.get(String(graph.project.id), graph, workspaceId)
    expect(restored.version).toBe(1)
    expect(restored.selectedViewIds).toEqual([String(first.id), String(second.id)])
    expect(restored.viewport).toEqual(expect.objectContaining({ x: 32, y: 64, zoom: 0.8 }))
    metadata.close()
  })

  it('persists CommandDraft, Context Proposal and Provider Session Binding', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'lcos-local-state-'))
    cleanup.push(directory)
    const databasePath = join(directory, 'metadata.sqlite')
    const graph = createMvpSampleSnapshot(join(directory, 'project'), '2026-08-04T00:00:00.000Z')
    const projectId = String(graph.project.id)
    const workspaceId = String(graph.workspaces[0]!.id)
    const viewId = String(graph.artifactViews[0]!.id)

    let metadata = new SqliteMetadataRepository(databasePath)
    metadata.save(graph)
    const draft: CommandDraftV1 = {
      schemaVersion: 1,
      projectId,
      workspaceId,
      composerAnchor: 'selection',
      surfaceKind: 'context',
      surfaceId: 'context:brief',
      prompt: '把开场缩短到三秒',
      contextViewIds: [viewId],
      selectionViewIds: [viewId],
      receiverId: 'connected-conversation-one',
      provider: 'codex',
      createAsNewNode: false,
      intent: 'revise',
      resultPolicy: 'draft_revision_per_target',
      updatedAt: '2026-08-04T00:01:00.000Z',
    }
    metadata.saveCommandDraft(draft)

    const activeStore = new ActiveContextStore(metadata)
    const active = activeStore.update(projectId, graph, {
      workspaceId,
      scopeId: String(graph.artifactViews[0]!.scopeId),
      selectedViewIds: [viewId],
      pinnedContextIds: [viewId],
      excludedContextIds: [],
      expectedVersion: 0,
      updatedBy: 'web',
    })
    const proposals = new ContextProposalStore(metadata)
    const proposal = proposals.create(projectId, {
      workspaceId,
      baseContextVersion: active.version,
      addViewIds: [],
      removeViewIds: [],
      targetViewId: viewId,
      reason: '用户明确要求把当前节点设为修改目标',
    }, active)

    const binding: ProviderSessionBindingV1 = {
      projectId,
      provider: 'codex',
      externalSessionId: 'session-codex-one',
      origin: 'watchdog',
      status: 'active',
      lastSeenAt: '2026-08-04T00:02:00.000Z',
      lastRunId: 'run-one',
      failureCount: 0,
      updatedAt: '2026-08-04T00:02:00.000Z',
    }
    metadata.saveProviderSessionBinding(binding)
    metadata.close()

    metadata = new SqliteMetadataRepository(databasePath)
    expect(metadata.getCommandDraft(projectId, workspaceId, 'selection')).toEqual(draft)
    expect(metadata.getContextProposal(projectId, proposal.proposalId)?.status).toBe('pending')
    expect(metadata.getProviderSessionBinding(projectId, 'codex')).toEqual(binding)
    metadata.close()
  })
})
