import { randomUUID } from 'node:crypto'
import type {
  BindContinuitySessionV1,
  ContinuityAttachBundleV1,
  ContinuityResolveRequestV1,
  ContinuityResolveResultV1,
  ContinuityResumeSnapshotV1,
  ContinuityReturnIntakeV1,
  ContinuityReturnReceiptV1,
  ProjectEventOrigin,
} from '@local-creative-os/contracts'
import type { HandoffRecord, ProjectId, RunId, SessionSummary } from '@local-creative-os/domain'
import type { SqliteMetadataRepository } from './metadata-repository.js'
import type { AttentionRuntimeService } from './attention-runtime-service.js'
import type { RuntimeRegistryService } from './runtime-registry-service.js'
import type { ProjectEventHub } from './project-events/project-event-hub.js'
import { resolveProjectAffinity } from './project-affinity-service.js'

/**
 * B6 Project Continuity Runtime.
 * 只组合既有 Project Truth / WorkState / Session / Attention，不创建第二份连续性数据库。
 */
export class ContinuityRuntimeService {
  constructor(
    private readonly metadata: SqliteMetadataRepository,
    private readonly runtimeRegistry: RuntimeRegistryService,
    private readonly attentionRuntime: AttentionRuntimeService,
    private readonly events: ProjectEventHub,
  ) {}

  resolve(input: ContinuityResolveRequestV1): ContinuityResolveResultV1 {
    const projectRoots = this.metadata.listProjects().map((project) => ({ projectId: String(project.id), rootPath: project.rootPath }))
    const session = input.sessionId === undefined ? undefined : this.metadata.getSessionContextRef(input.sessionId)
    return resolveProjectAffinity(input, {
      projectRoots,
      registry: this.runtimeRegistry.getRegistry(),
      ...(session === undefined ? {} : {
        sessionBindings: [{
          sessionId: session.sessionId,
          projectId: session.projectId,
          source: 'agent_bind' as const,
          openedAt: session.updatedAt,
          ...(session.status === 'closed' ? { closedAt: session.updatedAt } : {}),
        }],
      }),
      now: input.capturedAt,
    })
  }

  async resume(projectId: string, input: {
    readonly workspaceId?: string | null
    readonly sessionId?: string
    readonly explicitAction?: string
    readonly tokenBudget?: number
  } = {}, signal?: AbortSignal): Promise<ContinuityResumeSnapshotV1> {
    const project = this.metadata.getProject(projectId)
    if (project === undefined) throw new Error('Project not found.')
    const workspaces = this.metadata.getWorkspaces(projectId)
    const workspaceId = input.workspaceId ?? null
    if (workspaceId !== null) {
      const workspace = this.metadata.getWorkspace(workspaceId)
      if (workspace === undefined || String(workspace.projectId) !== projectId) throw new Error('Workspace not found in project.')
    }

    const requestedSession = input.sessionId === undefined ? undefined : this.metadata.getSessionContextRef(input.sessionId)
    if (requestedSession !== undefined && requestedSession.projectId !== projectId) throw new Error('Session is bound to another project.')
    const attentionRuntime = await this.attentionRuntime.snapshot(projectId, {
      ...(workspaceId === null ? {} : { workspaceId }),
      ...(input.explicitAction?.trim() ? { explicitAction: input.explicitAction.trim() } : {}),
      ...(input.tokenBudget === undefined ? {} : { tokenBudget: input.tokenBudget }),
      ...(requestedSession?.selectedViewIds.length ? { seedViewIds: requestedSession.selectedViewIds } : {}),
    }, signal)
    const providerSessions = (['codex', 'workbuddy'] as const)
      .map((provider) => this.metadata.getProviderSessionBinding(projectId, provider))
      .filter((value): value is NonNullable<typeof value> => value !== undefined)
      .map((value) => ({
        provider: value.provider,
        externalSessionId: value.externalSessionId,
        status: value.status,
        lastSeenAt: value.lastSeenAt,
        ...(value.lastRunId === undefined ? {} : { lastRunId: value.lastRunId }),
      }))

    return {
      schemaVersion: 1,
      project: { id: String(project.id), name: project.name, rootPath: project.rootPath },
      workspaceId,
      workspaceCandidates: workspaces.map((workspace) => ({ id: String(workspace.id), name: workspace.name })),
      attentionRuntime,
      ...(requestedSession === undefined ? {} : { requestedSession }),
      recentSessions: this.metadata.listSessionContextRefs(projectId),
      providerSessions,
      realtime: { runtimeId: this.events.runtimeId, projectSeq: this.events.currentSeq(projectId) },
      generatedAt: new Date().toISOString(),
    }
  }

  async bindSession(input: BindContinuitySessionV1, origin?: ProjectEventOrigin): Promise<ContinuityResumeSnapshotV1> {
    const graph = this.metadata.get(input.projectId)
    if (graph === undefined) throw new Error('Project not found.')
    const workspaceId = input.workspaceId ?? null
    const snapshot = await this.attentionRuntime.snapshot(input.projectId, workspaceId === null ? {} : { workspaceId })
    const existing = this.metadata.getSessionContextRef(input.sessionId)
    const retrievalEntityRefs = [
      ...snapshot.attention.retrieved,
      ...snapshot.attention.related,
    ].flatMap((item) => item.artifactId === undefined ? [item.viewId] : [item.artifactId])
    this.metadata.upsertSessionContextRef({
      sessionId: input.sessionId,
      projectId: input.projectId,
      selectedViewIds: snapshot.workState.selectedViewIds,
      retrievalEntityRefs: [...new Set(retrievalEntityRefs)],
      sourceRefs: input.sourceRefs ?? existing?.sourceRefs ?? [],
      status: input.status ?? (existing?.status === 'working' || existing?.status === 'blocked' ? existing.status : 'idle'),
    })
    this.events.publish(input.projectId, {
      channel: 'continuity',
      type: 'continuity.changed',
      ...(origin === undefined ? {} : { origin }),
      entityRefs: workspaceId === null ? [] : [workspaceId],
      payload: { kind: 'session_bound', sessionId: input.sessionId, workspaceId },
    })
    return this.resume(input.projectId, { workspaceId, sessionId: input.sessionId })
  }

  intakeReturn(projectId: string, input: ContinuityReturnIntakeV1, origin?: ProjectEventOrigin): ContinuityReturnReceiptV1 {
    const project = this.metadata.getProject(projectId)
    if (project === undefined) throw new Error('Project not found.')
    if (input.title.trim() === '' || input.summary.trim() === '') throw new Error('Return intake requires title and summary.')

    const now = new Date().toISOString()
    for (const ref of input.artifactRefs ?? []) {
      const artifact = this.metadata.getArtifact(ref.artifactId)
      if (artifact === undefined || String(artifact.projectId) !== projectId) throw new Error(`Artifact return reference is outside project: ${ref.artifactId}`)
      if (ref.revisionId !== undefined) {
        const revision = this.metadata.getArtifactRevision(ref.revisionId)
        if (revision === undefined || String(revision.artifactId) !== ref.artifactId) throw new Error(`Revision does not belong to artifact: ${ref.revisionId}`)
      }
    }

    const summaryId = `session-summary-${randomUUID()}`
    const handoffId = `handoff-${randomUUID()}`
    const summary: SessionSummary = {
      id: summaryId,
      projectId: projectId as ProjectId,
      title: input.title.trim(),
      summary: input.summary.trim(),
      runIds: (input.runIds ?? []).map((id) => id as RunId),
      handoffRef: handoffId,
      createdAt: now,
      updatedAt: now,
    }
    const handoff: HandoffRecord = {
      id: handoffId,
      projectId: projectId as ProjectId,
      title: input.title.trim(),
      resumeMode: 'standard-handoff',
      ...(input.fromProvider?.trim() ? { fromProvider: input.fromProvider.trim() } : {}),
      ...(input.toProvider?.trim() ? { toProvider: input.toProvider.trim() } : {}),
      sessionSummaryId: summaryId,
      decisions: input.decisions ?? [],
      openQuestions: input.openQuestions ?? [],
      nextActions: input.nextActions ?? [],
      artifactRefs: (input.artifactRefs ?? []).map((ref) => ({
        artifactId: ref.artifactId as never,
        ...(ref.revisionId === undefined ? {} : { revisionId: ref.revisionId as never }),
      })),
      messageRefs: input.messageRefs ?? [],
      createdAt: now,
      updatedAt: now,
    }
    const existingSession = input.sessionId === undefined ? undefined : this.metadata.getSessionContextRef(input.sessionId)
    const sessionContext = existingSession !== undefined && existingSession.projectId === projectId
      ? {
          ...existingSession,
          sourceRefs: [
            ...existingSession.sourceRefs,
            ...(input.artifactRefs ?? []).map((ref) => ({ sourceType: 'artifact', sourceRef: ref.artifactId, observedAt: now })),
          ].slice(-100),
          status: 'idle' as const,
        }
      : undefined

    this.metadata.createContinuityReturnRecord({
      summary,
      handoff,
      ...(sessionContext === undefined ? {} : { sessionContext }),
    })

    this.events.publish(projectId, {
      channel: 'continuity',
      type: 'continuity.changed',
      ...(origin === undefined ? {} : { origin }),
      entityRefs: (input.artifactRefs ?? []).map((ref) => ref.artifactId),
      payload: { kind: 'return_intake', sessionId: input.sessionId ?? null, sessionSummaryId: summaryId, handoffId },
    })

    return {
      schemaVersion: 1,
      projectId,
      sessionSummaryId: summaryId,
      handoffId,
      ...(input.sessionId === undefined ? {} : { sessionId: input.sessionId }),
      createdAt: now,
    }
  }

  async attachBundle(projectId: string, input: {
    readonly workspaceId?: string | null
    readonly sessionId?: string
    readonly provider?: string
    readonly explicitAction?: string
    readonly tokenBudget?: number
  } = {}, signal?: AbortSignal): Promise<ContinuityAttachBundleV1> {
    const resume = await this.resume(projectId, input, signal)
    const session = input.sessionId === undefined ? undefined : this.metadata.getSessionContextRef(input.sessionId)
    return {
      schemaVersion: 1,
      projectId,
      workspaceId: resume.workspaceId,
      ...(input.sessionId === undefined ? {} : { sessionId: input.sessionId }),
      ...(input.provider?.trim() ? { provider: input.provider.trim() } : {}),
      intent: resume.attentionRuntime.intent,
      contextPack: resume.attentionRuntime.contextPack,
      skillTarget: resume.attentionRuntime.skillTarget,
      selectedViewIds: resume.attentionRuntime.workState.selectedViewIds,
      sourceRefs: session?.sourceRefs ?? [],
      generatedAt: new Date().toISOString(),
    }
  }
}
