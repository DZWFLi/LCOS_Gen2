// R6 ColorPin semantic correction：当前现场 → canonical surface target 的 pure 映射。
//
// 纪律（冻结）：**不得**用 activeWorkspaceId 冒充 root surface —— 那会把「子工作现场」
// 当成「Context/Workflow 根现场」，往 Core 写一个错误的 canonical marker。
//
//   root Main       → surface:main
//   root Context    → surface:scope:<exact context scopeId>
//   root Workflow   → surface:scope:<exact workflow scopeId>
//   explicit child  → surface:workspace:<childWorkspaceId>   （route ?workspaceId=）
//
// root scope 无法**唯一**解析时 fail closed（绝不取第一个 workspace 猜）。
// 真相来自 current route + project graph truth（scopes/workspaces）；不新增 SurfaceStore。

/** project graph truth 的最小切片（只读，不是新真值）。 */
export interface LcosSurfaceScopeTruthV1 {
  readonly id: string;
  readonly kind: string;
  readonly parentScopeId?: string | null;
}

export interface LcosSurfaceWorkspaceTruthV1 {
  readonly id: string;
  readonly scopeId: string;
}

export interface LcosSurfaceMarkerTargetRefV1 {
  readonly projectId: string;
  readonly kind: 'surface';
  readonly id: string;
}

export type LcosSurfaceMarkerUnresolvedReasonV1 =
  | 'unknown-surface'
  | 'missing-workspace'
  | 'root-scope-missing'
  | 'root-scope-ambiguous';

export type LcosSurfaceMarkerTargetV1 =
  | { readonly status: 'resolved'; readonly targetRef: LcosSurfaceMarkerTargetRefV1 }
  | { readonly status: 'unresolved'; readonly reason: LcosSurfaceMarkerUnresolvedReasonV1 };

/** 诚实文案：为什么当前现场不能形成 canonical surface target。 */
export const LCOS_SURFACE_MARKER_REASON_TEXT: Readonly<Record<LcosSurfaceMarkerUnresolvedReasonV1, string>> = {
  'unknown-surface': '这个现场没有可标记的 canonical surface',
  'missing-workspace': '这个工作现场不在当前项目真值里',
  'root-scope-missing': '当前现场还没有自己的 canonical scope（无法唯一解析）',
  'root-scope-ambiguous': '当前现场对应多个 canonical scope（无法唯一解析）',
};

export function resolveSurfaceMarkerTargetV1(input: {
  readonly projectId: string;
  readonly surface: string;
  /** route ?workspaceId= —— 显式子工作现场。 */
  readonly childWorkspaceId?: string | undefined;
  readonly scopes: readonly LcosSurfaceScopeTruthV1[];
  readonly workspaces: readonly LcosSurfaceWorkspaceTruthV1[];
}): LcosSurfaceMarkerTargetV1 {
  const { projectId, surface, childWorkspaceId, scopes, workspaces } = input;

  if (surface !== 'main' && surface !== 'context' && surface !== 'workflow') {
    return { status: 'unresolved', reason: 'unknown-surface' };
  }

  // 1) 显式子工作现场（route 明确指定）：canonical workspace 目标，身份必须真实存在。
  if (childWorkspaceId !== undefined && childWorkspaceId !== '') {
    const workspace = workspaces.find((item) => String(item.id) === childWorkspaceId);
    if (workspace === undefined) return { status: 'unresolved', reason: 'missing-workspace' };
    return { status: 'resolved', targetRef: { projectId, kind: 'surface', id: `workspace:${String(workspace.id)}` } };
  }

  // 2) root Main：项目世界根，不需要 scope 解析。
  if (surface === 'main') {
    return { status: 'resolved', targetRef: { projectId, kind: 'surface', id: 'main' } };
  }

  // 3) root Context / Workflow：必须唯一命中同 kind 的根级 scope。
  const roots = scopes.filter((scope) => scope.kind === 'root');
  if (roots.length !== 1) return { status: 'unresolved', reason: 'root-scope-ambiguous' };
  const rootScopeId = String(roots[0]!.id);
  const candidates = scopes.filter((scope) => scope.kind === surface
    && (scope.parentScopeId === null || scope.parentScopeId === undefined || String(scope.parentScopeId) === rootScopeId));
  if (candidates.length === 0) return { status: 'unresolved', reason: 'root-scope-missing' };
  if (candidates.length > 1) return { status: 'unresolved', reason: 'root-scope-ambiguous' };
  return { status: 'resolved', targetRef: { projectId, kind: 'surface', id: `scope:${String(candidates[0]!.id)}` } };
}

/** 两个 canonical targetRef 是否同一目标（ColorPin membership 归属判断）。 */
export function sameSurfaceMarkerTargetV1(
  left: { readonly kind: string; readonly id: string },
  right: { readonly kind: string; readonly id: string },
): boolean {
  return left.kind === right.kind && left.id === right.id;
}