import { randomUUID } from 'node:crypto'

import type { AnswerRunInputRequestV1, CompiledContextPromptV1, ContextCacheTelemetryV1, ContinuityAttachBundleV1, ContextManifestOrderedItemV0, RunReview } from '@local-creative-os/contracts'
import type { JsonValue, ProjectId, Run, RunEvent, RunId, RunResultPolicy, RuntimeDispatch } from '@local-creative-os/domain'
import type { RuntimeProviderStatus } from '@local-creative-os/contracts'

import { ContextManifestService } from './context-manifest-service.js'
import type { ContinuityRuntimeService } from './continuity-runtime-service.js'
import { SqliteMetadataRepository } from './metadata-repository.js'
import { runtimeConstraintsForOutputIntent, RuntimeAdapterError, RuntimeAdapterService, type RuntimeProviderError } from './runtime-adapter.js'
import { compileContextPromptV1, contextCacheTelemetryV1, type ContextPromptManifestSourceV1 } from './context-prompt-serializer.js'
import { RuntimeResultIngestionService } from './runtime-result-ingestion.js'
import { RuntimeReviewService } from './runtime-review-service.js'
import type { SessionLifecycleService } from './session-lifecycle-service.js'
import { ResourceMatcher } from './resources/resource-matcher.js'

export interface CreateRuntimeRunInput {
  readonly instruction: string
  readonly targetArtifactId?: string
  readonly targetRevisionId?: string
  readonly contextArtifactIds?: readonly string[]
  /** Saved Context scope used as cache-stable baseline; no GUI cache concept is exposed. */
  readonly savedContextId?: string
  readonly workspaceId?: string
  readonly outputIntent: 'create' | 'revise' | 'analyze'
  readonly resultPolicy?: RunResultPolicy
  readonly requestedProvider?: 'workbuddy' | 'codex' | 'auto'
  /** B6 Continuity：Run 归属的 LCOS 会话（Session Binding / Attach / Return 的锚点）。 */
  readonly sessionId?: string
  /** F6 P0-D1（20260828）：canonical receiver——Core 解析 ConnectedConversation 身份桥；未 link 的 Glyth fail-close。 */
  readonly receiverRef?: { readonly connectedConversationId: string }
  /** F6 P0-D2：heterogeneous ordered references（artifact/view/scope/workspace/conversation/component）。 */
  readonly orderedReferences?: readonly import('@local-creative-os/contracts').OrderedRunReferenceV2[]
  /** F6 P0-D5：Run 产出物化到的结果槽位。 */
  readonly resultSlotId?: string
}

export interface RuntimeRunActionResult {
  readonly review: RunReview
  readonly providerError?: RuntimeProviderError
}

export class RuntimeApplicationService {
  constructor(
    private readonly repository: SqliteMetadataRepository,
    private readonly manifests: ContextManifestService,
    private readonly adapter: RuntimeAdapterService,
    private readonly ingestion: RuntimeResultIngestionService,
    private readonly review: RuntimeReviewService,
    private readonly now: () => string = () => new Date().toISOString(),
    private readonly createId: () => string = randomUUID,
    private readonly matcher: ResourceMatcher = new ResourceMatcher(),
  ) {}

  #continuity: ContinuityRuntimeService | undefined = undefined

  /** 由 compose 在 continuity runtime 构建完成后注入；Server 层运行时不直接构造。 */
  attachContinuity(continuity: ContinuityRuntimeService): void {
    this.#continuity = continuity
  }

  #sessionLifecycle: SessionLifecycleService | undefined = undefined

  /** Phase 5 Live Session Binding：compose 注入；run 状态与桥错误驱动会话七态。 */
  attachSessionLifecycle(service: SessionLifecycleService): void {
    this.#sessionLifecycle = service
  }

  async create(projectId: ProjectId, input: CreateRuntimeRunInput): Promise<RuntimeRunActionResult> {
    const instruction = input.instruction.trim()
    if (instruction.length === 0) throw new Error('Run instruction is required.')
    const outputIntent = input.outputIntent
    if (outputIntent === undefined) throw new Error('Run outputIntent is required (create|revise|analyze).')
    if (outputIntent !== 'revise' && input.targetArtifactId !== undefined) {
      throw new Error(`${outputIntent} 不允许指定修改目标；只有 revise 可以绑定 Target。`)
    }
    if (outputIntent === 'revise' && input.targetArtifactId === undefined) throw new Error('Revise Run requires an explicit target Artifact.')
    if (outputIntent !== 'revise' && input.targetRevisionId !== undefined) {
      throw new Error(`${outputIntent} 不允许指定 Base Revision；只有 revise 可以绑定 Base Revision。`)
    }
    if (outputIntent === 'revise' && input.targetArtifactId !== undefined) {
      const target = this.repository.getArtifact(String(input.targetArtifactId))
      if (target !== undefined && target.managed === false) {
        throw new Error('外部 Reference 不能作为修改目标；只有受管 Artifact 可以 revise。')
      }
    }
    if (outputIntent === 'analyze' && input.resultPolicy !== undefined
      && !['reply_only', 'create_artifact'].includes(input.resultPolicy.type)) {
      throw new Error('analyze 的结果去向只能是直接回复或创建分析 Artifact。')
    }
    if (outputIntent === 'create' && input.resultPolicy !== undefined
      && !['create_artifact', 'create_collection'].includes(input.resultPolicy.type)) {
      throw new Error('create 的结果去向只能是新建 Artifact 或内容集合。')
    }
    if (outputIntent === 'revise' && input.resultPolicy !== undefined
      && input.resultPolicy.type !== 'draft_revision_per_target') {
      throw new Error('revise 的结果去向只能是每个目标生成新 Draft Revision。')
    }
    const descriptors = this.repository.listResourceDescriptors(String(projectId))
    const policyByResourceId = new Map(descriptors.map((descriptor) => [
      descriptor.resourceId,
      this.repository.getResourcePolicy(String(projectId), descriptor.resourceId) ?? { approvedContext: false, executable: false },
    ]))
    const matches = this.matcher.match(descriptors, {
      projectId: String(projectId),
      instruction,
      outputIntent,
      limit: 8,
    }, {
      ...(input.contextArtifactIds === undefined ? {} : { activeContextArtifactIds: input.contextArtifactIds }),
      policyByResourceId,
    })
    const resourceRefs = this.matcher.toManifestRefs(matches.filter((match) => match.layer !== 'suggested'), descriptors)
    const continuityBundle = await this.#continuityBundle(projectId, input)
    const continuityItems: ContextManifestOrderedItemV0[] = continuityBundle === undefined
      ? []
      : continuityBundle.contextPack.items.map((item, index) => ({
          role: 'context' as const,
          identity: `continuity:${item.viewId}:${index}`,
          title: item.title,
          ...(item.content === undefined ? {} : { content: item.content }),
        }))
    const stableContextItems = input.savedContextId === undefined
      ? []
      : this.#savedContextItems(projectId, input.savedContextId)
    const manifest = await this.manifests.build(projectId, {
      ...(input.targetArtifactId === undefined ? {} : { targetArtifactId: input.targetArtifactId }),
      ...(input.targetRevisionId === undefined ? {} : { targetRevisionId: input.targetRevisionId }),
      ...(input.contextArtifactIds === undefined ? {} : { contextArtifactIds: input.contextArtifactIds }),
      ...(input.savedContextId === undefined ? {} : { savedContextId: input.savedContextId }),
      ...(stableContextItems.length === 0 ? {} : { stableContextItems }),
      promptRouteId: `runtime.${outputIntent}@v1`,
      capabilityProfileId: 'runtime-input-pack-v0+bridge-task-v1',
      requestedOutput: 'Markdown Script Revision',
      ...(resourceRefs.length === 0 ? {} : { resourceRefs }),
      ...(continuityItems.length === 0 ? {} : { extraItems: continuityItems }),
    })
    if (outputIntent === 'revise' && (manifest.target === null || manifest.currentRevision === null)) {
      throw new Error('Run target must have a Current Revision.')
    }
    const timestamp = this.now()
    const suffix = this.createId()
    const requestedProvider = input.requestedProvider ?? 'workbuddy'
    const autoProvider = (await this.providers()).find((entry) =>
          entry.executionMode === 'automatic' && entry.availability === 'ready'
          && (entry.provider === 'codex' || entry.provider === 'workbuddy'))
    const provider: Run['provider'] = requestedProvider === 'auto'
      ? (autoProvider?.provider === 'codex' ? 'codex' : 'workbuddy')
      : requestedProvider
    const run: Run = {
      id: `run-${suffix}` as Run['id'],
      projectId,
      ...(input.workspaceId === undefined ? {} : { workspaceId: input.workspaceId as NonNullable<Run['workspaceId']> }),
      ...(manifest.target === null ? {} : { targetArtifactId: manifest.target.artifactId as NonNullable<Run['targetArtifactId']> }),
      ...(manifest.currentRevision === null ? {} : { targetRevisionId: manifest.currentRevision.revisionId as NonNullable<Run['targetRevisionId']> }),
      contextManifestId: manifest.id,
      provider,
      requestedProvider: provider,
      outputIntent,
      returnGroupId: `return-group-${suffix}`,
      ...(input.resultPolicy === undefined ? {} : { resultPolicy: input.resultPolicy }),
      status: 'created',
      instruction,
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
    this.repository.createRunWithDispatch(run, dispatch)
    // ---- F6 P0-D（20260828）：Composer 三列落地（receiver / ordered refs / result slot）----
    // P0-D1：receiverRef 由 Core 解析——linked 的 ConnectedConversation 提供 canonical session；
    // 未 link = fail-close（不伪造 session，不回退猜测）。receiverRef 与显式 sessionId 并存时后者优先。
    let effectiveSessionId = input.sessionId
    if (input.receiverRef !== undefined) {
      const connected = this.repository.getConnectedConversation(String(projectId), input.receiverRef.connectedConversationId)
      if (connected === undefined) throw new Error('ReceiverRef resolved to no connected conversation (fail-close).')
      const linkedSessionId = connected.conversationSessionId
      if (effectiveSessionId === undefined && linkedSessionId !== undefined) effectiveSessionId = linkedSessionId
      this.repository.setRunComposerFields(String(run.id), { receiverConversationId: input.receiverRef.connectedConversationId })
    }
    // P0-D2：orderedReferences 持久化（Core 冻结时的输入快照；manifest 仍走既有 build）。
    if (input.orderedReferences !== undefined && input.orderedReferences.length > 0) {
      this.repository.setRunComposerFields(String(run.id), { orderedReferencesJson: JSON.stringify(input.orderedReferences) })
    }
    this.emit(run.id, 'run.queued', { outputIntent, projectId: String(projectId), ...(effectiveSessionId === undefined ? {} : { sessionId: effectiveSessionId }) })
    const createdReview = this.review.getRunReview(run.id)
    this.#observeSessionLifecycle(createdReview)
    return { review: createdReview }
  }

  /**
   * 用户 Accept Artifact Return（Run 真正 completed）后的 authoritative continuity intake。
   * 幂等：同一 Run 只生成一次 SessionSummary / Handoff；无 session / 未 completed / retry / failed 不产生。
   */
  async intakeContinuityReturn(runId: RunId): Promise<void> {
    const continuity = this.#continuity
    if (continuity === undefined) return
    const run = this.repository.getRun(runId)
    if (run === undefined || run.status !== 'completed') return
    const sessionId = this.#sessionIdForRun(runId)
    if (sessionId === undefined) return
    const alreadyIntaken = this.repository.listSessionSummaries(run.projectId)
      .some((summary) => summary.runIds.some((id) => String(id) === String(runId)))
    if (alreadyIntaken) return
    const artifactRefs = this.repository.getArtifactReturns(run.id)
      .filter((item) => item.status !== 'rejected')
      .map((item) => ({ artifactId: String(item.targetArtifactId) }))
    continuity.intakeReturn(String(run.projectId), {
      sessionId,
      fromProvider: 'codex',
      title: run.instruction.slice(0, 120) || '本轮返回',
      summary: (run.resultSummary ?? run.shortSummary ?? run.instruction).slice(0, 2_000),
      ...(artifactRefs.length === 0 ? {} : { artifactRefs }),
      runIds: [String(run.id)],
    })
  }

  async dispatch(runId: RunId): Promise<RuntimeRunActionResult> {
    return this.providerAction(runId, () => this.adapter.dispatch(runId))
  }

  async recover(runId: RunId): Promise<RuntimeRunActionResult> {
    return this.providerAction(runId, () => this.adapter.recover(runId))
  }

  async sync(runId: RunId): Promise<RuntimeRunActionResult> {
    return this.providerAction(runId, async () => {
      await this.adapter.sync(runId)
      await this.ingestion.ingestFromBridge(runId)
    })
  }

  async finalize(
    runId: RunId,
    decision: 'completed' | 'retrying',
    comment?: string,
  ): Promise<RuntimeRunActionResult> {
    return this.providerAction(runId, () => this.adapter.finalize(runId, decision, comment))
  }

  async cancel(runId: RunId): Promise<RuntimeRunActionResult> {
    return this.providerAction(runId, () => this.adapter.cancel(runId))
  }

  async answerInput(runId: RunId, input: AnswerRunInputRequestV1): Promise<RuntimeRunActionResult> {
    const current = this.repository.getRunInputRequest(input.requestId)
    if (current === undefined || current.runId !== String(runId)) throw new Error('INPUT_REQUEST_NOT_FOUND')
    if (current.status === 'answered') return { review: this.review.getRunReview(runId) }
    if (current.status !== 'pending') throw new Error('INPUT_REQUEST_NOT_PENDING')
    const selectedOptions = [...new Set(input.selectedOptions ?? [])]
    if (selectedOptions.some((option) => !current.options.includes(option))) throw new Error('INPUT_OPTION_INVALID')
    const answerText = input.text?.trim()
    if (answerText && !current.allowFreeText) throw new Error('FREE_TEXT_NOT_ALLOWED')
    if (!answerText && selectedOptions.length === 0) throw new Error('INPUT_RESPONSE_EMPTY')

    const result = await this.providerAction(runId, () => this.adapter.answerInput(runId, {
      requestId: input.requestId,
      ...(answerText ? { text: answerText } : {}),
      selectedOptions,
    }))
    if (result.providerError === undefined) {
      const answeredAt = this.now()
      this.repository.answerRunInputRequest(runId, {
        requestId: input.requestId,
        ...(answerText ? { text: answerText } : {}),
        selectedOptions,
      }, answeredAt)
      this.emit(runId, 'run.input_resolved', { requestId: input.requestId, projectId: String(result.review.run.projectId) })
      this.emit(runId, 'run.queued', { resumedFromInput: true, projectId: String(result.review.run.projectId) })
      return { review: this.review.getRunReview(runId) }
    }
    return result
  }


  contextPrompt(runId: RunId): { readonly compiledContextPrompt: CompiledContextPromptV1; readonly telemetry: ContextCacheTelemetryV1 } {
    const run = this.repository.getRun(runId)
    if (run === undefined) throw new Error('Run not found.')
    const manifest = this.repository.getContextManifest(run.contextManifestId)
    if (manifest === undefined) throw new Error('Run Context Manifest not found.')
    const parsed = JSON.parse(manifest.canonicalJson) as ContextPromptManifestSourceV1
    const compiledContextPrompt = compileContextPromptV1({
      manifest: parsed,
      userTask: run.instruction,
      outputIntent: run.outputIntent,
      runConstraints: runtimeConstraintsForOutputIntent(run.outputIntent),
    })
    return {
      compiledContextPrompt,
      telemetry: contextCacheTelemetryV1(compiledContextPrompt, run.provider),
    }
  }

  async providers(): Promise<readonly RuntimeProviderStatus[]> {
    return this.adapter.providersStatus()
  }

  async getCodexTaskState(runId: RunId): Promise<{ readonly status?: string; readonly leaseExpiresAt?: string } | undefined> {
    return this.adapter.getCodexTaskState(runId)
  }

  getProjectReviews(projectId: ProjectId, limit = 20): readonly RunReview[] {
    return this.repository.getProjectRuns(projectId, limit)
      .map((run) => this.review.getRunReview(run.id))
  }

  private async providerAction(runId: RunId, action: () => Promise<unknown>): Promise<RuntimeRunActionResult> {
    try {
      const before = this.review.getRunReview(runId)
      await action()
      const review = this.review.getRunReview(runId)
      if (before.run.status !== 'running' && review.run.status === 'running') {
        this.emit(runId, 'run.started', { projectId: String(review.run.projectId) })
      }
      if (before.run.status !== 'waiting_input' && review.run.status === 'waiting_input') {
        const inputRequest = review.inputRequest
        this.emit(runId, 'run.waiting_input', {
          projectId: String(review.run.projectId),
          ...(inputRequest === undefined ? {} : { requestId: inputRequest.requestId, question: inputRequest.question }),
        })
      }
      if (before.presentationPhase !== 'review' && review.presentationPhase === 'review') {
        this.emit(runId, 'run.review_ready', { projectId: String(review.run.projectId) })
      }
      if (before.run.status !== 'completed' && review.run.status === 'completed') {
        this.emit(runId, 'run.completed', { projectId: String(review.run.projectId) })
        // 无 ArtifactReturn 的 analyze/reply 路径也会在这里完成；统一走 authoritative intake（幂等）。
        void this.intakeContinuityReturn(runId)
      }
      if (before.run.status !== 'cancelled' && review.run.status === 'cancelled') {
        this.emit(runId, 'run.cancelled', { projectId: String(review.run.projectId) })
      }
      if (before.run.status !== 'failed' && review.run.status === 'failed') {
        this.emit(runId, 'run.failed', { projectId: String(review.run.projectId) })
      }
      this.#observeSessionLifecycle(review)
      return { review }
    } catch (error: unknown) {
      if (!(error instanceof RuntimeAdapterError)) throw error
      const failed = this.review.getRunReview(runId)
      this.#sessionLifecycle?.markDisconnected(
        String(failed.run.projectId),
        failed.run.provider,
        `bridge error: ${error.detail.code} ${error.detail.message}`,
      )
      return {
        review: failed,
        providerError: error.detail,
      }
    }
  }

  /** Phase 5：run 状态 → 会话 phase（七态投影；服务内部做多 run 感知与合法转移）。 */
  #observeSessionLifecycle(review: RunReview): void {
    if (this.#sessionLifecycle === undefined) return
    this.#sessionLifecycle.observeRunStatus(
      String(review.run.projectId),
      review.run.provider,
      review.run.status,
      `run ${String(review.run.id)} → ${review.run.status}`,
    )
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

  #savedContextItems(projectId: ProjectId, savedContextId: string): readonly { readonly artifactId: string; readonly revisionId?: string }[] {
    const graph = this.repository.get(String(projectId))
    if (graph === undefined) throw new Error('Project not found.')
    const scope = graph.scopes.find((item) => String(item.id) === savedContextId)
    if (scope === undefined || scope.kind !== 'context') throw new Error(`Saved Context not found: ${savedContextId}`)
    const presentation = this.repository.getPresentationView(String(projectId), `presentation:context:${savedContextId}`)
    const memberViewIds = presentation?.state.memberViewIds.length
      ? presentation.state.memberViewIds
      : graph.artifactViews
          .filter((view) => String(view.scopeId) === savedContextId)
          .map((view) => String(view.id))
          .sort((left, right) => left.localeCompare(right, 'en-US'))
    const viewById = new Map(graph.artifactViews.map((view) => [String(view.id), view]))
    const artifactById = new Map(graph.artifacts.map((artifact) => [String(artifact.id), artifact]))
    const seen = new Set<string>()
    const result: Array<{ artifactId: string; revisionId?: string }> = []
    for (const viewId of memberViewIds) {
      const view = viewById.get(String(viewId))
      if (view === undefined) continue
      const artifactId = String(view.artifactId)
      if (seen.has(artifactId)) continue
      const artifact = artifactById.get(artifactId)
      if (artifact === undefined) continue
      const revisionId = view.revisionId === undefined
        ? (artifact.currentRevisionId === undefined ? undefined : String(artifact.currentRevisionId))
        : String(view.revisionId)
      result.push({ artifactId, ...(revisionId === undefined ? {} : { revisionId }) })
      seen.add(artifactId)
    }
    return result
  }

  async #continuityBundle(projectId: ProjectId, input: CreateRuntimeRunInput): Promise<ContinuityAttachBundleV1 | undefined> {
    const continuity = this.#continuity
    if (continuity === undefined || input.sessionId === undefined) return undefined
    if (this.repository.getSessionContextRef(input.sessionId) === undefined) {
      await continuity.bindSession({
        sessionId: input.sessionId,
        projectId: String(projectId),
        ...(input.workspaceId === undefined ? {} : { workspaceId: input.workspaceId }),
      })
    }
    return continuity.attachBundle(String(projectId), {
      sessionId: input.sessionId,
      provider: 'codex',
      explicitAction: input.instruction,
    })
  }

  #sessionIdForRun(runId: RunId): string | undefined {
    for (const event of this.repository.getRunEvents(runId)) {
      if (event.type !== 'run.queued') continue
      const payload = event.payload as { readonly sessionId?: unknown } | null
      if (payload !== null && typeof payload === 'object' && typeof payload.sessionId === 'string') return payload.sessionId
    }
    return undefined
  }
}
