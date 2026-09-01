import { mkdtempSync, mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { SqliteMetadataRepository } from '../src/metadata-repository.js'
import { SkillPackageService } from '../src/skill-package-service.js'
import { SkillProposalService } from '../src/skill-proposal-service.js'
import { SkillAuthorDispatchService } from '../src/skill-author-dispatch-service.js'

const roots: string[] = []
const repositories: SqliteMetadataRepository[] = []

afterEach(async () => {
  for (const repository of repositories.splice(0)) repository.close()
  for (const root of roots.splice(0)) void Promise.resolve().then(() => { try { rmSync(root, { recursive: true, force: true }) } catch { /* best effort */ } })
})

function disposable() {
  const dir = mkdtempSync(join(tmpdir(), 'lcos-skill-author-'))
  roots.push(dir)
  const projectRoot = join(dir, 'root')
  mkdirSync(projectRoot, { recursive: true })
  const repository = new SqliteMetadataRepository(join(dir, 'metadata.sqlite'))
  repositories.push(repository)
  repository.createProject({ id: 'sa-project' as never, name: 'SA', rootPath: projectRoot })
  const packages = new SkillPackageService(repository)
  const skillProposals = new SkillProposalService(repository, packages)
  const service = new SkillAuthorDispatchService({ repository, skillProposals })
  return { repository, skillProposals, service }
}

describe('SkillAuthorDispatchService (P0-D semantic execution bridge)', () => {
  it('dispatch requires a configured agentlet runtime (fail-close UNAVAILABLE)', async () => {
    const { service } = disposable()
    expect(() => service.dispatch({ schemaVersion: 1, projectId: 'sa-project', runId: 'run-1' }))
      .toThrow('UNAVAILABLE: agentlet runtime is not configured.')
  })

  it('ingest a valid result persists a SkillProposal (pending, createdBy=system, not installed)', async () => {
    const { repository, service } = disposable()
    const result = {
      schemaVersion: 1,
      kind: 'skill-proposal',
      agentletId: 'lcos-skill-author',
      draft: { skillId: 'summarize-notes', name: 'summarize-notes', description: '总结笔记', content: '---\nname: summarize-notes\n---\n# summarize-notes\n' },
      methodFact: { methods: ['按章节结构总结'], facts: [] },
      source: { runId: 'run-1', prompt: '总结这份会议笔记', intent: 'analyze', orderedReferenceCount: 0, provider: 'codex', runCompletedAt: new Date().toISOString() },
      summary: '已生成可复用 Skill 底稿',
    }
    const ingested = service.ingest('sa-project', 'agentlet-session', result)
    expect(ingested.ok).toBe(true)
    expect(ingested.proposalId.length).toBeGreaterThan(0)
    // proposal 以 pending + createdBy=system 持久化（S3 语义诚实：未 install）
    const proposals = repository.listSkillProposals('sa-project')
    const proposal = proposals.find((entry) => entry.proposalId === ingested.proposalId)
    expect(proposal).toBeDefined()
    expect(proposal!.status).toBe('pending')
    expect(proposal!.createdBy).toBe('system')
    expect(proposal!.draft.skillId).toBe('summarize-notes')
  })

  it('ingest an invalid output fails closed (no proposal persisted)', async () => {
    const { repository, service } = disposable()
    const invalid = {
      schemaVersion: 1,
      kind: 'skill-proposal',
      agentletId: 'lcos-skill-author',
      // draft 缺失 → schema validation fail
      methodFact: { methods: [], facts: [] },
      source: { runId: 'run-1', prompt: 'x', intent: 'analyze' as const, orderedReferenceCount: 0, provider: 'codex' as const, runCompletedAt: new Date().toISOString() },
      summary: 'bad',
    }
    expect(() => service.ingest('sa-project', 'agentlet-session', invalid)).toThrow('SKILL_AUTHOR_INVALID_OUTPUT')
    expect(repository.listSkillProposals('sa-project')).toEqual([])
  })
})