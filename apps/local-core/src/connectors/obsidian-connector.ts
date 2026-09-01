import { createHash, randomUUID } from 'node:crypto'
import { lstat, opendir, readFile, realpath, stat } from 'node:fs/promises'
import { basename, extname, relative, resolve, sep } from 'node:path'

import type { ObsidianNoteSummaryV1, ObsidianVaultScanV1, ResourceConnectorCapabilityV1 } from '@local-creative-os/contracts'

import type { ResourceConnectorPort } from './connector-port.js'

const MAX_NOTES = 5_000
const MAX_TOTAL_BYTES = 250 * 1024 * 1024
const MAX_NOTE_BYTES = 2 * 1024 * 1024
const SESSION_TTL_MS = 15 * 60 * 1_000
const SKIPPED_DIRECTORIES = new Set(['.obsidian', '.git', 'node_modules', '.trash'])

interface StoredObsidianScan {
  readonly rootPath: string
  readonly scan: ObsidianVaultScanV1
}

function normalizedRelativePath(value: string): string {
  return value.replace(/\\/g, '/').replace(/^\/+/, '')
}

function isInside(root: string, target: string): boolean {
  const fromRoot = relative(root, target)
  return fromRoot === '' || (!fromRoot.startsWith('..') && !fromRoot.startsWith(`..${sep}`) && !/^[A-Za-z]:/.test(fromRoot))
}

function frontmatterValue(content: string, key: string): string | undefined {
  if (!content.startsWith('---')) return undefined
  const end = content.indexOf('\n---', 3)
  if (end < 0) return undefined
  const lines = content.slice(3, end).split(/\r?\n/)
  const prefix = `${key}:`
  const line = lines.find((item) => item.trimStart().toLocaleLowerCase('en-US').startsWith(prefix))
  if (!line) return undefined
  return line.slice(line.indexOf(':') + 1).trim().replace(/^['"]|['"]$/g, '') || undefined
}

function noteTitle(content: string, fallback: string): string {
  const explicit = frontmatterValue(content, 'title')
  if (explicit) return explicit.slice(0, 160)
  const heading = content.match(/^#\s+(.+)$/m)?.[1]?.trim()
  return (heading || fallback).slice(0, 160)
}

function noteTags(content: string): readonly string[] {
  const tags = new Set<string>()
  const frontmatter = frontmatterValue(content, 'tags')
  if (frontmatter) {
    for (const item of frontmatter.replace(/^\[|\]$/g, '').split(',')) {
      const normalized = item.trim().replace(/^['"#]|['"]$/g, '')
      if (normalized) tags.add(normalized)
    }
  }
  for (const match of content.matchAll(/(^|\s)#([\p{L}\p{N}_/-]{2,64})/gu)) {
    if (match[2]) tags.add(match[2])
    if (tags.size >= 32) break
  }
  return [...tags].slice(0, 32)
}

function noteOutlinks(content: string): readonly string[] {
  const links = new Set<string>()
  for (const match of content.matchAll(/\[\[([^\]|#]+)(?:#[^\]|]+)?(?:\|[^\]]+)?\]\]/g)) {
    const value = match[1]?.trim()
    if (value) links.add(value)
    if (links.size >= 64) break
  }
  return [...links]
}

export class ObsidianConnectorSessionStore {
  readonly #scans = new Map<string, StoredObsidianScan>()

  create(rootPath: string, input: Omit<ObsidianVaultScanV1, 'scanId' | 'expiresAt'>): ObsidianVaultScanV1 {
    this.cleanup()
    const scanId = `obsidian-scan-${randomUUID()}`
    const expiresAt = new Date(Date.now() + SESSION_TTL_MS).toISOString()
    const scan: ObsidianVaultScanV1 = { ...input, scanId, expiresAt }
    this.#scans.set(scanId, { rootPath, scan })
    return scan
  }

  get(scanId: string): StoredObsidianScan | undefined {
    this.cleanup()
    return this.#scans.get(scanId)
  }

  cleanup(): void {
    const now = Date.now()
    for (const [id, value] of this.#scans) {
      if (Date.parse(value.scan.expiresAt) <= now) this.#scans.delete(id)
    }
  }
}

export class ObsidianReadOnlyConnector implements ResourceConnectorPort<Omit<ObsidianVaultScanV1, 'scanId' | 'expiresAt'>> {
  readonly capability: ResourceConnectorCapabilityV1 = {
    schemaVersion: 1,
    connector: 'obsidian',
    displayName: 'Obsidian Vault',
    sourceKind: 'local_directory',
    access: 'read_only',
    contentTypes: ['text/markdown'],
    supportsScan: true,
    supportsImport: true,
    supportsSync: false,
  }

  async scan(rootPath: string): Promise<Omit<ObsidianVaultScanV1, 'scanId' | 'expiresAt'>> {
    const canonicalRoot = await realpath(rootPath)
    const rootStat = await stat(canonicalRoot)
    if (!rootStat.isDirectory()) throw new Error('选择的位置不是 Obsidian Vault 文件夹。')

    const notes: ObsidianNoteSummaryV1[] = []
    const warnings: string[] = []
    let totalBytes = 0
    let stopped = false

    const visit = async (directory: string): Promise<void> => {
      if (stopped) return
      const handle = await opendir(directory)
      for await (const entry of handle) {
        if (stopped) return
        if (notes.length >= MAX_NOTES) {
          warnings.push(`笔记数量超过 ${MAX_NOTES}，其余内容未扫描。`)
          stopped = true
          return
        }
        if (entry.isSymbolicLink()) {
          warnings.push(`已跳过符号链接：${normalizedRelativePath(relative(canonicalRoot, resolve(directory, entry.name)))}`)
          continue
        }
        const target = resolve(directory, entry.name)
        if (!isInside(canonicalRoot, target)) continue
        if (entry.isDirectory()) {
          if (SKIPPED_DIRECTORIES.has(entry.name) || entry.name.startsWith('.')) continue
          await visit(target)
          continue
        }
        if (!entry.isFile() || extname(entry.name).toLocaleLowerCase('en-US') !== '.md') continue
        const fileStat = await lstat(target)
        if (!fileStat.isFile()) continue
        totalBytes += fileStat.size
        if (totalBytes > MAX_TOTAL_BYTES) {
          warnings.push('Vault Markdown 总量超过 250MB，其余内容未扫描。')
          stopped = true
          return
        }
        const relativePath = normalizedRelativePath(relative(canonicalRoot, target))
        let content = ''
        if (fileStat.size <= MAX_NOTE_BYTES) {
          content = await readFile(target, 'utf8').catch(() => '')
        } else {
          warnings.push(`笔记超过 2MB，仅记录元数据：${relativePath}`)
        }
        notes.push({
          relativePath,
          title: noteTitle(content, basename(entry.name, extname(entry.name))),
          size: fileStat.size,
          modifiedAt: fileStat.mtime.toISOString(),
          tags: noteTags(content),
          outlinks: noteOutlinks(content),
        })
      }
    }

    await visit(canonicalRoot)
    notes.sort((left, right) => left.relativePath.localeCompare(right.relativePath, 'zh-CN'))
    return {
      schemaVersion: 1,
      connector: 'obsidian',
      vaultName: basename(canonicalRoot),
      readOnly: true,
      noteCount: notes.length,
      totalBytes,
      notes,
      warnings: [...new Set(warnings)],
    }
  }

  async read(rootPath: string, relativePath: string): Promise<{ readonly bytes: Buffer; readonly contentHash: string }> {
    const canonicalRoot = await realpath(rootPath)
    const normalized = normalizedRelativePath(relativePath)
    if (!normalized || normalized.includes('\0') || normalized.split('/').some((part) => part === '..' || part === '.')) {
      throw new Error('Obsidian 笔记路径无效。')
    }
    if (extname(normalized).toLocaleLowerCase('en-US') !== '.md') throw new Error('Obsidian 连接器只读取 Markdown 笔记。')
    const requested = resolve(canonicalRoot, normalized)
    if (!isInside(canonicalRoot, requested)) throw new Error('Obsidian 笔记路径越界。')
    const fileInfo = await lstat(requested)
    if (!fileInfo.isFile() || fileInfo.isSymbolicLink()) throw new Error('Obsidian 笔记不是普通文件。')
    if (fileInfo.size > MAX_NOTE_BYTES) throw new Error('Obsidian 笔记超过 2MB 导入上限。')
    const canonicalFile = await realpath(requested)
    if (!isInside(canonicalRoot, canonicalFile)) throw new Error('Obsidian 笔记真实路径越界。')
    const bytes = await readFile(canonicalFile)
    return { bytes, contentHash: createHash('sha256').update(bytes).digest('hex') }
  }
}
