import type { ConnectorSourceActionV1, ConnectorSourceProjectionV1, ResourceConnectorCapabilityV1 } from '@local-creative-os/contracts'

/**
 * T7（P0-05）：connector source 投影推导 —— capability + 会话状态聚合。
 *
 * 规则（可测试锚点）：
 * - 会话 active（未过期）→ allowed scan/import（supportsScan/Import 分别约束）；无会话 → 仅 supportsScan 时 scan。
 * - reauthorize 不产出：通用 connector lifecycle 为 GAP，无真实 reauthorize 口（诚实）。
 * - 会话过期由 store 清理先行，投影只见 active/none 两态。
 */
export function connectorSourceProjectionsV1(
  capabilities: readonly ResourceConnectorCapabilityV1[],
  sessions: readonly { readonly connector: string; readonly scanId: string; readonly vaultName?: string; readonly noteCount?: number; readonly expiresAt: string }[],
): readonly ConnectorSourceProjectionV1[] {
  return capabilities.map((capability) => {
    const session = sessions.find((item) => item.connector === capability.connector)
    const allowedActions: ConnectorSourceActionV1[] = []
    if (session !== undefined && capability.supportsImport) allowedActions.push('import')
    if (capability.supportsScan) allowedActions.push('scan')
    return {
      schemaVersion: 1,
      connector: capability.connector,
      displayName: capability.displayName,
      access: capability.access,
      sourceKind: capability.sourceKind,
      contentTypes: capability.contentTypes,
      session: session === undefined
        ? { status: 'none' }
        : {
            status: 'active',
            scanId: session.scanId,
            ...(session.vaultName === undefined ? {} : { vaultName: session.vaultName }),
            ...(session.noteCount === undefined ? {} : { noteCount: session.noteCount }),
            expiresAt: session.expiresAt,
          },
      allowedActions,
    }
  })
}
