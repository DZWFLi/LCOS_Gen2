import { afterEach, describe, expect, it, vi } from 'vitest'

import { IntelligenceProviderService, type IntelligenceProviderConfigV0 } from '../src/intelligence-provider-service.js'

const originalFetch = globalThis.fetch
const envKeys = [
  'LCOS_UTILITY_PROVIDER', 'LCOS_INTELLIGENCE_PROVIDER', 'LCOS_CHAT_PROVIDER',
  'DEEPSEEK_API_KEY', 'OPENAI_API_KEY', 'ANTHROPIC_API_KEY', 'GEMINI_API_KEY',
]
const envBackup = new Map(envKeys.map((key) => [key, process.env[key]]))

afterEach(() => {
  globalThis.fetch = originalFetch
  for (const key of envKeys) {
    const value = envBackup.get(key)
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
  vi.restoreAllMocks()
})

const input = {
  selectionTitles: ['客户反馈', 'Script v3'],
  pinnedTitles: ['产品卖点'],
  openLoops: ['脚本尚未响应第二轮反馈'],
  recentDelta: ['新增 Feedback R2'],
  currentSurface: 'arrange',
} as const

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

describe('IntelligenceProviderService', () => {
  it('uses an OpenAI-compatible provider such as DeepSeek and keeps transport provider-neutral', async () => {
    process.env.DEEPSEEK_API_KEY = 'secret-do-not-expose'
    const providers: IntelligenceProviderConfigV0[] = [{
      id: 'deepseek', label: 'DeepSeek', protocol: 'openai-chat', baseUrl: 'https://api.deepseek.com',
      model: 'deepseek-v4-flash', apiKeyEnv: 'DEEPSEEK_API_KEY', roles: ['utility'], structuredOutput: 'json-object',
    }]
    globalThis.fetch = vi.fn(async (url, init) => {
      expect(String(url)).toBe('https://api.deepseek.com/chat/completions')
      expect((init?.headers as Record<string, string>).authorization).toBe('Bearer secret-do-not-expose')
      const request = JSON.parse(String(init?.body)) as { model: string; response_format: { type: string } }
      expect(request.model).toBe('deepseek-v4-flash')
      expect(request.response_format.type).toBe('json_object')
      return response({ choices: [{ message: { content: JSON.stringify({ type: 'revise', goal: '根据反馈修改脚本', constraints: ['保留卖点'], expectedOutput: 'Script v4', confidence: 0.91 }) } }] })
    }) as typeof fetch

    const service = new IntelligenceProviderService(providers)
    const result = await service.inferIntent(input)
    expect(result).toMatchObject({ type: 'revise', providerId: 'deepseek', model: 'deepseek-v4-flash', confidence: 0.91 })
    const status = await service.status()
    expect(JSON.stringify(status)).not.toContain('secret-do-not-expose')
  })

  it('supports OpenAI Responses compatible providers with strict structured output', async () => {
    process.env.OPENAI_API_KEY = 'openai-secret'
    const providers: IntelligenceProviderConfigV0[] = [{
      id: 'responses', label: 'Responses', protocol: 'openai-responses', baseUrl: 'https://responses.example/v1',
      model: 'model-test', apiKeyEnv: 'OPENAI_API_KEY', roles: ['utility'], structuredOutput: 'json-schema',
    }]
    globalThis.fetch = vi.fn(async (url, init) => {
      expect(String(url)).toBe('https://responses.example/v1/responses')
      const request = JSON.parse(String(init?.body)) as { store: boolean; text: { format: { type: string; strict: boolean } } }
      expect(request.store).toBe(false)
      expect(request.text.format).toMatchObject({ type: 'json_schema', strict: true })
      return response({ output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify({ type: 'compare', goal: '比较两个版本', constraints: [], confidence: 0.9 }) }] }] })
    }) as typeof fetch
    const result = await new IntelligenceProviderService(providers).inferIntent(input)
    expect(result).toMatchObject({ type: 'compare', providerId: 'responses', model: 'model-test' })
  })

  it('supports native Anthropic Messages without changing the intent contract', async () => {
    process.env.ANTHROPIC_API_KEY = 'ant-secret'
    const providers: IntelligenceProviderConfigV0[] = [{
      id: 'anthropic', label: 'Anthropic', protocol: 'anthropic-messages', baseUrl: 'https://api.anthropic.com',
      model: 'claude-test', apiKeyEnv: 'ANTHROPIC_API_KEY', roles: ['utility'], structuredOutput: 'prompt-json',
    }]
    globalThis.fetch = vi.fn(async (url, init) => {
      expect(String(url)).toBe('https://api.anthropic.com/v1/messages')
      expect((init?.headers as Record<string, string>)['x-api-key']).toBe('ant-secret')
      return response({ content: [{ type: 'text', text: JSON.stringify({ type: 'review', goal: '复核脚本', constraints: [], confidence: 0.84 }) }] })
    }) as typeof fetch
    const result = await new IntelligenceProviderService(providers).inferIntent(input)
    expect(result).toMatchObject({ type: 'review', providerId: 'anthropic' })
  })

  it('supports native Gemini structured JSON', async () => {
    process.env.GEMINI_API_KEY = 'gem-secret'
    const providers: IntelligenceProviderConfigV0[] = [{
      id: 'google', label: 'Google Gemini', protocol: 'google-generate-content', baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
      model: 'gemini-test', apiKeyEnv: 'GEMINI_API_KEY', roles: ['utility'], structuredOutput: 'json-schema',
    }]
    globalThis.fetch = vi.fn(async (url) => {
      expect(String(url)).toContain('/models/gemini-test:generateContent?key=gem-secret')
      return response({ candidates: [{ content: { parts: [{ text: JSON.stringify({ type: 'extract_actions', goal: '提炼修改项', constraints: [], confidence: 0.88 }) }] } }] })
    }) as typeof fetch
    const result = await new IntelligenceProviderService(providers).inferIntent(input)
    expect(result).toMatchObject({ type: 'extract_actions', providerId: 'google' })
  })

  it('honors utility provider preference instead of hard-wiring one vendor', async () => {
    process.env.LCOS_UTILITY_PROVIDER = 'second'
    const providers: IntelligenceProviderConfigV0[] = [
      { id: 'first', label: 'First', protocol: 'openai-chat', baseUrl: 'https://first.example/v1', model: 'one', roles: ['utility'], structuredOutput: 'json-object', priority: 1 },
      { id: 'second', label: 'Second', protocol: 'openai-chat', baseUrl: 'https://second.example/v1', model: 'two', roles: ['utility'], structuredOutput: 'json-object', priority: 100 },
    ]
    globalThis.fetch = vi.fn(async (url) => response({ choices: [{ message: { content: JSON.stringify({ type: 'understand', goal: String(url), constraints: [], confidence: 0.7 }) } }] })) as typeof fetch
    const result = await new IntelligenceProviderService(providers).inferIntent(input)
    expect(result?.providerId).toBe('second')
    expect(result?.goal).toContain('second.example')
  })

  it('falls through the configured utility chain before deterministic fallback', async () => {
    const providers: IntelligenceProviderConfigV0[] = [
      { id: 'primary', label: 'Primary', protocol: 'openai-chat', baseUrl: 'https://primary.example/v1', model: 'one', roles: ['utility'], structuredOutput: 'json-object', priority: 1 },
      { id: 'backup', label: 'Backup', protocol: 'openai-chat', baseUrl: 'https://backup.example/v1', model: 'two', roles: ['utility'], structuredOutput: 'json-object', priority: 2 },
    ]
    const calls: string[] = []
    globalThis.fetch = vi.fn(async (url) => {
      calls.push(String(url))
      if (String(url).includes('primary.example')) return response({ error: 'temporary' }, 503)
      return response({ choices: [{ message: { content: JSON.stringify({ type: 'review', goal: 'backup worked', constraints: [], confidence: 0.82 }) } }] })
    }) as typeof fetch
    const result = await new IntelligenceProviderService(providers).inferIntent(input)
    expect(result).toMatchObject({ type: 'review', providerId: 'backup', model: 'two' })
    expect(calls).toEqual(['https://primary.example/v1/chat/completions', 'https://backup.example/v1/chat/completions'])
  })

  it('fails closed when no provider is configured, allowing deterministic B4 fallback', async () => {
    const service = new IntelligenceProviderService([{ id: 'none', label: 'None', protocol: 'openai-chat', baseUrl: 'https://none.example/v1', roles: ['utility'] }])
    expect(await service.inferIntent(input)).toBeUndefined()
    expect((await service.status()).available).toBe(false)
  })

  it('propagates caller abort into the active provider request', async () => {
    const providers: IntelligenceProviderConfigV0[] = [{ id: 'slow', label: 'Slow', protocol: 'openai-chat', baseUrl: 'https://slow.example/v1', model: 'slow', roles: ['utility'] }]
    globalThis.fetch = vi.fn((_url, init) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(init.signal?.reason), { once: true })
    })) as typeof fetch
    const controller = new AbortController()
    const pending = new IntelligenceProviderService(providers).inferIntent(input, controller.signal)
    controller.abort(new Error('selection changed'))
    await expect(pending).rejects.toThrow('selection changed')
  })

  it('uses one total deadline across provider fallback instead of a full timeout per provider', async () => {
    const providers: IntelligenceProviderConfigV0[] = [
      { id: 'slow-a', label: 'Slow A', protocol: 'openai-chat', baseUrl: 'https://a.example/v1', model: 'a', roles: ['utility'], priority: 1 },
      { id: 'slow-b', label: 'Slow B', protocol: 'openai-chat', baseUrl: 'https://b.example/v1', model: 'b', roles: ['utility'], priority: 2 },
    ]
    let calls = 0
    globalThis.fetch = vi.fn((_url, init) => new Promise<Response>((_resolve, reject) => {
      calls += 1
      init?.signal?.addEventListener('abort', () => reject(init.signal?.reason), { once: true })
    })) as typeof fetch
    const started = Date.now()
    const result = await new IntelligenceProviderService(providers).generateStructured('utility', {
      schemaName: 'deadline', schema: { type: 'object' }, system: 'Return JSON', input: {}, timeoutMs: 25,
    })
    expect(result).toBeUndefined()
    expect(calls).toBe(1)
    expect(Date.now() - started).toBeLessThan(250)
  })
})
