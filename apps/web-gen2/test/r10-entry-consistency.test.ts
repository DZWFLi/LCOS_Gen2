/** Same user input through production click / native payload / Assembly / Reader adapters.
 * This suite does not substitute for a mounted ReactFlow/provider integration run. */
import assert from 'node:assert/strict';
import test from 'node:test';
import { draftReferenceKey } from '../src/interaction/referenceController.js';
import { snapshotDraftReference, prepareDraftReferences, draftReferenceForGesture, draftReferenceUnavailableReason } from '../../../huabu/apps/web/src/lcos/composer/referenceSnapshot.js';
import { snapshotCanvasDropNodes } from '../../../huabu/apps/web/src/lcos/drop/nativeCanvasDropGeometry.js';
import { resolveDropIntent } from '../../../huabu/apps/web/src/lcos/drop/dropIntentResolver.js';
import { canCommitDropRelease } from '../../../huabu/apps/web/src/lcos/drop/dropReleaseConsistency.js';
import { assemblyDraftReferenceOf } from '../../../huabu/apps/web/src/lcos/professional/assemblySourceRef.js';
import { toRunReference } from '../../../huabu/apps/web/src/lcos/professional/conversationContinuationActions.js';
import { buildComposerRunInput, buildComposerContinuationInput } from '../../../huabu/apps/web/src/lcos/composer/composerSubmission.js';
import { reviewAssemblyApply, assemblySourceKey } from '../../../huabu/apps/web/src/lcos/professional/assemblyApplyReview.js';
import { assemblyDropReceipt, mergeAssemblyDropAttempt } from '../../../huabu/apps/web/src/lcos/drop/dropAssemblyReceipt.js';
import { DropCommitRouter } from '../../../huabu/apps/web/src/lcos/drop/dropCommitRouter.js';
import type { DropAssemblyApplyIntent, DropTargetRegistration } from '../../../huabu/apps/web/src/lcos/drop/dropTypes.js';
import type { AssemblyApplyItemResultV1, WarehouseItemV1 } from '@local-creative-os/contracts';

const target: DropTargetRegistration = { targetId:'composer:original', kind:'composer-reference', label:'原输入', enabled:true, priority:100,
  rect:{left:10,top:20,width:100,height:60}, semantic:{kind:'composer-reference',intent:'continue',inputKey:'p/original-message'} };
const descriptor = {entityType:'artifact',entityId:'a',title:'简报初版',presentedRevisionId:'r1',currentRevisionId:'r2',artifactViewId:'v1',mimeType:'text/markdown'};
const bound = {entityType:'artifact',entityId:'a',descriptor};
const item: WarehouseItemV1 = {schemaVersion:1,kind:'artifact',entityRef:{type:'artifact',id:'a',viewId:'v1'},presentedRevisionId:'r1',title:'简报初版',usageCount:0,mimeType:'text/markdown'};
function fromDrop(payload: Parameters<typeof resolveDropIntent>[0]) {
  const resolved=resolveDropIntent(payload,target);assert.equal(resolved.status,'ready');
  if(resolved.status!=='ready'||resolved.intent.kind!=='composer-reference')throw Error('not composer');
  return resolved.intent.references??[resolved.intent.reference];
}
function native(ref=bound) {
  const nodes=[{id:'node-a',type:'text',position:{x:20,y:35},data:{}}];
  const snapshot=snapshotCanvasDropNodes(['node-a'],nodes,new Map([['node-a',ref]]));
  assert(snapshot[0]?.reference);return snapshot[0].reference;
}
for (const mimeType of ['text/markdown','image/png']) test(`R10 ${mimeType}: four entry adapters retain one revision identity (not a provider capability test)`,()=>{
  const ref={...bound,descriptor:{...descriptor,mimeType}};
  const clicked=snapshotDraftReference(ref);
  const dragged=fromDrop({kind:'objects',objects:[native(ref)]})[0]!;
  const assembly=assemblyDraftReferenceOf({...item,mimeType})!;
  const assemblyDrop=fromDrop({kind:'assembly',sourceRef:{kind:'artifactView',id:'v1'},entityRef:item.entityRef,reference:assembly})[0]!;
  const reader={entityType:'artifact',entityId:'a',revisionId:'r1'};
  assert.equal(new Set([clicked,dragged,assembly,assemblyDrop,reader].map(draftReferenceKey)).size,1);
  assert.deepEqual(toRunReference(dragged),toRunReference(reader));assert.equal(dragged.mimeType,mimeType);
});
test('R10 captured old revision never takes MIME/View facts from refreshed descriptor',()=>{
 const ref=snapshotDraftReference({...bound,revisionId:'r0',descriptor:{...descriptor,mimeType:'image/png'}});
 assert.equal(ref.revisionId,'r0');assert.equal(ref.mimeType,undefined);assert.equal(ref.artifactViewId,undefined);
});
test('R10 serializable native payload retains mode and contains no live descriptor',()=>{
 const r=draftReferenceForGesture({...bound,mode:'summary'});assert.equal(r.mode,'summary');assert(!('descriptor'in r));
 assert.equal(JSON.parse(JSON.stringify(r)).revisionId,'r1');
});
test('R10 multi-object Drop preserves distinct versions of the same material',()=>{
 const refs=fromDrop({kind:'objects',objects:[{entityType:'artifact',entityId:'a',revisionId:'r1'},{entityType:'artifact',entityId:'a',revisionId:'r2'},{entityType:'view',entityId:'v1',artifactId:'a',revisionId:'r1'}]});
 assert.deepEqual(refs.map(r=>r.revisionId),['r1','r2']);
});
test('R10 raw legacy View is not guessed to equal a pinned revision',()=>{
 const refs=prepareDraftReferences([{entityType:'view',entityId:'v1'},{entityType:'artifact',entityId:'a',revisionId:'r1'}]);
 assert(refs.ok);assert.equal(refs.references.length,2);
});
test('R10 mixed unsupported batch rejects before any draft admission',()=>{
 const refs=prepareDraftReferences([snapshotDraftReference(bound),{entityType:'note',entityId:'n'}],'continue');assert(!refs.ok);
 assert.equal(resolveDropIntent({kind:'objects',objects:[draftReferenceForGesture(bound),{entityType:'note',entityId:'n'}]},target).status,'ineligible');
});
for(const [title,ref] of Object.entries({missingId:{entityType:'artifact',entityId:''},badId:{entityType:'artifact',entityId:12},emptyVersion:{entityType:'artifact',entityId:'a',revisionId:''},invalidMode:{entityType:'artifact',entityId:'a',mode:'wrong'}}))test(`R10 invalid reference ${title} cannot degrade to current`,()=>assert(draftReferenceUnavailableReason(ref as never,'continue')));
test('R10 assembly source and draft address must describe the same View',()=>{
 const ref=assemblyDraftReferenceOf(item)!;
 assert.equal(resolveDropIntent({kind:'assembly',sourceRef:{kind:'artifactView',id:'different'},entityRef:item.entityRef,reference:ref},target).status,'ineligible');
});
test('R10 assembly reference cannot override another material identity',()=>{
 const ref=assemblyDraftReferenceOf(item)!;
 assert.equal(resolveDropIntent({kind:'assembly',sourceRef:{kind:'artifactView',id:'v1'},entityRef:{type:'artifact',id:'another'},reference:ref},target).status,'ineligible');
});
test('R10 same DOM receiver with changed input identity cancels release',()=>{
 const payload={kind:'object' as const,...draftReferenceForGesture(bound)};
 const before={state:{status:'preview' as const,payload,destination:{targetId:target.targetId,previewPoint:{x:1,y:2}},carryAnchor:'left' as const},resolution:resolveDropIntent(payload,target)};
 const after={...before,resolution:resolveDropIntent(payload,{...target,semantic:{kind:'composer-reference',intent:'continue',inputKey:'different-message'}})};
 assert.equal(canCommitDropRelease(before,after),false);
});
test('R10 delegate and continuation builders consume the same pinned revision',()=>{
 const refs=fromDrop({kind:'object',...draftReferenceForGesture(bound)});
 const run=buildComposerRunInput({projectId:'p',instruction:'分析',workspaceId:'w',target:{nodeId:'n',title:'t',anchor:{x:0,y:0,width:1,height:1},intent:'delegate'},refs});
 const send=buildComposerContinuationInput({conversationId:'c',continuationOperationId:'op',messageId:'m',text:'分析',refs});
 assert.deepEqual(run.orderedReferences,send.orderedReferences);assert.equal(run.orderedReferences?.[0]?.ref.type,'artifact');
 assert.equal((run.orderedReferences?.[0]?.ref as {revisionId:string}).revisionId,'r1');
});
test('R10 direct continuation builder cannot silently drop unsupported refs',()=>assert.throws(()=>buildComposerContinuationInput({conversationId:'c',continuationOperationId:'op',messageId:'m',text:'a',refs:[{entityType:'artifact',entityId:'a',revisionId:'r1'},{entityType:'note',entityId:'n'}]}),/暂不能/));

const sources=[{kind:'artifactView',id:'v1'},{kind:'note',id:'n'}] as const;
const intent: DropAssemblyApplyIntent={kind:'assembly-apply',targetId:'canvas',targetRef:{kind:'main'},sourceRefs:sources};
const line=(i:number,status:AssemblyApplyItemResultV1['status']='applied',channel:AssemblyApplyItemResultV1['channel']='presentation-membership'):AssemblyApplyItemResultV1=>({sourceRef:sources[i]!,status,channel});
const envelope=(results:unknown,projectId='p')=>({schemaVersion:1,projectId,results,allApplied:true});
const cases:Record<string,unknown>={
 success:envelope([line(0),line(1)]),already:envelope([line(0,'skipped','already-member'),line(1,'skipped','already-member')]),
 mixedComplete:envelope([line(0),line(1,'skipped','already-member')]),partial:envelope([line(0),line(1,'failed','error')]),
 unsupported:envelope([line(0,'skipped','unsupported'),line(1,'failed','unsupported')]),
 wrongProject:envelope([line(0),line(1)],'foreign'),wrongSchema:{...envelope([line(0)]),schemaVersion:2},missing:envelope([line(0)]),
 duplicate:envelope([line(0),line(0),line(1)]),contradictory:envelope([line(0),line(0,'failed','error'),line(1)]),
 appliedError:envelope([line(0,'applied','error'),line(1)]),appliedUnsupported:envelope([line(0,'applied','unsupported'),line(1)]),
 appliedAlready:envelope([line(0,'applied','already-member'),line(1)]),skippedError:envelope([line(0,'skipped','error'),line(1)]),
 foreignSource:envelope([line(0),{...line(1),sourceRef:{kind:'note',id:'foreign'}}]),nullResult:null,
 malformedResults:envelope({}),nullRow:envelope([null,line(1)]),badSource:envelope([{...line(0),sourceRef:null},line(1)]),
 badStatus:envelope([{...line(0),status:'done'},line(1)]),badMessage:envelope([{...line(0),message:{}},line(1)]),
};
for(const [name,receipt] of Object.entries(cases))test(`R10 button and Drop agree for ${name}`,()=>{
 const button=reviewAssemblyApply({projectId:'p',sourceRefs:sources},receipt);
 const drop=assemblyDropReceipt(intent,'tx',receipt,'p');
 assert.deepEqual(drop.assemblyItems,button.result.results);assert.deepEqual(drop.unknownSourceKeys,button.unknownKeys);
 assert.deepEqual(drop.retrySourceRefs,button.retrySourceRefs);assert.equal(drop.status==='success',button.result.allApplied);
});
test('R10 skill identity includes catalog and version on both entries',()=>{
 const refs=[{kind:'skill' as const,id:'s',source:'user' as const,version:'1'}];
 const r=envelope([{sourceRef:{...refs[0],version:'2'},status:'applied',channel:'relation'}]);
 assert.equal(assemblyDropReceipt({...intent,sourceRefs:refs},'tx',r,'p').unknownSourceKeys?.length,1);
});
test('R10 retry lost reply cannot reuse previous failure as replay permission',()=>{
 const first=assemblyDropReceipt(intent,'first',envelope([line(0),line(1,'failed','error')]),'p');
 const attempt={...intent,sourceRefs:[sources[1]]};
 const lost=assemblyDropReceipt(attempt,'second',null,'p');
 const merged=mergeAssemblyDropAttempt(intent,attempt,lost,first);
 assert.equal(merged.status,'partial');assert.deepEqual(merged.retrySourceRefs,[]);
 assert.deepEqual(merged.unknownSourceKeys,[assemblySourceKey(sources[1])]);assert.equal(merged.assemblyItems?.[0]?.status,'applied');
});
test('R10 retry success leaves earlier confirmed success intact',()=>{
 const first=assemblyDropReceipt(intent,'first',envelope([line(0),line(1,'failed','error')]),'p');
 const attempt={...intent,sourceRefs:[sources[1]]};const incoming=assemblyDropReceipt(attempt,'second',envelope([line(1)]),'p');
 const merged=mergeAssemblyDropAttempt(intent,attempt,incoming,first);assert.equal(merged.status,'success');assert.equal(merged.assemblyItems?.length,2);
});
test('R10 transport exception during retry still replaces attempted rows with unknown',()=>{
 const first=assemblyDropReceipt(intent,'first',envelope([line(0),line(1,'failed','error')]),'p');
 const merged=mergeAssemblyDropAttempt(intent,{...intent,sourceRefs:[sources[1]]},{status:'failed',transactionId:'next',targetId:intent.targetId,message:'offline',projectId:'p'},first);
 assert.equal(merged.retrySourceRefs?.length,0);assert.equal(merged.unknownSourceKeys?.length,1);assert.equal(merged.assemblyItems?.[0]?.status,'applied');
});
test('R10 earlier unknown is not silently converted to retryable failure after another retry',()=>{
 const original={...intent,sourceRefs:[...sources,{kind:'note' as const,id:'missing'}]};
 const first=assemblyDropReceipt(original,'first',envelope([line(0),line(1,'failed','error')]),'p');
 const attempt={...original,sourceRefs:[sources[1]]};const good=assemblyDropReceipt(attempt,'next',envelope([line(1)]),'p');
 const merged=mergeAssemblyDropAttempt(original,attempt,good,first);assert.equal(merged.status,'partial');assert.equal(merged.unknownSourceKeys?.length,1);assert.deepEqual(merged.retrySourceRefs,[]);
});
test('R10 atomic destination does not expose per-item retry',()=>{
 const receipt=assemblyDropReceipt({...intent,railwayReceive:true},'tx',envelope([line(0),line(1,'failed','error')]),'p');assert.deepEqual(receipt.retrySourceRefs,[]);
});
test('R10 generic assembly requires host project before invoking a write',async()=>{
 let writes=0;const r=await new DropCommitRouter().commit(intent,'tx',{applyAssembly:async()=>{writes++;return envelope([line(0)]) as never},addComposerReference:()=>{}});
 assert.equal(writes,0);assert.equal(r.status,'failed');
});
test('R10 router does not return old success for reused id with changed target or input',async()=>{
 let writes=0;const router=new DropCommitRouter(),owners={projectId:'p',applyAssembly:async()=>{writes++;return envelope([line(0),line(1)]) as never},addComposerReference:()=>{}};
 assert.equal((await router.commit(intent,'same',owners)).status,'success');assert.equal((await router.commit(intent,'same',owners)).status,'success');
 assert.equal((await router.commit({...intent,targetId:'other'},'same',owners)).status,'failed');
 assert.equal((await router.commit({...intent,sourceRefs:[sources[0]]},'same',owners)).status,'failed');assert.equal(writes,1);
});
