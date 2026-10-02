import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SqliteMetadataRepository } from '../../apps/local-core/src/metadata-repository.ts';
import { createMvpSampleSnapshot } from '../../apps/local-core/src/mvp-sample-project.ts';
import { PresentationApplicationService } from '../../apps/local-core/src/presentation-application-service.ts';
import { MutationSafetyService } from '../../apps/local-core/src/mutation-safety-service.ts';
import { WarehouseService } from '../../apps/local-core/src/warehouse-service.ts';
import { handleCollectionsRoute } from '../../apps/local-core/src/routes/collections.ts';
import { readCollectionMemberPreviews } from '../../apps/local-core/src/collection-preview.ts';
import { validateCollectionMembersSnapshot, collectionPreviewMembers } from '../../apps/web-gen2/src/backend/collections.ts';

async function fixture() {
 const dir=await mkdtemp(join(tmpdir(),'r11-collection-')),path=join(dir,'core.sqlite');let db=new SqliteMetadataRepository(path);
 const sample=createMvpSampleSnapshot(join(dir,'files'),'2026-10-02T00:00:00Z');db.save(sample);const p=String(sample.project.id);
 const safety=()=>new MutationSafetyService(db,new PresentationApplicationService(db,db));
 const c=String(safety().createCollection({projectId:p,title:'真实集合'}).collection.id);
 const add=(type:string,id:string)=>safety().addCollectionMember({projectId:p,collectionId:c,memberRef:{type,id} as never});
 const members=()=>db.listCollectionMemberships(p,c);
 const read=()=>readCollectionMemberPreviews(db,p,members());
 const route=async(method:string,collectionId=c,body?:unknown)=>{
  let status=0,value:any;
  const handled=await handleCollectionsRoute({
    method, pathname:`/projects/${p}/collections/${collectionId}/members`,
    request:{} as never, response:{} as never, signal:new AbortController().signal,
    metadata:db, mutationSafety:safety(),
    helpers:{
      readJsonBody:async()=>body,
      sendJson:(_r:any,s:number,v:unknown)=>{status=s;value=v},
      failure:(code:string,message:string)=>({ok:false,error:{code,message}}),
    },
  } as never);
  return {status,value,handled};
 };
 return{p,c,sample,db:()=>db,safety,add,members,read,route,reopen:()=>{db.close();db=new SqliteMetadataRepository(path)},cleanup:async()=>{db.close();await rm(dir,{recursive:true,force:true})}};
}
async function run(fn:(f:Awaited<ReturnType<typeof fixture>>)=>unknown){const f=await fixture();try{await fn(f)}finally{await f.cleanup()}}
test('R11 Core: empty collection is genuinely empty, no decorative members',()=>run(async f=>{const r=await f.route('GET');assert.equal(r.status,200);assert.deepEqual(r.value.value.members,[]);assert.deepEqual(r.value.value.previews,[])}));
test('R11 Core: actual member types and precise current file flow through HTTP/client validation',()=>run(async f=>{
 f.add('artifact','artifact-brief');f.add('note',String(f.sample.notes[0]!.id));
 const r=await f.route('GET');const s=validateCollectionMembersSnapshot(r.value.value,f.p,f.c);const p=collectionPreviewMembers(s);
 assert.equal(p.length,2);const a=p.find(x=>x.type==='artifact')!;assert.equal(a.revisionId,'revision-brief-initial');assert.equal(a.fileRecordId,String(f.db().getArtifactRevision(a.revisionId)!.fileRecordId));
 assert.equal(p.find(x=>x.type==='note')!.excerpt,f.sample.notes[0]!.body.slice(0,1200));
}));
test('R11 Core: many-to-many previews do not clone or reparent source artifacts',()=>run(f=>{
 const before=f.db().get(f.p)!;f.add('artifact','artifact-brief');const other=f.safety().createCollection({projectId:f.p,title:'另一个集合'}).collection.id;
 f.safety().addCollectionMember({projectId:f.p,collectionId:String(other),memberRef:{type:'artifact',id:'artifact-brief'}});
 assert.equal(f.read().length,1);assert.deepEqual(f.db().get(f.p)!.artifacts,before.artifacts);assert.deepEqual(f.db().get(f.p)!.artifactViews,before.artifactViews);
}));
test('R11 Core: current member version updates without changing a historical View',()=>run(f=>{
 f.add('artifact','artifact-brief');const before=f.read()[0]!,a=f.db().getArtifact('artifact-brief')!,rev=f.db().getArtifactRevision(before.revisionId!)!,file=f.db().getFileRecord(before.fileRecordId!)!;
 const view=f.db().getArtifactView('view-brief')!;
 f.db().commitManagedTextRevision({artifact:a,previousRevision:rev,newFileRecord:{...file,id:'r11-file' as never,mimeType:'image/png',size:200},newRevision:{...rev,id:'r11-revision' as never,fileRecordId:'r11-file' as never,source:'external',status:'current',parentRevisionId:rev.id}});
 // The existing edit service advances its Views; establish an explicit historical View as fixture input.
 f.db().upsertArtifactView(view);
 const after=f.read()[0]!;assert.equal(after.kind,'image');assert.equal(after.revisionId,'r11-revision');assert.equal(after.fileRecordId,'r11-file');assert.deepEqual(f.db().getArtifactView('view-brief'),view);
}));
test('R11 Core: missing member remains in count and order instead of falling back to another image',()=>run(f=>{
 f.add('artifact','artifact-brief');f.add('artifact',String(f.sample.artifacts[1]!.id));f.db().deleteArtifact('artifact-brief');const p=f.read();assert.equal(p.length,2);assert.equal(p.find(x=>x.id==='artifact-brief')!.availability,'missing');assert.deepEqual(p.map(x=>[x.type,x.id]),f.members().map(x=>[x.memberRef.type,x.memberRef.id]));
}));
test('R11 Core: foreign member metadata cannot leak title or file identity',()=>run(f=>{
 const m={collectionId:f.c,memberRef:{type:'artifact',id:'foreign'},relationId:'r',addedAt:'t'};
 const other={...f.sample,project:{...f.sample.project,id:'other-project'},artifacts:[{...f.sample.artifacts[0]!,id:'foreign',projectId:'other-project',title:'secret foreign title'}],fileRecords:[],artifactViews:[],notes:[],workspaces:[],scopes:[],relations:[]};
 // The read adapter also verifies every member against the requested project.
 const repo={getArtifact:()=>other.artifacts[0]} as unknown as SqliteMetadataRepository;
 const result=readCollectionMemberPreviews(repo,f.p,[m as never])[0]!;assert.equal(result.availability,'missing');assert(!JSON.stringify(result).includes('secret'));
}));
test('R11 Core: unreadable/stale files are identified, not downloaded or removed',()=>run(f=>{
 f.add('artifact','artifact-brief');const a=f.db().getArtifact('artifact-brief')!,rev=f.db().getArtifactRevision(String(a.currentRevisionId))!,file=f.db().getFileRecord(String(rev.fileRecordId))!;
 for(const availability of ['stale','unreadable','missing'] as const){f.db().upsertFileRecord({...file,availability});assert.equal(f.read()[0]!.availability,availability);assert.equal(f.members().length,1)}
}));
test('R11 Core: metadata-only read does not mutate graph or collection relations',()=>run(async f=>{
 f.add('artifact','artifact-brief');const before=f.db().get(f.p);const memberships=f.members();await f.route('GET');await f.route('GET');assert.deepEqual(f.db().get(f.p),before);assert.deepEqual(f.members(),memberships);
}));
test('R11 Core: membership/previews survive real SQLite close and reopen',()=>run(async f=>{
 f.add('artifact','artifact-brief');f.add('note',String(f.sample.notes[0]!.id));const before=(await f.route('GET')).value;f.reopen();assert.deepEqual((await f.route('GET')).value,before);
}));
test('R11 Core: remove updates preview, leaves source and other collection, repeats as not-member',()=>run(async f=>{
 f.add('artifact','artifact-brief');const other=String(f.safety().createCollection({projectId:f.p,title:'其他'}).collection.id);f.safety().addCollectionMember({projectId:f.p,collectionId:other,memberRef:{type:'artifact',id:'artifact-brief'}});
 const body={memberType:'artifact',memberId:'artifact-brief'};assert.equal((await f.route('DELETE',f.c,body)).value.value.status,'removed');f.reopen();assert.equal(f.read().length,0);assert(f.db().getArtifact('artifact-brief'));assert.equal(f.db().listCollectionMemberships(f.p,other).length,1);assert.equal((await f.route('DELETE',f.c,body)).value.value.status,'not-member');
}));
test('R11 Core: button/collection-member endpoint and confirmed duplicate share preview result',()=>run(async f=>{
 const body={memberType:'artifact',memberId:'artifact-brief'};assert.equal((await f.route('POST',f.c,body)).value.value.status,'applied');const before=f.read();assert.equal((await f.route('POST',f.c,body)).value.value.status,'already-member');assert.deepEqual(f.read(),before);
}));
test('R11 Core: invalid add keeps existing count and canonical identities',()=>run(async f=>{
 f.add('artifact','artifact-brief');const before=f.read();const result=await f.route('POST',f.c,{memberType:'artifact',memberId:'missing'});assert.equal(result.status,422);assert.deepEqual(f.read(),before);
}));

test('R11 Core: real created Collection appears in Warehouse used by Main overview and Assembly',()=>run(f=>{
 const result=new WarehouseService(f.db()).query(f.p,{kinds:['collection']});
 assert.equal(result.items.length,1);assert.equal(result.items[0]!.entityRef.type,'collection');assert.equal(result.items[0]!.entityRef.id,f.c);
 assert.equal(f.db().getCollection(result.items[0]!.entityRef.id)!.title,'真实集合');
}));
test('R11 Core: legacy collection Scope is not a canonical Collection and is not deleted',()=>run(f=>{
 const graph=f.db().get(f.p)!;const old={...graph.scopes[0]!,id:'legacy-set',kind:'collection' as const,name:'旧集合范围'};
 f.db().save({...graph,scopes:[...graph.scopes,old]} as never);
 const result=new WarehouseService(f.db()).query(f.p,{kinds:['collection']});assert(result.items.some(i=>i.entityRef.id===f.c));assert(!result.items.some(i=>i.entityRef.id==='legacy-set'));assert(f.db().get(f.p)!.scopes.some(i=>String(i.id)==='legacy-set'));
}));
test('R11 Core: canonical Collection filtering and pagination happen in the same read model',()=>run(f=>{
 for(let i=0;i<55;i++)f.safety().createCollection({projectId:f.p,title:`批次${String(i).padStart(2,'0')}`});
 const service=new WarehouseService(f.db());const page=service.query(f.p,{kinds:['collection'],search:'批次',sort:'name',limit:50});assert.equal(page.items.length,50);assert.equal(page.totalApprox,55);assert(page.nextCursor);
 const more=service.query(f.p,{kinds:['collection'],search:'批次',sort:'name',limit:50,cursor:page.nextCursor});assert.equal(more.items.length,5);assert.equal(new Set([...page.items,...more.items].map(i=>i.entityRef.id)).size,55);
 f.reopen();assert.equal(new WarehouseService(f.db()).query(f.p,{search:'批次54',materialFilter:'collection'}).items[0]!.title,'批次54');
}));
