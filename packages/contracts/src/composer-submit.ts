/**
 * T6 Composer submit projection（T6 §3.2 / T5 V4 P0-03）。
 *
 * 只读组合 CommandDraft + exact receiver + canonical receipt（Run 或 continuation
 * operation），不建第二 Draft/Submit truth。`acknowledgement` 反映当前 draft 上下文
 * 是否存在可核对的 canonical receipt；`unconfirmed` 由消费 body 在会话内禁止重复提交。
 */

export type ComposerSubmissionKindV1 = 'run' | 'continuation'

/** 提交确认语义：acknowledged=存在 canonical receipt；rejected=响应期 4xx（body 本地态）；unconfirmed=无 receipt 可核对。 */
export type ComposerAcknowledgementV1 = 'acknowledged' | 'rejected' | 'unconfirmed'

export type ComposerSubmitActionV1 =
  | 'submit_run'
  | 'submit_continuation'
  | 'choose_receiver'
  | 'open_recovery'
  | 'refresh'

export interface ComposerOwnerRefV1 {
  readonly kind: 'connected_conversation' | 'workspace' | 'project'
  readonly id: string
}

export interface ComposerSubmitProjectionV1 {
  readonly schemaVersion: 1
  readonly projectId: string
  readonly composerAnchor: string
  /** draft.updatedAt —— 草稿每次保存即新 revision。 */
  readonly draftRevision: string
  readonly receiverId: string | null
  /** 续工提交（存在可恢复 continuation op）与普通 Run 提交的分流依据。 */
  readonly submissionKind: ComposerSubmissionKindV1
  readonly ownerRef: ComposerOwnerRefV1 | null
  readonly acknowledgement: ComposerAcknowledgementV1
  readonly allowedActions: readonly ComposerSubmitActionV1[]
}
