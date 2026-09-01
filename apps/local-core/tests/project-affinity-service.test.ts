import { describe, expect, it } from 'vitest'
import { resolveProjectAffinity, type SessionProjectBindingV0 } from '../src/project-affinity-service.js'
import type { RuntimeRegistryV0 } from '../src/runtime-registry-service.js'

const NOW = '2026-08-11T12:00:00.000Z'

function registry(overrides: Partial<RuntimeRegistryV0> = {}): RuntimeRegistryV0 {
  return {
    schemaVersion: 0,
    recentProjects: [
      { projectId: 'project-a', lastOpenedAt: NOW, lastFocusedAt: NOW },
      { projectId: 'project-b', lastOpenedAt: NOW },
    ],
    lastFocusedProjectId: 'project-a',
    ...overrides,
  }
}

const roots = [
  { projectId: 'project-a', rootPath: 'C:/work/alpha' },
  { projectId: 'project-b', rootPath: 'C:/work/beta' },
]

function resolve(input: Parameters<typeof resolveProjectAffinity>[0], overrides: { registry?: Partial<RuntimeRegistryV0>; sessionBindings?: readonly SessionProjectBindingV0[]; now?: string } = {}) {
  return resolveProjectAffinity(input, {
    projectRoots: roots,
    registry: registry(overrides.registry),
    sessionBindings: overrides.sessionBindings,
    now: overrides.now ?? NOW,
  })
}

describe('ProjectAffinityService (Phase B deterministic matrix)', () => {
  it('explicit A wins over recent B', () => {
    const result = resolve({ explicitProjectId: 'project-a', capturedAt: NOW })
    expect(result.projectId).toBe('project-a')
    expect(result.reason).toBe('explicit')
    expect(result.confidence).toBe(1)
  })

  it('session A wins over recent B', () => {
    const bindings: SessionProjectBindingV0[] = [{ sessionId: 'session-1', projectId: 'project-a', source: 'agent_bind', openedAt: NOW }]
    const result = resolve({ sessionId: 'session-1', capturedAt: NOW }, { sessionBindings: bindings })
    expect(result.projectId).toBe('project-a')
    expect(result.reason).toBe('session_bound')
  })

  it('closed session binding is ignored', () => {
    const bindings: SessionProjectBindingV0[] = [{ sessionId: 'session-1', projectId: 'project-a', source: 'agent_bind', openedAt: NOW, closedAt: NOW }]
    const result = resolve({ sessionId: 'session-1', capturedAt: NOW }, { sessionBindings: bindings })
    expect(result.reason).not.toBe('session_bound')
  })

  it('file under A root maps to A even when B is recent', () => {
    const result = resolve({ localPath: 'C:/work/alpha/docs/brief.md', capturedAt: NOW })
    expect(result.projectId).toBe('project-a')
    expect(result.reason).toBe('path_inside_root')
  })

  it('longest root wins for nested roots', () => {
    const nested = [...roots, { projectId: 'project-nested', rootPath: 'C:/work/alpha/special' }]
    const result = resolveProjectAffinity({ localPath: 'C:/work/alpha/special/file.md', capturedAt: NOW }, { projectRoots: nested, registry: registry(), now: NOW })
    expect(result.projectId).toBe('project-nested')
  })

  it('browser tab binding A wins over recent B', () => {
    const result = resolve({ browser: { profileId: 'p1', tabId: 7 }, capturedAt: NOW }, {
      registry: { browserTabBindings: { 'p1:7': 'project-a' }, lastFocusedProjectId: 'project-b' },
    })
    expect(result.projectId).toBe('project-a')
    expect(result.reason).toBe('browser_tab_bound')
  })

  it('unbound browser tab falls through to pinned', () => {
    const result = resolve({ browser: { profileId: 'p1', tabId: 9 }, capturedAt: NOW }, { registry: { pinnedCaptureProjectId: 'project-b' } })
    expect(result.projectId).toBe('project-b')
    expect(result.reason).toBe('pinned_capture_target')
  })

  it('pinned A wins over recent B', () => {
    const result = resolve({ capturedAt: NOW }, { registry: { pinnedCaptureProjectId: 'project-a' } })
    expect(result.projectId).toBe('project-a')
    expect(result.reason).toBe('pinned_capture_target')
    expect(result.confidence).toBe(0.99)
  })

  it('recent focus 5m is direct', () => {
    const result = resolve({ capturedAt: '2026-08-11T12:05:00.000Z' }, { now: '2026-08-11T12:05:00.000Z' })
    expect(result.projectId).toBe('project-a')
    expect(result.reason).toBe('recent_focus')
    expect(result.confidence).toBe(0.9)
  })

  it('recent focus 1h is not direct (staging candidate only)', () => {
    const result = resolve({ capturedAt: '2026-08-11T13:00:00.000Z' }, { now: '2026-08-11T13:00:00.000Z' })
    expect(result.projectId).toBeUndefined()
    expect(result.reason).toBe('unknown')
    expect(result.candidates?.[0]?.projectId).toBe('project-a')
    expect(result.candidates?.[0]?.score).toBeLessThan(0.8)
  })

  it('no signal at all returns unknown with empty candidates', () => {
    const result = resolveProjectAffinity({ capturedAt: NOW }, { projectRoots: [], registry: { schemaVersion: 0, recentProjects: [] }, now: NOW })
    expect(result.projectId).toBeUndefined()
    expect(result.reason).toBe('unknown')
    expect(result.candidates).toEqual([])
  })

  it('recent project is a weak candidate, never direct', () => {
    const result = resolve({ capturedAt: NOW }, { registry: { lastFocusedProjectId: undefined, recentProjects: registry().recentProjects } })
    expect(result.projectId).toBeUndefined()
    expect(result.candidates?.find((candidate) => candidate.reason === 'recent_project')?.score).toBe(0.55)
  })
})
