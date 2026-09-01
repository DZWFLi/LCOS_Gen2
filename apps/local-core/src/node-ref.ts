/**
 * Agent 侧节点引用阶梯（L0/L1/L2）+ preview 提取（20260826 任务三 P0）。
 * 借鉴 huabu modules/agent/node-ref.ts（MIT）的阶梯设计与缩略参数，LCOS 化差异：
 * - huabu 的 rev 是 content/src 的哈希 token；LCOS 的 revisionId + contentHash 已由
 *   Core 持有，本层只透传引用（不重复造哈希）。
 * - huabu L0 的 filename（nodes/<safeLabel>.md）对应 LCOS 的 viewId/artifactId 寻址，
 *   已存在于 AgentContextItem，不在此重复。
 * 纯函数零副作用：所有输入由调用方传入，不碰文件系统与存储。
 */

import type { AgentContextItem } from '@local-creative-os/contracts'

/** preview 截断上限（字符）。与 huabu NODE_PREVIEW_MAX_LENGTH 同值。 */
export const NODE_PREVIEW_MAX_LENGTH = 120

/**
 * 折叠空白成单空格后再截断（huabu flattenPreview 同构）：
 * 多行 markdown 的换行/缩进不占 120 字预算，预算花在内容上；
 * 单行结果不破坏任何单行容器。
 */
export function flattenPreview(raw: string): string {
  return raw.replace(/\s+/g, ' ').trim().slice(0, NODE_PREVIEW_MAX_LENGTH)
}

/**
 * L1 preview 提取：content 的原始切片。
 * summary 不在此消费（它是独立字段）；src/URL 不是内容预览（媒体节点按自身字段读）。
 * 空白内容返回 undefined，调用方省略字段。
 */
export function extractAgentNodePreview(input: { readonly content?: string }): string | undefined {
  if (typeof input.content === 'string' && input.content.trim()) {
    return flattenPreview(input.content)
  }
  return undefined
}

/** L0 — 最小可寻址引用：身份 + 命名（LCOS 已有 AgentContextItem 同构，直接复用其形状）。 */
export type AgentNodeRefL0 = Pick<AgentContextItem, 'viewId' | 'artifactId' | 'title' | 'kind'> & {
  readonly revisionId?: string
}

/** L1 — 加扫描头：preview（raw 切片）+ rev（版本 token，供「读后是否被改」比对）。 */
export interface AgentNodePreviewL1 extends AgentNodeRefL0 {
  /** content 折叠截断后的单行切片；≤120 字。 */
  readonly preview?: string
  /** 版本 token（LCOS 用 revisionId/contentHash；比对早先读取与当前是否一致）。 */
  readonly rev?: string
}

/** L2 — 加几何/层级元数据（画布推理用；写回坐标走 L2 的 position）。 */
export interface AgentNodeOutlineL2 extends AgentNodePreviewL1 {
  readonly position: { readonly x: number; readonly y: number }
  readonly size: { readonly width: number; readonly height: number }
}

/**
 * 构造 L1 预览引用（纯函数）：L0 身份 + content/rev 的可选输入 → L1。
 * 调用方给什么算什么——content 缺席就不出 preview，不伪造。
 */
export function buildAgentNodePreview(input: {
  readonly viewId: string
  readonly artifactId: string
  readonly title: string
  readonly kind: string
  readonly revisionId?: string
  readonly content?: string
  readonly rev?: string
}): AgentNodePreviewL1 {
  const preview = extractAgentNodePreview(input)
  return {
    viewId: input.viewId,
    artifactId: input.artifactId,
    title: input.title,
    kind: input.kind,
    ...(input.revisionId === undefined ? {} : { revisionId: input.revisionId }),
    ...(preview === undefined ? {} : { preview }),
    ...(input.rev === undefined ? {} : { rev: input.rev }),
  }
}