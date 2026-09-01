import { createHash } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { CaptureGatewayResultV1, CaptureRequestV1 } from '@local-creative-os/contracts'
import type { CaptureApplicationService } from './capture-application-service.js'
import type { CaptureStagingService } from './capture-staging-service.js'
import type { SqliteMetadataRepository } from './metadata-repository.js'
import type { RuntimeRegistryService } from './runtime-registry-service.js'
import { resolveProjectAffinity } from './project-affinity-service.js'

export class CaptureGatewayError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) {
    super(message)
    this.name = 'CaptureGatewayError'
  }
}

const V1_KINDS = new Set(['page', 'selection', 'image', 'link', 'screenshot', 'text', 'file'])
const MAX_IMAGE_BYTES = 10 * 1024 * 1024

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function decodeDataUrl(dataUrl: string): { readonly bytes: Buffer; readonly mimeType: string } {
  const match = /^data:([^;,]+);base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl.trim())
  if (match === null) throw new CaptureGatewayError(400, 'INVALID_ARGUMENT', 'content.dataUrl must be a base64 data URL.')
  const bytes = Buffer.from(match[2]!, 'base64')
  if (bytes.byteLength > MAX_IMAGE_BYTES) throw new CaptureGatewayError(413, 'INVALID_ARGUMENT', `Image capture exceeds ${MAX_IMAGE_BYTES} bytes.`)
  return { bytes, mimeType: match[1]! }
}

export class CaptureGatewayService {
  constructor(
    private readonly capture: CaptureApplicationService | undefined,
    private readonly staging: CaptureStagingService | undefined,
    private readonly registry: RuntimeRegistryService,
    private readonly metadata: SqliteMetadataRepository | undefined,
    private readonly blobRoot: string,
  ) {}

  async submitTrusted(input: unknown): Promise<CaptureGatewayResultV1> {
    return this.continueSubmit(input, { trusted: true })
  }

  async submit(input: unknown, headers: { readonly token?: string | undefined; readonly origin?: string | undefined; readonly trusted?: boolean }): Promise<CaptureGatewayResultV1> {
    if (this.capture === undefined || this.staging === undefined || this.metadata === undefined) {
      throw new CaptureGatewayError(503, 'UNAVAILABLE', 'Capture gateway is not configured.')
    }
    const expected = this.registry.ensureExtensionToken()
    if (headers.token === undefined || headers.token !== expected) {
      throw new CaptureGatewayError(401, 'UNAUTHORIZED', 'Invalid or missing gateway token.')
    }
    if (headers.origin !== undefined && headers.origin !== '') {
      // 浏览器扩展上下文（MV3）：扩展 id 不是回环 hostname，但请求仍来自本机浏览器。
      if (!headers.origin.startsWith('chrome-extension://')) {
        try {
          const host = new URL(headers.origin).hostname
          if (!['127.0.0.1', 'localhost', '[::1]'].includes(host)) {
            throw new CaptureGatewayError(403, 'FORBIDDEN', `Origin ${headers.origin} is not allowed.`)
          }
        } catch (error) {
          if (error instanceof CaptureGatewayError) throw error
          throw new CaptureGatewayError(403, 'FORBIDDEN', 'Origin header is malformed.')
        }
      }
    }
    return this.continueSubmit(input, headers)
  }

  private async continueSubmit(input: unknown, headers: { readonly token?: string | undefined; readonly origin?: string | undefined; readonly trusted?: boolean }): Promise<CaptureGatewayResultV1> {
    if (this.capture === undefined || this.staging === undefined || this.metadata === undefined) {
      throw new CaptureGatewayError(503, 'UNAVAILABLE', 'Capture gateway is not configured.')
    }
    if (!isRecord(input) || input.schemaVersion !== 1 || typeof input.operationId !== 'string'
      || typeof input.capturedAt !== 'string' || !isRecord(input.source) || !isRecord(input.target)) {
      throw new CaptureGatewayError(400, 'INVALID_ARGUMENT', 'CaptureRequestV1 requires schemaVersion, operationId, capturedAt, source and target.')
    }
    const request = input as unknown as CaptureRequestV1
    if (!V1_KINDS.has(request.source.kind)) {
      throw new CaptureGatewayError(400, 'INVALID_ARGUMENT', `Unsupported capture source kind ${request.source.kind}.`)
    }

    const projectId = request.target.mode === 'project' ? request.target.projectId : undefined
    if (projectId !== undefined && this.metadata.getProject(projectId) === undefined) {
      throw new CaptureGatewayError(404, 'NOT_FOUND', `Target project ${projectId} does not exist.`)
    }

    let payload: { type: 'url'; url: string } | { type: 'text'; text: string } | { type: 'staged_blob'; blobRef: string } | { type: 'local_path'; path: string }
    let kind: string
    const url = request.source.sourceUrl ?? request.source.pageUrl
    switch (request.source.kind) {
      case 'page':
      case 'link':
        if (url === undefined) throw new CaptureGatewayError(400, 'INVALID_ARGUMENT', 'page/link capture requires sourceUrl or pageUrl.')
        payload = { type: 'url', url }
        kind = request.source.kind === 'page' ? 'web_page' : 'web_link'
        break
      case 'text':
      case 'selection': {
        const text = request.content?.text
        if (text === undefined || text.trim() === '') throw new CaptureGatewayError(400, 'INVALID_ARGUMENT', 'text/selection capture requires content.text.')
        payload = { type: 'text', text }
        kind = request.source.kind === 'selection' ? 'web_selection' : 'clipboard_text'
        break
      }
      case 'image':
      case 'screenshot': {
        const dataUrl = request.content?.dataUrl
        if (dataUrl === undefined) throw new CaptureGatewayError(400, 'INVALID_ARGUMENT', 'image/screenshot capture requires content.dataUrl.')
        const { bytes } = decodeDataUrl(dataUrl)
        const hash = createHash('sha256').update(bytes).digest('hex')
        await mkdir(this.blobRoot, { recursive: true })
        await writeFile(join(this.blobRoot, hash), bytes, { flag: 'wx' }).catch(() => undefined)
        payload = { type: 'staged_blob', blobRef: `blob:${hash}` }
        kind = request.source.kind === 'screenshot' ? 'screenshot' : 'web_image'
        break
      }
      case 'file': {
        // 本地路径捕获仅限 Runtime Host 信任通道（Core Bearer）；浏览器扩展 token 不得提交。
        if (headers.trusted !== true) {
          throw new CaptureGatewayError(403, 'FORBIDDEN', 'Local file capture requires the trusted Runtime Host channel.')
        }
        const path = request.source.localPath
        if (typeof path !== 'string' || path.trim() === '') {
          throw new CaptureGatewayError(400, 'INVALID_ARGUMENT', 'file capture requires source.localPath.')
        }
        payload = { type: 'local_path', path }
        kind = 'local_file'
        break
      }
      default:
        throw new CaptureGatewayError(400, 'INVALID_ARGUMENT', 'Unsupported capture kind.')
    }

    const v0 = {
      schemaVersion: 0 as const,
      operationId: request.operationId,
      kind,
      ...(projectId === undefined ? {} : { targetHint: { projectId } }),
      ...(request.hints?.title === undefined ? {} : { hints: { title: request.hints.title } }),
      source: {
        app: 'lcos-gateway',
        ...(request.source.pageUrl === undefined ? {} : { url: request.source.pageUrl }),
        ...(request.source.pageTitle === undefined ? {} : { title: request.source.pageTitle }),
        capturedAt: request.capturedAt,
      },
      payload,
    }

    if (request.target.mode === 'staging') {
      const existing = this.metadata.getCaptureReceipt(request.operationId)
      if (existing !== undefined) {
        return { receipt: existing, destinationLabel: '暂存区', destination: existing.status === 'staged' ? 'staging' : 'project' }
      }
      const affinity = resolveProjectAffinity({
        capturedAt: request.capturedAt,
        ...(payload.type === 'local_path' ? { localPath: payload.path } : {}),
        sourceApp: 'lcos-gateway',
      }, {
        projectRoots: this.metadata.listProjects().map((project) => ({ projectId: String(project.id), rootPath: project.rootPath })),
        registry: this.registry.getRegistry(),
        now: request.capturedAt,
      })
      const staged = await this.staging.enqueue({
        operationId: request.operationId,
        kind,
        ...(payload.type === 'text'
          ? { payloadBytes: new TextEncoder().encode(payload.text) }
          : { payloadRef: payload.type === 'staged_blob' ? payload.blobRef : payload.type === 'url' ? payload.url : payload.path }),
        source: v0.source,
        suggestedProjects: affinity.candidates ?? [],
        capturedAt: request.capturedAt,
      })
      const receipt = { operationId: request.operationId, status: 'staged' as const, stagingId: staged.id }
      this.metadata.saveCaptureReceipt(receipt)
      return { receipt, destinationLabel: '暂存区', destination: 'staging' }
    }

    const receipt = await this.capture.capture(v0 as never)
    if (receipt.status === 'staged') {
      return { receipt, destinationLabel: '暂存区', destination: 'staging' }
    }
    const project = receipt.projectId === undefined ? undefined : this.metadata.getProject(receipt.projectId)
    return { receipt, destinationLabel: project?.name ?? '项目', destination: 'project' }
  }
}
