/**
 * SpaceVfs V0 — 任务四 P1：虚拟 /space/ 命名空间（借鉴 huabu ACP fs 沙箱，MIT）。
 * Agent 以稳定的人类可读路径（/space/nodes/<safeLabel>.md）寻址项目节点。
 * 边界纪律（huabu 同构）：命名空间只读——读取记 full-read lease，
 * 写入一律走 CAS 守卫的 curation/text 通道，本命名空间不提供写。
 *
 * 20260827 补检索原语：SpaceSearchNodeV0/SpaceSearchResultV0——
 * huabu agentic 检索哲学（给 agent grep/find/ls 工具让它自己翻）的 LCOS 直译。
 * 搜索只扫标题+正文前缀并回片段，**不记 full-read lease**（搜索≠通读，
 * 不能凭片段命中获得 CAS 写资格——写前必须 /space/read 全文）。
 */

export interface SpaceListNodeV0 {
  /** 完整虚拟路径（含 /space/ 前缀），Agent 的稳定寻址句柄。 */
  readonly path: string
  readonly artifactId: string
  readonly title: string
  readonly revisionId: string
  /** 版本 token（contentHash）：供「读后是否被改」比对。 */
  readonly contentHash: string
  /** L1 扫描头（折叠空白截 120 字，node-ref 同构参数）；无文本内容时省略。 */
  readonly preview?: string
}

export interface SpaceListResultV0 {
  readonly items: readonly SpaceListNodeV0[]
  readonly generatedAt: string
}

export interface SpaceReadResultV0 {
  readonly path: string
  readonly artifactId: string
  /** 主 view（若存在）：供后续 curation/text 定向写入。 */
  readonly viewId?: string
  readonly revisionId: string
  readonly contentHash: string
  readonly content: string
  readonly truncated: boolean
}

export interface SpaceSearchNodeV0 {
  readonly path: string
  readonly artifactId: string
  readonly title: string
  readonly revisionId: string
  readonly contentHash: string
  /** 命中位置：title / content。标题命中排前。 */
  readonly matchedIn: 'title' | 'content'
  /** 首个命中点附近的片段（折叠空白，≤200 字窗）；标题命中时省略。 */
  readonly snippet?: string
}

export interface SpaceSearchResultV0 {
  readonly items: readonly SpaceSearchNodeV0[]
  /** 参与扫描的节点总数（命中与否都算）。 */
  readonly scanned: number
  readonly generatedAt: string
}
