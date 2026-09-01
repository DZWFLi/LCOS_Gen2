/**
 * ExtensionManifestV1 — RESERVE（S11，审计 §14/§15）。
 *
 * 边界（红线）：
 *   - Core Truth = guarded：manifest 只描述"扩展贡献"，不拥有 Core 的 Project/Run/Revision truth。
 *   - Adapters + UI slots = extensible：插件向五个 slot 贡献能力，但 mount/unmount 运行时
 *     逻辑属于后续实施，本契约只做类型 seam + 校验器（零 mount/unmount 运行时逻辑）。
 *   - 禁止把插件能力写成 Core ontology；任何 slot 的贡献都必须经过显式 Capability 声明。
 */

/** Extension slot 枚举（审计 §15 十个 slot）。 */
export type ExtensionSlotV1 =
  | 'OrbitAction'
  | 'CaptureProcessor'
  | 'AssemblySource'
  | 'SkillModule'
  | 'RuntimeAdapter'
  | 'SearchProvider'
  | 'EmbeddingProvider'
  | 'PreviewRenderer'
  | 'CompanionSkin'
  | 'ExecutionAction'

/** manifest schema 固定值。 */
export const EXTENSION_MANIFEST_SCHEMA_V1 = 'lcos-extension-manifest-v1'

/** 能力贡献：插件向一个 slot 声明一个能力。 */
export interface CapabilityContributionV1 {
  readonly capabilityId: string
  readonly slot: ExtensionSlotV1
  readonly label: string
  readonly readWrite: 'read' | 'write' | 'read_write'
  /** 硬性的 capability 依赖（不满足则该贡献不激活）。 */
  readonly requiredCapabilities?: readonly string[]
}

/** UI 贡献：声明可插入的 UI 面（如 OrbitAction / CompanionSkin）。 */
export interface UIContributionV1 {
  readonly slot: Extract<ExtensionSlotV1, 'OrbitAction' | 'PreviewRenderer' | 'CompanionSkin' | 'ExecutionAction'>
  readonly entry: string
  readonly label: string
}

/** Runtime 贡献：声明可插拔的 runtime adapter / provider。 */
export interface RuntimeContributionV1 {
  readonly slot: Extract<ExtensionSlotV1, 'RuntimeAdapter' | 'SearchProvider' | 'EmbeddingProvider' | 'SkillModule'>
  readonly entry: string
  readonly capabilityId: string
}

/** 插件 manifest（RESERVE：只声明类型，不做 mount/unmount 运行时）。 */
export interface ExtensionManifestV1 {
  readonly schemaVersion: 1
  readonly extensionId: string
  readonly name: string
  readonly version: string
  readonly capabilities: readonly CapabilityContributionV1[]
  readonly ui?: readonly UIContributionV1[]
  readonly runtime?: readonly RuntimeContributionV1[]
}

/** manifest 结构校验（fail-close）：非法 manifest 抛错，不 fallback "差不多解析"。 */
export function validateExtensionManifest(input: unknown): asserts input is ExtensionManifestV1 {
  if (typeof input !== 'object' || input === null) throw new Error('Extension manifest must be an object.')
  const value = input as Partial<ExtensionManifestV1>
  if (value.schemaVersion !== 1) throw new Error('Extension manifest schemaVersion must be 1.')
  if (typeof value.extensionId !== 'string' || value.extensionId.length === 0) throw new Error('Extension manifest extensionId is required.')
  if (typeof value.name !== 'string' || value.name.length === 0) throw new Error('Extension manifest name is required.')
  if (typeof value.version !== 'string' || value.version.length === 0) throw new Error('Extension manifest version is required.')
  if (!Array.isArray(value.capabilities) || value.capabilities.length === 0) {
    throw new Error('Extension manifest must declare at least one capability.')
  }
  for (const cap of value.capabilities) {
    if (typeof cap?.capabilityId !== 'string' || cap.capabilityId.length === 0) throw new Error('Capability contribution capabilityId is required.')
    if (typeof cap?.slot !== 'string') throw new Error('Capability contribution slot is required.')
    if (cap?.readWrite !== 'read' && cap?.readWrite !== 'write' && cap?.readWrite !== 'read_write') {
      throw new Error('Capability contribution readWrite must be read|write|read_write.')
    }
  }
}