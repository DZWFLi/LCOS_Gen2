import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, extname, join } from 'node:path'
import {
  VoiceTranscriptionError,
  type VoiceTranscriptionProvider,
  type VoiceTranscriptionProviderResultV1,
  type VoiceTranscriptionRequestV1,
  type VoiceTranscriptionSegmentV1,
} from './voice-transcription-service.js'

const DEFAULT_PROCESS_TIMEOUT_MS = 120_000
const MAX_CAPTURED_PROCESS_OUTPUT_BYTES = 1024 * 1024

export interface WhisperCppCliProviderOptions {
  readonly binaryPath: string
  readonly modelPath: string
  readonly ffmpegPath?: string
  readonly processTimeoutMs?: number
  readonly threads?: number
  readonly noGpu?: boolean
}

interface RunCommandOptions {
  readonly signal?: AbortSignal
  readonly timeoutMs: number
}

interface RunCommandResult {
  readonly stdout: string
  readonly stderr: string
}

interface WhisperJsonSegment {
  readonly text?: unknown
  readonly offsets?: {
    readonly from?: unknown
    readonly to?: unknown
  }
}

interface WhisperJsonOutput {
  readonly result?: {
    readonly language?: unknown
  }
  readonly transcription?: readonly WhisperJsonSegment[]
  readonly text?: unknown
}

function normalizedMimeType(value: string): string {
  return value.trim().toLocaleLowerCase('en-US').split(';', 1)[0] ?? ''
}

function extensionForMime(mimeType: string): string {
  switch (normalizedMimeType(mimeType)) {
    case 'audio/webm': return '.webm'
    case 'audio/mp4':
    case 'audio/x-m4a':
    case 'audio/m4a': return '.m4a'
    case 'audio/ogg': return '.ogg'
    case 'audio/wav':
    case 'audio/wave':
    case 'audio/x-wav': return '.wav'
    case 'audio/mpeg':
    case 'audio/mp3': return '.mp3'
    case 'audio/flac': return '.flac'
    default: return '.audio'
  }
}

function finiteNonNegativeInteger(value: number | undefined): number | undefined {
  if (value === undefined || !Number.isFinite(value) || value <= 0) return undefined
  return Math.max(1, Math.floor(value))
}

function optionalLanguage(value: string | undefined): string | undefined {
  const trimmed = value?.trim()
  if (!trimmed) return undefined
  return trimmed.split('-', 1)[0]?.toLocaleLowerCase('en-US') || undefined
}

function safeModelLabel(path: string): string {
  const file = basename(path)
  const suffix = extname(file)
  return suffix ? file.slice(0, -suffix.length) : file
}

function captureText(buffer: string, chunk: Uint8Array): string {
  if (Buffer.byteLength(buffer, 'utf8') >= MAX_CAPTURED_PROCESS_OUTPUT_BYTES) return buffer
  const remaining = MAX_CAPTURED_PROCESS_OUTPUT_BYTES - Buffer.byteLength(buffer, 'utf8')
  return buffer + Buffer.from(chunk).subarray(0, remaining).toString('utf8')
}

async function runCommand(command: string, args: readonly string[], options: RunCommandOptions): Promise<RunCommandResult> {
  if (options.signal?.aborted) {
    throw new VoiceTranscriptionError('aborted', 'Voice transcription was aborted.', true, 'whisper.cpp-cli')
  }

  return await new Promise<RunCommandResult>((resolve, reject) => {
    let settled = false
    let stdout = ''
    let stderr = ''
    const child = spawn(command, [...args], {
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    })

    const cleanup = () => {
      clearTimeout(timer)
      options.signal?.removeEventListener('abort', abort)
    }
    const finishReject = (error: unknown) => {
      if (settled) return
      settled = true
      cleanup()
      reject(error)
    }
    const abort = () => {
      if (!child.killed) child.kill('SIGTERM')
      finishReject(new VoiceTranscriptionError('aborted', 'Voice transcription was aborted.', true, 'whisper.cpp-cli'))
    }
    const timer = setTimeout(() => {
      if (!child.killed) child.kill('SIGTERM')
      finishReject(new VoiceTranscriptionError('provider-failed', `Voice transcription process exceeded ${options.timeoutMs} ms.`, true, 'whisper.cpp-cli'))
    }, options.timeoutMs)
    timer.unref?.()
    options.signal?.addEventListener('abort', abort, { once: true })

    child.stdout?.on('data', (chunk: Uint8Array) => { stdout = captureText(stdout, chunk) })
    child.stderr?.on('data', (chunk: Uint8Array) => { stderr = captureText(stderr, chunk) })
    child.once('error', (error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') {
        finishReject(new VoiceTranscriptionError('provider-unavailable', `Required voice transcription executable is unavailable: ${command}`, false, 'whisper.cpp-cli', { cause: error }))
        return
      }
      finishReject(error)
    })
    child.once('close', (code, signal) => {
      if (settled) return
      settled = true
      cleanup()
      if (code !== 0) {
        reject(new VoiceTranscriptionError(
          'provider-failed',
          `Voice transcription process failed (${signal ?? `exit ${String(code)}`}): ${stderr.trim() || stdout.trim() || 'no diagnostic output'}`,
          true,
          'whisper.cpp-cli',
        ))
        return
      }
      resolve({ stdout, stderr })
    })
  })
}

function parseWhisperJson(value: unknown, includeSegments: boolean, modelLabel: string): VoiceTranscriptionProviderResultV1 {
  if (typeof value !== 'object' || value === null) {
    throw new VoiceTranscriptionError('provider-failed', 'whisper.cpp returned an invalid JSON document.', true, 'whisper.cpp-cli')
  }
  const json = value as WhisperJsonOutput
  const rawTranscription = Array.isArray(json.transcription) ? json.transcription : []
  const texts = rawTranscription
    .map((entry) => typeof entry?.text === 'string' ? entry.text : '')
    .filter((text) => text.length > 0)
  const fallbackText = typeof json.text === 'string' ? json.text : ''
  const text = (texts.length > 0 ? texts.join('') : fallbackText).trim()

  const segments: VoiceTranscriptionSegmentV1[] = []
  if (includeSegments) {
    for (const entry of rawTranscription) {
      if (typeof entry?.text !== 'string') continue
      const from = entry.offsets?.from
      const to = entry.offsets?.to
      if (typeof from !== 'number' || typeof to !== 'number' || !Number.isFinite(from) || !Number.isFinite(to)) continue
      segments.push({ startMs: from, endMs: to, text: entry.text.trim() })
    }
  }

  const language = typeof json.result?.language === 'string' && json.result.language.trim() ? json.result.language.trim() : undefined
  return {
    text,
    ...(language === undefined ? {} : { language }),
    ...(includeSegments && segments.length > 0 ? { segments } : {}),
    model: modelLabel,
  }
}

export class WhisperCppCliTranscriptionProvider implements VoiceTranscriptionProvider {
  readonly id = 'whisper.cpp-cli'
  readonly #binaryPath: string
  readonly #modelPath: string
  readonly #ffmpegPath: string
  readonly #processTimeoutMs: number
  readonly #threads: number | undefined
  readonly #noGpu: boolean

  constructor(options: WhisperCppCliProviderOptions) {
    this.#binaryPath = options.binaryPath
    this.#modelPath = options.modelPath
    this.#ffmpegPath = options.ffmpegPath?.trim() || 'ffmpeg'
    this.#processTimeoutMs = finiteNonNegativeInteger(options.processTimeoutMs) ?? DEFAULT_PROCESS_TIMEOUT_MS
    this.#threads = finiteNonNegativeInteger(options.threads)
    this.#noGpu = options.noGpu === true
  }

  supports(input: { readonly mimeType: string }): number {
    const mime = normalizedMimeType(input.mimeType)
    if (!mime.startsWith('audio/')) return 0
    if (mime === 'audio/webm' || mime === 'audio/mp4' || mime === 'audio/ogg' || mime === 'audio/mpeg' || mime === 'audio/wav' || mime === 'audio/flac') return 100
    return 80
  }

  async transcribe(request: VoiceTranscriptionRequestV1): Promise<VoiceTranscriptionProviderResultV1> {
    if (!existsSync(this.#binaryPath)) {
      throw new VoiceTranscriptionError('provider-unavailable', `whisper.cpp executable is missing: ${this.#binaryPath}`, false, this.id)
    }
    if (!existsSync(this.#modelPath)) {
      throw new VoiceTranscriptionError('provider-unavailable', `whisper.cpp model is missing: ${this.#modelPath}`, false, this.id)
    }

    const temp = await mkdtemp(join(tmpdir(), 'lcos-whisper-cpp-'))
    try {
      const inputPath = join(temp, `capture${extensionForMime(request.audio.mimeType)}`)
      const wavPath = join(temp, 'capture-16k-mono.wav')
      const outputBase = join(temp, 'transcript')
      const outputJson = `${outputBase}.json`
      await writeFile(inputPath, request.audio.bytes)

      const processOptions: RunCommandOptions = {
        timeoutMs: this.#processTimeoutMs,
        ...(request.signal === undefined ? {} : { signal: request.signal }),
      }
      await runCommand(this.#ffmpegPath, [
        '-nostdin', '-hide_banner', '-loglevel', 'error', '-y',
        '-i', inputPath,
        '-ar', '16000', '-ac', '1', '-c:a', 'pcm_s16le',
        wavPath,
      ], processOptions)

      const args = ['-m', this.#modelPath, '-f', wavPath, '-oj', '-of', outputBase, '-np']
      const language = optionalLanguage(request.hints?.language)
      args.push('-l', language ?? 'auto')
      const prompt = request.hints?.prompt?.trim()
      if (prompt) args.push('--prompt', prompt)
      if (this.#threads !== undefined) args.push('-t', String(this.#threads))
      if (this.#noGpu) args.push('-ng')

      await runCommand(this.#binaryPath, args, processOptions)

      let parsed: unknown
      try {
        parsed = JSON.parse(await readFile(outputJson, 'utf8'))
      } catch (error: unknown) {
        throw new VoiceTranscriptionError('provider-failed', 'whisper.cpp did not produce readable JSON output.', true, this.id, { cause: error })
      }
      return parseWhisperJson(parsed, request.hints?.timestamps === true, safeModelLabel(this.#modelPath))
    } finally {
      await rm(temp, { recursive: true, force: true })
    }
  }
}

export interface WhisperCppEnvironment {
  readonly LCOS_WHISPER_CPP_BIN?: string
  readonly LCOS_WHISPER_CPP_MODEL?: string
  readonly LCOS_WHISPER_CPP_FFMPEG?: string
  readonly LCOS_WHISPER_CPP_THREADS?: string
  readonly LCOS_WHISPER_CPP_NO_GPU?: string
}

function parseBoolean(value: string | undefined): boolean {
  return value?.trim().toLocaleLowerCase('en-US') === 'true' || value?.trim() === '1'
}

function parsePositiveInteger(value: string | undefined): number | undefined {
  if (value === undefined || value.trim() === '') return undefined
  const parsed = Number(value)
  return finiteNonNegativeInteger(parsed)
}

/**
 * Desktop/package layer opts in explicitly by providing exact binary+model paths.
 * Missing assets mean “provider not installed”, not a half-configured provider.
 */
export function createWhisperCppProviderFromEnvironment(env: WhisperCppEnvironment = process.env): WhisperCppCliTranscriptionProvider | undefined {
  const binaryPath = env.LCOS_WHISPER_CPP_BIN?.trim()
  const modelPath = env.LCOS_WHISPER_CPP_MODEL?.trim()
  if (!binaryPath || !modelPath || !existsSync(binaryPath) || !existsSync(modelPath)) return undefined
  return new WhisperCppCliTranscriptionProvider({
    binaryPath,
    modelPath,
    ...(env.LCOS_WHISPER_CPP_FFMPEG?.trim() ? { ffmpegPath: env.LCOS_WHISPER_CPP_FFMPEG.trim() } : {}),
    ...(parsePositiveInteger(env.LCOS_WHISPER_CPP_THREADS) === undefined ? {} : { threads: parsePositiveInteger(env.LCOS_WHISPER_CPP_THREADS)! }),
    noGpu: parseBoolean(env.LCOS_WHISPER_CPP_NO_GPU),
  })
}
