/**
 * ExecutionGate V1 — G5/G11 统一执行门 taxonomy（20260827 草案）。
 *
 * 现状（Truth Map §2.5 / G5 / G11）：写回守卫三入口一致（都过 Core CAS），但**前置
 * 风险分级各层无人负责**——permissionGate.ts 只管 GUI 发起的 Run（两态 allow/confirm）；
 * MCP（mcp-server.mjs）只做角色可见性裁剪；CLI 全裸。Core CAS 兜底的是「版本新鲜度」，
 * 不裁决「这个角色此刻能不能做这个级别的操作」。
 *
 * 双轴模型（Truth Map 命名直译）：
 * - MutationRisk 五级：操作本身的破坏力（SAFE/REVERSIBLE/STRUCTURAL/DESTRUCTIVE/PROTECTED）
 * - PermissionScope 四级：发起方能碰的边界（READ_ONLY/SCENE/PROJECT/WORKSPACE）
 *
 * GateDecision 四值（G11 要的 PREVIEW/DENY 语义）：
 * - allow    静默放行（读零打扰——继承 permissionGate 白名单纪律）
 * - preview  先出变更预览再执行（STRUCTURAL 级；reorganize_proposals 的 PREVIEW 基建已有）
 * - confirm  需用户确认（继承 PermissionConfirmCard 契约：取消不半执行）
 * - deny     拒绝（fail-closed；角色无权或越界，消息说明原因）
 *
 * 判定核心放 contracts（纯函数零依赖）：GUI/CLI/MCP 三入口 import 同一实现，
 * 「同一动作从哪个口进来风险分级一致」是本契约的存在理由。落地接线属 0.2 Phase 6。
 */

/** 操作风险五级。级别递进 = 确认成本递进。 */
export type MutationRisk = 'safe' | 'reversible' | 'structural' | 'destructive' | 'protected'

/** 发起方权限边界四级。包含关系：scene ⊂ project ⊂ workspace；read_only 不含任何写。 */
export type PermissionScope = 'read_only' | 'scene' | 'project' | 'workspace'

/** 发起角色（MCP 角色裁剪 mcp-server.mjs 的 LCOS_MCP_ROLE 对齐 + GUI/CLI）。 */
export type GateActorRole = 'user' | 'cli' | 'mcp_executor' | 'mcp_agent'

/** 操作目标空间：与 PermissionScope 同尺度判定覆盖关系。 */
export type OperationScope = 'scene' | 'project' | 'workspace'

export interface ExecutionGateInput {
  readonly risk: MutationRisk
  readonly actor: GateActorRole
  /** 发起方被授予的边界。 */
  readonly grantedScope: PermissionScope
  /** 本次操作实际触碰的空间。 */
  readonly operationScope: OperationScope
  /** 变更对象清单（confirm/preview 呈现用；permissionGate items 先例）。 */
  readonly targets?: readonly string[]
}

export type GateDecision =
  | { readonly kind: 'allow' }
  | { readonly kind: 'preview'; readonly risk: MutationRisk; readonly targets: readonly string[] }
  | { readonly kind: 'confirm'; readonly risk: MutationRisk; readonly targets: readonly string[]; readonly reason: string }
  | { readonly kind: 'deny'; readonly risk: MutationRisk; readonly reason: string }

/** scope 覆盖判定：granted 是否包含 operation（read_only 永不覆盖写空间）。 */
const SCOPE_COVERS: Readonly<Record<PermissionScope, readonly OperationScope[]>> = {
  read_only: [],
  scene: ['scene'],
  project: ['scene', 'project'],
  workspace: ['scene', 'project', 'workspace'],
}

function covers(granted: PermissionScope, operation: OperationScope): boolean {
  return SCOPE_COVERS[granted].includes(operation)
}

const RISK_LABEL: Readonly<Record<MutationRisk, string>> = {
  safe: '只读操作',
  reversible: '可逆写（ChangeSet 记账，可 revert）',
  structural: '结构性变更（布局/拓扑/成员）',
  destructive: '破坏性操作（内容删除风险）',
  protected: '受保护对象（宪法级）',
}

/**
 * 统一判定（纯函数，fail-closed）。
 *
 * 矩阵（行=risk，列=scope 覆盖与否；mcp_agent 对 destructive/protected 一律 deny——
 * agent 不得代用户删除；user/cli/mcp_executor 走人类确认链）：
 *
 *   risk        | 覆盖         | 越界
 *   ------------+--------------+---------
 *   safe        | allow        | allow（读不受空间限制）
 *   reversible  | allow        | confirm
 *   structural  | preview      | confirm
 *   destructive | confirm      | deny
 *   protected   | confirm      | deny
 *
 * read_only 边界：任何非 safe 操作 → deny（不是 confirm——越权读会话不该被劝诱升级）。
 */
export function evaluateExecutionGate(input: ExecutionGateInput): GateDecision {
  const targets = input.targets ?? []
  if (input.risk !== 'safe' && input.grantedScope === 'read_only') {
    return { kind: 'deny', risk: input.risk, reason: 'read_only 边界不覆盖任何写操作。' }
  }
  if (input.risk === 'safe') return { kind: 'allow' }
  if (input.actor === 'mcp_agent' && (input.risk === 'destructive' || input.risk === 'protected')) {
    return { kind: 'deny', risk: input.risk, reason: `agent 角色无权执行${RISK_LABEL[input.risk]}。` }
  }
  const covered = covers(input.grantedScope, input.operationScope)
  if (input.risk === 'reversible') {
    return covered
      ? { kind: 'allow' }
      : { kind: 'confirm', risk: input.risk, targets, reason: `${RISK_LABEL[input.risk]}超出授权边界。` }
  }
  if (input.risk === 'structural') {
    return covered
      ? { kind: 'preview', risk: input.risk, targets }
      : { kind: 'confirm', risk: input.risk, targets, reason: `${RISK_LABEL[input.risk]}超出授权边界。` }
  }
  // destructive / protected
  return covered
    ? { kind: 'confirm', risk: input.risk, targets, reason: `${RISK_LABEL[input.risk]}需要确认。` }
    : { kind: 'deny', risk: input.risk, reason: `${RISK_LABEL[input.risk]}超出授权边界。` }
}

/**
 * LCOS 操作 → 风险级映射表（0.2 实现层的单一事实源；本草案先钉语义）。
 * 全部操作名核实自现行代码面（routes / curation-command-service / mutation-safety）。
 */
export const OPERATION_RISK: Readonly<Record<string, MutationRisk>> = {
  // safe：读零打扰（/space/ 三件套 + active context 读/订阅 + 搜索）
  'space.ls': 'safe',
  'space.read': 'safe',
  'space.search': 'safe',
  'context.get': 'safe',
  'context.watch': 'safe',
  'search.query': 'safe',
  'artifact.preview': 'safe',
  // reversible：带 sessionId 的写自动进 ChangeSet（revert/reapply 已落地）
  'curation.text.create': 'reversible',
  'curation.text.update': 'reversible',
  'capture.stage': 'reversible',
  // structural：CAS 版本校验（expectedVersion）+ reorganize PREVIEW 基建已有
  'presentation.apply': 'structural',
  'relation.write': 'structural',
  'reorganize.propose': 'structural',
  'context.membership': 'structural',
  'workflow.build': 'structural',
  'workflow.edit': 'structural',
  // destructive：内容丢失风险
  'artifact.delete': 'destructive',
  'reorganize.apply_with_delete': 'destructive',
  'changeset.revert_create': 'destructive',
  'checkpoint.rollback': 'destructive',
  // protected：宪法级对象
  'project.delete': 'protected',
  'project.export': 'protected',
  'saved_context.root': 'protected',
  'locked_elements.write': 'protected',
  'resource_policies.write': 'protected',
}

/** 查操作风险级；未登记操作 fail-closed 返回 protected（未知当最高危处理）。 */
export function riskOfOperation(operation: string): MutationRisk {
  return OPERATION_RISK[operation] ?? 'protected'
}
