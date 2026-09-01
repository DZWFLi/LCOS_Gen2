import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { Relation } from '@local-creative-os/domain'
import { MutationSafetyService } from '../src/mutation-safety-service.js'
import { SqliteMetadataRepository } from '../src/metadata-repository.js'
import { PresentationApplicationService } from '../src/presentation-application-service.js'
import { createMvpSampleSnapshot } from '../src/mvp-sample-project.js'

const roots: string[] = []
const repos: SqliteMetadataRepository[] = []
async function setup() {
  const root = await mkdtemp(join(tmpdir(), 'lcos-b5-mutation-')); roots.push(root)
  const graph = createMvpSampleSnapshot(join(root, 'project'), '2026-08-16T00:00:00.000Z')
  const repo = new SqliteMetadataRepository(join(root, 'metadata.sqlite')); repos.push(repo); repo.save(graph)
  const presentation = new PresentationApplicationService(repo, repo)
  return { graph, repo, service: new MutationSafetyService(repo, presentation), projectId: String(graph.project.id) }
}
afterEach(async()=>{for(const r of repos.splice(0)){try{r.close()}catch{}};await Promise.all(roots.splice(0).map((p)=>rm(p,{recursive:true,force:true,maxRetries:3})))})

describe('B5 MutationSafety relation lifecycle', () => {
  it('records create, safely reverts, and reapplies a Relation including provenance evidence', async () => {
    const { repo, service, projectId } = await setup()
    const now = new Date().toISOString()
    const relation: Relation = {
      id: 'relation-b5-created' as Relation['id'], projectId: projectId as Relation['projectId'],
      sourceEntityType: 'artifact', sourceEntityId: 'artifact-feedback', targetEntityType: 'artifact', targetEntityId: 'artifact-script',
      kind: 'supports', origin: 'user', createdBy: 'test', evidenceRefs: [{ kind:'artifact', id:'artifact-feedback', label:'feedback' }], confidence: .9,
      createdAt: now, updatedAt: now,
    }
    const cs = service.upsertRelation({ projectId, relation, operationId:'op-create' })
    expect(repo.getRelation(String(relation.id))?.evidenceRefs?.[0]?.label).toBe('feedback')
    expect(service.revert(cs.id).revertable).toBe(true)
    expect(repo.getRelation(String(relation.id))).toBeUndefined()
    expect(service.reapply(cs.id).revertable).toBe(true)
    expect(repo.getRelation(String(relation.id))?.evidenceRefs?.[0]?.id).toBe('artifact-feedback')
  })

  it('refuses undo after touched relation changed again', async () => {
    const { repo, service, projectId } = await setup()
    const current = repo.getRelation('relation-feedback-script')!
    const changed: Relation = { ...current, kind:'change_request', updatedAt:new Date().toISOString() }
    const cs = service.upsertRelation({ projectId, relation: changed, operationId:'op-update' })
    repo.upsertRelation({ ...changed, kind:'someone-else-changed-this', updatedAt:new Date().toISOString() })
    expect(service.revert(cs.id)).toMatchObject({ revertable:false, reason:'TOUCHED_STATE_CHANGED_AFTER_APPLY' })
    expect(repo.getRelation(String(current.id))?.kind).toBe('someone-else-changed-this')
  })
})
