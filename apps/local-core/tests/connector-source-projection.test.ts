import { describe, expect, it } from 'vitest'

import type { ResourceConnectorCapabilityV1 } from '@local-creative-os/contracts'
import { connectorSourceProjectionsV1 } from '../src/connector-source-projection.js'

const obsidianCapability: ResourceConnectorCapabilityV1 = {
  schemaVersion: 1, connector: 'obsidian', displayName: 'Obsidian Vault',
  sourceKind: 'local_directory', access: 'read_only', contentTypes: ['text/markdown'],
  supportsScan: true, supportsImport: true, supportsSync: false,
}

describe('connectorSourceProjectionsV1（T7 P0-05）', () => {
  it('无会话 → session none，allowed scan（supportsScan）', () => {
    const value = connectorSourceProjectionsV1([obsidianCapability], [])
    expect(value).toHaveLength(1)
    expect(value[0]!.session).toEqual({ status: 'none' })
    expect(value[0]!.allowedActions).toEqual(['scan'])
    expect(value[0]!.displayName).toBe('Obsidian Vault')
  })

  it('有 active 会话 → import + scan（supportsImport/Scan 分别约束）', () => {
    const value = connectorSourceProjectionsV1([obsidianCapability], [
      { connector: 'obsidian', scanId: 'obsidian-scan-1', vaultName: 'vault', noteCount: 12, expiresAt: '2099-01-01T00:00:00.000Z' },
    ])
    expect(value[0]!.session).toEqual({ status: 'active', scanId: 'obsidian-scan-1', vaultName: 'vault', noteCount: 12, expiresAt: '2099-01-01T00:00:00.000Z' })
    expect(value[0]!.allowedActions).toEqual(['import', 'scan'])
  })

  it('不支持的 connector（supportsScan=false）→ 无 scan 动作；reauthorize 永不产出（lifecycle GAP）', () => {
    const readOnly: ResourceConnectorCapabilityV1 = {
      schemaVersion: 1, connector: 'readonly-web', displayName: 'Readonly', sourceKind: 'remote_service',
      access: 'read_only', contentTypes: [], supportsScan: false, supportsImport: false, supportsSync: false,
    }
    const value = connectorSourceProjectionsV1([readOnly], [])
    expect(value[0]!.allowedActions).toEqual([])
    expect(value[0]!.allowedActions.includes('reauthorize')).toBe(false)
  })
})
