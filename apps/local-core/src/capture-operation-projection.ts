import type { CaptureOperationProjectionV1, CaptureStagingItemV0 } from '@local-creative-os/contracts'

/**
 * T6（§3.3）：capture operation 投影推导 —— 由 staging items 聚合出 operation 级只读投影。
 *
 * 规则（可测试锚点）：
 * - 按 operationId 分组；targetResolution：全部 item 同 pid → resolved，否则 unresolved（partial 不冒充全成）。
 * - outcome：resolved → confirmed；unresolved → unconfirmed（无 materialize 回链可核对，只 reconcile）。
 * - allowedActions：unresolved → apply/reconcile（apply 到当前 project）；resolved 到当前 project → locate/reconcile；
 *   resolved 到其它 project → 仅 reconcile（跨项目 apply 不允许）。
 * - preview / retry_failed_items 不产出：本 Inbox 列表态不提供预览；confirmed failed 需持久化 receipt，当前无此事实（诚实 GAP）。
 */
export function captureOperationProjectionsV1(
  items: readonly CaptureStagingItemV0[],
  projectId: string,
): readonly CaptureOperationProjectionV1[] {
  const byOperation = new Map<string, CaptureStagingItemV0[]>()
  for (const item of items) {
    const group = byOperation.get(item.operationId)
    if (group === undefined) byOperation.set(item.operationId, [item])
    else group.push(item)
  }

  const projections: CaptureOperationProjectionV1[] = []
  for (const [operationId, group] of byOperation) {
    const latest = group.reduce((a, b) => (a.capturedAt >= b.capturedAt ? a : b))
    const resolvedPids = [...new Set(group.map((item) => item.resolvedProjectId).filter((pid): pid is string => pid !== undefined))]
    const allResolved = group.every((item) => item.resolvedProjectId !== undefined)
    const allSameProject = resolvedPids.length === 1 && allResolved
    const resolvedHere = allSameProject && resolvedPids[0] === projectId
    const materializationRefs = group
      .filter((item) => item.resolvedArtifactId !== undefined)
      .map((item) => ({ artifactId: item.resolvedArtifactId as string, viewId: item.resolvedViewId ?? '' }))

    let allowedActions: CaptureOperationProjectionV1['allowedActions']
    if (!allSameProject) {
      allowedActions = ['apply', 'reconcile']
    } else if (resolvedHere) {
      allowedActions = ['locate', 'reconcile']
    } else {
      allowedActions = ['reconcile']
    }

    projections.push({
      schemaVersion: 1,
      operationId,
      kind: latest.kind,
      capturedAt: latest.capturedAt,
      stagingItemIds: group.map((item) => item.id),
      materializationRefs,
      targetResolution: allSameProject
        ? { status: 'resolved', projectId: resolvedPids[0]! }
        : { status: 'unresolved', projectId: null },
      outcome: allSameProject ? 'confirmed' : 'unconfirmed',
      allowedActions,
    })
  }

  return projections.sort((a, b) => (a.capturedAt >= b.capturedAt ? -1 : 1))
}
