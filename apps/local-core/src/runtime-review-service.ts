import { randomUUID } from 'node:crypto'

import type {
  AcceptArtifactReturnInput,
  AcceptArtifactReturnResult,
  RejectArtifactReturnResult,
  RetryRunInput,
  RetryRunResult,
  RunReview,
} from '@local-creative-os/contracts'
import type { ArtifactReturnId, JsonValue, Run, RunEvent, RunId, RuntimeDispatch } from '@local-creative-os/domain'

import { RuntimeLifecycleConflictError, SqliteMetadataRepository } from './metadata-repository.js'

export class RuntimeReviewService {
  /** F6 P0-A2（20260828）：accept 诞生/更新 artifact 即索引；缺省不 reindex。 */
  readonly #semantic: import('./semantic-index-service.js').SemanticIndexService | undefined
  /** F6 P0-D5（20260828）：accept 时把产出物化到 Run 关联的 ResultSlot。 */
  readonly #resultSlots: import('./result-slot-service.js').ResultSlotService | undefined
  /** F6 B6（P1-B census）：ResultSlot materialize 挂 parent Run 的 ChangeSet（accept 记账）。 */
  readonly #mutationSafety: import('./mutation-safety-service.js').MutationSafetyService | undefined

  constructor(
    private readonly repository: SqliteMetadataRepository,
    private readonly now: () => string = () => new Date().toISOString(),
    private readonly createId: () => string = randomUUID,
    semantic?: import('./semantic-index-service.js').SemanticIndexService,
    resultSlots?: import('./result-slot-service.js').ResultSlotService,
    mutationSafety?: import('./mutation-safety-service.js').MutationSafetyService,
  ) {
    this.#semantic = semantic
    this.#resultSlots = resultSlots
    this.#mutationSafety = mutationSafety
  }

  getRunReview(runId: RunId): RunReview {
    const run = this.repository.getRun(runId)
    const dispatch = this.repository.getRuntimeDispatch(runId)
    if (run === undefined || dispatch === undefined) throw new RuntimeLifecycleConflictError('Run review not found.')
    const binding = this.repository.getRuntimeBinding(runId)
    const returns = this.repository.getArtifactReturns(runId)
    const draftRevisions = returns.flatMap((artifactReturn) => {
      if (artifactReturn.draftRevisionId === undefined) return []
      const revision = this.repository.getArtifactRevision(String(artifactReturn.draftRevisionId))
      return revision === undefined ? [] : [revision]
    })
    const pending = returns.some((artifactReturn) => artifactReturn.status === 'pending_review')
    const disabledReason = pending ? undefined : 'no_pending_artifact_return'
    const inputRequest = this.repository.getPendingRunInputRequest(runId)
    return {
      run,
      dispatch,
      ...(binding === undefined ? {} : { binding }),
      returns,
      draftRevisions,
      ...(inputRequest === undefined ? {} : { inputRequest }),
      presentationPhase: pending ? 'review' : run.status,
      capabilities: {
        schemaVersion: 1,
        accept: { enabled: pending, ...(disabledReason === undefined ? {} : { reason: disabledReason }) },
        reject: { enabled: pending, ...(disabledReason === undefined ? {} : { reason: disabledReason }) },
        retry: { enabled: pending, ...(disabledReason === undefined ? {} : { reason: disabledReason }) },
      },
    }
  }

  accept(returnId: ArtifactReturnId, input: AcceptArtifactReturnInput): AcceptArtifactReturnResult {
    const result = this.repository.acceptArtifactReturn(returnId, input.expectedBaseRevisionId, this.now())
    this.emit(result.run.id, 'run.completed', { projectId: String(result.run.projectId), returnId: String(returnId) })
    // F6 P0-A2：accept 诞生/更新的 artifact 立即进索引（fire-and-forget，不阻塞 review 返回）。
    if (this.#semantic !== undefined) {
      void this.#semantic.reindexArtifact(String(result.run.projectId), String(result.artifactReturn.targetArtifactId))
    }
    // F6 P0-D5：Run 带 ResultSlot 时物化（绑定 canonical view；不复制节点；幂等）。
    if (this.#resultSlots !== undefined) {
      const slotId = this.repository.getRunResultSlotId(String(result.run.id))
      if (slotId !== undefined) {
        try {
          const views = this.repository.getArtifactViews(String(result.artifactReturn.targetArtifactId))
          const viewId = views[0]?.id
          if (viewId !== undefined) {
            const materialized = this.#resultSlots.materialize(slotId, String(result.run.id), String(result.artifactReturn.targetArtifactId), String(viewId))
            // F6 B6：materialize 挂 parent Run 的 ChangeSet（undo = 槽位回 review；record 在
            // accept 事务之后——与 curation createText 的 record() 模式一致，非复合事务）。
            if (this.#mutationSafety !== undefined) {
              this.#mutationSafety.record({
                projectId: String(result.run.projectId),
                operationId: `run-accept-${String(returnId)}`,
                actorKind: 'web',
                changes: [{
                  type: 'result_slot_materialize',
                  slotId,
                  runId: String(result.run.id),
                  ...(materialized.artifactId === undefined ? {} : { artifactId: String(materialized.artifactId) }),
                  ...(materialized.artifactViewId === undefined ? {} : { artifactViewId: String(materialized.artifactViewId) }),
                  inverse: { type: 'result_slot_restore', slotId, status: 'review' },
                  forward: {
                    type: 'result_slot_materialize',
                    slotId,
                    runId: String(result.run.id),
                    ...(materialized.artifactId === undefined ? {} : { artifactId: String(materialized.artifactId) }),
                    ...(materialized.artifactViewId === undefined ? {} : { artifactViewId: String(materialized.artifactViewId) }),
                  },
                  appliedFingerprint: `result-slot:${slotId}:materialized:${String(materialized.artifactViewId ?? '')}`,
                }],
              })
            }
          }
        } catch (error: unknown) {
          console.warn(`[result-slot] materialize failed for slot ${slotId}: ${error instanceof Error ? error.message : String(error)}`)
        }
      }
    }
    return result
  }

  reject(returnId: ArtifactReturnId): RejectArtifactReturnResult {
    const result = this.repository.rejectArtifactReturn(returnId, this.now())
    this.emit(result.run.id, 'run.completed', { projectId: String(result.run.projectId), returnId: String(returnId), rejected: true })
    return result
  }

  retry(returnId: ArtifactReturnId, input: RetryRunInput = {}): RetryRunResult {
    const artifactReturn = this.repository.getArtifactReturn(returnId)
    const previousRun = artifactReturn === undefined ? undefined : this.repository.getRun(artifactReturn.runId)
    if (artifactReturn === undefined || previousRun === undefined) {
      throw new RuntimeLifecycleConflictError('Retry lifecycle evidence is incomplete.')
    }
    const timestamp = this.now()
    const suffix = this.createId()
    const run: Run = {
      id: `run-${suffix}` as Run['id'],
      projectId: previousRun.projectId,
      ...(previousRun.workspaceId === undefined ? {} : { workspaceId: previousRun.workspaceId }),
      ...(previousRun.targetArtifactId === undefined ? {} : { targetArtifactId: previousRun.targetArtifactId }),
      ...(previousRun.targetRevisionId === undefined ? {} : { targetRevisionId: previousRun.targetRevisionId }),
      contextManifestId: previousRun.contextManifestId,
      retryOfRunId: previousRun.id,
      provider: previousRun.provider,
      requestedProvider: previousRun.requestedProvider,
      outputIntent: previousRun.outputIntent,
      returnGroupId: `return-group-${suffix}`,
      status: 'created',
      instruction: input.instruction?.trim() || previousRun.instruction,
      createdAt: timestamp,
      updatedAt: timestamp,
    }
    const dispatch: RuntimeDispatch = {
      id: `dispatch-${suffix}` as RuntimeDispatch['id'],
      runId: run.id,
      provider: run.provider,
      idempotencyKey: String(run.id),
      status: 'planned',
      attemptCount: 0,
      createdAt: timestamp,
      updatedAt: timestamp,
    }
    const result = this.repository.retryArtifactReturn(returnId, run, dispatch, timestamp)
    this.emit(run.id, 'run.retry_queued', { projectId: String(run.projectId), retryOfRunId: String(previousRun.id) })
    return result
  }

  private emit(runId: RunId, type: RunEvent['type'], payload: JsonValue = {}): void {
    this.repository.createRunEvent({
      id: `event-${randomUUID()}` as RunEvent['id'],
      runId,
      type,
      payload,
      occurredAt: this.now(),
    })
  }
}
