import { createHash } from 'node:crypto'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { existsSync } from 'node:fs'

import type { PersistedContextManifestV0 } from '@local-creative-os/contracts'
import type { Run, RuntimeDispatch } from '@local-creative-os/domain'
import { afterEach, describe, expect, it } from 'vitest'

import { SqliteMetadataRepository } from '../src/metadata-repository.js'
import { createMvpSampleSnapshot } from '../src/mvp-sample-project.js'
import { ProjectEventHub } from '../src/project-events/project-event-hub.js'
import { SkillPackageService } from '../src/skill-package-service.js'
import { SkillProposalService } from '../src/skill-proposal-service.js'

const cleanup: string[] = []

afterEach(async () => {
  for (const path of cleanup.splice(0)) void rm(path, { recursive: true, force: true }).catch(() => { /* best effort */ })
})

function createRun(repository: SqliteMetadataRepository, snapshot: ReturnType<typeof createMvpSampleSnapshot>, id: string, status: Run['status']): Run {
  const manifestJson = JSON.stringify({ schemaVersion: 0, sequence: 0, runKey: id, target: { artifactId: String(snapshot.artifacts[0]!.id) }, references: [{ artifactId: String(snapshot.artifacts[1]!.id) }] })
  const manifestId = `manifest-sp-${id}` as PersistedContextManifestV0['id']
  repository.createContextManifest({
    id: manifestId,
    projectId: snapshot.project.id,
    schemaVersion: 0,
    targetArtifactId: snapshot.artifacts[0]!.id,
    targetRevisionId: snapshot.artifacts[0]!.currentRevisionId,
    canonicalJson: manifestJson,
    manifestHash: createHash('sha256').update(manifestJson).digest('hex'),
    createdAt: '2026-08-30T09:00:00.000Z',
  })
  const run: Run = {
    id: `run-sp-${id}` as Run['id'],
    projectId: snapshot.project.id,
    workspaceId: snapshot.workspaces[0]!.id,
    targetArtifactId: snapshot.artifacts[0]!.id,
    targetRevisionId: snapshot.artifacts[0]!.currentRevisionId,
    contextManifestId: manifestId,
    provider: 'codex',
    requestedProvider: 'codex',
    outputIntent: 'revise',
    returnGroupId: `return-group-sp-${id}`,
    status,
    instruction: 'Summarize the meeting notes into a decision list',
    createdAt: '2026-08-30T09:00:00.000Z',
    updatedAt: '2026-08-30T09:05:00.000Z',
  }
  repository.createRunWithDispatch(run, {
    id: `dispatch-sp-${id}` as RuntimeDispatch['id'],
    runId: run.id,
    provider: 'codex',
    idempotencyKey: String(run.id),
    status: 'bound',
    attemptCount: 1,
    createdAt: run.createdAt,
    updatedAt: run.updatedAt,
  })
  return run
}

describe('SkillProposalService (RunRecipe → Skill Proposal seam)', () => {
  it('end-to-end chain: completed run → recipe → pending proposal → accept → real user skill', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'lcos-skill-proposal-'))
    cleanup.push(directory)
    const repository = new SqliteMetadataRepository(join(directory, 'metadata.sqlite'))
    const snapshot = createMvpSampleSnapshot(directory, '2026-08-30T09:00:00.000Z')
    repository.save(snapshot)
    const run = createRun(repository, snapshot, 'done', 'completed')
    const events = new ProjectEventHub()
    const packages = new SkillPackageService(repository)
    const proposals = new SkillProposalService(repository, packages, events)
    const projectId = String(snapshot.project.id)

    // 事件通道复用断言：与 ContextProposalStore 相同的 proposal.changed 事件
    const seen: string[] = []
    events.subscribe(projectId, (event) => seen.push(`${(event as { channel: string }).channel}:${(event as { type: string }).type}`))

    try {
      // 1) run → recipe → proposal
      const proposal = await proposals.proposeFromRun(String(run.id))
      expect(proposal.status).toBe('pending')
      expect(proposal.schemaVersion).toBe(1)
      expect(proposal.createdBy).toBe('system')
      expect(proposal.source.runId).toBe(String(run.id))
      expect(proposal.source.prompt).toBe(run.instruction)
      expect(proposal.source.intent).toBe('revise')
      expect(proposal.source.provider).toBe('codex')
      expect(proposal.draft.skillId.startsWith('summarize-the-meeting-notes')).toBe(true)
      expect(proposal.draft.skillId.length).toBeLessThanOrEqual(48)
      // draft SKILL.md 通过 S2 结构校验（frontmatter + name + description）
      const validation = packages.validate(proposal.draft.content)
      expect(validation.valid).toBe(true)
      expect(seen).toContain('proposal:proposal.changed')

      // 未完成 run 拒绝（诚实语义）
      const running = createRun(repository, snapshot, 'wip', 'running')
      await expect(proposals.proposeFromRun(String(running.id))).rejects.toThrow('RUN_NOT_COMPLETED')

      // 2) proposal → accept（Skill Builder 复用 S2）
      const accepted = await proposals.accept(projectId, proposal.proposalId)
      expect(accepted.proposal.status).toBe('accepted')
      expect(accepted.proposal.builtSkillId).toBe(proposal.draft.skillId)
      expect(accepted.skillId).toBe(proposal.draft.skillId)

      // user skill 真实落盘（provenance 继承 S2 origin=user）
      const skillMd = join(snapshot.project.rootPath, '.creative-os', 'skills', proposal.draft.skillId, 'SKILL.md')
      expect(existsSync(skillMd)).toBe(true)
      const raw = await readFile(skillMd, 'utf8')
      expect(raw).toContain(run.instruction)
      const listed = await packages.list(projectId)
      const entry = listed.find((item) => item.id === proposal.draft.skillId)
      expect(entry?.provenance?.origin).toBe('user')

      // 双重 accept / reject 已决提案拒绝（状态机与 context proposal 一致）
      await expect(proposals.accept(projectId, proposal.proposalId)).rejects.toThrow('SKILL_PROPOSAL_NOT_PENDING')
      expect(() => proposals.reject(projectId, proposal.proposalId)).toThrow('SKILL_PROPOSAL_NOT_PENDING')

      // 事件在 create/accept 各发一次（复用现有 proposal.changed 通道）
      expect(seen.filter((item) => item === 'proposal:proposal.changed').length).toBeGreaterThanOrEqual(2)
    } finally {
      repository.close()
    }
  })

  it('reject keeps audit trail and never writes a skill file', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'lcos-skill-proposal-'))
    cleanup.push(directory)
    const repository = new SqliteMetadataRepository(join(directory, 'metadata.sqlite'))
    const snapshot = createMvpSampleSnapshot(directory, '2026-08-30T09:00:00.000Z')
    repository.save(snapshot)
    const run = createRun(repository, snapshot, 'rejected-run', 'completed')
    const packages = new SkillPackageService(repository)
    const proposals = new SkillProposalService(repository, packages)
    const projectId = String(snapshot.project.id)
    try {
      const proposal = await proposals.proposeFromRun(String(run.id))
      const rejected = proposals.reject(projectId, proposal.proposalId)
      expect(rejected.status).toBe('rejected')
      // 拒绝后不再 accept
      await expect(proposals.accept(projectId, proposal.proposalId)).rejects.toThrow('SKILL_PROPOSAL_NOT_PENDING')
      // 未落任何 skill 文件
      expect(await packages.listUserSkillIds(projectId)).toEqual([])
      // 审计行保留（list 仍可见）
      expect(proposals.list(projectId).some((item) => item.proposalId === proposal.proposalId && item.status === 'rejected')).toBe(true)
    } finally {
      repository.close()
    }
  })

  it('derives unique skill ids when the same prompt runs twice', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'lcos-skill-proposal-'))
    cleanup.push(directory)
    const repository = new SqliteMetadataRepository(join(directory, 'metadata.sqlite'))
    const snapshot = createMvpSampleSnapshot(directory, '2026-08-30T09:00:00.000Z')
    repository.save(snapshot)
    const run1 = createRun(repository, snapshot, 'dup1', 'completed')
    const run2 = createRun(repository, snapshot, 'dup2', 'completed')
    const packages = new SkillPackageService(repository)
    const proposals = new SkillProposalService(repository, packages)
    const projectId = String(snapshot.project.id)
    try {
      const first = await proposals.proposeFromRun(String(run1.id))
      const second = await proposals.proposeFromRun(String(run2.id))
      expect(first.draft.skillId).not.toBe(second.draft.skillId)
      await proposals.accept(projectId, first.proposalId)
      await proposals.accept(projectId, second.proposalId)
      const ids = await packages.listUserSkillIds(projectId)
      expect(ids).toContain(first.draft.skillId)
      expect(ids).toContain(second.draft.skillId)
    } finally {
      repository.close()
    }
  })
})
