import { mkdtemp, mkdir, lstat, readFile, rm, symlink, unlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { ObsidianReadOnlyConnector } from '../../src/connectors/obsidian-connector.js'
import { SqliteMetadataRepository } from '../../src/metadata-repository.js'
import { createMvpSampleSnapshot } from '../../src/mvp-sample-project.js'
import { createLocalCoreServer, type LocalCoreServer } from '../../src/server.js'

const roots: string[] = []
const servers: LocalCoreServer[] = []
const repositories: SqliteMetadataRepository[] = []

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.close()))
  for (const repository of repositories.splice(0)) repository.close()
  for (const root of roots.splice(0)) void rm(root, { recursive: true, force: true }).catch(() => { /* best effort */ })
})

async function makeVault(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'lcos-obsidian-vault-'))
  roots.push(root)
  await mkdir(join(root, '.obsidian'), { recursive: true })
  await mkdir(join(root, 'Projects'), { recursive: true })
  await writeFile(join(root, '.obsidian', 'workspace.json'), '{}')
  await writeFile(join(root, 'Projects', 'Brief.md'), `---\ntitle: 美的冰箱 Brief\ntags: [midea, brief]\n---\n# 备用标题\n参考 [[Script]] 和 #campaign。\n`)
  await writeFile(join(root, 'Script.md'), '# 冰箱篇脚本\n\n关联 [[Projects/Brief]]。\n')
  await writeFile(join(root, 'ignore.txt'), 'not markdown')
  const outside = await mkdtemp(join(tmpdir(), 'lcos-obsidian-outside-'))
  roots.push(outside)
  await writeFile(join(outside, 'secret.md'), '# secret')
  // Windows 无 symlink 特权时 fs.symlink 可能 EPERM 失败，或静默降级为普通文件副本。
  // 只有真符号链接才保留（供“跳过符号链接”断言）；降级副本会污染 noteCount，必须回滚。
  try {
    await symlink(join(outside, 'secret.md'), join(root, 'linked.md'))
    const linkStat = await lstat(join(root, 'linked.md'))
    if (!linkStat.isSymbolicLink()) await unlink(join(root, 'linked.md'))
  } catch {
    /* Windows without symlink privilege: linked.md never exists */
  }
  return root
}

describe('Obsidian read-only connector', () => {
  it('scans Markdown metadata without reading Obsidian internals or symlink targets', async () => {
    const root = await makeVault()
    const connector = new ObsidianReadOnlyConnector()
    const scan = await connector.scan(root)

    expect(scan.readOnly).toBe(true)
    expect(scan.noteCount).toBe(2)
    expect(scan.notes.map((note) => note.relativePath)).toEqual(['Projects/Brief.md', 'Script.md'])
    expect(scan.notes[0]).toMatchObject({ title: '美的冰箱 Brief', tags: expect.arrayContaining(['midea', 'brief', 'campaign']), outlinks: ['Script'] })
    expect(scan.warnings.some((warning) => warning.includes('符号链接')) || scan.warnings.length === 0).toBe(true)
  })

  it('reads only Markdown files inside the selected Vault', async () => {
    const root = await makeVault()
    const connector = new ObsidianReadOnlyConnector()
    const note = await connector.read(root, 'Projects/Brief.md')
    expect(note.bytes.toString('utf8')).toContain('美的冰箱 Brief')
    expect(note.contentHash).toMatch(/^[0-9a-f]{64}$/)
    await expect(connector.read(root, '../secret.md')).rejects.toThrow('路径无效')
    await expect(connector.read(root, 'ignore.txt')).rejects.toThrow('只读取 Markdown')
  })

  it('imports selected notes through the Core without exposing the Vault absolute path', async () => {
    const vault = await makeVault()
    const dbRoot = await mkdtemp(join(tmpdir(), 'lcos-obsidian-db-'))
    const projectRoot = await mkdtemp(join(tmpdir(), 'lcos-obsidian-project-'))
    roots.push(dbRoot, projectRoot)
    const repository = new SqliteMetadataRepository(join(dbRoot, 'metadata.sqlite'))
    repositories.push(repository)
    const snapshot = createMvpSampleSnapshot(projectRoot, '2026-08-05T04:00:00.000Z')
    repository.save(snapshot)
    const server = createLocalCoreServer({
      port: 0,
      metadataRepository: repository,
      directoryPicker: async () => ({ path: vault, cancelled: false }),
    })
    servers.push(server)
    const address = await server.start()
    const base = `http://${address.host}:${address.port}`

    const scanResponse = await fetch(`${base}/connectors/obsidian/select-and-scan`, { method: 'POST', body: '{}' })
    expect(scanResponse.status).toBe(200)
    const scanBody = await scanResponse.json() as { value: { scanId: string; notes: { relativePath: string }[] } }
    expect(JSON.stringify(scanBody)).not.toContain(vault)

    const importResponse = await fetch(`${base}/projects/${snapshot.project.id}/connectors/obsidian/import`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        scanId: scanBody.value.scanId,
        relativePaths: ['Projects/Brief.md'],
        scopeId: String(snapshot.scopes[0]!.id),
        position: { x: 800, y: 400 },
      }),
    })
    expect(importResponse.status).toBe(201)
    const imported = await importResponse.json() as { value: { artifactId: string; viewId: string }[] }
    expect(imported.value).toHaveLength(1)
    expect(JSON.stringify(imported)).not.toContain('observedPath')
    expect(JSON.stringify(imported)).not.toContain(vault)
    const artifact = repository.getArtifact(imported.value[0]!.artifactId)
    const revision = repository.getArtifactRevision(String(artifact?.currentRevisionId))
    const file = repository.getFileRecord(String(revision?.fileRecordId))
    expect(file?.observedPath).toContain(join(projectRoot, 'imports'))
    expect(await readFile(join(vault, 'Projects', 'Brief.md'), 'utf8')).toContain('美的冰箱 Brief')
  })
})
