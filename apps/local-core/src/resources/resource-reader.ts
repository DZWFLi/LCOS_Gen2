import { open, readFile as readFileAsync, stat } from 'node:fs/promises'
import { basename, dirname, relative, resolve } from 'node:path'

import { SqliteMetadataRepository } from '../metadata-repository.js'

const MAX_READ_BYTES = 1024 * 1024

export interface ResourceReadOptions {
  readonly path?: string
  readonly offset?: number
  readonly limit?: number
  readonly format?: 'raw' | 'text' | 'json_tree'
}

export interface ResourceReadResult {
  readonly resourceId: string
  readonly fileName: string
  readonly mimeType?: string
  readonly contentHash?: string
  readonly size: number
  readonly offset: number
  readonly limit: number
  readonly truncated: boolean
  readonly format: 'raw' | 'text' | 'json_tree'
  readonly data: string
}

export class ResourceReader {
  constructor(readonly repository: SqliteMetadataRepository) {}

  async read(projectId: string, resourceId: string, options: ResourceReadOptions = {}): Promise<ResourceReadResult> {
    const descriptor = this.repository.getResourceDescriptorByResourceId(projectId, resourceId)
    if (descriptor === undefined) throw new Error('Resource not found.')
    const revision = this.repository.getArtifactRevision(descriptor.sourceRevisionId)
    const fileRecord = revision === undefined ? undefined : this.repository.getFileRecord(String(revision.fileRecordId))
    if (fileRecord === undefined) throw new Error('Resource file record not found.')

    let targetPath = fileRecord.observedPath
    let size = (await stat(targetPath)).size
    let contentHash: string | undefined = fileRecord.observedHash
    let mimeType = fileRecord.mimeType
    let fileName = basename(targetPath)
    if (descriptor.source.kind === 'directory') {
      const manifestText = await readFileAsync(fileRecord.observedPath, 'utf8')
      const manifest = JSON.parse(manifestText) as { files?: readonly { path: string; size: number; contentHash: string }[] }
      const requested = options.path === undefined || options.path === '' ? undefined : options.path.replace(/\\/g, '/').replace(/^\/+/, '')
      if (requested !== undefined) {
        const entry = manifest.files?.find((file) => file.path === requested)
        if (entry === undefined) throw new Error('Requested path is not part of this resource.')
        const sourceRoot = resolve(dirname(fileRecord.observedPath), 'source')
        const candidate = resolve(sourceRoot, requested)
        if (relative(sourceRoot, candidate).startsWith('..')) throw new Error('Requested path is not part of this resource.')
        targetPath = candidate
        size = entry.size
        contentHash = entry.contentHash
        fileName = basename(requested)
        mimeType = mimeForExtension(requested)
      } else {
        targetPath = fileRecord.observedPath
        size = Buffer.byteLength(manifestText)
        fileName = 'resource-manifest.json'
        mimeType = 'application/json'
      }
    } else if (options.path !== undefined && options.path !== '' && options.path !== basename(descriptor.source.originalName ?? '')) {
      throw new Error('Requested path is not part of this resource.')
    }

    const offset = Math.max(0, Math.floor(options.offset ?? 0))
    const rawLimit = options.limit === undefined ? Math.min(MAX_READ_BYTES, Math.max(1, size - offset)) : Math.max(1, Math.floor(options.limit))
    const limit = Math.min(rawLimit, MAX_READ_BYTES, Math.max(0, size - offset))
    const format = options.format ?? 'text'
    const buffer = Buffer.alloc(limit)
    const handle = await open(targetPath, 'r')
    try {
      const { bytesRead } = await handle.read(buffer, 0, limit, offset)
      const data = format === 'raw'
        ? buffer.subarray(0, bytesRead).toString('base64')
        : format === 'json_tree'
          ? buildJsonTree(buffer.subarray(0, bytesRead).toString('utf8'))
          : buffer.subarray(0, bytesRead).toString('utf8')
      return {
        resourceId,
        fileName,
        mimeType,
        contentHash,
        size,
        offset,
        limit,
        truncated: offset + limit < size,
        format,
        data,
      }
    } finally {
      await handle.close()
    }
  }
}

function mimeForExtension(path: string): string {
  const extension = path.split('.').at(-1)?.toLocaleLowerCase('en-US') ?? ''
  if (extension === 'md') return 'text/markdown'
  if (extension === 'json') return 'application/json'
  if (extension === 'yaml' || extension === 'yml') return 'application/yaml'
  if (extension === 'txt') return 'text/plain'
  if (['png', 'jpg', 'jpeg', 'webp'].includes(extension)) return `image/${extension === 'jpg' ? 'jpeg' : extension}`
  return 'application/octet-stream'
}

function buildJsonTree(text: string): string {
  try {
    const value = JSON.parse(text) as unknown
    return JSON.stringify(describeTree(value, 0))
  } catch {
    return JSON.stringify({ kind: 'text', note: 'Not valid JSON; use format=text for raw content.' })
  }
}

function describeTree(value: unknown, depth: number): unknown {
  if (depth > 8) return { kind: 'truncated' }
  if (Array.isArray(value)) {
    return {
      kind: 'array',
      length: value.length,
      sample: value.slice(0, 5).map((item) => describeTree(item, depth + 1)),
    }
  }
  if (typeof value === 'object' && value !== null) {
    const record = value as Record<string, unknown>
    const keys = Object.keys(record).slice(0, 32)
    return {
      kind: 'object',
      keys,
      sample: keys.slice(0, 8).reduce<Record<string, unknown>>((acc, key) => {
        acc[key] = describeTree(record[key], depth + 1)
        return acc
      }, {}),
    }
  }
  return { kind: typeof value, value: String(value).slice(0, 120) }
}
