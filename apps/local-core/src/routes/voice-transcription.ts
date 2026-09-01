import type { VoiceTranscriptionResponseV1 } from '@local-creative-os/contracts'
import { VoiceTranscriptionError, type VoiceTranscriptionService } from '../voice-transcription-service.js'
import { parseMultipartImport } from './multipart.js'
import type { RouteHttpContext, RouteHttpHelpers } from './route-context.js'

export interface VoiceTranscriptionRouteContext extends RouteHttpContext {
  readonly helpers: RouteHttpHelpers
  readonly voiceTranscription: VoiceTranscriptionService
  readonly maxBodyBytes: number
}

const ALLOWED_FIELDS = new Set(['durationMs', 'language', 'prompt', 'timestamps', 'providerId'])

function optionalTrimmed(value: string | undefined, maxLength: number, label: string): string | undefined {
  if (value === undefined) return undefined
  const trimmed = value.trim()
  if (trimmed === '') return undefined
  if (trimmed.length > maxLength) throw new Error(`${label} is too long.`)
  return trimmed
}

function optionalDuration(value: string | undefined): number | undefined {
  if (value === undefined || value.trim() === '') return undefined
  const durationMs = Number(value)
  if (!Number.isFinite(durationMs) || durationMs < 0) throw new Error('durationMs must be a finite non-negative number.')
  return durationMs
}

function optionalBoolean(value: string | undefined): boolean | undefined {
  if (value === undefined || value.trim() === '') return undefined
  if (value === 'true' || value === '1') return true
  if (value === 'false' || value === '0') return false
  throw new Error('timestamps must be true/false or 1/0.')
}

function transcriptionErrorResponse(error: VoiceTranscriptionError): { readonly status: number; readonly code: 'INVALID_ARGUMENT' | 'UNAVAILABLE' | 'ABORTED' } {
  if (error.code === 'aborted') return { status: 499, code: 'ABORTED' }
  if (error.code === 'provider-unavailable' || error.code === 'provider-failed') return { status: error.code === 'provider-unavailable' ? 503 : 502, code: 'UNAVAILABLE' }
  return { status: 400, code: 'INVALID_ARGUMENT' }
}

/**
 * POST /runtime/voice/transcriptions
 * multipart/form-data with one audio file plus optional narrow hint fields.
 */
export async function handleVoiceTranscriptionRoute(ctx: VoiceTranscriptionRouteContext): Promise<boolean> {
  const { method, pathname, request, response, controller, voiceTranscription, maxBodyBytes } = ctx
  const { sendJson, failure, readRawBody } = ctx.helpers

  if (method !== 'POST' || pathname !== '/runtime/voice/transcriptions') return false

  let raw: Buffer
  try {
    raw = await readRawBody(request, controller.signal, maxBodyBytes)
  } catch (error: unknown) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      sendJson(response, 499, failure('ABORTED', 'Voice transcription upload was aborted.', true))
    } else {
      sendJson(response, error instanceof RangeError ? 413 : 400, failure('INVALID_ARGUMENT', error instanceof RangeError
        ? `Voice transcription body must be under ${Math.floor(maxBodyBytes / (1024 * 1024))} MiB.`
        : 'Voice transcription upload could not be read.'))
    }
    return true
  }

  try {
    const multipart = parseMultipartImport(request.headers['content-type'], raw)
    const unknownField = Object.keys(multipart.fields).find((field) => !ALLOWED_FIELDS.has(field))
    if (unknownField !== undefined) throw new Error(`Unknown voice transcription field: ${unknownField}`)
    if (!multipart.file.contentType.toLocaleLowerCase('en-US').startsWith('audio/')) throw new Error('Voice transcription requires an audio/* upload.')
    if (multipart.file.bytes.byteLength === 0) throw new Error('Voice transcription requires non-empty audio bytes.')

    const durationMs = optionalDuration(multipart.fields.durationMs)
    const language = optionalTrimmed(multipart.fields.language, 64, 'language')
    const prompt = optionalTrimmed(multipart.fields.prompt, 4_000, 'prompt')
    const timestamps = optionalBoolean(multipart.fields.timestamps)
    const providerId = optionalTrimmed(multipart.fields.providerId, 128, 'providerId')

    const value = await voiceTranscription.transcribe({
      audio: {
        bytes: new Uint8Array(multipart.file.bytes),
        mimeType: multipart.file.contentType,
        ...(durationMs === undefined ? {} : { durationMs }),
      },
      ...((language === undefined && prompt === undefined && timestamps === undefined) ? {} : {
        hints: {
          ...(language === undefined ? {} : { language }),
          ...(prompt === undefined ? {} : { prompt }),
          ...(timestamps === undefined ? {} : { timestamps }),
        },
      }),
      signal: controller.signal,
    }, providerId)

    const responseValue: VoiceTranscriptionResponseV1 = {
      text: value.text,
      ...(value.language === undefined ? {} : { language: value.language }),
      ...(value.segments === undefined ? {} : { segments: value.segments }),
      ...(value.model === undefined ? {} : { model: value.model }),
      providerId: value.providerId,
    }
    sendJson(response, 200, { ok: true, value: responseValue })
  } catch (error: unknown) {
    if (error instanceof VoiceTranscriptionError) {
      const mapped = transcriptionErrorResponse(error)
      sendJson(response, mapped.status, failure(mapped.code, error.message, error.retryable))
    } else {
      sendJson(response, 400, failure('INVALID_ARGUMENT', error instanceof Error ? error.message : 'Voice transcription upload is invalid.'))
    }
  }
  return true
}
