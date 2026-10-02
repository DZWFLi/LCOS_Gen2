/** R5 Warehouse queries use real SQLite and the production HTTP route. Fixtures
 * are disposable metadata; this does not start the full UI/provider stack. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SqliteMetadataRepository } from '../../apps/local-core/src/metadata-repository.ts';
import { createMvpSampleSnapshot } from '../../apps/local-core/src/mvp-sample-project.ts';
import { WarehouseService } from '../../apps/local-core/src/warehouse-service.ts';
import { handleF6AssemblyRoute, type F6AssemblyRouteContext } from '../../apps/local-core/src/routes/f6-assembly.ts';
import type { ProjectGraphSnapshot } from '@local-creative-os/contracts';

async function setup() {
 const root=await mkdtemp(join(tmpdir(),'lcos-r5-core-'));
 const sample=createMvpSampleSnapshot(join(root,'files'),'2026-09-30T00:00:00Z');
 const template=sample.artifacts[0]!,rev=sample.artifactRevisions[0]!,file=sample.fileRecords[0]!,view=sample.artifactViews[0]!;
 const artifacts=[],revisions=[],files=[],views=[];
 for(let i=0;i<61;i++){
  const id=String(i).padStart(3,'0');const image=i===60;
  artifacts.push({...template,id:`art-${id}`,title:image?'Z图片60':`A文本${id}`,kind:image?'image':'markdown',currentRevisionId:`rev-${id}`});
  revisions.push({...rev,id:`rev-${id}`,artifactId:`art-${id}`,fileRecordId:`file-${id}`});
  files.push({...file,id:`file-${id}`,mimeType:image?'image/png':'text/markdown'});
  views.push({...view,id:`view-${id}`,artifactId:`art-${id}`,revisionId:`rev-${id}`});
 }
 const graph={...sample,artifacts,artifactRevisions:revisions,fileRecords:files,artifactViews:views,relations:[],notes:[],checkpoints:[],workspaces:sample.workspaces.map(ws=>({...ws,focusedViewIds:[]}))} as unknown as ProjectGraphSnapshot;
 const db=join(root,'metadata.sqlite');let repo=new SqliteMetadataRepository(db);repo.save(graph);
 const projectId=String(graph.project.id);
 const service=()=>new WarehouseService(repo);
 const reopen=()=>{repo.close();repo=new SqliteMetadataRepository(db);};
 const cleanup=async()=>{repo.close();await rm(root,{recursive:true,force:true});};
 const route=async(query:string,options:{method?:string;body?:unknown;apply?:unknown}={})=>{
  let code=0,body:any;
  const pathname=`/projects/${projectId}/${options.method==='POST'?'assembly/apply':'warehouse'}`;
  const ctx={method:options.method??'GET',pathname,url:new URL(`http://core${pathname}${query}`),request:{},response:{},controller:new AbortController(),metadata:repo,warehouse:service(),assemblyApply:options.apply,
   helpers:{sendJson:(_r:unknown,status:number,value:unknown)=>{code=status;body=value;},failure:(code:string,message:string)=>({ok:false,error:{code,message}}),isRecord:(value:unknown)=>value!==null&&typeof value==='object',readJsonBody:async()=>options.body}} as unknown as F6AssemblyRouteContext;
  assert.equal(await handleF6AssemblyRoute(ctx),true);return {code,body};
 };
 return {graph,projectId,service,reopen,cleanup,route,repo:()=>repo};
}
test('R5 SQLite: image 61 is found on first filtered page, not hidden behind first 50 text items',async()=>{
 const s=await setup();try{
  assert.equal(s.service().query(s.projectId,{kinds:['artifact'],sort:'name'}).items.length,50);
  assert.equal(s.service().query(s.projectId,{kinds:['artifact'],sort:'name'}).items.some(i=>i.visualFamily==='image'),false);
  const found=s.service().query(s.projectId,{materialFilter:'image',sort:'name'});assert.equal(found.totalApprox,1);assert.equal(found.items[0]!.title,'Z图片60');assert.equal(found.nextCursor,undefined);
  s.reopen();assert.equal(s.service().query(s.projectId,{materialFilter:'image'}).items[0]!.entityRef.id,'art-060');
 }finally{await s.cleanup();}
});
test('R5 SQLite/route: material/order/search/cursor reach the production service together',async()=>{
 const s=await setup();try{const a=await s.route('?material=text&sort=name&search=A文本&limit=7');assert.equal(a.code,200);assert.equal(a.body.value.items.length,7);assert.equal(a.body.value.totalApprox,60);assert.equal(a.body.value.items[0].title,'A文本000');
 const b=await s.route('?material=text&sort=name&search=A文本&limit=7&cursor='+a.body.value.nextCursor);assert.equal(b.body.value.items[0].title,'A文本007');assert.equal(b.body.value.totalApprox,60);
 }finally{await s.cleanup();}
});
test('R5 SQLite: usage ordering reads existing memberships and survives reopen',async()=>{
 const s=await setup();try{
  for (const workspace of s.graph.workspaces.slice(0,2)) {
    s.repo().addWorkspaceMembers(workspace.id,['view-042' as never],'user','2026-09-30T01:00:00Z');
  }
  const result=s.service().query(s.projectId,{kinds:['artifact'],sort:'usage'});assert.equal(result.items[0]!.entityRef.id,'art-042');assert.equal(result.items[0]!.usageCount,2);
  s.reopen();assert.equal(s.service().query(s.projectId,{kinds:['artifact'],sort:'usage'}).items[0]!.entityRef.id,'art-042');
 }finally{await s.cleanup();}
});
test('R5 SQLite: selected view revision, MIME and exact reference remain aligned',async()=>{
 const s=await setup();try{
  const graph=s.repo().get(s.projectId)!;
  const target=graph.artifacts.find(a=>String(a.id)==='art-000')!;
  const previous=s.repo().getArtifactRevision('rev-000')!;
  s.repo().commitManagedTextRevision({artifact:target,previousRevision:previous,
    newFileRecord:{...graph.fileRecords[0]!,id:'file-new' as never,mimeType:'image/png'},
    newRevision:{...previous,id:'rev-new' as never,fileRecordId:'file-new' as never,source:'external',status:'current'}});
  const current=s.repo().get(s.projectId)!;
  s.repo().save({...current,artifactViews:[
    {...current.artifactViews[0]!,id:'z-view-new',artifactId:target.id,revisionId:'rev-new'},
    ...current.artifactViews.map(v=>String(v.id)==='view-000'?{...v,revisionId:'rev-000'}:v)]} as never);
  const item=s.service().query(s.projectId,{search:'A文本000'}).items[0]!;assert.equal(item.entityRef.viewId,'z-view-new');assert.equal(item.presentedRevisionId,'rev-new');assert.equal(item.mimeType,'image/png');
  // Only historical view remains: its bytes/MIME, not new Current, must be shown.
  const latest=s.repo().get(s.projectId)!;
  s.repo().save({...latest,artifactViews:latest.artifactViews.filter(v=>String(v.id)!=='z-view-new')} as never);
  const historical=s.service().query(s.projectId,{search:'A文本000'}).items[0]!;assert.equal(historical.entityRef.viewId,'view-000');assert.equal(historical.presentedRevisionId,'rev-000');assert.equal(historical.mimeType,'text/markdown');
 }finally{await s.cleanup();}
});
test('R5 HTTP route refuses unsupported filter/order rather than claiming a different query',async()=>{
 const s=await setup();try{assert.equal((await s.route('?material=fake')).code,400);assert.equal((await s.route('?sort=guessed-ai-score')).code,400);assert.equal((await s.route('?material=all&sort=updated')).code,200);}finally{await s.cleanup();}
});
test('R5 HTTP route refuses a foreign project body before invoking canonical mutation',async()=>{
 const s=await setup();try{let calls=0;const result=await s.route('',{method:'POST',body:{schemaVersion:1,projectId:'other',sourceRefs:[],targetRef:{kind:'main'}},apply:{apply:async()=>{calls++;}}});assert.equal(result.code,400);assert.equal(calls,0);}finally{await s.cleanup();}
});
