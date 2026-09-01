/**
 * Cache-friendly Context prompt contracts.
 * Runtime-derived only: never Project Truth and never a GUI concept.
 */

export const CONTEXT_PROMPT_SERIALIZER_V1 = 'context-prompt-v1' as const

export interface ContextPromptCachePlanV1 {
  readonly schemaVersion: 1
  readonly serializerVersion: typeof CONTEXT_PROMPT_SERIALIZER_V1
  readonly savedContextId?: string
  /** Stable Saved Context membership order, expressed by ContextManifest item identity. */
  readonly stableItemIdentities: readonly string[]
  /** Active selection/focus. Dynamic only; changing it must not change stablePrefixHash. */
  readonly focusArtifactIds?: readonly string[]
  readonly routeId?: string
  readonly skillId?: string
  readonly skillVersion?: string
  readonly capabilityProfileId?: string
}

export interface CompiledContextPromptV1 {
  readonly schemaVersion: 1
  readonly serializerVersion: typeof CONTEXT_PROMPT_SERIALIZER_V1
  readonly projectId: string
  readonly savedContextId?: string
  /** Derived semantic snapshot identity. Presentation state is intentionally excluded. */
  readonly snapshotId: string
  readonly routeId?: string
  readonly skillId?: string
  readonly skillVersion?: string
  readonly capabilityProfileId?: string
  readonly stablePrefix: string
  readonly dynamicTail: string
  readonly stablePrefixHash: string
  readonly dynamicTailHash: string
  readonly stablePrefixChars: number
  readonly dynamicTailChars: number
  readonly stablePrefixTokensEstimated: number
  readonly dynamicTailTokensEstimated: number
  readonly cacheFamily: string
}

export interface ContextCacheTelemetryV1 {
  readonly schemaVersion: 1
  readonly serializerVersion: typeof CONTEXT_PROMPT_SERIALIZER_V1
  readonly projectId: string
  readonly savedContextId?: string
  readonly snapshotId: string
  readonly routeId?: string
  readonly skillId?: string
  readonly stablePrefixHash: string
  readonly stablePrefixChars: number
  readonly dynamicTailChars: number
  readonly estimatedStableTokens: number
  readonly estimatedTailTokens: number
  readonly cacheFamily: string
  /** Provider adapters may fill these later without changing the stable prefix. */
  readonly provider?: string
  readonly providerCachedTokens?: number
  readonly providerInputTokens?: number
}
