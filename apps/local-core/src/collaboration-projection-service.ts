/**
 * Collaboration Projection Service（收敛方案 V1 §11.1）。
 *
 * 只读聚合：ConnectedConversation + identity chain + Runs(receiver) + RunReview +
 * Continuation journal + Provider capability snapshot → CollaborationSessionProjectionV1。
 *
 * 纪律：
 * - 不新增 persistence，不是第二 Source of Truth；每次调用从既有 owner 现算。
 * - provider / externalSessionId / RuntimeDispatch 不进入产品投影。
 * - 能力探测失败/缺席 → fail-closed（canSend 等全 false + 原因），不抛错阻断读路径。
 */

import type {
  CollaborationSessionProjectionV1,
  CollaborationTimelineItemV1,
  CollaborationUserStateV1,
  ProviderContinuationCapabilitySnapshotV1,
  RunReview,
} from '@local-creative-os/contracts'
import type { ArtifactReturn, Run } from '@local-creative-os/domain'

import {
  deriveCollaborationRecoveryV1,
  deriveCollaborationUserStateV1,
  resolveCollaborationCapabilitiesV1,
} from './collaboration-capability-resolver.js'
import { projectCollaborationTimelineV1 } from './collaboration-timeline-projector.js'
import type { ConversationContinuationService } from './conversation-continuation-service.js'
import type { ConversationIdentityService } from './conversation-identity-service.js'
import type { SqliteMetadataRepository } from './metadata-repository.js'
import type { ReceiverRuntimeService } from './receiver-runtime-service.js'
import type { RuntimeReviewService } from './runtime-review-service.js'

/** 能力探测入口：由 compose 注入（包装 recoveryAdapter.probe），缺席 = 未接线。 */
export type CollaborationCapabilityProbe = () => Promise<ProviderContinuationCapabilitySnapshotV1 | undefined>

export class CollaborationProjectionService {
  constructor(
    private readonly metadata: SqliteMetadataRepository,
    private readonly identity: ConversationIdentityService,
    private readonly continuation: ConversationContinuationService | undefined,
    private readonly receiverRuntime: ReceiverRuntimeService | undefined,
    private readonly runtimeReview: RuntimeReviewService | undefined,
    private readonly probeCapability: CollaborationCapabilityProbe | undefined,
  ) {}

  async getSession(
    projectId: string,
    connectedConversationId: string,
  ): Promise<CollaborationSessionProjectionV1 | undefined> {
    const conversation = this.metadata.getConnectedConversation(projectId, connectedConversationId)
    if (conversation === undefined) return undefined

    const chain = this.identity.resolveChain(projectId, connectedConversationId)
    const runs = [...this.metadata.listRunsByReceiverConversation(projectId, connectedConversationId, 20)]
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    const activeRun = runs[0]
    const reviews = this.collectReviews(runs)
    const activeRunReview = activeRun === undefined ? undefined : reviews.get(String(activeRun.id))
    const operations = (this.continuation?.list(projectId) ?? [])
      .filter((op) => op.connectedConversationId === connectedConversationId)
    const pendingReturns = this.collectPendingReturns(reviews)
    const snapshot = await this.probeSafely()

    const recovery = deriveCollaborationRecoveryV1(operations)
    const hasPendingInput =
      activeRunReview?.inputRequest !== undefined && activeRunReview.inputRequest.status === 'pending'
    const { capabilities, capabilityReasons } = resolveCollaborationCapabilitiesV1({
      ...(activeRunReview === undefined ? {} : { activeRunReview }),
      pendingReturns,
      continuationOps: operations,
      ...(snapshot === undefined ? {} : { capabilitySnapshot: snapshot }),
      handoffOwnerAvailable: this.receiverRuntime !== undefined,
    })
    const userState: CollaborationUserStateV1 = deriveCollaborationUserStateV1({
      ...(activeRun === undefined ? {} : { activeRunStatus: activeRun.status }),
      hasPendingInput,
      hasPendingReview: pendingReturns.length > 0,
      recovery: recovery.state,
    })

    const session = chain?.conversationSession
    const targetRefs = session === undefined
      ? []
      : this.metadata.listArtifactIdsReferencedByConversation(String(session.id))
          .map((artifactId) => `artifact:${artifactId}`)

    const lastActivityAt = [
      conversation.updatedAt,
      activeRun?.updatedAt,
      operations[0]?.updatedAt,
    ].filter((value): value is string => typeof value === 'string').sort().at(-1)

    return {
      schemaVersion: 1,
      projectId,
      conversationId: connectedConversationId,
      identity: {
        title: conversation.label,
        ...(session !== undefined && 'title' in session && typeof session.title === 'string'
          ? { subtitle: session.title }
          : {}),
      },
      userState,
      relation: {
        ...(conversation.workspaceRef === null ? {} : { workspaceId: conversation.workspaceRef }),
        targetRefs,
      },
      activity: {
        ...(lastActivityAt === undefined ? {} : { lastActivityAt }),
        ...(activeRun === undefined ? {} : {
          activeRunId: String(activeRun.id),
          activeSummary: activeRun.instruction.split('\n')[0]?.trim() ?? '',
        }),
        ...(hasPendingInput && activeRunReview?.inputRequest !== undefined
          ? { pendingInputId: activeRunReview.inputRequest.requestId }
          : {}),
      },
      capabilities,
      capabilityReasons,
      recentReturns: this.toReturnSummaries(reviews),
      ...(recovery.state === 'none' ? {} : { recovery }),
    }
  }

  getTimeline(
    projectId: string,
    connectedConversationId: string,
    options: { readonly limit?: number } = {},
  ): readonly CollaborationTimelineItemV1[] | undefined {
    const conversation = this.metadata.getConnectedConversation(projectId, connectedConversationId)
    if (conversation === undefined) return undefined
    const runs = this.metadata.listRunsByReceiverConversation(projectId, connectedConversationId, 50)
    const reviews = [...this.collectReviews(runs).values()]
    const operations = (this.continuation?.list(projectId) ?? [])
      .filter((op) => op.connectedConversationId === connectedConversationId)
    return projectCollaborationTimelineV1({ runs, reviews, operations }, options)
  }

  private collectReviews(runs: readonly Run[]): Map<string, RunReview> {
    const reviews = new Map<string, RunReview>()
    if (this.runtimeReview === undefined) return reviews
    for (const run of runs) {
      try {
        reviews.set(String(run.id), this.runtimeReview.getRunReview(run.id))
      } catch {
        // 没有 dispatch/review 原料的 Run（如未派发）诚实缺席，不阻断投影。
      }
    }
    return reviews
  }

  private collectPendingReturns(reviews: Map<string, RunReview>): readonly ArtifactReturn[] {
    return [...reviews.values()].flatMap((review) =>
      review.returns.filter((row) => row.status === 'pending_review'))
  }

  private toReturnSummaries(
    reviews: Map<string, RunReview>,
  ): CollaborationSessionProjectionV1['recentReturns'] {
    return [...reviews.values()]
      .flatMap((review) => review.returns)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, 5)
      .map((row) => {
        const artifact = this.metadata.getArtifact(String(row.targetArtifactId))
        return {
          returnId: String(row.id),
          ...(artifact === undefined ? {} : { artifactId: String(row.targetArtifactId) }),
          title: artifact?.title ?? '未命名产出',
          status: row.status,
          returnedAt: row.createdAt,
        }
      })
  }

  private async probeSafely(): Promise<ProviderContinuationCapabilitySnapshotV1 | undefined> {
    if (this.probeCapability === undefined) return undefined
    try {
      return await this.probeCapability()
    } catch {
      // 探测失败 = 未知，不是可用；fail-closed 由 resolver 处理。
      return undefined
    }
  }
}