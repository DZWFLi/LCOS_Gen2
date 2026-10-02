/** Production SQLite repository/services/routes, disposable files. No external provider. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { SqliteMetadataRepository } from '../../apps/local-core/src/metadata-repository.ts';
import { createMvpSampleSnapshot } from '../../apps/local-core/src/mvp-sample-project.ts';
import { ResultSlotService } from '../../apps/local-core/src/result-slot-service.ts';
import { RuntimeReviewService } from '../../apps/local-core/src/runtime-review-service.ts';
import { handleSpatialBindingsRoute } from '../../apps/local-core/src/routes/spatial-bindings.ts';
import { handleRunsRoute } from '../../apps/local-core/src/routes/runs.ts';
import { viewPresentationByArtifact } from '../../apps/web-gen2/src/spatial/reconciliationRunner.ts';

const now='2026-09-30T00:00:00.000Z';
async function setup(options: { unopened?: boolean } = {}){
 const root=await mkdtemp(join(tmpdir(),'lcos-r6-core-')),path=join(root,'metadata.sqlite');let repo=new SqliteMetadataRepository(path);
 const original=createMvpSampleSnapshot(join(root,'files'),now);
 const graph={...original,scopes:[...original.scopes,{...original.scopes[0]!,id:'scope-other' as typeof original.scopes[number]['id'],kind:'collection' as const}],workspaces:original.workspaces.map((w,i)=>({...w,canvasId:options.unopened&&i===0?undefined as unknown as string:`canvas-${i}`,preferredSurface:i===0?'main':w.preferredSurface}))};repo.save(graph);
 const projectId=String(graph.project.id),workspace=graph.workspaces[0]!,target=graph.artifacts[1]!,base=graph.artifactRevisions.find(r=>r.id===target.currentRevisionId)!;
 const canonicalJson=JSON.stringify({schemaVersion:0,project:{id:projectId}}),hash=createHash('sha256').update(canonicalJson).digest('hex');
 repo.createContextManifest({id:`manifest-${hash}`,projectId,schemaVersion:0,targetArtifactId:target.id,targetRevisionId:base.id,canonicalJson,manifestHash:hash,createdAt:now} as never);
 const makeRun=(id:string,status='running',workspaceId:string|undefined=String(workspace.id))=>({id,projectId,...(workspaceId===undefined?{}:{workspaceId}),targetArtifactId:target.id,targetRevisionId:base.id,contextManifestId:`manifest-${hash}`,provider:'workbuddy',status,instruction:`任务 ${id}`,createdAt:now,updatedAt:now});
 const createRun=(id:string,slotId?:string,status='running',workspaceId:string|undefined=String(workspace.id))=>{const run=makeRun(id,status,workspaceId);repo.createRunWithDispatch(run as never,{id:`dispatch-${id}`,runId:id,provider:'workbuddy',idempotencyKey:id,status:'planned',attemptCount:0,createdAt:now,updatedAt:now} as never,slotId);return run;};
 const createSlot=()=>new ResultSlotService(repo).create({projectId,scopeId:String(workspace.scopeId),workspaceId:String(workspace.id),x:600,y:300,width:248,height:180});
 const addReturn=(runId:string,returnId='return-1')=>{
  const file={...graph.fileRecords[0]!,id:`file-${returnId}`,projectId,observedPath:join(root,`draft-${returnId}.md`),size:5,observedHash:createHash('sha256').update('draft').digest('hex'),mimeType:'text/markdown'};
  const draft={...base,id:`revision-${returnId}`,artifactId:target.id,fileRecordId:file.id,parentRevisionId:base.id,contentHash:file.observedHash,source:'run',runId,status:'draft',createdAt:now};
  const returned={id:returnId,runId,targetArtifactId:target.id,baseRevisionId:base.id,returnedFileId:file.id,contentHash:file.observedHash,canonicalPath:file.observedPath,action:'created',status:'pending_review',draftRevisionId:draft.id,createdAt:now,updatedAt:now};
  repo.createRuntimeDraft(file as never,draft as never,returned as never);return{returned,draft,file};
 };
 const bindSlot=(id:string)=>repo.upsertProjectionBinding({projectId,canvasId:workspace.canvasId,entityType:'result-slot',entityId:id,spatialKind:'node',spatialId:'native-reservation'});
 const accept=(returnId='return-1')=>new RuntimeReviewService(repo,()=>now,()=> 'review-event',undefined,new ResultSlotService(repo)).accept(returnId as never,{expectedBaseRevisionId:base.id});
 const reopen=()=>{repo.close();repo=new SqliteMetadataRepository(path);};
 const cleanup=async()=>{repo.close();await rm(root,{recursive:true,force:true});};
 return{graph,projectId,workspace,target,base,root,repo:()=>repo,createRun,createSlot,addReturn,bindSlot,accept,reopen,cleanup};
}
test('R6 SQLite: full execution identity set includes 125 runs even though detail list stops at100',async()=>{
 const s=await setup();try{for(let i=0;i<125;i++)s.createRun(`r-${i}`);assert.equal(s.repo().getProjectRuns(s.projectId as never,1000).length,100);const p=s.repo().getProjectExecutionProjection(s.projectId);assert.equal(p.runs.length,125);assert(p.runs.every(r=>!('instruction' in r)));s.reopen();assert.equal(s.repo().getProjectExecutionProjection(s.projectId).runs.length,125);}finally{await s.cleanup();}
});
test('R6 SQLite: Run creation and result slot claim are atomic and recover together',async()=>{
 const s=await setup();try{const slot=s.createSlot();s.createRun('r1',slot.id);assert.equal(s.repo().getRunResultSlotId('r1'),slot.id);assert.equal(s.repo().getResultSlot(slot.id)!.runId,'r1');s.reopen();assert.equal(s.repo().getResultSlot(slot.id)!.status,'running');
 assert.throws(()=>s.createRun('r2',slot.id));assert.equal(s.repo().getRun('r2' as never),undefined);assert.equal(s.repo().getRuntimeDispatch('r2' as never),undefined);
 }finally{await s.cleanup();}
});
test('R6 SQLite: missing/foreign worksite reservation leaves no partial Run/dispatch',async()=>{
 const s=await setup();try{const slot=s.createSlot();assert.throws(()=>s.createRun('missing','no-slot'));assert.throws(()=>s.createRun('wrong-worksite',slot.id,'created',String(s.graph.workspaces[1]!.id)));assert.equal(s.repo().getProjectExecutionProjection(s.projectId).runs.length,0);assert.equal(s.repo().getResultSlot(slot.id)!.status,'empty');}finally{await s.cleanup();}
});
test('R6 SQLite: pending return artifact ids/status come from actual review rows',async()=>{
 const s=await setup();try{const slot=s.createSlot();s.createRun('r1',slot.id);s.addReturn('r1');const r=s.repo().getProjectExecutionProjection(s.projectId).runs[0]!;assert.equal(r.pendingReturnCount,1);assert.deepEqual(r.pendingArtifactIds,[String(s.target.id)]);}finally{await s.cleanup();}
});
test('R6 SQLite: accept creates exact result view without repointing history, updates slot in same transaction',async()=>{
 const s=await setup();try{const slot=s.createSlot();s.createRun('r1',slot.id);const {draft}=s.addReturn('r1');s.bindSlot(slot.id);const oldViews=s.repo().getArtifactViews(String(s.target.id));const accepted=s.accept();assert.equal(accepted.artifactReturn.status,'adopted');
 const result=s.repo().getResultSlot(slot.id)!;assert.equal(result.status,'materialized');assert.equal(s.repo().getArtifactView(result.artifactViewId!)!.revisionId,draft.id);
 for(const old of oldViews)assert.equal(s.repo().getArtifactView(String(old.id))!.revisionId,old.revisionId);
 const ws=s.repo().getWorkspace(String(s.workspace.id))!;assert(ws.focusedViewIds.some(id=>String(id)===result.artifactViewId));
 const chosen=viewPresentationByArtifact(s.repo().getArtifactViews(String(s.target.id)),{scopeId:String(ws.scopeId),focusedViewIds:new Set(ws.focusedViewIds.map(String))});assert.equal(chosen.get(String(s.target.id))?.revisionId,draft.id);
 s.reopen();assert.equal(s.repo().getResultSlot(slot.id)!.status,'materialized');assert.equal(s.repo().getArtifact(String(s.target.id))!.currentRevisionId,draft.id);
 }finally{await s.cleanup();}
});
test('R6 SQLite: accept slot identity conflict rolls back revision/return/Run together',async()=>{
 const s=await setup();try{const slot=s.createSlot();s.createRun('r1',slot.id);s.addReturn('r1');s.repo().updateResultSlot(slot.id,{runId:'other'});assert.throws(()=>s.accept());assert.equal(s.repo().getArtifact(String(s.target.id))!.currentRevisionId,s.base.id);assert.equal(s.repo().getArtifactReturn('return-1' as never)!.status,'pending_review');}finally{await s.cleanup();}
});
test('R6 SQLite: accept-to-binding promotion preserves native id; lost response retry/reopen remain idempotent',async()=>{
 const s=await setup();try{const slot=s.createSlot();s.createRun('r1',slot.id);s.addReturn('r1');s.bindSlot(slot.id);s.accept();
 const a=s.repo().materializeResultSlotBinding(s.projectId,slot.id,s.workspace.canvasId,'native-reservation');assert.equal(a.status,'promoted');assert.equal(a.binding.spatialId,'native-reservation');assert.equal(a.binding.entityType,'artifact');assert.equal(s.repo().findProjectionBinding(s.projectId,s.workspace.canvasId,'node','result-slot',slot.id),undefined);
 s.reopen();const b=s.repo().materializeResultSlotBinding(s.projectId,slot.id,s.workspace.canvasId,'native-reservation');assert.equal(b.status,'already-promoted');assert.deepEqual(a.binding,b.binding);
 }finally{await s.cleanup();}
});
test('R6 SQLite: existing artifact projection and historical presentation are not moved or overwritten',async()=>{
 const s=await setup();try{const slot=s.createSlot();s.createRun('r1',slot.id);s.addReturn('r1');s.bindSlot(slot.id);
 s.repo().upsertProjectionBinding({projectId:s.projectId,canvasId:s.workspace.canvasId,spatialKind:'node',spatialId:'original-material-node',entityType:'artifact',entityId:String(s.target.id)});
 const before=s.repo().getWorkspace(String(s.workspace.id))!.focusedViewIds;s.accept();const result=s.repo().materializeResultSlotBinding(s.projectId,slot.id,s.workspace.canvasId,'native-reservation');assert.equal(result.status,'existing-artifact');assert.equal(result.binding.spatialId,'original-material-node');assert.deepEqual(s.repo().getWorkspace(String(s.workspace.id))!.focusedViewIds,before);assert(s.repo().findProjectionBinding(s.projectId,s.workspace.canvasId,'node','result-slot',slot.id));
 }finally{await s.cleanup();}
});
test('R6 SQLite: stale spatial id, wrong canvas and unrelated carrier binding fail without writes',async()=>{
 const s=await setup();try{const slot=s.createSlot();s.createRun('r1',slot.id);s.addReturn('r1');s.bindSlot(slot.id);s.accept();assert.throws(()=>s.repo().materializeResultSlotBinding(s.projectId,slot.id,s.workspace.canvasId,'stale-node'));assert.throws(()=>s.repo().materializeResultSlotBinding(s.projectId,slot.id,'canvas-1','native-reservation'));
 s.repo().upsertProjectionBinding({projectId:s.projectId,canvasId:s.workspace.canvasId,spatialKind:'node',spatialId:'native-reservation',entityType:'note',entityId:'unrelated'});assert.throws(()=>s.repo().materializeResultSlotBinding(s.projectId,slot.id,s.workspace.canvasId,'native-reservation'));assert.equal(s.repo().findProjectionBinding(s.projectId,s.workspace.canvasId,'node','artifact',String(s.target.id)),undefined);
 }finally{await s.cleanup();}
});
test('R6 HTTP production route exposes real complete projection, not default detail slice',async()=>{
 const s=await setup();try{s.createRun('r1');let status=0,body:any;const handled=await handleRunsRoute({method:'GET',pathname:`/projects/${s.projectId}/execution-projection`,metadata:s.repo(),controller:new AbortController(),request:{},response:{},url:new URL('http://core'),helpers:{sendJson:(_r:any,c:number,b:any)=>{status=c;body=b;},failure:(code:string,message:string)=>({ok:false,error:{code,message}})}} as any);assert(handled);assert.equal(status,200);assert.equal(body.value.runs[0].id,'r1');}finally{await s.cleanup();}
});
test('R6 HTTP promotion route rejects geometry injection; valid receipt contains same native id',async()=>{
 const s=await setup();try{const slot=s.createSlot();s.createRun('r1',slot.id);s.addReturn('r1');s.bindSlot(slot.id);s.accept();const route=async(value:any)=>{let status=0,body:any;await handleSpatialBindingsRoute({method:'POST',pathname:`/projects/${s.projectId}/spatial/result-slots/${slot.id}/materialize`,metadata:s.repo(),controller:new AbortController(),request:{},response:{},helpers:{sendJson:(_r:any,c:number,b:any)=>{status=c;body=b;},failure:(code:string,message:string)=>({ok:false,error:{code,message}}),readJsonBody:async()=>value,isRecord:(v:any)=>v!==null&&typeof v==='object'}} as any);return{status,body};};
 assert.equal((await route({canvasId:s.workspace.canvasId,spatialId:'native-reservation',x:900})).status,400);const good=await route({canvasId:s.workspace.canvasId,spatialId:'native-reservation'});assert.equal(good.status,200);assert.equal(good.body.value.binding.spatialId,'native-reservation');
 }finally{await s.cleanup();}
});

test('R6 SQLite: reservation scope/worksite mismatch cannot partially create a Run',async()=>{
 const s=await setup();try{
  const otherScope=s.graph.scopes.find(scope=>String(scope.id)!==String(s.workspace.scopeId))!;
  const slot=new ResultSlotService(s.repo()).create({projectId:s.projectId,scopeId:String(otherScope.id),workspaceId:String(s.workspace.id),x:40,y:30});
  assert.throws(()=>s.createRun('bad-scope',slot.id));assert.equal(s.repo().getRun('bad-scope' as never),undefined);assert.equal(s.repo().getResultSlot(slot.id)?.status,'empty');
 }finally{await s.cleanup();}
});
test('R6 SQLite: accepted unscoped Main slot retains exact revision on first projection',async()=>{
 const s=await setup();try{
  const slot=new ResultSlotService(s.repo()).create({projectId:s.projectId,scopeId:String(s.workspace.scopeId),x:40,y:30});s.createRun('unscoped',slot.id);const{draft}=s.addReturn('unscoped');s.accept();
  const ws=s.repo().getWorkspace(String(s.workspace.id))!;const chosen=viewPresentationByArtifact(s.repo().getArtifactViews(String(s.target.id)),{scopeId:String(ws.scopeId),focusedViewIds:new Set(ws.focusedViewIds.map(String))});assert.equal(chosen.get(String(s.target.id))?.revisionId,draft.id);
 }finally{await s.cleanup();}
});
test('R6 SQLite: accepted result view survives before the worksite has a canvas',async()=>{
 const s=await setup({unopened:true});try{
  const slot=s.createSlot();s.createRun('not-opened',slot.id);s.addReturn('not-opened');s.accept();const id=s.repo().getResultSlot(slot.id)!.artifactViewId!;
  s.reopen();assert(s.repo().getWorkspace(String(s.workspace.id))!.focusedViewIds.some(v=>String(v)===id));
 }finally{await s.cleanup();}
});
