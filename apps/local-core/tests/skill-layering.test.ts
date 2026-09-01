import { spawn } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) { try { rmSync(root, { recursive: true, force: true }) } catch { /* best effort */ } }
})

const cliRoot = resolve(import.meta.dirname, '../../..')

interface CliOutcome { code: number; stdout: string; stderr: string }

function runSkillCli(args: readonly string[]): Promise<CliOutcome> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(process.execPath, ['tools/lcos-agent/cli.mjs', 'skill', ...args], { cwd: cliRoot, env: process.env })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (chunk: Buffer) => { stdout += chunk.toString('utf8') })
    child.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString('utf8') })
    child.on('error', (error) => reject(new Error(`CLI spawn failed: ${error.message}`)))
    child.on('close', (code) => resolvePromise({ code: code ?? -1, stdout, stderr }))
  })
}

function makeProjectRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'lcos-skill-layers-'))
  roots.push(root)
  return root
}

function writeUserSkill(projectRoot: string, id: string, frontmatter: string, body: string): void {
  const dir = join(projectRoot, '.creative-os', 'skills', id)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'SKILL.md'), `${frontmatter}\n${body}`, 'utf8')
}

describe('skill 分层加载 system/user/merged（任务四 P2）', () => {
  it('无 user 层：list 仅 system（向后兼容），curator 标 system', async () => {
    const outcome = await runSkillCli(['list'])
    expect(outcome.code).toBe(0)
    const value = JSON.parse(outcome.stdout) as { skills: Array<{ id: string; source: string }> }
    const curator = value.skills.find((entry) => entry.id === 'lcos-project-curator')
    expect(curator?.source).toBe('system')
    expect(value.skills.some((entry) => entry.source === 'merged')).toBe(false)
  })

  it('同 id 双层 → merged；read 返回 system 原文 + User extensions 分隔 + user 正文', async () => {
    const projectRoot = makeProjectRoot()
    writeUserSkill(
      projectRoot,
      'lcos-project-curator',
      '---\nname: lcos-project-curator\ndescription: 我的整理偏好扩展\n---',
      '## 我的规则\n\n- 中文节点一律先 Search 再建',
    )
    const list = await runSkillCli(['list', '--project-root', projectRoot])
    expect(list.code).toBe(0)
    const value = JSON.parse(list.stdout) as { skills: Array<{ id: string; source: string }> }
    expect(value.skills.find((entry) => entry.id === 'lcos-project-curator')?.source).toBe('merged')

    const read = await runSkillCli(['read', 'lcos-project-curator', '--project-root', projectRoot])
    expect(read.code).toBe(0)
    const readValue = JSON.parse(read.stdout) as { skill: string; source: string; content: string }
    expect(readValue.source).toBe('merged')
    expect(readValue.content).toContain('LCOS Project Curator V2.1')
    expect(readValue.content).toContain('## User extensions')
    expect(readValue.content).toContain('中文节点一律先 Search 再建')
    // user frontmatter 是元数据，不进合并正文
    expect(readValue.content).not.toContain('我的整理偏好扩展')
  })

  it('user 独有 skill → source=user，read 原样透出', async () => {
    const projectRoot = makeProjectRoot()
    writeUserSkill(
      projectRoot,
      'my-custom-flow',
      '---\nname: my-custom-flow\ndescription: 项目私有流程\n---',
      '# 私有流程\n\n只在本项目用',
    )
    const list = await runSkillCli(['list', '--project-root', projectRoot])
    const value = JSON.parse(list.stdout) as { skills: Array<{ id: string; source: string }> }
    expect(value.skills.find((entry) => entry.id === 'my-custom-flow')?.source).toBe('user')

    const read = await runSkillCli(['read', 'my-custom-flow', '--project-root', projectRoot])
    expect(read.code).toBe(0)
    const readValue = JSON.parse(read.stdout) as { source: string; content: string }
    expect(readValue.source).toBe('user')
    expect(readValue.content).toContain('只在本项目用')
  })

  it('坏 user skill（缺 frontmatter）→ warn + skip，不 brick', async () => {
    const projectRoot = makeProjectRoot()
    writeUserSkill(projectRoot, 'broken-skill', '', '没有 frontmatter 的正文')
    writeUserSkill(
      projectRoot,
      'good-skill',
      '---\nname: good-skill\ndescription: 正常\n---',
      '正常正文',
    )
    const list = await runSkillCli(['list', '--project-root', projectRoot])
    expect(list.code).toBe(0)
    const value = JSON.parse(list.stdout) as { skills: Array<{ id: string; source: string }> }
    expect(value.skills.some((entry) => entry.id === 'broken-skill')).toBe(false)
    expect(value.skills.find((entry) => entry.id === 'good-skill')?.source).toBe('user')
    expect(list.stderr).toContain('skipping invalid user skill')
  })

  it('目录沙箱：.. 穿越 / 反斜杠 → 逃逸拒绝（exit 1）', async () => {
    const traversal = await runSkillCli(['read', 'skills/lcos-project-curator/../../SKILL_SPEC.md'])
    expect(traversal.code).toBe(1)
    expect(traversal.stderr).toContain('escapes the skill directory')

    const backslash = await runSkillCli(['read', 'skills/lcos-project-curator\\..\\..\\SKILL_SPEC.md'])
    expect(backslash.code).toBe(1)
    expect(backslash.stderr).toContain('escapes the skill directory')
  })

  it('subpath 读取：system 层 policy 可读；user 层 references 影子化优先', async () => {
    const systemPolicy = await runSkillCli(['read', 'skills/lcos-project-curator/policies/node-labeling.md'])
    expect(systemPolicy.code).toBe(0)
    const value = JSON.parse(systemPolicy.stdout) as { source: string; content: string }
    expect(value.source).toBe('system')
    expect(value.content.length).toBeGreaterThan(0)

    const projectRoot = makeProjectRoot()
    writeUserSkill(
      projectRoot,
      'lcos-project-curator',
      '---\nname: lcos-project-curator\ndescription: 扩展\n---',
      '扩展正文',
    )
    const policyDir = join(projectRoot, '.creative-os', 'skills', 'lcos-project-curator', 'policies')
    mkdirSync(policyDir, { recursive: true })
    writeFileSync(join(policyDir, 'my-team-rules.md'), '# 团队规则\n\n节点 label 用中文', 'utf8')

    const userPolicy = await runSkillCli(['read', 'skills/lcos-project-curator/policies/my-team-rules.md', '--project-root', projectRoot])
    expect(userPolicy.code).toBe(0)
    const userValue = JSON.parse(userPolicy.stdout) as { source: string; content: string }
    expect(userValue.content).toContain('节点 label 用中文')

    // user 层的 policy 目录不影响 system 层 policy 命中
    const stillSystem = await runSkillCli(['read', 'skills/lcos-project-curator/policies/node-labeling.md', '--project-root', projectRoot])
    expect(JSON.parse(stillSystem.stdout).source).toBe('system')
  })

  it('不存在的 skill → 干净的 not found（exit 1）', async () => {
    const outcome = await runSkillCli(['read', 'no-such-skill'])
    expect(outcome.code).toBe(1)
    expect(outcome.stderr).toContain('not found')
  })

  it('resolve 保持 system-only 路由语义（不受 user 层影响）', async () => {
    const projectRoot = makeProjectRoot()
    writeUserSkill(
      projectRoot,
      'lcos-project-curator',
      '---\nname: lcos-project-curator\ndescription: 扩展\n---',
      '扩展正文',
    )
    const outcome = await runSkillCli(['resolve', 'lcos-project-curator', '--intent', 'ingest_conversation', '--project-root', projectRoot])
    expect(outcome.code).toBe(0)
    const value = JSON.parse(outcome.stdout) as { entry: string; load: string[] }
    expect(value.entry).toBe('routes/ingest-conversation.md')
    expect(value.load).toContain('policies/node-labeling.md')
  })
})
