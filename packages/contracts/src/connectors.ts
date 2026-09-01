export interface ObsidianNoteSummaryV1 {
  readonly relativePath: string
  readonly title: string
  readonly size: number
  readonly modifiedAt: string
  readonly tags: readonly string[]
  readonly outlinks: readonly string[]
}

export interface ObsidianVaultScanV1 {
  readonly schemaVersion: 1
  readonly connector: 'obsidian'
  readonly scanId: string
  readonly vaultName: string
  readonly readOnly: true
  readonly noteCount: number
  readonly totalBytes: number
  readonly notes: readonly ObsidianNoteSummaryV1[]
  readonly warnings: readonly string[]
  readonly expiresAt: string
}

export interface ImportObsidianNotesV1 {
  readonly scanId: string
  readonly relativePaths: readonly string[]
  readonly scopeId: string
  readonly position: { readonly x: number; readonly y: number }
}

export type ResourceConnectorAccessV1 = 'read_only' | 'read_write'

export interface ResourceConnectorCapabilityV1 {
  readonly schemaVersion: 1
  readonly connector: string
  readonly displayName: string
  readonly sourceKind: 'local_directory' | 'local_file' | 'remote_service'
  readonly access: ResourceConnectorAccessV1
  readonly contentTypes: readonly string[]
  readonly supportsScan: boolean
  readonly supportsImport: boolean
  readonly supportsSync: boolean
}
