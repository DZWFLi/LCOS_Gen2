import { spawn } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import type { ProjectId } from '@local-creative-os/domain'

import { ImportCopyService } from '../../src/import-copy-service.js'
import { SqliteMetadataRepository } from '../../src/metadata-repository.js'
import { createLocalCoreServer, type LocalCoreServer } from '../../src/server.js'
import { UniversalResourceImportService } from '../../src/resources/universal-resource-import-service.js'

const roots: string[] = []
const repositories: SqliteMetadataRepository[] = []
const servers: LocalCoreServer[] = []

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.close()))
  for (const repository of repositories.splice(0)) repository.close()
  for (const root of roots.splice(0)) void Promise.resolve().then(() => { try { rmSync(root, { recursive: true, force: true }) } catch { /* best effort */ } })
})

describe('LCOS Agent CLI resource commands (U2)', () => {
  it('lists, shows and reads a resource through the CLI', async () => {
    const dbRoot = mkdtempSync(join(tmpdir(), 'lcos-cli-db-'))
    const projectRoot = mkdtempSync(join(tmpdir(), 'lcos-cli-project-'))
    roots.push(dbRoot, projectRoot)
    const repository = new SqliteMetadataRepository(join(dbRoot, 'metadata.sqlite'))
    repositories.push(repository)
    repository.createProject({
      id: 'project-cli' as ProjectId,
      name: 'CLI',
      rootPath: projectRoot,
    })
    const scopeId = String(repository.get('project-cli')?.scopes[0]?.id ?? '')
    const service = new UniversalResourceImportService(repository, new ImportCopyService(repository))
    const outcome = await service.importFile('project-cli' as ProjectId, {
      importRequestId: 'cli-doc',
      fileName: 'cli.md',
      contentType: 'text/markdown',
      bytes: Buffer.from('# CLI Doc\n\nHello from CLI test.', 'utf8'),
      scopeId,
      position: { x: 0, y: 0 },
    })
    const server = createLocalCoreServer({ port: 0, metadataRepository: repository })
    servers.push(server)
    const address = await server.start()
    const baseUrl = `http://${address.host}:${address.port}`
    const cliRoot = resolve(import.meta.dirname, '../../../..')
    const env = { ...process.env, LCOS_CORE_URL: baseUrl }

    const runCli = (args: readonly string[]): Promise<string> => new Promise((resolvePromise, reject) => {
      const child = spawn(process.execPath, ['tools/lcos-agent/cli.mjs', ...args], { cwd: cliRoot, env })
      let stdout = ''
      let stderr = ''
      child.stdout.on('data', (chunk: Buffer) => { stdout += chunk.toString('utf8') })
      child.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString('utf8') })
      child.on('error', (error) => reject(new Error(`CLI spawn failed: ${error.message}`)))
      child.on('close', (code) => {
        if (code === 0) resolvePromise(stdout)
        else reject(new Error(`CLI exited ${code}\nstdout: ${stdout.slice(0, 400)}\nstderr: ${stderr.slice(0, 800)}`))
      })
    })

    const listed = await runCli(['resource', 'list', 'project-cli'])
    expect(listed).toContain(outcome.resourceId)

    const read = await runCli(['resource', 'read', 'project-cli', outcome.resourceId, '--limit', '32', '--format', 'text'])
    expect(read).toContain('Hello from CLI test.')

    const shown = await runCli(['resource', 'show', 'project-cli', outcome.resourceId])
    expect(shown).toContain(outcome.artifactId)
  })

  it('imports a local directory as a resource through the CLI (U3)', async () => {
    const dbRoot = mkdtempSync(join(tmpdir(), 'lcos-cli-import-db-'))
    const projectRoot = mkdtempSync(join(tmpdir(), 'lcos-cli-import-project-'))
    const sourceDir = mkdtempSync(join(tmpdir(), 'lcos-cli-source-'))
    mkdirSync(join(sourceDir, 'scripts'), { recursive: true })
    writeFileSync(join(sourceDir, 'SKILL.md'), '---\nname: cli-skill\n---\n# CLI Skill', 'utf8')
    writeFileSync(join(sourceDir, '.env'), 'SECRET=1', 'utf8')
    writeFileSync(join(sourceDir, 'scripts', 'run.js'), 'console.log(1)', 'utf8')
    roots.push(dbRoot, projectRoot, sourceDir)
    const repository = new SqliteMetadataRepository(join(dbRoot, 'metadata.sqlite'))
    repositories.push(repository)
    repository.createProject({ id: 'project-cli-import' as ProjectId, name: 'CLI Import', rootPath: projectRoot })
    const server = createLocalCoreServer({ port: 0, metadataRepository: repository })
    servers.push(server)
    const address = await server.start()
    const baseUrl = `http://${address.host}:${address.port}`
    const cliRoot = resolve(import.meta.dirname, '../../../..')
    const env = { ...process.env, LCOS_CORE_URL: baseUrl }
    const runCli = async (args: readonly string[]): Promise<string> => new Promise((resolvePromise, reject) => {
      const child = spawn(process.execPath, ['tools/lcos-agent/cli.mjs', ...args], { cwd: cliRoot, env })
      let stdout = ''
      let stderr = ''
      child.stdout.on('data', (chunk: Buffer) => { stdout += chunk.toString('utf8') })
      child.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString('utf8') })
      child.on('error', (error) => reject(new Error(`CLI spawn failed: ${error.message}`)))
      child.on('close', (code) => {
        if (code === 0) resolvePromise(stdout)
        else reject(new Error(`CLI exited ${code}\nstdout: ${stdout.slice(0, 400)}\nstderr: ${stderr.slice(0, 800)}`))
      })
    })

    const imported = await runCli(['resource', 'import', 'project-cli-import', sourceDir, '--name', 'cli-skill'])
    const importedBody = JSON.parse(imported) as { resourceId: string; sourceKind: string }
    expect(importedBody.sourceKind).toBe('directory_copy')

    const listed = await runCli(['resource', 'list', 'project-cli-import'])
    expect(listed).toContain('cli-skill')

    const read = await runCli(['resource', 'read', 'project-cli-import', importedBody.resourceId, '--path', 'SKILL.md'])
    expect(read).toContain('name: cli-skill')
  })
})
