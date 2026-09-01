import { deflateRawSync } from 'node:zlib'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import type { ProjectId } from '@local-creative-os/domain'

import { SqliteMetadataRepository } from '../../src/metadata-repository.js'
import { ResourcePackageService } from '../../src/resources/resource-package-service.js'
import { ResourceReader } from '../../src/resources/resource-reader.js'

const roots: string[] = []
const repositories: SqliteMetadataRepository[] = []

afterEach(() => {
  for (const repository of repositories.splice(0)) repository.close()
  for (const root of roots.splice(0)) void Promise.resolve().then(() => { try { rmSync(root, { recursive: true, force: true }) } catch { /* best effort */ } })
})

function setup(): { readonly repository: SqliteMetadataRepository; readonly packages: ResourcePackageService; readonly projectId: ProjectId; readonly scopeId: string; readonly projectRoot: string } {
  const dbRoot = mkdtempSync(join(tmpdir(), 'lcos-pkg-db-'))
  const projectRoot = mkdtempSync(join(tmpdir(), 'lcos-pkg-project-'))
  roots.push(dbRoot, projectRoot)
  const repository = new SqliteMetadataRepository(join(dbRoot, 'metadata.sqlite'))
  repositories.push(repository)
  repository.createProject({ id: 'project-pkg' as ProjectId, name: 'Pkg', rootPath: projectRoot })
  const scopeId = String(repository.get('project-pkg')?.scopes[0]?.id ?? '')
  return {
    repository,
    packages: new ResourcePackageService(repository),
    projectId: 'project-pkg' as ProjectId,
    scopeId,
    projectRoot,
  }
}

function crc32(bytes: Buffer): number {
  const table: number[] = []
  for (let n = 0; n < 256; n += 1) {
    let c = n
    for (let k = 0; k < 8; k += 1) c = c & 1 ? (0xedb88320 ^ (c >>> 1)) >>> 0 : c >>> 1
    table[n] = c >>> 0
  }
  let crc = 0xffffffff
  for (const byte of bytes) crc = (table[(crc ^ byte) & 0xff]! ^ (crc >>> 8)) >>> 0
  return (crc ^ 0xffffffff) >>> 0
}

function buildZip(entries: readonly { name: string; bytes: Buffer }[]): Buffer {
  const chunks: Buffer[] = []
  const central: Buffer[] = []
  let offset = 0
  for (const entry of entries) {
    const name = Buffer.from(entry.name, 'utf8')
    const data = deflateRawSync(entry.bytes)
    const crc = crc32(entry.bytes)
    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4)
    local.writeUInt16LE(8, 8)
    local.writeUInt32LE(crc, 14)
    local.writeUInt32LE(data.length, 18)
    local.writeUInt32LE(entry.bytes.length, 22)
    local.writeUInt16LE(name.length, 26)
    chunks.push(local, name, data)
    const entryCentral = Buffer.alloc(46)
    entryCentral.writeUInt32LE(0x02014b50, 0)
    entryCentral.writeUInt16LE(20, 4)
    entryCentral.writeUInt16LE(20, 6)
    entryCentral.writeUInt16LE(8, 10)
    entryCentral.writeUInt32LE(crc, 16)
    entryCentral.writeUInt32LE(data.length, 20)
    entryCentral.writeUInt32LE(entry.bytes.length, 24)
    entryCentral.writeUInt16LE(name.length, 28)
    entryCentral.writeUInt32LE(((0o100644 & 0xffff) << 16) >>> 0, 38)
    entryCentral.writeUInt32LE(offset, 42)
    central.push(entryCentral, name)
    offset += 30 + name.length + data.length
  }
  const centralBuffer = Buffer.concat(central)
  const eocd = Buffer.alloc(22)
  eocd.writeUInt32LE(0x06054b50, 0)
  eocd.writeUInt16LE(entries.length, 8)
  eocd.writeUInt16LE(entries.length, 10)
  eocd.writeUInt32LE(centralBuffer.length, 12)
  eocd.writeUInt32LE(offset, 16)
  return Buffer.concat([...chunks, centralBuffer, eocd])
}

describe('ResourcePackageService (U3)', () => {
  it('imports a directory as one node with manifest, filtering secrets and node_modules', async () => {
    const { packages, projectId, scopeId, projectRoot } = setup()
    const outcome = await packages.importDirectory(projectId, {
      importRequestId: 'skill-1',
      rootName: 'my-skill',
      files: [
        { path: 'SKILL.md', bytes: Buffer.from('---\nname: my-skill\n---\n# Do things', 'utf8') },
        { path: 'scripts/run.js', bytes: Buffer.from('console.log(1)', 'utf8') },
        { path: '.env', bytes: Buffer.from('SECRET=1', 'utf8') },
        { path: 'node_modules/pkg/index.js', bytes: Buffer.from('x', 'utf8') },
        { path: 'keys/private.pem', bytes: Buffer.from('pem', 'utf8') },
      ],
      scopeId,
      position: { x: 10, y: 20 },
    })

    expect(outcome.sourceKind).toBe('directory_copy')
    expect(outcome.artifact.title).toBe('my-skill')
    expect(outcome.reused).toBe(false)
    const manifestPath = join(projectRoot, 'imports', 'resources', outcome.resourceId, 'resource-manifest.json')
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as { files: readonly { path: string }[] }
    expect([...manifest.files.map((file) => file.path)].sort()).toEqual(['SKILL.md', 'scripts/run.js'].sort())
    expect(manifest.files.some((file) => file.path.includes('.env'))).toBe(false)
    expect(manifest.files.some((file) => file.path.includes('node_modules'))).toBe(false)
    expect(manifest.files.some((file) => file.path.includes('pem'))).toBe(false)

    const reader = new ResourceReader(packages.repository)
    const skill = await reader.read('project-pkg', outcome.resourceId, { path: 'SKILL.md', format: 'text' })
    expect(skill.data).toContain('name: my-skill')
  })

  it('drops over-deep paths and rejects empty packages after filtering', async () => {
    const { packages, projectId, scopeId } = setup()
    const outcome = await packages.importDirectory(projectId, {
      importRequestId: 'depth-1',
      rootName: 'deep-pkg',
      files: [
        { path: 'a/b/c/d/e/f/g/h/i/deep.txt', bytes: Buffer.from('too deep', 'utf8') },
        { path: 'ok.txt', bytes: Buffer.from('fine', 'utf8') },
      ],
      scopeId,
      position: { x: 0, y: 0 },
    })
    const reader = new ResourceReader(packages.repository)
    const ok = await reader.read('project-pkg', outcome.resourceId, { path: 'ok.txt' })
    expect(ok.data).toBe('fine')
    await expect(reader.read('project-pkg', outcome.resourceId, { path: 'a/b/c/d/e/f/g/h/i/deep.txt' }))
      .rejects.toThrow(/not part of this resource/)
  })

  it('imports a ZIP archive as a package', async () => {
    const { packages, projectId, scopeId } = setup()
    const zip = buildZip([
      { name: 'SKILL.md', bytes: Buffer.from('# Zip Skill', 'utf8') },
      { name: 'assets/ref.png', bytes: Buffer.from('png', 'utf8') },
    ])
    const outcome = await packages.importArchive(projectId, {
      importRequestId: 'zip-1',
      fileName: 'zip-skill.zip',
      bytes: zip,
      scopeId,
      position: { x: 0, y: 0 },
    })
    expect(outcome.artifact.title).toBe('zip-skill')
    const reader = new ResourceReader(packages.repository)
    const skill = await reader.read('project-pkg', outcome.resourceId, { path: 'SKILL.md' })
    expect(skill.data).toBe('# Zip Skill')
  })

  it('is idempotent for the same request id and package name', async () => {
    const { packages, projectId, scopeId } = setup()
    const input = {
      importRequestId: 'same-pkg',
      rootName: 'same',
      files: [{ path: 'a.txt', bytes: Buffer.from('a', 'utf8') }],
      scopeId,
      position: { x: 0, y: 0 },
    }
    const first = await packages.importDirectory(projectId, input)
    const replay = await packages.importDirectory(projectId, input)
    expect(replay.reused).toBe(true)
    expect(replay.resourceId).toBe(first.resourceId)
  })
})
