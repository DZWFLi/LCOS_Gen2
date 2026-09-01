import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import type {
  BridgeResultEnvelopeV0,
  BridgeRuntimePort,
  BridgeTaskEnvelopeV0,
  BridgeTaskIdentity,
} from '../../src/runtime-adapter.js'
import type { ProjectId } from '@local-creative-os/domain'

import { ContextManifestService } from '../../src/context-manifest-service.js'
import { ImportCopyService } from '../../src/import-copy-service.js'
import { SqliteMetadataRepository } from '../../src/metadata-repository.js'
import { RuntimeAdapterService } from '../../src/runtime-adapter.js'
import { RuntimeApplicationService } from '../../src/runtime-application-service.js'
import { RuntimeResultIngestionService } from '../../src/runtime-result-ingestion.js'
import { RuntimeReviewService } from '../../src/runtime-review-service.js'
import { ResourcePackageService } from '../../src/resources/resource-package-service.js'
import { UniversalResourceImportService } from '../../src/resources/universal-resource-import-service.js'

const roots: string[] = []
const repositories: SqliteMetadataRepository[] = []

afterEach(() => {
  for (const repository of repositories.splice(0)) repository.close()
  for (const root of roots.splice(0)) void Promise.resolve().then(() => { try { rmSync(root, { recursive: true, force: true }) } catch { /* best effort */ } })
})

class FakeBridge implements BridgeRuntimePort {
  task: BridgeTaskIdentity | undefined
  async createTask(envelope: BridgeTaskEnvelopeV0): Promise<BridgeTaskIdentity> {
    this.task = {
      taskId: `task-${envelope.lcosRunId}`,
      lcosRunId: envelope.lcosRunId,
      status: 'assigned',
      requestFingerprint: envelope.requestFingerprint,
      contractVersion: envelope.contractVersion,
    }
    return this.task
  }
  async findTaskByRunId(): Promise<BridgeTaskIdentity | undefined> { return this.task }
  async getResult(): Promise<BridgeResultEnvelopeV0 | undefined> { return undefined }
}

describe('Run-time resource matching into RuntimeInputPack (U4)', () => {
  it('records matched resources in the manifest and materializes readFirst files in the pack', async () => {
    const dbRoot = mkdtempSync(join(tmpdir(), 'lcos-pack-db-'))
    const projectRoot = mkdtempSync(join(tmpdir(), 'lcos-pack-project-'))
    roots.push(dbRoot, projectRoot)
    const repository = new SqliteMetadataRepository(join(dbRoot, 'metadata.sqlite'))
    repositories.push(repository)
    repository.createProject({ id: 'project-pack' as ProjectId, name: 'Pack', rootPath: projectRoot })
    const scopeId = String(repository.get('project-pack')?.scopes[0]?.id ?? '')
    const imports = new UniversalResourceImportService(repository, new ImportCopyService(repository))
    const target = await imports.importFile('project-pack' as ProjectId, {
      importRequestId: 'target',
      fileName: 'script.md',
      contentType: 'text/markdown',
      bytes: Buffer.from('# Script\n\nDraft.', 'utf8'),
      scopeId,
      position: { x: 0, y: 0 },
    })
    const packages = new ResourcePackageService(repository)
    const skill = await packages.importDirectory('project-pack' as ProjectId, {
      importRequestId: 'skill',
      rootName: 'storyboard-skill',
      files: [{
        path: 'SKILL.md',
        bytes: Buffer.from('---\nname: storyboard-skill\ndescription: Turn scripts into shots.\n---\n# Instructions', 'utf8'),
      }],
      scopeId,
      position: { x: 0, y: 0 },
    })
    await imports.reanalyze('project-pack', skill.resourceId)
    repository.upsertResourcePolicy({ projectId: 'project-pack', resourceId: skill.resourceId, trustLevel: 'reviewed', approvedContext: true, executable: false })

    const bridge = new FakeBridge()
    const review = new RuntimeReviewService(repository, undefined, () => 'pack-one')
    const application = new RuntimeApplicationService(
      repository,
      new ContextManifestService(repository),
      new RuntimeAdapterService(repository, bridge, 'mvp-fast-build'),
      new RuntimeResultIngestionService(repository, bridge),
      review,
      undefined,
      () => 'pack-one',
    )
    const action = await application.create('project-pack' as ProjectId, {
      instruction: 'use the storyboard skill to revise the script',
      outputIntent: 'revise',
      targetArtifactId: target.artifact.id,
    })
    const runId = String(action.review.run.id)
    await application.dispatch(action.review.run.id)
    const pack = JSON.parse(readFileSync(
      join(projectRoot, '.creative-os', 'runtime', runId, 'runtime-input-pack.json'),
      'utf8',
    )) as {
      contextManifest: { resourceRefs?: readonly { resourceId: string; role: string; requiresApproval: boolean }[] }
      resourceRefs?: readonly { resourceId: string; role: string }[]
      resourceFiles?: readonly { resourceId: string; path: string; content: string }[]
    }

    expect(pack.contextManifest.resourceRefs?.some((ref) => ref.role === 'candidate_skill')).toBe(true)
    expect(pack.resourceRefs?.some((ref) => ref.resourceId.startsWith('resource-'))).toBe(true)
    const descriptorFile = pack.resourceFiles?.find((file) => file.path === '<descriptor>')
    expect(descriptorFile?.content).toContain('storyboard-skill')
    const skillMd = pack.resourceFiles?.find((file) => file.path === 'SKILL.md')
    expect(skillMd?.content).toContain('name: storyboard-skill')
  })
})
