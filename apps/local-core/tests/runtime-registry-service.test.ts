import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { RuntimeRegistryService } from '../src/runtime-registry-service.js'

const cleanup: string[] = []

async function disposableRegistry(): Promise<RuntimeRegistryService> {
  const dir = await mkdtemp(join(tmpdir(), 'lcos-registry-'))
  cleanup.push(dir)
  return new RuntimeRegistryService(join(dir, 'registry.json'))
}

afterEach(async () => {
  for (const dir of cleanup.splice(0)) void rm(dir, { recursive: true, force: true }).catch(() => { /* best effort */ })
})

describe('RuntimeRegistryService', () => {
  it('starts empty with schemaVersion 0', async () => {
    const registry = await disposableRegistry()
    expect(registry.getRegistry()).toEqual({ schemaVersion: 0, recentProjects: [] })
  })

  it('recordOpen appends projects and sorts by recency', async () => {
    const registry = await disposableRegistry()
    registry.recordOpen('project-a', { rootPath: 'C:/a', displayTitle: 'Alpha' })
    registry.recordOpen('project-b', { rootPath: 'C:/b' })
    const state = registry.getRegistry()
    expect(state.recentProjects.map((project) => project.projectId)).toEqual(['project-b', 'project-a'])
    expect(state.recentProjects[1]?.rootPath).toBe('C:/a')
    expect(state.recentProjects[1]?.displayTitle).toBe('Alpha')
  })

  it('recordOpen updates existing entry instead of duplicating', async () => {
    const registry = await disposableRegistry()
    registry.recordOpen('project-a', { displayTitle: 'Alpha' })
    registry.recordOpen('project-b')
    registry.recordOpen('project-a', { displayTitle: 'Alpha v2' })
    const state = registry.getRegistry()
    expect(state.recentProjects.filter((project) => project.projectId === 'project-a')).toHaveLength(1)
    expect(state.recentProjects[0]?.displayTitle).toBe('Alpha v2')
  })

  it('recordFocus sets lastFocusedProjectId and moves project to front', async () => {
    const registry = await disposableRegistry()
    registry.recordOpen('project-a')
    registry.recordOpen('project-b')
    registry.recordFocus('project-a')
    const state = registry.getRegistry()
    expect(state.lastFocusedProjectId).toBe('project-a')
    expect(state.recentProjects[0]?.projectId).toBe('project-a')
  })

  it('setPinnedCaptureProject supports pin and unpin', async () => {
    const registry = await disposableRegistry()
    registry.setPinnedCaptureProject('project-b')
    expect(registry.getRegistry().pinnedCaptureProjectId).toBe('project-b')
    registry.setPinnedCaptureProject(null)
    expect(registry.getRegistry().pinnedCaptureProjectId).toBeUndefined()
  })

  it('persists across instances (restart survives)', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'lcos-registry-persist-'))
    cleanup.push(dir)
    const path = join(dir, 'registry.json')
    const first = new RuntimeRegistryService(path)
    first.recordFocus('project-a')
    first.setPinnedCaptureProject('project-a')
    const second = new RuntimeRegistryService(path)
    expect(second.getRegistry().lastFocusedProjectId).toBe('project-a')
    expect(second.getRegistry().pinnedCaptureProjectId).toBe('project-a')
    expect(second.getRegistry().recentProjects[0]?.projectId).toBe('project-a')
  })

  it('recovers from corrupted registry file', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'lcos-registry-corrupt-'))
    cleanup.push(dir)
    const path = join(dir, 'registry.json')
    await writeFile(path, '{not json', 'utf8')
    const registry = new RuntimeRegistryService(path)
    expect(registry.getRegistry()).toEqual({ schemaVersion: 0, recentProjects: [] })
    registry.recordOpen('project-a')
    expect(JSON.parse(await readFile(path, 'utf8')).recentProjects[0].projectId).toBe('project-a')
  })
})
