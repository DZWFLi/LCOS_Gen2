import { test } from 'node:test';
import assert from 'node:assert/strict';
import { executionBelongsHere, validateExecutionProjection, reconcileExecutionProjection } from '../src/spatial/reconcileExecutionProjection.js';
import { runPresentation, resultSlotPresentation, executionStatusLabel } from '../src/presentation/executionPresentation.js';
import { resolveVisualFamily } from '../src/presentation/visualFamily.js';
import { resolveNodeSpeciesFromFacts } from '../src/presentation/projectedNodeDescriptor.js';
import { MemoryBindingStore, ProjectionBindingRegistry } from '../src/spatial/projectionBinding.js';
import { ReconciliationRunner } from '../src/spatial/reconciliationRunner.js';
import { CoreRunClient } from '../src/backend/runs.js';
import { CoreCollaborationClient } from '../src/backend/collaboration.js';
import { HttpClient } from '../src/backend/client.js';
import { performRunWorkAction } from '../../../huabu/apps/web/src/lcos/professional/runWorkActions.ts';
import { buildComposerRunInput } from '../../../huabu/apps/web/src/lcos/composer/composerSubmission.ts';
import type { ProjectExecutionProjection, RunReview } from '@local-creative-os/contracts';

const run = { id:'r1',projectId:'p1',workspaceId:'w1',title:'真实指令',status:'created',pendingReturnCount:0,pendingArtifactIds:[],createdAt:'2026-09-30',updatedAt:'2026-09-30' } as const;
const slot={schemaVersion:0,id:'s1',projectId:'p1',workspaceId:'w1',scopeId:'scope1',position:{x:600,y:300},size:{width:248,height:180},status:'empty',createdAt:'2026-09-30',updatedAt:'2026-09-30'} as const;
const snapshot:ProjectExecutionProjection={projectId:'p1',runs:[run],resultSlots:[slot]};
const workspace={id:'w1',scopeId:'scope1',preferredSurface:'workflow'};

test('R6 worksite ownership: explicit workspace wins; missing canvas mapping never projects globally',()=>{
 assert.equal(executionBelongsHere(run,workspace),true);assert.equal(executionBelongsHere(run,{...workspace,id:'other'}),false);
 assert.equal(executionBelongsHere({},workspace),false);assert.equal(executionBelongsHere({},undefined),false);
 assert.equal(executionBelongsHere({}, {...workspace,preferredSurface:'main'}),true);
 assert.equal(executionBelongsHere({scopeId:'other'},{...workspace,preferredSurface:'main'}),false);
});
for(const status of ['created','queued','running','waiting_input','completed','failed','cancelled'] as const){
 test(`R6 Run ${status} is observed not a fabricated percentage`,()=>{const value=runPresentation({...run,status});assert.equal(value.execution!.status,status);assert(!executionStatusLabel(status).includes('%'));});
}
test('R6 pending review takes precedence over a completed run; waiting input remains actionable',()=>{
 assert.equal(runPresentation({...run,status:'completed',pendingReturnCount:1}).execution!.status,'review');
 assert.equal(runPresentation({...run,status:'waiting_input',pendingReturnCount:1}).execution!.status,'waiting_input');
});
test('R6 materialized slot has artifact identity; missing run state never pretends success',()=>{
 assert.equal(resultSlotPresentation({...slot,status:'materialized',artifactId:'a1',artifactViewId:'v1'},snapshot).execution!.artifactId,'a1');
 assert.equal(resultSlotPresentation({...slot,status:'running',runId:'missing'},snapshot).execution!.status,'unavailable');
});
test('R6 accepted image returns to its concrete species without losing Run provenance',()=>{
 const facts={entityType:'artifact',artifactKind:'image',mimeType:'image/png',managed:true,sourceRunId:'r1',revisionStatus:'current'} as const;
 assert.equal(resolveVisualFamily(facts),'image');assert.equal(resolveNodeSpeciesFromFacts(facts),'source');
 assert.equal(resolveVisualFamily({...facts,revisionStatus:'draft'}),'output');
 assert.equal(resolveNodeSpeciesFromFacts({entityType:'result-slot'}),'result-slot');
});
for(const kind of ['project','duplicate','missing-run','invalid-position'])test(`R6 rejects malformed ${kind} execution snapshot`,()=>{
 const bad=structuredClone(snapshot) as any;if(kind==='project')bad.projectId='other';if(kind==='duplicate')bad.runs.push(run);if(kind==='missing-run')bad.resultSlots[0].runId='missing';if(kind==='invalid-position')bad.resultSlots[0].position.x=NaN;
 assert.throws(()=>validateExecutionProjection(bad,'p1'));
});
function projectionHarness(data:ProjectExecutionProjection=snapshot){
 const bindings=new ProjectionBindingRegistry(new MemoryBindingStore());const calls:any[]=[];let n=0;
 const project=async(source:any)=>{calls.push(source);const prior=await bindings.findNode('p1','c1',source.entityType,source.entityId);if(prior)return prior;
  const binding={projectId:'p1',canvasId:'c1',spatialKind:'node' as const,spatialId:`node-${++n}`,entityType:source.entityType,entityId:source.entityId};await bindings.bind(binding);return binding;};
 const projector={projectEntity:project,projectBatchWithReport:async(sources:any[])=>({bindings:await Promise.all(sources.map(project)),failures:[]}),
  projectArtifactsWithReport:async(sources:any[])=>({bindings:await Promise.all(sources.map(s=>project({...s,entityType:'artifact',entityId:s.artifactId}))),failures:[]}),
  removeOrphanNode:async(binding:any)=>{calls.push({removed:binding.entityId,type:binding.entityType});await bindings.unbind(binding);}};
 const runs={readExecutionProjection:async()=>data, materializeResultSlotProjection:async(_p:string,_s:string,_c:string,spatialId:string)=>{
  const item=data.resultSlots[0]!;const existing=await bindings.findNode('p1','c1','artifact',item.artifactId!);
  if(existing&&existing.spatialId!==spatialId)return{status:'existing-artifact',binding:existing};
  await bindings.unbind({projectId:'p1',canvasId:'c1',spatialKind:'node',entityType:'result-slot',entityId:item.id});
  const binding={projectId:'p1',canvasId:'c1',spatialKind:'node' as const,spatialId,entityType:'artifact' as const,entityId:item.artifactId!};await bindings.bind(binding);return{status:'promoted',binding};
 }};
 const args={projectId:'p1',canvasId:'c1',snapshot:data,workspace,activeArtifactIds:new Set(['a1']),runs:runs as any,nodeProjector:projector as any,bindings};
 return{bindings,calls,projector,runs,args};
}
test('R6 complete execution set reuses existing binding and preserves reservation geometry',async()=>{
 const h=projectionHarness();const a=await reconcileExecutionProjection(h.args);const b=await reconcileExecutionProjection(h.args);
 assert.equal(a.bindings[0]!.spatialId,b.bindings[0]!.spatialId);assert.equal((await h.bindings.list()).length,2);
 assert.deepEqual(h.calls.find(c=>c.entityType==='result-slot').position,{x:600,y:300});
});
test('R6 pending output stays in its slot instead of creating a draft elsewhere',async()=>{
 const data={...snapshot,runs:[{...run,status:'completed' as const,pendingArtifactIds:['a1'],pendingReturnCount:1}],resultSlots:[{...slot,status:'review' as const,runId:'r1'}]};
 const h=projectionHarness(data),out=await reconcileExecutionProjection(h.args);assert(out.blockedArtifactIds.has('a1'));assert(!out.bindings.some(b=>b.entityType==='artifact'));
});
test('R6 accept promotes SAME native carrier; repeating/reloading does not recreate the ghost',async()=>{
 const data={...snapshot,resultSlots:[{...slot,status:'materialized' as const,runId:'r1',artifactId:'a1',artifactViewId:'v1'}]};const h=projectionHarness(data);
 const result=await reconcileExecutionProjection(h.args);assert.equal(result.promoted,1);const before=await h.bindings.findNode('p1','c1','artifact','a1');assert(before);
 assert.equal(await h.bindings.findNode('p1','c1','result-slot','s1'),undefined);
 const again=await reconcileExecutionProjection(h.args);assert.equal(again.slotsProjected,0);assert.equal((await h.bindings.findNode('p1','c1','artifact','a1'))!.spatialId,before.spatialId);
});
test('R6 existing Artifact never moves to the slot; slot remains a reference cue',async()=>{
 const data={...snapshot,resultSlots:[{...slot,status:'materialized' as const,runId:'r1',artifactId:'a1',artifactViewId:'v1'}]};const h=projectionHarness(data);
 await h.projector.projectEntity({entityType:'result-slot',entityId:'s1'});await h.projector.projectEntity({entityType:'artifact',entityId:'a1'});
 const old=await h.bindings.findNode('p1','c1','artifact','a1');await reconcileExecutionProjection(h.args);
 assert.equal((await h.bindings.findNode('p1','c1','artifact','a1'))!.spatialId,old!.spatialId);assert(await h.bindings.findNode('p1','c1','result-slot','s1'));
});
test('R6 unknown/mismatched materialization blocks a second Artifact without rolling back accept',async()=>{
 const data={...snapshot,resultSlots:[{...slot,status:'materialized' as const,runId:'r1',artifactId:'a1',artifactViewId:'v1'}]};const h=projectionHarness(data);
 h.runs.materializeResultSlotProjection=async()=>({status:'promoted',binding:{projectId:'foreign'} as any});
 const out=await reconcileExecutionProjection(h.args);assert.equal(out.failures,1);assert(out.blockedArtifactIds.has('a1'));assert.equal(data.resultSlots[0]!.status,'materialized');
});
test('R6 archived accepted Artifact is not resurrected by its result slot',async()=>{
 const h=projectionHarness({...snapshot,resultSlots:[{...slot,status:'materialized',artifactId:'a1',artifactViewId:'v1'}]});h.args.activeArtifactIds.clear();
 const out=await reconcileExecutionProjection(h.args);assert.equal(out.slotsProjected,0);assert.equal(out.slotIds.size,0);
});
test('R6 production runner retains Run/slot nodes on failed execution read; known empty snapshot prunes only obsolete types',async()=>{
 const h=projectionHarness();await h.projector.projectEntity({entityType:'run',entityId:'old'});await h.projector.projectEntity({entityType:'result-slot',entityId:'old-slot'});
 const runner=new ReconciliationRunner({projectId:'p1',canvasId:'c1',nodeProjector:h.projector,bindings:h.bindings,runs:{readExecutionProjection:async()=>{throw Error('offline')}},
  projects:{getProjectGraph:async()=>({artifacts:[],artifactViews:[],workspaces:[{...workspace,canvasId:'c1',focusedViewIds:[]}],scopes:[]})},relations:{listRelations:async()=>[]},relationProjector:{}} as any);
 const out=await runner.runOnce();assert(out.degraded);assert.equal((await h.bindings.list()).length,2);
 (runner as any).deps.runs={readExecutionProjection:async()=>({projectId:'p1',runs:[],resultSlots:[]})};await runner.runOnce();assert.equal((await h.bindings.list()).length,0);
});
function review():RunReview{return{run:{...run,instruction:'真实任务'},dispatch:{runId:'r1',status:'planned'},returns:[],draftRevisions:[],presentationPhase:'created',capabilities:{accept:{enabled:true},reject:{enabled:true},retry:{enabled:true}}} as any;}
function actions(value=review()){
 const calls:any[]=[];const client={readRunReview:async()=>value,actOnRun:async(id:string,a:string)=>{calls.push([a,id]);return{review:value}},cancelRun:async(id:string)=>{calls.push(['cancel',id]);return{review:value}},
 answerInput:async(id:string,input:any)=>{calls.push(['answer',id,input]);return{review:value}},
 acceptArtifactReturn:async(id:string,input:any)=>{calls.push(['accept',id,input]);return{run:value.run,artifactReturn:{...value.returns[0],status:'adopted'}}},
 rejectArtifactReturn:async(id:string)=>{calls.push(['reject',id]);return{run:value.run,artifactReturn:{...value.returns[0],status:'rejected'}}},retryArtifactReturn:async(id:string)=>{calls.push(['retry',id]);return{previousRun:value.run,previousReturn:value.returns[0],run:{...value.run,id:'r2'}}}};
 return{client:client as any,calls,value};
}
test('R6 dispatch operates the original created Run and rejects a later running state',async()=>{const a=actions();await performRunWorkAction(a.client,'p1','r1',{kind:'dispatch'});assert.deepEqual(a.calls,[['dispatch','r1']]);(a.value.run as any).status='running';await assert.rejects(performRunWorkAction(a.client,'p1','r1',{kind:'dispatch'}));assert.equal(a.calls.length,1);});
test('R6 HTTP200 providerError is failure, not an execution success',async()=>{const a=actions();a.client.actOnRun=async()=>({review:a.value,providerError:{message:'执行端离线'}});await assert.rejects(performRunWorkAction(a.client,'p1','r1',{kind:'sync'}),/离线/);});
test('R6 stale/foreign Run identity and aborted window send no mutations',async()=>{const a=actions();await assert.rejects(performRunWorkAction(a.client,'other','r1',{kind:'cancel'}));const c=new AbortController();c.abort();await assert.rejects(performRunWorkAction(a.client,'p1','r1',{kind:'cancel'},c.signal));assert.equal(a.calls.length,0);});
test('R6 completed Run cannot be stopped',async()=>{const a=actions();(a.value.run as any).status='completed';await assert.rejects(performRunWorkAction(a.client,'p1','r1',{kind:'cancel'}));assert.equal(a.calls.length,0);});
test('R6 answer checks request identity and allowed options',async()=>{
 const a=actions();(a.value as any).inputRequest={requestId:'q1',runId:'r1',status:'pending',options:['保留'],allowFreeText:false};
 await assert.rejects(performRunWorkAction(a.client,'p1','r1',{kind:'answer',input:{requestId:'old',selectedOptions:['保留']}}));
 await assert.rejects(performRunWorkAction(a.client,'p1','r1',{kind:'answer',input:{requestId:'q1',text:'不允许'}}));
 await performRunWorkAction(a.client,'p1','r1',{kind:'answer',input:{requestId:'q1',selectedOptions:['保留','保留']}});assert.deepEqual(a.calls[0][2],{requestId:'q1',selectedOptions:['保留']});
});
for(const kind of ['accept','reject','retry'] as const)test(`R6 ${kind} re-reads exact return and base before mutation`,async()=>{
 const a=actions();(a.value as any).returns=[{id:'ret1',runId:'r1',baseRevisionId:'base1',status:'pending_review'}];
 await assert.rejects(performRunWorkAction(a.client,'p1','r1',{kind,returnId:'ret1',baseRevisionId:'stale'}));assert.equal(a.calls.length,0);
 const out=await performRunWorkAction(a.client,'p1','r1',{kind,returnId:'ret1',baseRevisionId:'base1'});assert.equal(a.calls.length,1);if(kind==='retry')assert.equal(out.nextRunId,'r2');
});
test('R6 delegate returns actual Core review.run.id and refuses missing or foreign receipt',async()=>{
 let result:any={review:{run:{id:'r1',projectId:'p1'}}};const http=new HttpClient({baseUrl:'http://core',fetch:async()=>new Response(JSON.stringify({ok:true,value:result}),{headers:{'content-type':'application/json'}})});const client=new CoreCollaborationClient(http);
 assert.equal((await client.delegate('p1',{instruction:'test',outputIntent:'analyze'})).ok,true);result={id:'r1'};assert.equal((await client.delegate('p1',{instruction:'test',outputIntent:'analyze'})).ok,false);result={review:{run:{id:'r1',projectId:'other'}}};assert.equal((await client.delegate('p1',{instruction:'test',outputIntent:'analyze'})).ok,false);
});
test('R6 typed client sends exact execution, recipe, review and materialization paths',async()=>{
 const calls:any[]=[];const http=new HttpClient({baseUrl:'http://core',fetch:async(url:any,init:any)=>{calls.push([url,init.method,init.body?JSON.parse(init.body):undefined]);return new Response(JSON.stringify({ok:true,value:{}}),{headers:{'content-type':'application/json'}})}});const client=new CoreRunClient(http);
 await client.readExecutionProjection('p/a');await client.readRecipe('r/a');await client.readRunReview('r/a');await client.materializeResultSlotProjection('p/a','s/a','c1','n1');await client.actOnRun('r/a','dispatch');
 assert(calls[0][0].endsWith('/projects/p%2Fa/execution-projection'));assert(calls[1][0].endsWith('/runs/r%2Fa/recipe'));assert(calls[2][0].endsWith('/runs/r%2Fa/review'));assert.deepEqual(calls[3][2],{canvasId:'c1',spatialId:'n1'});assert(calls[4][0].endsWith('/runs/r%2Fa/dispatch'));
});
test('R6 Composer uses canonical ordered references instead of silently dropped entityType objects',()=>{
 const input={projectId:'p1',instruction:'test',workspaceId:'w1',target:{},refs:[{entityType:'view',entityId:'historical-view'},{entityType:'artifact',entityId:'a1'}]} as any;
 const result=buildComposerRunInput(input);assert.deepEqual(result.orderedReferences,[{ref:{type:'view',viewId:'historical-view'},order:0},{ref:{type:'artifact',artifactId:'a1'},order:1}]);
 assert.throws(()=>buildComposerRunInput({...input,refs:[{entityType:'result-slot',entityId:'s1'}]}),/暂不能/);
});

test('R6 unavailable execution census cannot materialize a pending draft elsewhere',async()=>{
 const h=projectionHarness();const runner=new ReconciliationRunner({projectId:'p1',canvasId:'c1',nodeProjector:h.projector,bindings:h.bindings,runs:{readExecutionProjection:async()=>{throw Error('offline')}},
 projects:{getProjectGraph:async()=>({artifacts:[{id:'a1',kind:'markdown'}],artifactRevisions:[{id:'draft1',artifactId:'a1',status:'draft',runId:'r1'}],workspaces:[{...workspace,canvasId:'c1',focusedViewIds:[]}],scopes:[]})},relations:{listRelations:async()=>[]},relationProjector:{}} as any);
 await runner.runOnce();assert(!h.calls.some(c=>c.entityType==='artifact'));assert.equal((await h.bindings.list()).length,0);
});
test('R6 a pending source keeps its original binding and remains a relation endpoint',async()=>{
 const data={...snapshot,runs:[{...run,status:'completed' as const,pendingArtifactIds:['a1'],pendingReturnCount:1}],resultSlots:[{...slot,status:'review' as const,runId:'r1'}]};const h=projectionHarness(data);
 const source=await h.projector.projectEntity({entityType:'artifact',entityId:'a1'});let endpoint='';
 const runner=new ReconciliationRunner({projectId:'p1',canvasId:'c1',nodeProjector:h.projector,bindings:h.bindings,runs:h.runs,
 projects:{getProjectGraph:async()=>({artifacts:[{id:'a1',kind:'markdown'},{id:'a2',kind:'markdown'}],workspaces:[{...workspace,canvasId:'c1',focusedViewIds:[]}],scopes:[]})},relations:{listRelations:async()=>[{id:'rel1',kind:'reference',sourceEntityType:'artifact',sourceEntityId:'a1',targetEntityType:'artifact',targetEntityId:'a2'}]},relationProjector:{reconcileRelationEdges:async(entries:any[])=>{endpoint=entries[0].fromNodeId;return{skipped:0};}}} as any);
 await runner.runOnce();assert.equal(endpoint,source.spatialId);assert.equal((await h.bindings.findNode('p1','c1','artifact','a1'))!.spatialId,source.spatialId);assert(!h.calls.some(c=>c.removed==='a1'));
});
