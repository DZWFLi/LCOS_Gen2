import type { IntentTypeV0 } from '@local-creative-os/contracts'

/**
 * B4 provider-neutral intelligence layer.
 *
 * The Local Core owns credentials and model transport. GUI/CLI/MCP only see
 * redacted status and structured results. Provider configs use env-var names,
 * never raw secrets, so API keys cannot leak through Runtime responses.
 *
 * Design borrowed from Huabu's provider/model separation, but LCOS keeps a
 * much smaller role contract: `utility` is used for intent/ranking/background
 * reasoning; `chat` is reserved for later Companion/Harness integration.
 */
export type IntelligenceRoleV0 = 'utility' | 'chat'
export type IntelligenceWireProtocolV0 =
  | 'openai-responses'
  | 'openai-chat'
  | 'anthropic-messages'
  | 'google-generate-content'
  | 'ollama-chat'
  | 'azure-openai-chat'

export interface IntelligenceProviderConfigV0 {
  readonly id: string
  readonly label: string
  readonly protocol: IntelligenceWireProtocolV0
  readonly baseUrl: string
  readonly model?: string | undefined
  readonly apiKeyEnv?: string
  readonly apiVersion?: string
  readonly deployment?: string | undefined
  readonly enabled?: boolean
  readonly priority?: number
  readonly roles?: readonly IntelligenceRoleV0[]
  readonly structuredOutput?: 'json-schema' | 'json-object' | 'prompt-json'
  readonly extraHeaders?: Readonly<Record<string, string>>
}

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
  /** Back-compat convenience for old status UI. */
  readonly endpoint?: string
  readonly generativeModels: readonly string[]
  readonly embeddingModels: readonly string[]
}

export interface IntentInferenceInputV0 {
  readonly explicitAction?: string
  readonly selectionTitles: readonly string[]
  readonly pinnedTitles: readonly string[]
  readonly sceneName?: string
  readonly openLoops: readonly string[]
  readonly recentDelta: readonly string[]
  readonly currentSurface?: string
}

export interface IntentInferenceResultV0 {
  readonly type: IntentTypeV0
  readonly goal: string
  readonly constraints: readonly string[]
  readonly expectedOutput?: string
  readonly confidence: number
  readonly providerId: string
  readonly model?: string
}

interface StructuredRequest {
  readonly schemaName: string
  readonly schema: Record<string, unknown>
  readonly system: string
  readonly input: unknown
  readonly temperature?: number
  readonly timeoutMs?: number
  readonly signal?: AbortSignal
}

interface StructuredResult {
  readonly value: Record<string, unknown>
  readonly providerId: string
  readonly model?: string
}

const INTENT_TYPES: readonly IntentTypeV0[] = [
  'continue_work', 'understand', 'compare', 'revise', 'review', 'extract_actions',
  'create_brief', 'organize', 'research', 'execute_skill', 'unknown',
]

const INTENT_SCHEMA: Record<string, unknown> = {
  type: 'object',
  properties: {
    type: { type: 'string', enum: INTENT_TYPES },
    goal: { type: 'string' },
    constraints: { type: 'array', items: { type: 'string' }, maxItems: 6 },
    expectedOutput: { type: 'string' },
    confidence: { type: 'number', minimum: 0, maximum: 1 },
  },
  required: ['type', 'goal', 'constraints', 'confidence'],
  additionalProperties: false,
}

const DEFAULT_TIMEOUT_MS = 8_000
const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]', '::1'])

function env(name: string | undefined): string | undefined {
  if (!name) return undefined
  const value = process.env[name]?.trim()
  return value ? value : undefined
}

function trimSlash(value: string): string {
  return value.replace(/\/+$/, '')
}

function clampConfidence(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0.5
}

function jsonFromText(text: string): Record<string, unknown> | undefined {
  const cleaned = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')
  try {
    const parsed = JSON.parse(cleaned) as unknown
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed) ? parsed as Record<string, unknown> : undefined
  } catch {
    const start = cleaned.indexOf('{')
    const end = cleaned.lastIndexOf('}')
    if (start < 0 || end <= start) return undefined
    try {
      const parsed = JSON.parse(cleaned.slice(start, end + 1)) as unknown
      return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed) ? parsed as Record<string, unknown> : undefined
    } catch {
      return undefined
    }
  }
}

function parseConfigJson(raw: string | undefined): IntelligenceProviderConfigV0[] {
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw) as unknown
    const values = Array.isArray(parsed)
      ? parsed
      : (typeof parsed === 'object' && parsed !== null && Array.isArray((parsed as { providers?: unknown }).providers)
          ? (parsed as { providers: unknown[] }).providers
          : [])
    return values.flatMap((value): IntelligenceProviderConfigV0[] => {
      if (typeof value !== 'object' || value === null) return []
      const item = value as Record<string, unknown>
      if (typeof item.id !== 'string' || typeof item.baseUrl !== 'string' || typeof item.protocol !== 'string') return []
      if (!['openai-responses', 'openai-chat', 'anthropic-messages', 'google-generate-content', 'ollama-chat', 'azure-openai-chat'].includes(item.protocol)) return []
      const roles = Array.isArray(item.roles)
        ? item.roles.filter((role): role is IntelligenceRoleV0 => role === 'utility' || role === 'chat')
        : ['utility'] as IntelligenceRoleV0[]
      return [{
        id: item.id,
        label: typeof item.label === 'string' ? item.label : item.id,
        protocol: item.protocol as IntelligenceWireProtocolV0,
        baseUrl: item.baseUrl,
        ...(typeof item.model === 'string' ? { model: item.model } : {}),
        ...(typeof item.apiKeyEnv === 'string' ? { apiKeyEnv: item.apiKeyEnv } : {}),
        ...(typeof item.apiVersion === 'string' ? { apiVersion: item.apiVersion } : {}),
        ...(typeof item.deployment === 'string' ? { deployment: item.deployment } : {}),
        ...(typeof item.enabled === 'boolean' ? { enabled: item.enabled } : {}),
        ...(typeof item.priority === 'number' ? { priority: item.priority } : {}),
        roles,
        ...(item.structuredOutput === 'json-schema' || item.structuredOutput === 'json-object' || item.structuredOutput === 'prompt-json'
          ? { structuredOutput: item.structuredOutput }
          : {}),
      }]
    })
  } catch {
    return []
  }
}

/**
 * Provider presets. The model remains configurable because vendor catalogs move
 * faster than LCOS releases. DeepSeek gets a current safe default because its
 * API publishes a stable V4 model name; other cloud providers require a model
 * env to avoid silently pinning stale SKUs.
 */
function envProviderPresets(): IntelligenceProviderConfigV0[] {
  const presets: IntelligenceProviderConfigV0[] = [
    {
      id: 'openai', label: 'OpenAI', protocol: 'openai-responses', baseUrl: process.env.OPENAI_BASE_URL ?? 'https://api.openai.com/v1',
      ...(env('OPENAI_MODEL') ? { model: env('OPENAI_MODEL') } : {}), apiKeyEnv: 'OPENAI_API_KEY', roles: ['utility', 'chat'], priority: 20, structuredOutput: 'json-schema',
    },
    {
      id: 'deepseek', label: 'DeepSeek', protocol: 'openai-chat', baseUrl: process.env.DEEPSEEK_BASE_URL ?? 'https://api.deepseek.com',
      model: env('DEEPSEEK_MODEL') ?? 'deepseek-v4-flash', apiKeyEnv: 'DEEPSEEK_API_KEY', roles: ['utility', 'chat'], priority: 10, structuredOutput: 'json-object',
    },
    {
      id: 'anthropic', label: 'Anthropic', protocol: 'anthropic-messages', baseUrl: process.env.ANTHROPIC_BASE_URL ?? 'https://api.anthropic.com',
      ...(env('ANTHROPIC_MODEL') ? { model: env('ANTHROPIC_MODEL') } : {}), apiKeyEnv: 'ANTHROPIC_API_KEY', roles: ['utility', 'chat'], priority: 30, structuredOutput: 'prompt-json',
    },
    {
      id: 'google', label: 'Google Gemini', protocol: 'google-generate-content', baseUrl: process.env.GEMINI_BASE_URL ?? 'https://generativelanguage.googleapis.com/v1beta',
      ...(env('GEMINI_MODEL') ? { model: env('GEMINI_MODEL') } : {}), apiKeyEnv: 'GEMINI_API_KEY', roles: ['utility', 'chat'], priority: 40, structuredOutput: 'json-schema',
    },
    { id: 'openrouter', label: 'OpenRouter', protocol: 'openai-chat', baseUrl: process.env.OPENROUTER_BASE_URL ?? 'https://openrouter.ai/api/v1', ...(env('OPENROUTER_MODEL') ? { model: env('OPENROUTER_MODEL') } : {}), apiKeyEnv: 'OPENROUTER_API_KEY', roles: ['utility', 'chat'], priority: 50, structuredOutput: 'json-object' },
    { id: 'groq', label: 'Groq', protocol: 'openai-chat', baseUrl: process.env.GROQ_BASE_URL ?? 'https://api.groq.com/openai/v1', ...(env('GROQ_MODEL') ? { model: env('GROQ_MODEL') } : {}), apiKeyEnv: 'GROQ_API_KEY', roles: ['utility', 'chat'], priority: 55, structuredOutput: 'json-object' },
    { id: 'mistral', label: 'Mistral', protocol: 'openai-chat', baseUrl: process.env.MISTRAL_BASE_URL ?? 'https://api.mistral.ai/v1', ...(env('MISTRAL_MODEL') ? { model: env('MISTRAL_MODEL') } : {}), apiKeyEnv: 'MISTRAL_API_KEY', roles: ['utility', 'chat'], priority: 55, structuredOutput: 'json-object' },
    { id: 'xai', label: 'xAI', protocol: 'openai-chat', baseUrl: process.env.XAI_BASE_URL ?? 'https://api.x.ai/v1', ...(env('XAI_MODEL') ? { model: env('XAI_MODEL') } : {}), apiKeyEnv: 'XAI_API_KEY', roles: ['utility', 'chat'], priority: 55, structuredOutput: 'json-object' },
    { id: 'qwen', label: 'Qwen / DashScope', protocol: 'openai-chat', baseUrl: process.env.QWEN_BASE_URL ?? 'https://dashscope.aliyuncs.com/compatible-mode/v1', ...(env('QWEN_MODEL') ? { model: env('QWEN_MODEL') } : {}), apiKeyEnv: 'DASHSCOPE_API_KEY', roles: ['utility', 'chat'], priority: 55, structuredOutput: 'json-object' },
    { id: 'zhipu', label: 'Zhipu / GLM', protocol: 'openai-chat', baseUrl: process.env.ZHIPU_BASE_URL ?? 'https://open.bigmodel.cn/api/paas/v4', ...(env('ZHIPU_MODEL') ? { model: env('ZHIPU_MODEL') } : {}), apiKeyEnv: 'ZHIPU_API_KEY', roles: ['utility', 'chat'], priority: 55, structuredOutput: 'json-object' },
    { id: 'moonshot', label: 'Moonshot / Kimi', protocol: 'openai-chat', baseUrl: process.env.MOONSHOT_BASE_URL ?? 'https://api.moonshot.cn/v1', ...(env('MOONSHOT_MODEL') ? { model: env('MOONSHOT_MODEL') } : {}), apiKeyEnv: 'MOONSHOT_API_KEY', roles: ['utility', 'chat'], priority: 55, structuredOutput: 'json-object' },
    { id: 'siliconflow', label: 'SiliconFlow', protocol: 'openai-chat', baseUrl: process.env.SILICONFLOW_BASE_URL ?? 'https://api.siliconflow.cn/v1', ...(env('SILICONFLOW_MODEL') ? { model: env('SILICONFLOW_MODEL') } : {}), apiKeyEnv: 'SILICONFLOW_API_KEY', roles: ['utility', 'chat'], priority: 55, structuredOutput: 'json-object' },
    { id: 'minimax', label: 'MiniMax', protocol: 'openai-chat', baseUrl: process.env.MINIMAX_BASE_URL ?? 'https://api.minimax.io/v1', ...(env('MINIMAX_MODEL') ? { model: env('MINIMAX_MODEL') } : {}), apiKeyEnv: 'MINIMAX_API_KEY', roles: ['utility', 'chat'], priority: 55, structuredOutput: 'json-object' },
    { id: 'hunyuan', label: 'Tencent Hunyuan', protocol: 'openai-chat', baseUrl: process.env.HUNYUAN_BASE_URL ?? 'https://api.hunyuan.cloud.tencent.com/v1', ...(env('HUNYUAN_MODEL') ? { model: env('HUNYUAN_MODEL') } : {}), apiKeyEnv: 'HUNYUAN_API_KEY', roles: ['utility', 'chat'], priority: 56, structuredOutput: 'json-object' },
    { id: 'qianfan', label: 'Baidu Qianfan', protocol: 'openai-chat', baseUrl: process.env.QIANFAN_BASE_URL ?? 'https://qianfan.baidubce.com/v2', ...(env('QIANFAN_MODEL') ? { model: env('QIANFAN_MODEL') } : {}), apiKeyEnv: 'QIANFAN_API_KEY', roles: ['utility', 'chat'], priority: 56, structuredOutput: 'json-object' },
    { id: 'cohere', label: 'Cohere', protocol: 'openai-chat', baseUrl: process.env.COHERE_BASE_URL ?? 'https://api.cohere.ai/compatibility/v1', ...(env('COHERE_MODEL') ? { model: env('COHERE_MODEL') } : {}), apiKeyEnv: 'COHERE_API_KEY', roles: ['utility', 'chat'], priority: 56, structuredOutput: 'json-object' },
    { id: 'together', label: 'Together AI', protocol: 'openai-chat', baseUrl: process.env.TOGETHER_BASE_URL ?? 'https://api.together.ai/v1', ...(env('TOGETHER_MODEL') ? { model: env('TOGETHER_MODEL') } : {}), apiKeyEnv: 'TOGETHER_API_KEY', roles: ['utility', 'chat'], priority: 56, structuredOutput: 'json-schema' },
    { id: 'fireworks', label: 'Fireworks AI', protocol: 'openai-chat', baseUrl: process.env.FIREWORKS_BASE_URL ?? 'https://api.fireworks.ai/inference/v1', ...(env('FIREWORKS_MODEL') ? { model: env('FIREWORKS_MODEL') } : {}), apiKeyEnv: 'FIREWORKS_API_KEY', roles: ['utility', 'chat'], priority: 56, structuredOutput: 'json-schema' },
    { id: 'ark', label: 'Volcengine Ark', protocol: 'openai-responses', baseUrl: process.env.ARK_BASE_URL ?? 'https://ark.cn-beijing.volces.com/api/v3', ...(env('ARK_MODEL') ? { model: env('ARK_MODEL') } : {}), apiKeyEnv: 'ARK_API_KEY', roles: ['utility', 'chat'], priority: 57, structuredOutput: 'json-schema' },
    { id: 'perplexity', label: 'Perplexity Agent API', protocol: 'openai-responses', baseUrl: process.env.PERPLEXITY_BASE_URL ?? 'https://api.perplexity.ai/v1', ...(env('PERPLEXITY_MODEL') ? { model: env('PERPLEXITY_MODEL') } : {}), apiKeyEnv: 'PERPLEXITY_API_KEY', roles: ['utility', 'chat'], priority: 57, structuredOutput: 'json-schema' },
    { id: 'bedrock', label: 'Amazon Bedrock Mantle', protocol: 'openai-responses', baseUrl: process.env.BEDROCK_BASE_URL ?? '', ...(env('BEDROCK_MODEL') ? { model: env('BEDROCK_MODEL') } : {}), apiKeyEnv: 'BEDROCK_API_KEY', roles: ['utility', 'chat'], priority: 58, structuredOutput: 'json-schema' },
    {
      id: 'azure-openai', label: 'Azure OpenAI', protocol: 'azure-openai-chat', baseUrl: process.env.AZURE_OPENAI_ENDPOINT ?? '',
      ...(env('AZURE_OPENAI_DEPLOYMENT') ? { deployment: env('AZURE_OPENAI_DEPLOYMENT'), model: env('AZURE_OPENAI_DEPLOYMENT') } : {}),
      apiKeyEnv: 'AZURE_OPENAI_API_KEY', apiVersion: process.env.AZURE_OPENAI_API_VERSION ?? '2024-10-21', roles: ['utility', 'chat'], priority: 45, structuredOutput: 'json-schema',
    },
    {
      id: 'ollama', label: 'Ollama', protocol: 'ollama-chat', baseUrl: process.env.LCOS_OLLAMA_URL ?? 'http://127.0.0.1:11434',
      ...(env('LCOS_OLLAMA_MODEL') ? { model: env('LCOS_OLLAMA_MODEL') } : {}), roles: ['utility', 'chat'], priority: 90, structuredOutput: 'json-schema',
    },
    {
      id: 'lmstudio', label: 'LM Studio', protocol: 'openai-chat', baseUrl: process.env.LMSTUDIO_BASE_URL ?? 'http://127.0.0.1:1234/v1',
      ...(env('LMSTUDIO_MODEL') ? { model: env('LMSTUDIO_MODEL') } : {}), roles: ['utility', 'chat'], priority: 95, structuredOutput: 'json-object',
    },
    {
      id: 'openai-compatible', label: 'OpenAI-compatible', protocol: 'openai-chat', baseUrl: process.env.LCOS_COMPATIBLE_BASE_URL ?? '',
      ...(env('LCOS_COMPATIBLE_MODEL') ? { model: env('LCOS_COMPATIBLE_MODEL') } : {}), apiKeyEnv: 'LCOS_COMPATIBLE_API_KEY', roles: ['utility', 'chat'], priority: 70, structuredOutput: 'json-object',
    },
  ]
  return presets.filter((provider) => provider.baseUrl.trim().length > 0)
}

function configured(provider: IntelligenceProviderConfigV0): boolean {
  if (provider.enabled === false || provider.baseUrl.trim().length === 0) return false
  if (provider.protocol === 'ollama-chat') return true
  if ((provider.protocol === 'openai-chat' || provider.protocol === 'openai-responses') && LOOPBACK_HOSTS.has(new URL(provider.baseUrl).hostname)) return provider.model !== undefined
  return provider.model !== undefined && (provider.apiKeyEnv === undefined || env(provider.apiKeyEnv) !== undefined)
}

function authorizationHeaders(provider: IntelligenceProviderConfigV0): Record<string, string> {
  const key = env(provider.apiKeyEnv)
  const headers: Record<string, string> = { 'content-type': 'application/json', ...(provider.extraHeaders ?? {}) }
  if (!key) return headers
  if (provider.protocol === 'anthropic-messages') {
    headers['x-api-key'] = key
    headers['anthropic-version'] = '2023-06-01'
  } else if (provider.protocol === 'azure-openai-chat') {
    headers['api-key'] = key
  } else {
    headers.authorization = `Bearer ${key}`
  }
  return headers
}

async function fetchJson(url: string, init: RequestInit, timeoutMs: number, signal?: AbortSignal): Promise<Record<string, unknown> | undefined> {
  const timeoutSignal = AbortSignal.timeout(Math.max(1, timeoutMs))
  const response = await fetch(url, { ...init, signal: signal === undefined ? timeoutSignal : AbortSignal.any([signal, timeoutSignal]) })
  if (!response.ok) return undefined
  const body = await response.json() as unknown
  return typeof body === 'object' && body !== null && !Array.isArray(body) ? body as Record<string, unknown> : undefined
}

function openAiResponsesText(body: Record<string, unknown>): string | undefined {
  if (typeof body.output_text === 'string' && body.output_text.trim()) return body.output_text
  const output = Array.isArray(body.output) ? body.output : []
  return output.flatMap((item) => {
    if (typeof item !== 'object' || item === null) return []
    const content = Array.isArray((item as Record<string, unknown>).content) ? (item as Record<string, unknown>).content as unknown[] : []
    return content.flatMap((part) => {
      if (typeof part !== 'object' || part === null) return []
      const record = part as Record<string, unknown>
      if ((record.type === 'output_text' || record.type === 'text') && typeof record.text === 'string') return [record.text]
      return []
    })
  }).join('') || undefined
}

function openAiText(body: Record<string, unknown>): string | undefined {
  const choices = Array.isArray(body.choices) ? body.choices : []
  const message = choices[0] && typeof choices[0] === 'object' ? (choices[0] as Record<string, unknown>).message : undefined
  if (typeof message !== 'object' || message === null) return undefined
  const content = (message as Record<string, unknown>).content
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content.flatMap((part) => typeof part === 'object' && part !== null && typeof (part as Record<string, unknown>).text === 'string' ? [(part as Record<string, unknown>).text as string] : []).join('')
  }
  return undefined
}

function anthropicText(body: Record<string, unknown>): string | undefined {
  const content = Array.isArray(body.content) ? body.content : []
  return content.flatMap((part) => typeof part === 'object' && part !== null && typeof (part as Record<string, unknown>).text === 'string' ? [(part as Record<string, unknown>).text as string] : []).join('') || undefined
}

function googleText(body: Record<string, unknown>): string | undefined {
  const candidates = Array.isArray(body.candidates) ? body.candidates : []
  const first = candidates[0]
  if (typeof first !== 'object' || first === null) return undefined
  const content = (first as Record<string, unknown>).content
  if (typeof content !== 'object' || content === null) return undefined
  const parts = Array.isArray((content as Record<string, unknown>).parts) ? (content as Record<string, unknown>).parts as unknown[] : []
  return parts.flatMap((part) => typeof part === 'object' && part !== null && typeof (part as Record<string, unknown>).text === 'string' ? [(part as Record<string, unknown>).text as string] : []).join('') || undefined
}

export class IntelligenceProviderService {
  readonly #providers: readonly IntelligenceProviderConfigV0[]
  readonly #utilityPreference: string | undefined
  readonly #chatPreference: string | undefined
  #statusCache?: { readonly expiresAt: number; readonly value: IntelligenceStatusV0 }

  constructor(providers?: readonly IntelligenceProviderConfigV0[] | string) {
    const custom = parseConfigJson(process.env.LCOS_INTELLIGENCE_PROVIDERS)
    const resolvedProviders = typeof providers === 'string'
      ? [{ id: 'ollama', label: 'Ollama', protocol: 'ollama-chat' as const, baseUrl: providers, roles: ['utility', 'chat'] as const }]
      : providers
    this.#providers = (resolvedProviders ?? [...custom, ...envProviderPresets()])
      .filter((provider, index, all) => all.findIndex((candidate) => candidate.id === provider.id) === index)
      .sort((a, b) => (a.priority ?? 100) - (b.priority ?? 100) || a.id.localeCompare(b.id))
    this.#utilityPreference = env('LCOS_UTILITY_PROVIDER') ?? env('LCOS_INTELLIGENCE_PROVIDER')
    this.#chatPreference = env('LCOS_CHAT_PROVIDER')
  }

  providers(): readonly IntelligenceProviderConfigV0[] {
    return this.#providers
  }

  #candidates(role: IntelligenceRoleV0): readonly IntelligenceProviderConfigV0[] {
    const preferred = role === 'utility' ? this.#utilityPreference : this.#chatPreference
    const eligible = this.#providers.filter((provider) => (provider.roles ?? ['utility']).includes(role) && configured(provider))
    if (!preferred) return eligible
    const exact = eligible.find((provider) => provider.id === preferred)
    return exact === undefined ? eligible : [exact, ...eligible.filter((provider) => provider.id !== exact.id)]
  }

  #resolve(role: IntelligenceRoleV0): IntelligenceProviderConfigV0 | undefined {
    return this.#candidates(role)[0]
  }

  /** P0-C/P0-D harness 语义生成入口：Core 侧保留凭证，子进程经 reachback 调用。
   * 返回 undefined / 抛错 → semanticUnavailable=true（honest，harness 据此诚实降级/失败）。
   */
  async generateSemantic(request: { readonly schemaName: string; readonly schema: Record<string, unknown>; readonly system: string; readonly input: unknown; readonly temperature?: number; readonly timeoutMs?: number }): Promise<{ readonly ok: boolean; readonly value?: Record<string, unknown>; readonly model?: string; readonly semanticUnavailable?: boolean }> {
    try {
      const result = await this.generateStructured('utility', request)
      if (result === undefined) return { ok: false, semanticUnavailable: true }
      return { ok: true, ...(result.value ? { value: result.value } : {}), ...(result.model ? { model: result.model } : {}) }
    } catch {
      return { ok: false, semanticUnavailable: true }
    }
  }
  async status(): Promise<IntelligenceStatusV0> {
    if (this.#statusCache && this.#statusCache.expiresAt > Date.now()) return this.#statusCache.value
    const utility = this.#resolve('utility')
    const chat = this.#resolve('chat')
    const statuses = await Promise.all(this.#providers.map(async (provider): Promise<IntelligenceProviderStatusV0> => {
      const isConfigured = configured(provider)
      let available = isConfigured
      let reason: string | undefined
      if (provider.protocol === 'ollama-chat') {
        try {
          const url = new URL(provider.baseUrl)
          if (!LOOPBACK_HOSTS.has(url.hostname)) {
            available = false
            reason = 'Ollama endpoint must be loopback.'
          } else {
            const response = await fetch(`${trimSlash(provider.baseUrl)}/api/version`, { signal: AbortSignal.timeout(1_500) })
            available = response.ok
            if (!available) reason = `HTTP ${response.status}`
          }
        } catch {
          available = false
          reason = 'Local endpoint unavailable.'
        }
      }
      return {
        id: provider.id,
        label: provider.label,
        protocol: provider.protocol,
        configured: isConfigured,
        available,
        endpoint: provider.baseUrl,
        ...(provider.model ? { model: provider.model } : {}),
        roles: provider.roles ?? ['utility'],
        ...(reason ? { reason } : {}),
      }
    }))
    const active = utility ?? chat
    const activeStatus = active ? statuses.find((item) => item.id === active.id) : undefined
    const value: IntelligenceStatusV0 = {
      provider: activeStatus?.available ? 'multi' : 'none',
      available: activeStatus?.available ?? false,
      ...(utility ? { activeUtilityProviderId: utility.id } : {}),
      ...(chat ? { activeChatProviderId: chat.id } : {}),
      providers: statuses,
      ...(active ? { endpoint: active.baseUrl } : {}),
      generativeModels: [...new Set(statuses.flatMap((item) => item.model ? [item.model] : []))],
      embeddingModels: [],
    }
    this.#statusCache = { value, expiresAt: Date.now() + 15_000 }
    return value
  }

  async inferIntent(input: IntentInferenceInputV0, signal?: AbortSignal): Promise<IntentInferenceResultV0 | undefined> {
    const result = await this.generateStructured('utility', {
      schemaName: 'lcos_intent_v0',
      schema: INTENT_SCHEMA,
      system: [
        'You resolve the CURRENT work intent for a local project continuity system.',
        'Infer only from supplied work signals. Never invent a new project goal.',
        'Prefer a concrete transformation such as revise/review/compare over generic understand when evidence supports it.',
        'Use unknown when evidence is insufficient.',
        'Return JSON only and conform to the supplied schema.',
      ].join(' '),
      input,
      timeoutMs: DEFAULT_TIMEOUT_MS,
      ...(signal === undefined ? {} : { signal }),
    })
    if (!result) return undefined
    const parsed = result.value
    if (typeof parsed.type !== 'string' || !INTENT_TYPES.includes(parsed.type as IntentTypeV0)) return undefined
    const goal = typeof parsed.goal === 'string' ? parsed.goal.trim() : ''
    const constraints = Array.isArray(parsed.constraints)
      ? parsed.constraints.filter((item): item is string => typeof item === 'string').map((item) => item.trim()).filter(Boolean).slice(0, 6)
      : []
    return {
      type: parsed.type as IntentTypeV0,
      goal: goal || '继续当前工作',
      constraints,
      ...(typeof parsed.expectedOutput === 'string' && parsed.expectedOutput.trim() ? { expectedOutput: parsed.expectedOutput.trim() } : {}),
      confidence: clampConfidence(parsed.confidence),
      providerId: result.providerId,
      ...(result.model ? { model: result.model } : {}),
    }
  }

  async generateStructured(role: IntelligenceRoleV0, request: StructuredRequest): Promise<StructuredResult | undefined> {
    // Provider preference chooses the first attempt, not a single point of failure.
    // This is deliberately transport-neutral: a configured cloud API may fall
    // through to another cloud provider or a loopback local model before B4
    // finally returns to deterministic rules.
    const deadline = Date.now() + (request.timeoutMs ?? 10_000)
    for (const provider of this.#candidates(role)) {
      if (request.signal?.aborted) throw request.signal.reason
      const remainingMs = deadline - Date.now()
      if (remainingMs <= 0) break
      try {
        const value = await this.#callStructured(provider, { ...request, timeoutMs: Math.min(DEFAULT_TIMEOUT_MS, remainingMs) })
        if (value) return { value, providerId: provider.id, ...(provider.model ? { model: provider.model } : {}) }
      } catch (error) {
        if (request.signal?.aborted) throw error
        // Continue through the configured role chain. The caller owns the final
        // deterministic fallback, so one transient vendor failure never changes
        // the Intent/Attention contract.
      }
    }
    return undefined
  }

  async #callStructured(provider: IntelligenceProviderConfigV0, request: StructuredRequest): Promise<Record<string, unknown> | undefined> {
    const timeoutMs = request.timeoutMs ?? DEFAULT_TIMEOUT_MS
    const baseUrl = trimSlash(provider.baseUrl)
    const model = provider.model
    if (provider.protocol !== 'ollama-chat' && !model) return undefined

    if (provider.protocol === 'ollama-chat') {
      let chosenModel = model
      if (!chosenModel) {
        const tags = await fetchJson(`${baseUrl}/api/tags`, { method: 'GET' }, Math.min(2_000, timeoutMs), request.signal)
        const models = Array.isArray(tags?.models) ? tags.models : []
        const first = models.find((item) => typeof item === 'object' && item !== null && typeof (item as Record<string, unknown>).name === 'string') as Record<string, unknown> | undefined
        chosenModel = typeof first?.name === 'string' ? first.name : undefined
      }
      if (!chosenModel) return undefined
      const body = await fetchJson(`${baseUrl}/api/chat`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({
          model: chosenModel,
          stream: false,
          format: request.schema,
          options: request.temperature === undefined ? {} : { temperature: request.temperature },
          messages: [{ role: 'system', content: request.system }, { role: 'user', content: JSON.stringify(request.input) }],
        }),
      }, timeoutMs, request.signal)
      const message = body?.message
      const text = typeof message === 'object' && message !== null && typeof (message as Record<string, unknown>).content === 'string'
        ? (message as Record<string, unknown>).content as string
        : undefined
      return text ? jsonFromText(text) : undefined
    }

    if (provider.protocol === 'openai-responses') {
      const body = await fetchJson(`${baseUrl}/responses`, {
        method: 'POST', headers: authorizationHeaders(provider), body: JSON.stringify({
          model,
          store: false,
          instructions: request.system,
          input: JSON.stringify(request.input),
          text: {
            format: provider.structuredOutput === 'json-schema'
              ? { type: 'json_schema', name: request.schemaName, strict: true, schema: request.schema }
              : { type: 'json_object' },
          },
        }),
      }, timeoutMs, request.signal)
      const text = body ? openAiResponsesText(body) : undefined
      return text ? jsonFromText(text) : undefined
    }

    if (provider.protocol === 'anthropic-messages') {
      const body = await fetchJson(`${baseUrl}/v1/messages`, {
        method: 'POST', headers: authorizationHeaders(provider), body: JSON.stringify({
          model,
          max_tokens: 900,
          ...(request.temperature === undefined ? {} : { temperature: request.temperature }),
          system: `${request.system}\nJSON schema: ${JSON.stringify(request.schema)}`,
          messages: [{ role: 'user', content: JSON.stringify(request.input) }],
        }),
      }, timeoutMs, request.signal)
      const text = body ? anthropicText(body) : undefined
      return text ? jsonFromText(text) : undefined
    }

    if (provider.protocol === 'google-generate-content') {
      const key = env(provider.apiKeyEnv)
      if (!key || !model) return undefined
      const url = `${baseUrl}/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(key)}`
      const body = await fetchJson(url, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({
          systemInstruction: { parts: [{ text: request.system }] },
          contents: [{ role: 'user', parts: [{ text: JSON.stringify(request.input) }] }],
          generationConfig: {
            ...(request.temperature === undefined ? {} : { temperature: request.temperature }),
            responseMimeType: 'application/json',
            responseJsonSchema: request.schema,
          },
        }),
      }, timeoutMs, request.signal)
      const text = body ? googleText(body) : undefined
      return text ? jsonFromText(text) : undefined
    }

    let url: string
    if (provider.protocol === 'azure-openai-chat') {
      if (!provider.deployment) return undefined
      url = `${baseUrl}/openai/deployments/${encodeURIComponent(provider.deployment)}/chat/completions?api-version=${encodeURIComponent(provider.apiVersion ?? '2024-10-21')}`
    } else {
      url = `${baseUrl}/chat/completions`
    }
    const responseFormat = provider.structuredOutput === 'json-schema'
      ? { type: 'json_schema', json_schema: { name: request.schemaName, strict: true, schema: request.schema } }
      : { type: 'json_object' }
    const body = await fetchJson(url, {
      method: 'POST', headers: authorizationHeaders(provider), body: JSON.stringify({
        model,
        ...(request.temperature === undefined ? {} : { temperature: request.temperature }),
        response_format: responseFormat,
        messages: [
          { role: 'system', content: `${request.system}\nReturn a single JSON object only.` },
          { role: 'user', content: JSON.stringify(request.input) },
        ],
      }),
    }, timeoutMs, request.signal)
    const text = body ? openAiText(body) : undefined
    return text ? jsonFromText(text) : undefined
  }
}