import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import { ActiveContextStore } from '../src/active-context-store.js'
import { createMvpSampleSnapshot } from '../src/mvp-sample-project.js'
import { ProjectEventHub } from '../src/project-events/project-event-hub.js'


const cleanup: string[] = []

function createGraph() {
  const root = mkdtempSync(join(tmpdir(), 'lcos-active-context-'))
  cleanup.push(root)
  return createMvpSampleSnapshot(root, '2026-07-30T00:00:00.000Z')
}

afterEach(() => {
  for (const root of cleanup.splice(0)) {
    try { rmSync(root, { recursive: true, force: true }) } catch { /* best effort */ }
  }
})

describe('ActiveContextStore', () => {
  it('projects stable View selection to canonical Artifact identity', () => {
    const graph = createGraph()
    const view = graph.artifactViews[0]!
    const pinnedView = graph.artifactViews[1]!
    const artifact = graph.artifacts.find((item) => item.id === view.artifactId)!
    const store = new ActiveContextStore()

    const first = store.update(String(graph.project.id), graph, {
      scopeId: String(view.scopeId),
      selectedViewIds: [String(view.id), String(view.id)],
      pinnedContextIds: [String(pinnedView.id)],
      excludedContextIds: [],
    })
    const second = store.get(String(graph.project.id), graph)

    expect(first.version).toBe(1)
    expect(second).toEqual(first)
    expect(first.selectedViewIds).toEqual([String(view.id)])
    expect(first.selectedArtifacts).toContainEqual(expect.objectContaining({
      viewId: String(view.id),
      artifactId: String(artifact.id),
      title: artifact.title,
    }))
    expect(first.contextArtifacts.map((item) => item.viewId)).toEqual([
      String(view.id),
      String(pinnedView.id),
    ])
  })

  it('does not advance semantic WorkState or publish when only camera visibility changes', () => {
    const graph = createGraph()
    const view = graph.artifactViews[0]!
    const events = new ProjectEventHub()
    const store = new ActiveContextStore(undefined, events)
    const projectId = String(graph.project.id)
    const first = store.update(projectId, graph, {
      scopeId: String(view.scopeId), selectedViewIds: [String(view.id)], pinnedContextIds: [], excludedContextIds: [],
    })
    const seqAfterSemanticWrite = events.currentSeq(projectId)
    const moved = store.update(projectId, graph, {
      scopeId: String(view.scopeId), selectedViewIds: [String(view.id)], pinnedContextIds: [], excludedContextIds: [],
      viewport: { x: 800, y: 400, zoom: 0.5 }, visibleViewIds: [String(view.id)], expectedVersion: first.version,
    })
    expect(moved.version).toBe(first.version)
    expect(moved.viewport).toMatchObject({ x: 800, y: 400, zoom: 0.5 })
    expect(events.currentSeq(projectId)).toBe(seqAfterSemanticWrite)
  })

  it('advances semantic WorkState for Pin', () => {
    const graph = createGraph()
    const [selected, pinned] = graph.artifactViews
    const store = new ActiveContextStore()
    const projectId = String(graph.project.id)
    const first = store.update(projectId, graph, {
      scopeId: String(selected!.scopeId), selectedViewIds: [String(selected!.id)], pinnedContextIds: [], excludedContextIds: [],
    })
    const second = store.update(projectId, graph, {
      scopeId: String(selected!.scopeId), selectedViewIds: [String(selected!.id)], pinnedContextIds: [String(pinned!.id)], excludedContextIds: [], expectedVersion: first.version,
    })
    expect(second.version).toBe(first.version + 1)
  })
})
