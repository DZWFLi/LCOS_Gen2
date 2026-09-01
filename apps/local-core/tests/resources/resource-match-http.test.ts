import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import type { ProjectId } from '@local-creative-os/domain'

import { ImportCopyService } from '../../src/import-copy-service.js'
import { SqliteMetadataRepository } from '../../src/metadata-repository.js'
import { ResourcePackageService } from '../../src/resources/resource-package-service.js'
import { UniversalResourceImportService } from '../../src/resources/universal-resource-import-service.js'
import { createLocalCoreServer, type LocalCoreServer } from '../../src/server.js'

const roots: string[] = []
const repositories: SqliteMetadataRepository[] = []
const servers: LocalCoreServer[] = []

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.close()))
  for (const repository of repositories.splice(0)) repository.close()
  for (const root of roots.splice(0)) void Promise.resolve().then(() => { try { rmSync(root, { recursive: true, force: true }) } catch { /* best effort */ } })
})

describe('Resource match HTTP route (U4)', () => {
  it('returns candidates and honors ActiveContext exclusions', async () => {
    const dbRoot = mkdtempSync(join(tmpdir(), 'lcos-match-http-db-'))
    const projectRoot = mkdtempSync(join(tmpdir(), 'lcos-match-http-project-'))
    roots.push(dbRoot, projectRoot)
    const repository = new SqliteMetadataRepository(join(dbRoot, 'metadata.sqlite'))
    repositories.push(repository)
    repository.createProject({ id: 'project-match' as ProjectId, name: 'Match', rootPath: projectRoot })
    const scopeId = String(repository.get('project-match')?.scopes[0]?.id ?? '')
    const imports = new UniversalResourceImportService(repository, new ImportCopyService(repository))
    const brief = await imports.importFile('project-match' as ProjectId, {
      importRequestId: 'brief',
      fileName: 'brief.md',
      contentType: 'text/markdown',
      bytes: Buffer.from('# Brief', 'utf8'),
      scopeId,
      position: { x: 0, y: 0 },
    })
    const packages = new ResourcePackageService(repository)
    const skill = await packages.importDirectory('project-match' as ProjectId, {
      importRequestId: 'skill',
      rootName: 'storyboard-skill',
      files: [{ path: 'SKILL.md', bytes: Buffer.from('---\nname: storyboard-skill\n---\n# Storyboard', 'utf8') }],
      scopeId,
      position: { x: 0, y: 0 },
    })
    const server = createLocalCoreServer({ port: 0, metadataRepository: repository })
    servers.push(server)
    const address = await server.start()
    const baseUrl = `http://${address.host}:${address.port}`
    await fetch(`${baseUrl}/projects/project-match/resources/${skill.resourceId}/reanalyze`, { method: 'POST' })
    await fetch(`${baseUrl}/projects/project-match/resources/${brief.resourceId}/reanalyze`, { method: 'POST' })

    const active = await fetch(`${baseUrl}/projects/project-match/active-context`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        scopeId,
        selectedViewIds: [String(skill.view.id)],
        pinnedContextIds: [],
        excludedContextIds: [String(brief.view.id)],
      }),
    })
    expect(active.status).toBe(200)

    const response = await fetch(`${baseUrl}/projects/project-match/resources/match`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ instruction: 'use the storyboard skill to revise the script', outputIntent: 'revise' }),
    })
    expect(response.status).toBe(200)
    const body = await response.json() as { ok: boolean; value: readonly { resourceId: string; role: string; requiresApproval: boolean }[] }
    expect(body.value.some((match) => match.resourceId === skill.resourceId && match.role === 'candidate_skill')).toBe(true)
    expect(body.value.some((match) => match.resourceId === brief.resourceId)).toBe(false)
  })
})
