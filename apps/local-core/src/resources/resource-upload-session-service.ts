import { randomUUID } from 'node:crypto'
import { mkdir, open, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { dirname, relative, resolve } from 'node:path'
import type { ProjectId } from '@local-creative-os/domain'
import { SqliteMetadataRepository } from '../metadata-repository.js'
import { ResourcePackageService } from './resource-package-service.js'

const MAX_FILE_BYTES = 10 * 1024 * 1024
const MAX_TOTAL_BYTES = 50 * 1024 * 1024

type UploadMeta = { projectId: string; importRequestId: string; rootName: string; scopeId: string; x: number; y: number; note?: string }

function safeRelativePath(value: string): string {
  const normalized = value.normalize('NFC').replace(/\\/g, '/').replace(/^\/+/, '')
  if (!normalized || normalized.split('/').some((part) => !part || part === '.' || part === '..' || /[:\0]/.test(part))) throw new Error('Unsafe upload relative path.')
  return normalized
}

export class ResourceUploadSessionService {
  constructor(readonly repository: SqliteMetadataRepository, readonly packages: ResourcePackageService) {}

  async start(meta: UploadMeta): Promise<{ sessionId: string }> {
    const project = this.repository.getProject(meta.projectId)
    if (project === undefined) throw new Error('Project not found.')
    const sessionId = `upload-${randomUUID()}`
    const root = resolve(project.rootPath, '.creative-os', 'import-staging', sessionId)
    await mkdir(resolve(root, 'files'), { recursive: true })
    await writeFile(resolve(root, 'session.json'), JSON.stringify(meta), { encoding: 'utf8', flag: 'wx' })
    return { sessionId }
  }

  async putFile(projectId: string, sessionId: string, relativePath: string, body: AsyncIterable<Uint8Array>): Promise<void> {
    const { root, meta } = await this.#load(projectId, sessionId)
    const path = safeRelativePath(relativePath)
    const target = resolve(root, 'files', path)
    if (relative(resolve(root, 'files'), target).startsWith('..')) throw new Error('Upload escaped staging root.')
    let size = 0
    await mkdir(dirname(target), { recursive: true })
    const handle = await open(target, 'wx')
    try {
      for await (const chunk of body) {
        size += chunk.byteLength
        if (size > MAX_FILE_BYTES) throw new RangeError('Upload file exceeds 10 MiB.')
        await handle.write(chunk)
      }
    } catch (error) {
      await handle.close()
      await rm(target, { force: true })
      throw error
    }
    await handle.close()
    await writeFile(resolve(root, 'session.json'), JSON.stringify(meta), 'utf8')
  }

  async complete(projectId: string, sessionId: string) {
    const { root, meta } = await this.#load(projectId, sessionId)
    const fileRoot = resolve(root, 'files')
    const files: Array<{ path: string; bytes: Buffer }> = []
    let total = 0
    const walk = async (folder: string): Promise<void> => {
      for (const entry of await readdir(folder, { withFileTypes: true })) {
        const path = resolve(folder, entry.name)
        if (entry.isDirectory()) await walk(path)
        else if (entry.isFile()) {
          const bytes = await readFile(path)
          total += bytes.byteLength
          if (total > MAX_TOTAL_BYTES) throw new RangeError('Upload session exceeds 50 MiB.')
          files.push({ path: relative(fileRoot, path).replace(/\\/g, '/'), bytes })
        }
      }
    }
    await walk(fileRoot)
    if (files.length === 0 || files.length > 200) throw new Error('Upload session requires 1-200 files.')
    const outcome = await this.packages.importDirectory(projectId as ProjectId, {
      importRequestId: meta.importRequestId, rootName: meta.rootName, files, scopeId: meta.scopeId,
      position: { x: meta.x, y: meta.y }, ...(meta.note === undefined ? {} : { userNote: meta.note }),
    })
    await rm(root, { recursive: true, force: true })
    return outcome
  }

  async #load(projectId: string, sessionId: string): Promise<{ root: string; meta: UploadMeta }> {
    if (!/^upload-[0-9a-f-]{36}$/.test(sessionId)) throw new Error('Invalid upload session ID.')
    const project = this.repository.getProject(projectId)
    if (project === undefined) throw new Error('Project not found.')
    const root = resolve(project.rootPath, '.creative-os', 'import-staging', sessionId)
    const meta = JSON.parse(await readFile(resolve(root, 'session.json'), 'utf8')) as UploadMeta
    if (meta.projectId !== projectId) throw new Error('Upload session belongs to another Project.')
    return { root, meta }
  }
}
