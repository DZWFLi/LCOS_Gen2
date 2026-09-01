/** Provider-neutral model runtime contract. Secrets never cross this boundary. */
export type IntelligenceRoleV0 = 'utility' | 'chat'
export type IntelligenceWireProtocolV0 =
  | 'openai-responses'
  | 'openai-chat'
  | 'anthropic-messages'
  | 'google-generate-content'
  | 'ollama-chat'
  | 'azure-openai-chat'

export interface IntelligenceProviderStatusV0 {
  readonly id: string
  readonly label: string
  readonly protocol: IntelligenceWireProtocolV0
  readonly configured: boolean
  readonly available: boolean
  readonly endpoint: string
  readonly model?: string
  readonly roles: readonly IntelligenceRoleV0[]
  readonly reason?: string
}

export interface IntelligenceStatusV0 {
  readonly provider: 'multi' | 'none'
  readonly available: boolean
  readonly activeUtilityProviderId?: string
  readonly activeChatProviderId?: string
  readonly providers: readonly IntelligenceProviderStatusV0[]
  readonly endpoint?: string
  readonly generativeModels: readonly string[]
  readonly embeddingModels: readonly string[]
}
