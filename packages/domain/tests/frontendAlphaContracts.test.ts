import { describe, expect, expectTypeOf, it } from 'vitest'
import {
  isTerminalRunStatus,
  resolveArtifactReturnPlacement,
  type ArtifactId,
  type ArtifactRevisionId,
  type ArtifactViewId,
  type Command,
  type NoteAnchor,
  type Run,
  type RunStatus,
  type ScopeId,
  type Workspace,
} from '../src/index'

const command = {
  id: 'command-1',
  projectId: 'project-1',
  workspaceId: 'workspace-1',
  instruction: 'Revise the proposal.',
  selectedObjectIds: ['artifact-context-1'],
  outputMode: 'new_revision',
  createdAt: '2026-07-20T00:00:00.000Z',
} as unknown as Command

const run = {
  id: 'run-dynamic-1',
  projectId: 'project-1',
  conversationId: 'conversation-1',
  commandId: 'command-1',
  contextSnapshotId: 'snapshot-1',
  executor: 'codex',
  status: 'review',
  createdAt: '2026-07-20T00:00:00.000Z',
  updatedAt: '2026-07-20T00:00:01.000Z',
} as unknown as Run

describe('Frontend Alpha domain contract', () => {
  it('uses Target → Working → Run → Pending Return placement precedence', () => {
    expect(resolveArtifactReturnPlacement(command, run)).toEqual({ zone: 'run', runId: 'run-dynamic-1' })

    const withWorking = { ...command, workingArtifactId: 'artifact-working-1' } as unknown as Command
    expect(resolveArtifactReturnPlacement(withWorking, run)).toEqual({ zone: 'working', artifactId: 'artifact-working-1' })

    const withTarget = { ...withWorking, targetArtifactId: 'artifact-target-1' } as unknown as Command
    expect(resolveArtifactReturnPlacement(withTarget, run)).toEqual({ zone: 'target', artifactId: 'artifact-target-1' })

    expect(resolveArtifactReturnPlacement(command)).toEqual({ zone: 'pending_return', workspaceId: 'workspace-1' })
  })

  it('marks only completed, failed, and cancelled runs terminal', () => {
    const statuses: readonly RunStatus[] = ['created', 'queued', 'running', 'waiting_input', 'completed', 'failed', 'cancelled']
    expect(statuses.filter(isTerminalRunStatus)).toEqual(['completed', 'failed', 'cancelled'])
  })

  it('keeps preview source explicit between fixture and runtime', () => {
    const preview = { artifactId: 'artifact-1', state: 'ready', kind: 'thumbnail', origin: 'fixture' } as const
    expect(preview.origin).toBe('fixture')
  })

  it('uses ArtifactView identity for workspace focus', () => {
    expectTypeOf<Workspace['focusedViewIds']>().toEqualTypeOf<readonly ArtifactViewId[]>()
    expectTypeOf<keyof Workspace>().not.toEqualTypeOf<'focusedNodeIds'>()
  })

  it('uses one discriminated NoteAnchor union without nullable anchor fields', () => {
    const anchors: readonly NoteAnchor[] = [
      { type: 'project' },
      { type: 'scope', scopeId: 'scope-1' as ScopeId },
      { type: 'artifact', artifactId: 'artifact-1' as ArtifactId },
      { type: 'artifact_view', viewId: 'view-1' as ArtifactViewId },
      { type: 'page', revisionId: 'revision-1' as ArtifactRevisionId, pageIndex: 0 },
    ]

    expect(anchors.map((anchor) => anchor.type)).toEqual([
      'project',
      'scope',
      'artifact',
      'artifact_view',
      'page',
    ])
  })
})
