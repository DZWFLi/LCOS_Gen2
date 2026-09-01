import { readFile, stat } from 'node:fs/promises'
import { isAbsolute, relative, resolve } from 'node:path'
import type { ContextManifestV0 } from '@local-creative-os/contracts'
import type { SqliteMetadataRepository } from './metadata-repository.js'
import { buildZip } from './zip-writer.js'

const MAX_FILE_BYTES = 10 * 1024 * 1024
const MAX_TOTAL_BYTES = 50 * 1024 * 1024

/**
 * Handoff 文件级 zip：handoff.md（renderedMarkdown）+ manifest.json（完整校验信息）
 * + files/（manifest 引用且位于项目根内的真实文件副本，受大小限制）。
 *
 * 安全边界：
 * - 只收 observedPath 位于 projectRoot 之内的文件（导入/notes 命名空间）；
 * - 单文件 ≤10 MiB、总量 ≤50 MiB，超出静默跳过并在 manifest.json 保留哈希可追溯；
 * - zip 使用自研 STORE writer，不引入第三方压缩依赖。
 */
export async function buildHandoffZip(
  repository: SqliteMetadataRepository,
  projectRoot: string,
  manifest: ContextManifestV0,
): Promise<Uint8Array> {
  const encoder = new TextEncoder()
  const entries: Array<{ readonly path: string; readonly bytes: Uint8Array }> = [
    { path: 'handoff.md', bytes: encoder.encode(manifest.renderedMarkdown) },
    { path: 'manifest.json', bytes: encoder.encode(JSON.stringify(manifest, null, 2)) },
  ]
  let total = entries.reduce((sum, entry) => sum + entry.bytes.length, 0)

  const refs = [manifest.currentRevision, manifest.target, ...manifest.references]
    .filter((ref): ref is NonNullable<typeof ref> => ref !== null)
  const byArtifact = new Map<string, string>()
  for (const ref of refs) {
    if (byArtifact.has(ref.artifactId)) continue
    const revision = repository.getArtifactRevision(ref.revisionId)
    if (revision === undefined) continue
    const fileRecord = repository.getFileRecord(String(revision.fileRecordId))
    if (fileRecord === undefined || fileRecord.availability !== 'current') continue
    byArtifact.set(ref.artifactId, String(fileRecord.observedPath))
  }

  const root = resolve(projectRoot)
  const seen = new Set<string>()
  for (const observedPath of byArtifact.values()) {
    try {
      const info = await stat(observedPath)
      if (!info.isFile() || info.size <= 0 || info.size > MAX_FILE_BYTES) continue
      if (total + info.size > MAX_TOTAL_BYTES) continue
      const relativePath = relative(root, resolve(observedPath)).split(/[\\/]/).join('/')
      if (relativePath.startsWith('..') || isAbsolute(relativePath) || seen.has(relativePath)) continue
      seen.add(relativePath)
      const bytes = new Uint8Array(await readFile(observedPath))
      entries.push({ path: `files/${relativePath}`, bytes })
      total += bytes.length
    } catch {
      // 文件不可读/缺失时跳过；manifest.json 已携带 contentHash 供校验追溯。
    }
  }

  return buildZip(entries)
}
