import { randomUUID } from 'node:crypto'
import { dirname } from 'node:path'
import { mkdir, rename, rm } from 'node:fs/promises'
import type {
  MutationChangeItemV1,
  MutationChangeSetV1,
  PrepareRevisionRequestV1,
  PreparedRevisionWorkflowV1,
  ProjectEventOrigin,
} from '@local-creative-os/contracts'
import type { Artifact, ProjectId, Relation, WorkspaceId } from '@local-creative-os/domain'
import type { SqliteMetadataRepository } from './metadata-repository.js'
import type { ProjectEventHub } from './project-events/project-event-hub.js'
import { buildTextArtifactDraft } from './text-artifact-service.js'
import { proposeRun } from './runtime-proposal-service.js'

function relationSnapshot(relation: Relation) {
  return {
    sourceEntityType: String(relation.sourceEntityType),
    sourceEntityId: String(relation.sourceEntityId),
    targetEntityType: String(relation.targetEntityType),
    targetEntityId: String(relation.targetEntityId),
    kind: relation.kind,
    ...(relation.origin === undefined ? {} : { origin: relation.origin }),
    ...(relation.createdBy === undefined ? {} : { createdBy: relation.createdBy }),
    ...(relation.evidenceRefs === undefined ? {} : { evidenceRefs: relation.evidenceRefs }),
    ...(relation.confidence === undefined ? {} : { confidence: relation.confidence }),
  }
}

function makeRelation(projectId: string, sourceArtifactId: string, targetArtifactId: string, kind: string, now: string): Relation {
  return {
    id: `relation-${randomUUID()}` as Relation['id'],
    projectId: projectId as Relation['projectId'],
    sourceEntityType: 'artifact',
    sourceEntityId: sourceArtifactId,
    targetEntityType: 'artifact',
    targetEntityId: targetArtifactId,
    kind,
    origin: 'user',
    createdBy: 'feedback-revision',
    confidence: 1,
    createdAt: now,
    updatedAt: now,
  }
}

function bulletList(items: readonly string[], empty: string): string {
  const cleaned = items.map((item) => item.trim()).filter(Boolean)
  return cleaned.length === 0 ? `- ${empty}` : cleaned.map((item) => `- ${item}`).join('\n')
}

/**
 * B5：把散落 Feedback 收口成“决策 + 修改请求 + 可执行 revise proposal”。
 *
 * Project Truth 仍是 Artifact / Relation / Revision / Run：
 * - 决策与修改请求是 managed Markdown Artifact，可进入 Context/Attention。
 * - Relation 是一等项目关系。
 * - 真正修改目标仍复用现有 Run -> Draft Revision -> Accept -> Version。
 */
export class FeedbackRevisionService {
  constructor(
    private readonly metadata: SqliteMetadataRepository,
    private readonly events?: ProjectEventHub,
  ) {}

  async prepare(
    projectId: string,
    input: PrepareRevisionRequestV1,
    origin?: ProjectEventOrigin,
  ): Promise<PreparedRevisionWorkflowV1> {
    const project = this.metadata.getProject(projectId)
    const graph = this.metadata.get(projectId)
    if (project === undefined || graph === undefined) throw new Error('Project not found.')
    if (!graph.scopes.some((scope) => String(scope.id) === input.scopeId)) throw new Error('Scope not found in project.')
    if (input.workspaceId !== undefined) {
      const workspace = this.metadata.getWorkspace(input.workspaceId)
      if (workspace === undefined || String(workspace.projectId) !== projectId) throw new Error('Workspace not found in project.')
    }

    const target = this.metadata.getArtifact(input.targetArtifactId)
    if (target === undefined || String(target.projectId) !== projectId) throw new Error('Target artifact not found in project.')
    const baseRevisionId = input.baseRevisionId ?? (target.currentRevisionId === undefined ? undefined : String(target.currentRevisionId))
    if (baseRevisionId === undefined) throw new Error('Target artifact has no current revision.')
    const baseRevision = this.metadata.getArtifactRevision(baseRevisionId)
    if (baseRevision === undefined || String(baseRevision.artifactId) !== input.targetArtifactId) throw new Error('Base revision does not belong to target artifact.')

    const feedbackArtifacts: Artifact[] = []
    for (const artifactId of input.feedbackArtifactIds) {
      const artifact = this.metadata.getArtifact(artifactId)
      if (artifact === undefined || String(artifact.projectId) !== projectId || artifact.currentRevisionId === undefined) {
        throw new Error(`Feedback artifact is unavailable: ${artifactId}`)
      }
      feedbackArtifacts.push(artifact)
    }
    if (feedbackArtifacts.length === 0) throw new Error('At least one feedback artifact is required.')
    if (input.decision.trim() === '') throw new Error('Decision is required.')
    if (input.changeItems.map((item) => item.trim()).filter(Boolean).length === 0) throw new Error('At least one change item is required.')

    const now = new Date().toISOString()
    const targetTitle = target.title?.trim() || input.targetArtifactId
    const decisionBody = [
      `# 决策｜${targetTitle}`,
      '',
      input.decision.trim(),
      '',
      '## 必须保留',
      bulletList(input.preserveItems, '未额外声明'),
      '',
      '## 来源反馈',
      ...feedbackArtifacts.map((artifact) => `- ${artifact.title || String(artifact.id)} (${String(artifact.id)})`),
      '',
      `> 目标：${targetTitle} (${input.targetArtifactId})`,
      `> 基础版本：${baseRevisionId}`,
    ].join('\n')
    const changeRequestBody = [
      `# 修改请求｜${targetTitle}`,
      '',
      '## 要修改',
      bulletList(input.changeItems, '无'),
      '',
      '## 必须保留',
      bulletList(input.preserveItems, '未额外声明'),
      '',
      '## 已确认决策',
      input.decision.trim(),
      '',
      `> 修改目标：${targetTitle} (${input.targetArtifactId})`,
      `> 基础版本：${baseRevisionId}`,
    ].join('\n')

    const decisionDraft = await buildTextArtifactDraft(this.metadata, projectId as ProjectId, {
      title: `决策 · ${targetTitle}`,
      body: decisionBody,
      scopeId: input.scopeId,
      ...(input.workspaceId === undefined ? {} : { workspaceId: input.workspaceId }),
      x: 120,
      y: 120,
    })
    const requestDraft = await buildTextArtifactDraft(this.metadata, projectId as ProjectId, {
      title: `修改请求 · ${targetTitle}`,
      body: changeRequestBody,
      scopeId: input.scopeId,
      ...(input.workspaceId === undefined ? {} : { workspaceId: input.workspaceId }),
      x: 420,
      y: 120,
    })

    const relations: Relation[] = [
      ...feedbackArtifacts.map((artifact) => makeRelation(projectId, String(artifact.id), String(requestDraft.artifact.id), 'feedback', now)),
      makeRelation(projectId, String(decisionDraft.artifact.id), input.targetArtifactId, 'decision', now),
      makeRelation(projectId, String(requestDraft.artifact.id), input.targetArtifactId, 'change_request', now),
      makeRelation(projectId, String(decisionDraft.artifact.id), String(requestDraft.artifact.id), 'governs', now),
    ]

    const relationChanges: MutationChangeItemV1[] = relations.map((relation) => ({
      type: 'relation_upsert',
      relationId: String(relation.id),
      inverse: { type: 'delete_relation', relationId: String(relation.id) },
      forward: { type: 'restore_relation', relationId: String(relation.id), relation: relationSnapshot(relation) },
      // New relation IDs are unique. Safe undo also verifies the relation still exists;
      // later direct edits get their own ChangeSet and block stale undo through relation history.
      appliedFingerprint: `relation:${String(relation.id)}:applied`,
    }))
    const changeSet: MutationChangeSetV1 = {
      schemaVersion: 1,
      id: `changeset-feedback-${randomUUID()}`,
      projectId,
      operationId: origin?.operationId ?? `feedback-revision-${randomUUID()}`,
      actorKind: 'web',
      ...(origin?.clientId === undefined ? {} : { actorId: origin.clientId }),
      changes: relationChanges,
      status: 'applied',
      createdAt: now,
    }

    try {
      this.metadata.runCurationMutation({
        projectId,
        textCreates: [
          {
            fileRecord: decisionDraft.fileRecord,
            artifact: decisionDraft.artifact,
            revision: decisionDraft.revision,
            view: decisionDraft.view,
            ...(input.workspaceId === undefined ? {} : { workspaceId: input.workspaceId as WorkspaceId }),
          },
          {
            fileRecord: requestDraft.fileRecord,
            artifact: requestDraft.artifact,
            revision: requestDraft.revision,
            view: requestDraft.view,
            ...(input.workspaceId === undefined ? {} : { workspaceId: input.workspaceId as WorkspaceId }),
          },
        ],
        relationUpserts: relations,
        changeSet,
      })
    } catch (error) {
      await Promise.all([
        rm(decisionDraft.stagedPath, { force: true }).catch(() => undefined),
        rm(requestDraft.stagedPath, { force: true }).catch(() => undefined),
      ])
      throw error
    }

    for (const draft of [decisionDraft, requestDraft]) {
      try {
        await mkdir(dirname(draft.finalPath), { recursive: true })
        await rename(draft.stagedPath, draft.finalPath)
      } catch {
        console.warn(`[feedback-revision] staged file rename deferred: ${draft.stagedPath}`)
      }
    }

    const contextItems = [
      ...feedbackArtifacts.map((artifact, order) => ({
        artifactId: String(artifact.id),
        revisionId: String(artifact.currentRevisionId),
        order,
      })),
      {
        artifactId: String(decisionDraft.artifact.id),
        revisionId: String(decisionDraft.revision.id),
        order: feedbackArtifacts.length,
      },
      {
        artifactId: String(requestDraft.artifact.id),
        revisionId: String(requestDraft.revision.id),
        order: feedbackArtifacts.length + 1,
      },
    ]
    const proposal = proposeRun({
      projectId,
      ...(input.workspaceId === undefined ? {} : { workspaceId: input.workspaceId }),
      prompt: changeRequestBody,
      intent: 'revise',
      requestedProvider: input.requestedProvider?.trim() || 'auto',
      contextItems,
      editTargets: [{ artifactId: input.targetArtifactId, baseRevisionId }],
      resultPolicy: { type: 'draft_revision_per_target' },
      decisionSource: 'fallback',
    })

    this.events?.publish(projectId, {
      channel: 'mutation',
      type: 'feedback_revision.changed',
      ...(origin === undefined ? {} : { origin }),
      entityRefs: [
        input.targetArtifactId,
        String(decisionDraft.artifact.id),
        String(requestDraft.artifact.id),
        ...feedbackArtifacts.map((artifact) => String(artifact.id)),
      ],
      payload: {
        targetArtifactId: input.targetArtifactId,
        baseRevisionId,
        decisionArtifactId: String(decisionDraft.artifact.id),
        changeRequestArtifactId: String(requestDraft.artifact.id),
        changeSetId: changeSet.id,
      },
    })
    this.events?.publish(projectId, {
      channel: 'mutation',
      type: 'change_set.changed',
      ...(origin === undefined ? {} : { origin }),
      payload: { changeSetId: changeSet.id, status: changeSet.status },
    })

    return {
      schemaVersion: 1,
      projectId,
      targetArtifactId: input.targetArtifactId,
      baseRevisionId,
      feedbackArtifactIds: feedbackArtifacts.map((artifact) => String(artifact.id)),
      decisionArtifactId: String(decisionDraft.artifact.id),
      decisionViewId: decisionDraft.viewId,
      changeRequestArtifactId: String(requestDraft.artifact.id),
      changeRequestViewId: requestDraft.viewId,
      relationIds: relations.map((relation) => String(relation.id)),
      changeSetId: changeSet.id,
      proposal,
      createdAt: now,
    }
  }
}
