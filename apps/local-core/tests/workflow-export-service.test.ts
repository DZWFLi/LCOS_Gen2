import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { ProjectGraphSnapshot } from '@local-creative-os/contracts'
import { SqliteMetadataRepository } from '../src/metadata-repository.js'
import { PresentationApplicationService } from '../src/presentation-application-service.js'
import { WorkflowExportService } from '../src/workflow-export-service.js'
import { readZipArchive } from '../src/resources/zip-reader.js'
import { buildZip } from '../src/zip-writer.js'

const cleanup: string[] = []

function snapshot(): ProjectGraphSnapshot {
  const now = '2026-08-12T00:00:00.000Z'
  const projectId = 'disposable-workflow' as ProjectGraphSnapshot['project']['id']
  return {
    schemaVersion: 33,
    graphVersion: 1 as ProjectGraphSnapshot['graphVersion'],
    project: { id: projectId, name: 'Workflow Fixture', rootPath: 'disposable://workflow', graphVersion: 1 as ProjectGraphSnapshot['project']['graphVersion'], createdAt: now, updatedAt: now },
    scopes: [{ id: 'scope-root', projectId, parentScopeId: null, containerViewId: null, kind: 'root', name: 'Root', createdAt: now, updatedAt: now }],
    workspaces: [{ id: 'ws-1', projectId, scopeId: 'scope-root', name: '排程', intent: null, viewport: { x: 0, y: 0, zoom: 1 }, focusedViewIds: ['v1'], visibleLayers: ['core'], contextPolicy: 'selection-only', updatedAt: now }],
    artifacts: [
      { id: 'art-1', projectId, title: 'Brief', kind: 'markdown', availability: 'available', currentRevisionId: 'rev-1', createdAt: now, updatedAt: now },
      { id: 'art-2', projectId, title: 'Board', kind: 'markdown', availability: 'available', currentRevisionId: 'rev-2', createdAt: now, updatedAt: now },
    ],
    artifactViews: [
      { id: 'v1', artifactId: 'art-1', scopeId: 'scope-root', referenceKind: 'primary', position: { x: 0, y: 0 }, size: { width: 100, height: 80 }, displayMode: 'card', collapsed: false },
      { id: 'v2', artifactId: 'art-2', scopeId: 'scope-root', referenceKind: 'primary', position: { x: 200, y: 0 }, size: { width: 100, height: 80 }, displayMode: 'card', collapsed: false },
    ],
    artifactRevisions: [
      { id: 'rev-1', artifactId: 'art-1', fileRecordId: 'file-1', contentHash: 'a', source: 'import', status: 'current', createdAt: now },
      { id: 'rev-2', artifactId: 'art-2', fileRecordId: 'file-2', contentHash: 'b', source: 'import', status: 'current', createdAt: now },
    ],
    fileRecords: [
      { id: 'file-1', projectId, observedPath: 'disposable://a', observedHash: 'a', size: 1, modifiedAt: now, mimeType: 'text/markdown', availability: 'current', observedAt: now },
      { id: 'file-2', projectId, observedPath: 'disposable://b', observedHash: 'b', size: 1, modifiedAt: now, mimeType: 'text/markdown', availability: 'current', observedAt: now },
    ],
    relations: [],
    notes: [],
    checkpoints: [],
  }
}

async function createFixture() {
  const directory = await mkdtemp(join(tmpdir(), 'local-core-workflow-export-'))
  cleanup.push(directory)
  const repository = new SqliteMetadataRepository(join(directory, 'metadata.sqlite'))
  repository.save(snapshot())
  const presentation = new PresentationApplicationService(repository, repository)
  presentation.save('disposable-workflow', {
    presentationId: 'presentation:workflow:scope-root',
    scopeId: 'scope-root',
    capability: 'workflow',
    renderer: 'workflow',
    state: {
      memberViewIds: ['v1', 'v2'],
      hiddenViewIds: [],
      positions: {},
      hierarchy: { parentByViewId: {}, orderByParent: {} },
      presentationEdges: [{ id: 'presentation:0:v1:v2', fromViewId: 'v1', toViewId: 'v2' }],
      pinnedViewIds: [],
      emphasisByViewId: {},
      workflowOperators: { v1: { kind: 'condition', branches: [{ id: 'c-a', label: '分支 A' }, { id: 'c-b', label: '分支 B', predicateText: '当用户确认时', targetViewId: 'v2' }] } },
    },
    expectedVersion: 0,
    updatedBy: 'web',
  })
  return { repository, presentation }
}

describe('Phase 4 Slice 2 — Workflow export/import roundtrip', () => {
  afterEach(async () => {
    for (const path of cleanup.splice(0)) void rm(path, { recursive: true, force: true }).catch(() => { /* best effort */ })
  })

  it('exports a neutral lcos-workflow zip with manifest/workflow/references', async () => {
    const { repository, presentation } = await createFixture()
    const service = new WorkflowExportService(repository, presentation)
    const zip = service.export('disposable-workflow', 'scope-root')
    const entries = readZipArchive(Buffer.from(zip))
    const manifest = JSON.parse(entries.find((entry) => entry.path === 'manifest.json')!.bytes.toString('utf8'))
    const workflow = JSON.parse(entries.find((entry) => entry.path === 'workflow.json')!.bytes.toString('utf8'))
    const references = JSON.parse(entries.find((entry) => entry.path === 'references.json')!.bytes.toString('utf8'))
    expect(manifest.schemaVersion).toBe(1)
    expect(manifest.kind).toBe('lcos-workflow')
    expect(workflow.members).toEqual(['v1', 'v2'])
    expect(workflow.edges).toEqual([{ source: 'v1', target: 'v2', presentationRole: 'primary' }])
    expect(workflow.operators.v1.branches[1].predicateText).toBe('当用户确认时')
    expect(references.references).toHaveLength(2)
  })

  it('imports the same zip back into a presentation with exact roundtrip', async () => {
    const { repository, presentation } = await createFixture()
    const service = new WorkflowExportService(repository, presentation)
    const exported = service.export('disposable-workflow', 'scope-root')
    const result = service.import('disposable-workflow', 'scope-root', exported)
    expect(result).toEqual({ imported: true, members: 2, workspaces: 1 })
    const view = presentation.get('disposable-workflow', 'presentation:workflow:scope-root')!
    expect(view.state.memberViewIds).toEqual(['v1', 'v2'])
    expect(view.state.presentationEdges[0]).toMatchObject({ fromViewId: 'v1', toViewId: 'v2' })
    expect(view.state.workflowOperators?.v1?.kind).toBe('condition')
    expect(repository.getWorkspaces('disposable-workflow').map((workspace) => workspace.name)).toContain('排程')
  })

  it('rejects unknown schema, duplicate workspace ids, missing references and invalid edge targets', async () => {
    const { repository, presentation } = await createFixture()
    const service = new WorkflowExportService(repository, presentation)
    const build = (workflow: Record<string, unknown>, manifest: Record<string, unknown> = { schemaVersion: 1, kind: 'lcos-workflow' }) => {
      return buildZip([
        { path: 'manifest.json', bytes: Buffer.from(JSON.stringify(manifest)) },
        { path: 'workflow.json', bytes: Buffer.from(JSON.stringify(workflow)) },
        { path: 'references.json', bytes: Buffer.from(JSON.stringify({ references: [{ viewId: 'v1', artifactId: 'art-1' }, { viewId: 'v2', artifactId: 'art-2' }] })) },
      ])
    }
    expect(() => service.import('disposable-workflow', 'scope-root', build({ members: ['v1'] }, { schemaVersion: 2, kind: 'lcos-workflow' }))).toThrow(/Unsupported workflow archive/)
    expect(() => service.import('disposable-workflow', 'scope-root', build({ members: ['v1', 'v2'], workspaces: [{ id: 'w', title: 'A', memberViewIds: [], order: 0 }, { id: 'w', title: 'B', memberViewIds: [], order: 1 }] }))).toThrow(/Duplicate workspace id/)
    expect(() => service.import('disposable-workflow', 'scope-root', build({ members: ['v9'] }))).toThrow(/Missing reference/)
    expect(() => service.import('disposable-workflow', 'scope-root', build({ members: ['v1', 'v2'], edges: [{ source: 'v1', target: 'v9' }] }))).toThrow(/non-member/)
  })
})
