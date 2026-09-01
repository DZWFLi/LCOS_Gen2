import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { ActiveContextStore } from '../src/active-context-store.js'
import { AttentionRuntimeService } from '../src/attention-runtime-service.js'
import { ContinuityRuntimeService } from '../src/continuity-runtime-service.js'
import { SqliteMetadataRepository } from '../src/metadata-repository.js'
import { createMvpSampleSnapshot } from '../src/mvp-sample-project.js'
import { ProjectEventHub } from '../src/project-events/project-event-hub.js'
import { RuntimeRegistryService } from '../src/runtime-registry-service.js'
import { SpatialRetrievalService } from '../src/spatial-retrieval-service.js'
import type { IntelligenceProviderService } from '../src/intelligence-provider-service.js'

const roots:string[]=[]; const repos:SqliteMetadataRepository[]=[]
async function setup(){
 const root=await mkdtemp(join(tmpdir(),'lcos-b6-continuity-'));roots.push(root)
 const graph=createMvpSampleSnapshot(join(root,'project'),'2026-08-16T00:00:00.000Z')
 const repo=new SqliteMetadataRepository(join(root,'metadata.sqlite'));repos.push(repo);repo.save(graph)
 const active=new ActiveContextStore(repo); const spatial=new SpatialRetrievalService(repo)
 const intelligence={ inferIntent:async()=>undefined } as unknown as IntelligenceProviderService
 const attention=new AttentionRuntimeService(repo,active,undefined,spatial,intelligence)
 const registry=new RuntimeRegistryService(repo)
 const events=new ProjectEventHub()
 return {graph,repo,active,events,service:new ContinuityRuntimeService(repo,registry,attention,events),projectId:String(graph.project.id),workspaceId:String(graph.workspaces[0]?.id??'')}
}
afterEach(async()=>{for(const r of repos.splice(0)){try{r.close()}catch{}};await Promise.all(roots.splice(0).map((p)=>rm(p,{recursive:true,force:true,maxRetries:3})))})

describe('B6 continuity runtime',()=>{
 it('lets an existing session binding resolve the project and produces a provider-neutral attach bundle',async()=>{
  const {repo,service,projectId,workspaceId}=await setup()
  repo.upsertSessionContextRef({sessionId:'session-1',projectId,selectedViewIds:['view-script'],retrievalEntityRefs:['artifact-brief'],sourceRefs:[],status:'idle'})
  const resolved=service.resolve({capturedAt:new Date().toISOString(),sessionId:'session-1'})
  expect(resolved.projectId).toBe(projectId)
  const bundle=await service.attachBundle(projectId,{workspaceId,sessionId:'session-1',provider:'deepseek',explicitAction:'继续修改脚本'})
  expect(bundle).toMatchObject({schemaVersion:1,projectId,provider:'deepseek',sessionId:'session-1'})
  expect(bundle.contextPack.items.length).toBeGreaterThan(0)
 })

 it('commits summary + handoff return record together and updates bound session sources',async()=>{
  const {repo,service,projectId}=await setup()
  repo.upsertSessionContextRef({sessionId:'session-2',projectId,selectedViewIds:[],retrievalEntityRefs:[],sourceRefs:[],status:'working'})
  const receipt=service.intakeReturn(projectId,{sessionId:'session-2',fromProvider:'deepseek',title:'本轮返回',summary:'完成了脚本分析',decisions:['保留结构'],openQuestions:[],nextActions:['进入修订'],artifactRefs:[{artifactId:'artifact-script'}],messageRefs:[],runIds:[]})
  expect(repo.getSessionSummary(receipt.sessionSummaryId)?.handoffRef).toBe(receipt.handoffId)
  expect(repo.getHandoff(receipt.handoffId)?.sessionSummaryId).toBe(receipt.sessionSummaryId)
  expect(repo.getSessionContextRef('session-2')?.sourceRefs.some((ref)=>ref.sourceRef==='artifact-script')).toBe(true)
 })
})
