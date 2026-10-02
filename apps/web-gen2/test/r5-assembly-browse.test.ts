import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { AssemblyApplyRequestV1, AssemblyApplyResultV1, WarehouseItemV1, WarehouseSnapshotV1, WarehouseQueryV1 } from '@local-creative-os/contracts';
import { warehouseMatchesMaterialV1 } from '@local-creative-os/contracts';
import { HttpClient } from '../src/backend/client.js';
import { CoreAssemblyClient, warehouseQueryStringV1 } from '../src/backend/assembly.js';
import { CoreArtifactClient } from '../src/backend/artifacts.js';
import { AssemblySourceBayController, dedupeWarehouseItems } from '../src/lcos/assembly/assemblySourceBayController.js';
import { assemblySourceRefOf } from '../../../huabu/apps/web/src/lcos/professional/assemblySourceRef.ts';
import { readAssemblyArtifactMedia } from '../../../huabu/apps/web/src/lcos/professional/assemblyArtifactMedia.ts';
import { reviewAssemblyApply } from '../../../huabu/apps/web/src/lcos/professional/assemblyApplyReview.ts';
import { assemblyResourceLabel, assemblyCaptureKindLabel } from '../../../huabu/apps/web/src/lcos/ui/professional/assemblyPresentation.ts';
import { clampAssemblyItemWidth, assemblyRowSpan } from '../../../huabu/apps/web/src/lcos/ui/professional/assemblyBrowseGeometry.ts';

const row = (id:string, extra:Partial<WarehouseItemV1>={}):WarehouseItemV1 => ({schemaVersion:1,kind:'artifact',entityRef:{type:'artifact',id,viewId:`view-${id}`},title:id,usageCount:0,...extra});
const page=(ids:string[],nextCursor?:string,projectId='p'):WarehouseSnapshotV1=>({schemaVersion:1,projectId,items:ids.map(id=>row(id)),totalApprox:60,...(nextCursor?{nextCursor}:{})});
const tick=()=>new Promise(resolve=>setTimeout(resolve,0));
function controlled(){
 const pending:{projectId:string;query:WarehouseQueryV1;signal:AbortSignal|undefined;resolve:(value:WarehouseSnapshotV1)=>void;reject:(error:unknown)=>void}[]=[];
 const controller=new AssemblySourceBayController({assembly:{queryWarehouse:(projectId:string,query:WarehouseQueryV1,signal?:AbortSignal)=>new Promise<WarehouseSnapshotV1>((resolve,reject)=>pending.push({projectId,query,signal,resolve,reject}))} as CoreAssemblyClient});
 controller.open('p');return {controller,pending};
}

test('R5 read filters use real families, never title suffixes or folders masquerading as image',()=>{
 assert(!warehouseMatchesMaterialV1(row('a',{title:'fake.jpg'}),'image'));
 assert(warehouseMatchesMaterialV1(row('a',{visualFamily:'image'}),'image'));
 assert(warehouseMatchesMaterialV1(row('a',{visualFamily:'pdf'}),'text'));
 assert(warehouseMatchesMaterialV1(row('a',{kind:'note',entityRef:{type:'note',id:'a'}}),'text'));
 assert(!warehouseMatchesMaterialV1(row('a',{kind:'collection',visualFamily:'image'}),'image'));
 assert(warehouseMatchesMaterialV1(row('a',{kind:'workflow'}),'collection'));
 assert(warehouseMatchesMaterialV1(row('a',{visualFamily:'video'}),'media'));
 assert(!warehouseMatchesMaterialV1(row('a',{kind:'conversation'}),'text'));
});
test('R5 warehouse serializes material/order with the same search/cursor; defaults remain unchanged',()=>{
 const q=new URLSearchParams(warehouseQueryStringV1({search:'山 野',materialFilter:'image',sort:'name',limit:50,cursor:'offset:50'}).slice(1));
 assert.equal(q.get('search'),'山 野');assert.equal(q.get('material'),'image');assert.equal(q.get('sort'),'name');assert.equal(q.get('cursor'),'offset:50');
 assert.equal(warehouseQueryStringV1({materialFilter:'all',sort:'updated'}),'');
});
test('R5 button apply refuses project/path mismatch before invoking transport',async()=>{
 let calls=0;const client=new CoreAssemblyClient(new HttpClient({baseUrl:'http://fixture',fetch:async()=>{calls++;throw Error('must not call');}}));
 await assert.rejects(()=>client.apply('p',{schemaVersion:1,projectId:'q',sourceRefs:[{kind:'note',id:'n'}],targetRef:{kind:'main'}}));assert.equal(calls,0);
});
test('R5 source identity without a view is read-only, not an artifact ID disguised as a view',()=>{
 assert.equal(assemblySourceRefOf(row('a',{entityRef:{type:'artifact',id:'a'}})),undefined);
 assert.deepEqual(assemblySourceRefOf(row('a')),{kind:'artifactView',id:'view-a'});
 assert.equal(assemblySourceRefOf(row('a',{entityRef:{type:'collection',id:'a'}})),undefined);
 assert.equal(assemblySourceRefOf(row('a',{entityRef:{type:'artifact',id:' ',viewId:'v'}})),undefined);
});
test('R5 same-query refresh retains loaded bodies and facts while loading',async()=>{
 const {controller:c,pending:p}=controlled();p[0]!.resolve(page(['a','b'],'offset:2'));await tick();const old=c.read()!.warehouse;
 c.reloadWarehouse();assert.equal(c.read()!.warehouse,old);assert.equal(c.read()!.warehouseStatus,'loading');
 p[1]!.reject(Error('offline'));await tick();assert.equal(c.read()!.warehouse,old);assert.equal(c.read()!.warehouseStatus,'error');c.dispose();
});
test('R5 changed material filter requests first matching page, clearing stale items and cursor',async()=>{
 const {controller:c,pending:p}=controlled();p[0]!.resolve(page(['a'],'offset:50'));await tick();
 c.setWarehouseQuery({materialFilter:'image',sort:'usage'});assert.equal(c.read()!.warehouse,undefined);assert.equal(c.read()!.warehouseNextCursor,undefined);
 assert.deepEqual(p[1]!.query,{materialFilter:'image',sort:'usage',limit:50});p[1]!.resolve(page(['image51']));await tick();assert.equal(c.read()!.warehouse!.items[0]!.title,'image51');c.dispose();
});
test('R5 all next pages retain submitted query/filter/order and cannot double-fetch',async()=>{
 const {controller:c,pending:p}=controlled();c.setWarehouseQuery({search:'brief',materialFilter:'text',sort:'name'});p[1]!.resolve(page(['a'],'offset:1'));await tick();
 c.loadMoreWarehouse();c.loadMoreWarehouse();assert.equal(p.length,3);
 assert.deepEqual(p[2]!.query,{search:'brief',materialFilter:'text',sort:'name',limit:50,cursor:'offset:1'});p[2]!.resolve(page(['b']));await tick();assert.deepEqual(c.read()!.warehouse!.items.map(i=>i.title),['a','b']);c.dispose();
});
test('R5 page error retains materials and successful retry clears the old error',async()=>{
 const {controller:c,pending:p}=controlled();p[0]!.resolve(page(['a'],'offset:1'));await tick();c.loadMoreWarehouse();p[1]!.reject({code:'offline'});await tick();
 assert.equal(c.read()!.warehouse!.items.length,1);assert.equal(c.read()!.warehouseErrorCode,'offline');c.loadMoreWarehouse();p[2]!.resolve(page(['b']));await tick();assert.equal(c.read()!.warehouseErrorCode,undefined);assert.equal(c.read()!.warehouse!.items.length,2);c.dispose();
});
test('R5 query supersession actually aborts old reads; late response cannot override a new search',async()=>{
 const {controller:c,pending:p}=controlled();c.setWarehouseSearch('new');assert.equal(p[0]!.signal?.aborted,true);
 p[1]!.resolve(page(['new']));await tick();p[0]!.resolve(page(['old']));await tick();assert.equal(c.read()!.warehouse!.items[0]!.title,'new');c.dispose();assert.equal(p[1]!.signal?.aborted,true);
});
test('R5 project switch aborts old queries and rejects late previous-project state',async()=>{
 const {controller:c,pending:p}=controlled();c.open('q');assert.equal(p[0]!.signal?.aborted,true);p[0]!.resolve(page(['old']));await tick();assert.equal(c.read()!.projectId,'q');assert.equal(c.read()!.warehouse,undefined);p[1]!.resolve(page(['q'],undefined,'q'));await tick();assert.equal(c.read()!.warehouse!.projectId,'q');c.dispose();
});
test('R5 refreshed duplicate facts replace old values without reordering existing identities',()=>{
 const result=dedupeWarehouseItems([row('a'),row('b')],[row('a',{title:'revised'}),row('c'),row('c')]);assert.deepEqual(result.map(i=>i.entityRef.id),['a','b','c']);assert.equal(result[0]!.title,'revised');
});
test('R5 skill search uses the catalog search parameter and stale skill reads are aborted',async()=>{
 const calls:{query?:string;signal?:AbortSignal;resolve:(x:never[])=>void}[]=[];
 const c=new AssemblySourceBayController({assembly:{queryWarehouse:async()=>page([])} as unknown as CoreAssemblyClient,skills:{list:(_p:string,query?:string,signal?:AbortSignal)=>new Promise<never[]>(resolve=>calls.push({query,signal,resolve}))} as never});
 c.open('p');c.selectTab('skills');c.loadTab('skills');c.setSkillSearch('分镜');assert.equal(calls[0]!.signal!.aborted,true);assert.equal(calls[1]!.query,'分镜');calls[1]!.resolve([]);await tick();assert.equal(c.read()!.skillStatus,'loaded');assert.equal(c.read()!.warehouseStatus,'loaded');c.dispose();
});
test('R5 source failures remain isolated while a preview is cancelled',async()=>{
 let previewSignal:AbortSignal|undefined;
 const c=new AssemblySourceBayController({assembly:{queryWarehouse:async()=>page(['ok'])} as unknown as CoreAssemblyClient,captureSpace:{snapshot:async()=>{throw {code:'UNAVAILABLE'};},preview:async(_id:string,signal?:AbortSignal)=>{previewSignal=signal;return {type:'text',text:'read'};}} as never});
 c.open('p');c.reloadCapture();await tick();assert.equal(c.read()!.captureStatus,'error');assert.equal(c.read()!.warehouseStatus,'loaded');const abort=new AbortController();await c.previewCapture('cap',abort.signal);abort.abort();assert.equal(previewSignal?.aborted,true);c.dispose();
});

const request:AssemblyApplyRequestV1={schemaVersion:1,projectId:'p',sourceRefs:[{kind:'artifactView',id:'v1'},{kind:'artifactView',id:'v2'}],targetRef:{kind:'conversation',id:'c'}};
const receipt=(results:AssemblyApplyResultV1['results'],projectId='p'):AssemblyApplyResultV1=>({schemaVersion:1,projectId,allApplied:true,results});
test('R5 batch missing outcomes stay unknown and are not blindly retryable',()=>{
 const out=reviewAssemblyApply(request,receipt([{sourceRef:request.sourceRefs[0]!,status:'applied',channel:'relation'}]));assert.equal(out.result.allApplied,false);assert.equal(out.unknownKeys.length,1);assert.equal(out.retrySourceRefs.length,0);assert.equal(out.result.results[0]!.status,'applied');
});
test('R5 failed subset excludes already-member and unsupported; uses original exact source refs',()=>{
 const out=reviewAssemblyApply(request,receipt([{sourceRef:request.sourceRefs[0]!,status:'skipped',channel:'already-member'},{sourceRef:request.sourceRefs[1]!,status:'failed',channel:'error'}]));assert.deepEqual(out.retrySourceRefs,[request.sourceRefs[1]]);assert.equal(out.unknownKeys.length,0);
 const unsupported=reviewAssemblyApply(request,receipt([{sourceRef:request.sourceRefs[0]!,status:'skipped',channel:'unsupported'},{sourceRef:request.sourceRefs[1]!,status:'applied',channel:'relation'}]));assert.equal(unsupported.retrySourceRefs.length,0);assert.equal(unsupported.result.allApplied,false);
});
test('R5 foreign project and duplicate contradictory outcomes cannot clear selection as success',()=>{
 assert.equal(reviewAssemblyApply(request,receipt([], 'other')).unknownKeys.length,2);
 const line={sourceRef:request.sourceRefs[0]!,status:'applied' as const,channel:'relation' as const};
 const out=reviewAssemblyApply(request,receipt([line,line]));assert.equal(out.unknownKeys.length,2);assert.equal(out.retrySourceRefs.length,0);
});
test('R5 Skill source/version mismatch remains unknown, not substituted by same id',()=>{
 const req={...request,sourceRefs:[{kind:'skill' as const,id:'s',source:'user' as const,version:'1'}]};
 const out=reviewAssemblyApply(req,receipt([{sourceRef:{kind:'skill',id:'s',source:'system',version:'2'},status:'applied',channel:'relation'}]));assert.equal(out.unknownKeys.length,1);assert.equal(out.result.allApplied,false);
});
test('R5 invalid success/channel combinations cannot become a green receipt',()=>{
 const out=reviewAssemblyApply({...request,sourceRefs:[request.sourceRefs[0]!]},receipt([{sourceRef:request.sourceRefs[0]!,status:'applied',channel:'unsupported'}]));assert.equal(out.result.allApplied,false);assert.equal(out.unknownKeys.length,1);
});
test('R5 material size is bounded and masonry spans include separation without changing source geometry',()=>{
 assert.equal(clampAssemblyItemWidth(NaN),248);assert.equal(clampAssemblyItemWidth(500),320);assert.equal(clampAssemblyItemWidth(2),184);assert.equal(assemblyRowSpan(201.2),226);assert.equal(assemblyRowSpan(0),24);
});
function mediaClient({mime='image/png',projectId='p',artifactId='a',missing=false,fail=false}={}){
 const urls:string[]=[];const signals:(AbortSignal|undefined)[]=[];
 const http=new HttpClient({baseUrl:'http://core.fixture',fetch:async(input,init)=>{
  const url=String(input);urls.push(url);signals.push(init?.signal??undefined);
  if(url.endsWith('/content')){if(fail)throw Error('offline');return new Response(mime.startsWith('text')?'historical text':'bytes',{headers:{'Content-Type':mime}});}
  const value=url.endsWith('/revisions')?(missing?[]:[{id:'old',artifactId:'a',fileRecordId:'file-old'},{id:'current',artifactId:'a',fileRecordId:'file-new'}]):{artifact:{id:artifactId,projectId,kind:'image',currentRevisionId:'current'},currentRevisionId:'current',revisions:[]};
  return new Response(JSON.stringify({ok:true,value}),{headers:{'Content-Type':'application/json'}});
 }});return {client:new CoreArtifactClient(http),urls,signals};
}
test('R5 actual ArtifactClient preview preserves requested historical revision despite Current changing',async()=>{
 const s=mediaClient();const ctrl=new AbortController();const out=await readAssemblyArtifactMedia(s.client,'p','a','old',ctrl.signal);assert.equal(out.revisionId,'old');assert.equal(out.fileRecordId,'file-old');assert.equal(out.kind,'image');assert(s.urls.some(u=>u.endsWith('/file-old/content')));assert(!s.urls.some(u=>u.includes('file-new')));assert.equal(s.signals.length,3);
});
test('R5 absent historical revision fails before bytes and never falls back to current',async()=>{
 const s=mediaClient({missing:true});await assert.rejects(()=>readAssemblyArtifactMedia(s.client,'p','a','old',new AbortController().signal));assert.equal(s.urls.length,2);
});
test('R5 preview identity mismatch fails before content access',async()=>{
 for(const opts of [{projectId:'other'},{artifactId:'other'}]){const s=mediaClient(opts);await assert.rejects(()=>readAssemblyArtifactMedia(s.client,'p','a','old',new AbortController().signal));assert.equal(s.urls.length,2);}
});
for(const [mime,kind] of [['text/markdown','text'],['video/mp4','video'],['audio/wav','audio'],['application/pdf','unsupported']] as const){
 test(`R5 media preview derives ${kind} from response MIME, not the artifact title`,async()=>{const s=mediaClient({mime});const out=await readAssemblyArtifactMedia(s.client,'p','a','old',new AbortController().signal);assert.equal(out.kind,kind);if(kind==='text')assert.equal(out.text,'historical text');});
}
test('R5 cancelled preview does not publish content after metadata resolves',async()=>{
 const s=mediaClient();const ctrl=new AbortController();ctrl.abort();await assert.rejects(()=>readAssemblyArtifactMedia(s.client,'p','a','old',ctrl.signal),e=>(e as Error).name==='AbortError');
});

test('R5 response project mismatch cannot replace visible materials',async()=>{
 const {controller:c,pending:p}=controlled();p[0]!.resolve(page(['safe']));await tick();c.reloadWarehouse();p[1]!.resolve(page(['foreign'],undefined,'q'));await tick();
 assert.equal(c.read()!.warehouseErrorCode,'warehouse_identity_mismatch');assert.equal(c.read()!.warehouse!.items[0]!.title,'safe');c.dispose();
});
test('R5 response project mismatch on pagination retains cursor and original page',async()=>{
 const {controller:c,pending:p}=controlled();p[0]!.resolve(page(['safe'],'offset:1'));await tick();c.loadMoreWarehouse();p[1]!.resolve(page(['foreign'],undefined,'q'));await tick();
 assert.equal(c.read()!.warehouseErrorCode,'warehouse_identity_mismatch');assert.equal(c.read()!.warehouseNextCursor,'offset:1');assert.equal(c.read()!.warehouse!.items.length,1);c.dispose();
});

test('R5 refresh re-reads the already exposed cursor range rather than truncating to page one',async()=>{
 const {controller:c,pending:p}=controlled();p[0]!.resolve(page(['a','b'],'offset:2'));await tick();c.loadMoreWarehouse();p[1]!.resolve(page(['c']));await tick();
 c.reloadWarehouse();p[2]!.resolve(page(['a','b'],'offset:2'));await tick();assert.equal(c.read()!.warehouse!.items.length,3);assert.equal(c.read()!.warehouseStatus,'loading');assert.equal(p[3]!.query.cursor,'offset:2');
 p[3]!.resolve(page(['c']));await tick();assert.equal(c.read()!.warehouse!.items.length,3);assert.equal(c.read()!.warehouseStatus,'loaded');c.dispose();
});
test('R5 refresh interrupted on a later page retains the complete previously exposed field',async()=>{
 const {controller:c,pending:p}=controlled();p[0]!.resolve(page(['a','b'],'offset:2'));await tick();c.loadMoreWarehouse();p[1]!.resolve(page(['c']));await tick();
 c.reloadWarehouse();p[2]!.resolve(page(['a','b'],'offset:2'));await tick();p[3]!.reject({code:'offline'});await tick();assert.equal(c.read()!.warehouse!.items.length,3);assert.equal(c.read()!.warehouseStatus,'error');c.dispose();
});
test('R5 enum copy is human-readable without inventing trust for unknown values',()=>{
 assert.equal(assemblyResourceLabel('source','external'),'外部文件');assert.equal(assemblyResourceLabel('status','failed'),'解析失败');assert.equal(assemblyResourceLabel('trust','untrusted'),'未经审核');assert.equal(assemblyResourceLabel('trust','something-new'),'未注明');
 assert.equal(assemblyCaptureKindLabel('web_selection'),'网页摘录');assert.equal(assemblyCaptureKindLabel('unrecognized'),'未命名收件');
});
