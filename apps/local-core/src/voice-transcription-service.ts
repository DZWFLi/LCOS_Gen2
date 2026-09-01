/**
 * A24-3 provider-neutral speech-to-text seam.
 *
 * This module deliberately owns only transcription capability selection and
 * normalization. It does not know about browser capture, the Voice XState
 * lifecycle, Composer prompt state, or execution/Run semantics.
 */

export type VoiceTranscriptionErrorCode =
  | 'invalid-audio'
  | 'unsupported-audio'
  | 'provider-unavailable'
  | 'provider-failed'
  | 'aborted'

export interface VoiceTranscriptionAudioV1 {
  readonly bytes: Uint8Array
  readonly mimeType: string
  readonly durationMs?: number
}

export interface VoiceTranscriptionHintsV1 {
  /** BCP-47-ish or provider-specific short language hint such as `zh` / `en-US`. */
  readonly language?: string
  /** Optional domain words / surrounding prompt context. Providers may ignore it. */
  readonly prompt?: string
  /** Request time-aligned segments when the provider can supply them. */
  readonly timestamps?: boolean
}

export interface VoiceTranscriptionRequestV1 {
  readonly audio: VoiceTranscriptionAudioV1
  readonly hints?: VoiceTranscriptionHintsV1
  readonly signal?: AbortSignal
}

export interface VoiceTranscriptionSegmentV1 {
  readonly startMs: number
  readonly endMs: number
  readonly text: string
}

export interface VoiceTranscriptionProviderResultV1 {
  readonly text: string
  readonly language?: string
  readonly segments?: readonly VoiceTranscriptionSegmentV1[]
  readonly model?: string
}

export interface VoiceTranscriptionResultV1 extends VoiceTranscriptionProviderResultV1 {
  readonly providerId: string
}

export interface VoiceTranscriptionProvider {
  readonly id: string
  /** Higher score wins. Return <= 0 when this provider cannot handle the MIME. */
  supports(input: Pick<VoiceTranscriptionAudioV1, 'mimeType'>): number
  transcribe(request: VoiceTranscriptionRequestV1): Promise<VoiceTranscriptionProviderResultV1>
}

export class VoiceTranscriptionError extends Error {
  readonly code: VoiceTranscriptionErrorCode
  readonly retryable: boolean
  readonly providerId: string | undefined

  constructor(
    code: VoiceTranscriptionErrorCode,
    message: string,
    retryable: boolean,
    providerId?: string,
    options?: { readonly cause?: unknown },
  ) {
    super(message, options)
    this.name = 'VoiceTranscriptionError'
    this.code = code
    this.retryable = retryable
    this.providerId = providerId
  }
}

function normalizedMimeType(value: string): string {
  return value.trim().toLocaleLowerCase('en-US').split(';', 1)[0] ?? ''
}

function validateAudio(audio: VoiceTranscriptionAudioV1): void {
  if (audio.bytes.byteLength === 0) {
    throw new VoiceTranscriptionError('invalid-audio', 'Voice transcription requires non-empty audio bytes.', false)
  }
  if (normalizedMimeType(audio.mimeType) === '') {
    throw new VoiceTranscriptionError('invalid-audio', 'Voice transcription requires an explicit audio MIME type.', false)
  }
  if (audio.durationMs !== undefined && (!Number.isFinite(audio.durationMs) || audio.durationMs < 0)) {
    throw new VoiceTranscriptionError('invalid-audio', 'Voice transcription duration must be a finite non-negative value.', false)
  }
}

function validateSegments(segments: readonly VoiceTranscriptionSegmentV1[] | undefined, providerId: string): void {
  if (segments === undefined) return
  let previousEnd = 0
  for (const segment of segments) {
    if (!Number.isFinite(segment.startMs) || !Number.isFinite(segment.endMs) || segment.startMs < 0 || segment.endMs < segment.startMs) {
      throw new VoiceTranscriptionError('provider-failed', `Transcription provider ${providerId} returned an invalid segment range.`, true, providerId)
    }
    if (segment.startMs < previousEnd) {
      throw new VoiceTranscriptionError('provider-failed', `Transcription provider ${providerId} returned overlapping/out-of-order segments.`, true, providerId)
    }
    previousEnd = segment.endMs
  }
}

function normalizeProviderResult(result: VoiceTranscriptionProviderResultV1, providerId: string): VoiceTranscriptionResultV1 {
  if (typeof result.text !== 'string') {
    throw new VoiceTranscriptionError('provider-failed', `Transcription provider ${providerId} returned a non-text transcript.`, true, providerId)
  }
  validateSegments(result.segments, providerId)
  return {
    text: result.text.replace(/\r\n?/g, '\n'),
    ...(result.language?.trim() ? { language: result.language.trim() } : {}),
    ...(result.segments === undefined ? {} : {
      segments: result.segments.map((segment) => ({
        startMs: segment.startMs,
        endMs: segment.endMs,
        text: segment.text.replace(/\r\n?/g, '\n'),
      })),
    }),
    ...(result.model?.trim() ? { model: result.model.trim() } : {}),
    providerId,
  }
}

export interface VoiceTranscriptionProviderRegistryOptions {
  readonly providers?: readonly VoiceTranscriptionProvider[]
  readonly preferredProviderId?: string
}

/** Explicit small registry: no provider guessing from Composer/Run UI state. */
export class VoiceTranscriptionProviderRegistry {
  readonly #providers = new Map<string, VoiceTranscriptionProvider>()
  #preferredProviderId: string | undefined

  constructor(options: VoiceTranscriptionProviderRegistryOptions = {}) {
    for (const provider of options.providers ?? []) this.register(provider)
    if (options.preferredProviderId !== undefined) this.setPreferred(options.preferredProviderId)
  }

  register(provider: VoiceTranscriptionProvider): void {
    const id = provider.id.trim()
    if (id === '') throw new Error('Voice transcription provider id is required.')
    if (this.#providers.has(id)) throw new Error(`Voice transcription provider already registered: ${id}`)
    this.#providers.set(id, provider)
    this.#preferredProviderId ??= id
  }

  setPreferred(providerId: string): void {
    if (!this.#providers.has(providerId)) throw new Error(`Unknown voice transcription provider: ${providerId}`)
    this.#preferredProviderId = providerId
  }

  preferredProviderId(): string | undefined {
    return this.#preferredProviderId
  }

  list(): readonly string[] {
    return [...this.#providers.keys()].sort()
  }

  resolve(audio: Pick<VoiceTranscriptionAudioV1, 'mimeType'>, requestedProviderId?: string): VoiceTranscriptionProvider | undefined {
    if (requestedProviderId !== undefined) {
      const provider = this.#providers.get(requestedProviderId)
      if (provider === undefined || provider.supports(audio) <= 0) return undefined
      return provider
    }

    const preferred = this.#preferredProviderId === undefined ? undefined : this.#providers.get(this.#preferredProviderId)
    if (preferred !== undefined && preferred.supports(audio) > 0) return preferred

    return [...this.#providers.values()]
      .map((provider) => ({ provider, score: provider.supports(audio) }))
      .filter((entry) => entry.score > 0)
      .sort((left, right) => right.score - left.score || left.provider.id.localeCompare(right.provider.id))[0]?.provider
  }
}

export interface VoiceTranscriptionServiceOptions {
  readonly registry: VoiceTranscriptionProviderRegistry
}

export class VoiceTranscriptionService {
  readonly #registry: VoiceTranscriptionProviderRegistry

  constructor(options: VoiceTranscriptionServiceOptions) {
    this.#registry = options.registry
  }

  async transcribe(request: VoiceTranscriptionRequestV1, requestedProviderId?: string): Promise<VoiceTranscriptionResultV1> {
    validateAudio(request.audio)
    if (request.signal?.aborted) throw new VoiceTranscriptionError('aborted', 'Voice transcription was aborted.', true)

    const provider = this.#registry.resolve(request.audio, requestedProviderId)
    if (provider === undefined) {
      const code: VoiceTranscriptionErrorCode = this.#registry.list().length === 0 ? 'provider-unavailable' : 'unsupported-audio'
      throw new VoiceTranscriptionError(
        code,
        requestedProviderId === undefined
          ? `No voice transcription provider can handle ${request.audio.mimeType}.`
          : `Voice transcription provider ${requestedProviderId} is unavailable or cannot handle ${request.audio.mimeType}.`,
        code === 'provider-unavailable',
        requestedProviderId,
      )
    }

    try {
      const result = await provider.transcribe(request)
      return normalizeProviderResult(result, provider.id)
    } catch (error: unknown) {
      if (error instanceof VoiceTranscriptionError) throw error
      if (request.signal?.aborted || (error instanceof Error && error.name === 'AbortError')) {
        throw new VoiceTranscriptionError('aborted', 'Voice transcription was aborted.', true, provider.id, { cause: error })
      }
      throw new VoiceTranscriptionError('provider-failed', `Voice transcription provider ${provider.id} failed.`, true, provider.id, { cause: error })
    }
  }
}
