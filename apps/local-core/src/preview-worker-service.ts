import { spawn } from 'node:child_process'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import type { ArtifactRevisionId, PreviewRecord, ProjectId } from '@local-creative-os/domain'
import { createCanvas, DOMMatrix, ImageData, loadImage, Path2D } from '@napi-rs/canvas'
import { getDocument } from 'pdfjs-dist'

import type { SqliteMetadataRepository } from './metadata-repository.js'
import { PreviewCacheService } from './preview-cache-service.js'
import { RendererRegistry, type RendererDescriptor } from './renderer-registry.js'

// pdf.js Node renderer needs browser geometry globals. Do not configure workerSrc here:
// Node has no Web Worker and pdf.js fake-worker setup can terminate thumbnail jobs.
if (globalThis.Path2D === undefined) globalThis.Path2D = Path2D as unknown as typeof globalThis.Path2D
if (globalThis.DOMMatrix === undefined) globalThis.DOMMatrix = DOMMatrix as unknown as typeof globalThis.DOMMatrix
if (globalThis.ImageData === undefined) globalThis.ImageData = ImageData as unknown as typeof globalThis.ImageData

const PDF_THUMBNAIL_MAX_WIDTH = 480
const SHELL_THUMBNAIL_SCRIPT = fileURLToPath(new URL('../scripts/shell-thumb.ps1', import.meta.url))

export interface GeneratePreviewInput {
  readonly projectId: ProjectId
  readonly revisionId: ArtifactRevisionId
  readonly previewProfile: string
  readonly signal?: AbortSignal
}

export interface GeneratePreviewResult {
  readonly record: PreviewRecord
  readonly reused: boolean
}

export interface PreviewWorkerServiceOptions {
  readonly cacheService: PreviewCacheService
  readonly rendererRegistry?: RendererRegistry
  readonly maxSourceBytes?: number
}

const DEFAULT_MAX_SOURCE_BYTES = 512 * 1024

export class PreviewWorkerService {
  readonly #repository: SqliteMetadataRepository
  readonly #cacheService: PreviewCacheService
  readonly #rendererRegistry: RendererRegistry
  readonly #maxSourceBytes: number
  #queue: Promise<void> = Promise.resolve()

  constructor(repository: SqliteMetadataRepository, options: PreviewWorkerServiceOptions) {
    this.#repository = repository
    this.#cacheService = options.cacheService
    this.#rendererRegistry = options.rendererRegistry ?? new RendererRegistry()
    this.#maxSourceBytes = options.maxSourceBytes ?? DEFAULT_MAX_SOURCE_BYTES
  }

  async generate(input: GeneratePreviewInput): Promise<GeneratePreviewResult> {
    let run!: () => Promise<GeneratePreviewResult>
    const task = new Promise<GeneratePreviewResult>((resolve, reject) => {
      run = async () => {
        try {
          const result = await this.#generateNow(input)
          resolve(result)
          return result
        } catch (error) {
          reject(error)
          throw error
        }
      }
    })
    this.#queue = this.#queue.then(() => run()).then(() => undefined, () => undefined)
    return task
  }

  async #generateNow(input: GeneratePreviewInput): Promise<GeneratePreviewResult> {
    this.#throwIfAborted(input.signal)
    const revision = this.#repository.getArtifactRevision(String(input.revisionId))
    if (revision === undefined) throw new Error('ArtifactRevision not found.')
    const artifact = this.#repository.getArtifact(String(revision.artifactId))
    if (artifact === undefined || artifact.projectId !== input.projectId) throw new Error('ArtifactRevision does not belong to project.')
    const fileRecord = this.#repository.getFileRecord(String(revision.fileRecordId))
    if (fileRecord === undefined) throw new Error('FileRecord not found.')
    if (fileRecord.availability !== 'current') {
      return { record: this.#cacheService.recordFailed(input.revisionId, input.previewProfile, `File is ${fileRecord.availability}.`), reused: false }
    }
    const renderer = this.#rendererRegistry.select(fileRecord, input.previewProfile)
    if (renderer === undefined) {
      return { record: this.#cacheService.recordUnsupported(input.revisionId, input.previewProfile), reused: false }
    }
    const existing = this.#repository.getPreviewRecordByCacheKey(this.#cacheService.computeCacheKey({
      sourceContentHash: revision.contentHash,
      rendererId: renderer.id,
      rendererVersion: renderer.version,
      previewProfile: input.previewProfile,
    }))
    if (existing?.status === 'ready') return { record: existing, reused: true }

    try {
      const bytes = await this.#renderBytes(fileRecord.observedPath, renderer, input.signal)
      this.#throwIfAborted(input.signal)
      return {
        record: await this.#cacheService.publishReadyPreview(input.revisionId, input.previewProfile, bytes),
        reused: false,
      }
    } catch (error) {
      if (input.signal?.aborted) throw error
      const message = error instanceof Error ? (error.stack ?? error.message) : 'Preview generation failed.'
      return { record: this.#cacheService.recordFailed(input.revisionId, input.previewProfile, message), reused: false }
    }
  }

  async #renderBytes(path: string, renderer: RendererDescriptor, signal?: AbortSignal): Promise<Uint8Array> {
    this.#throwIfAborted(signal)
    if (renderer.id === 'pdf') return this.#renderPdfThumbnail(path, signal)
    if (renderer.id === 'office') return this.#renderShellThumbnail(path, signal)
    if (renderer.id === 'image') return this.#renderImageThumbnail(path, signal)
    const bytes = await readFile(path)
    this.#throwIfAborted(signal)
    if (bytes.byteLength > this.#maxSourceBytes) {
      return Buffer.from(bytes.subarray(0, this.#maxSourceBytes))
    }
    if (renderer.id === 'text' || renderer.id === 'markdown') {
      return bytes
    }
    throw new Error(`Unsupported renderer: ${renderer.id}`)
  }

  async #renderImageThumbnail(path: string, signal?: AbortSignal): Promise<Uint8Array> {
    this.#throwIfAborted(signal)
    const image = await loadImage(path)
    this.#throwIfAborted(signal)
    const scale = Math.min(1, PDF_THUMBNAIL_MAX_WIDTH / Math.max(1, image.width))
    const width = Math.max(1, Math.round(image.width * scale))
    const height = Math.max(1, Math.round(image.height * scale))
    const canvas = createCanvas(width, height)
    const context = canvas.getContext('2d')
    context.drawImage(image, 0, 0, width, height)
    this.#throwIfAborted(signal)
    return new Uint8Array(canvas.toBuffer('image/png'))
  }

  async #renderPdfThumbnail(path: string, signal?: AbortSignal): Promise<Uint8Array> {
    this.#throwIfAborted(signal)
    const data = new Uint8Array(await readFile(path))
    const doc = await getDocument({ data, useSystemFonts: true }).promise
    try {
      const page = await doc.getPage(1)
      const viewport = page.getViewport({ scale: 1 })
      const scale = PDF_THUMBNAIL_MAX_WIDTH / Math.max(1, viewport.width)
      const target = page.getViewport({ scale })
      const canvas = createCanvas(Math.max(1, Math.floor(target.width)), Math.max(1, Math.floor(target.height)))
      const context = canvas.getContext('2d') as unknown as Parameters<typeof page.render>[0]['canvasContext']
      await page.render({ canvasContext: context, viewport: target }).promise
      this.#throwIfAborted(signal)
      return new Uint8Array(canvas.toBuffer('image/png'))
    } finally {
      await doc.destroy().catch(() => undefined)
    }
  }

  async #renderShellThumbnail(path: string, signal?: AbortSignal): Promise<Uint8Array> {
    this.#throwIfAborted(signal)
    const dir = await mkdtemp(join(tmpdir(), 'lcos-thumb-'))
    const outPath = join(dir, 'thumb.png')
    try {
      await new Promise<void>((resolve, reject) => {
        const child = spawn('powershell.exe', [
          '-NoProfile', '-ExecutionPolicy', 'Bypass',
          '-File', SHELL_THUMBNAIL_SCRIPT,
          '-InputPath', path,
          '-OutputPath', outPath,
          '-Width', '480',
          '-Height', '360',
        ], { windowsHide: true, stdio: 'ignore' })
        const abort = () => child.kill()
        signal?.addEventListener('abort', abort, { once: true })
        child.once('error', reject)
        child.once('exit', (code) => {
          signal?.removeEventListener('abort', abort)
          if (code === 0) resolve()
          else reject(new Error(`Shell thumbnail exited with code ${code ?? 'unknown'}.`))
        })
      })
      this.#throwIfAborted(signal)
      return new Uint8Array(await readFile(outPath))
    } finally {
      await rm(dir, { recursive: true, force: true }).catch(() => undefined)
    }
  }

  #throwIfAborted(signal?: AbortSignal): void {
    if (signal?.aborted) throw new DOMException('Preview generation aborted.', 'AbortError')
  }
}
