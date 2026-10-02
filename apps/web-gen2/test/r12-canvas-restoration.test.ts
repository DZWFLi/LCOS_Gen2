import assert from 'node:assert/strict';
import { test } from 'node:test';
import { markReferencePickCompleted, clearReferenceTrailingClick, handleReferenceClickSuppression } from '../../../huabu/apps/web/src/lcos/referenceClickSuppressor.ts';
import { selectionVisibleBounds, planSelectionLayout } from '../../../huabu/apps/web/src/lcos/navigation/selectionLayout.ts';
import { collectionHostMemberIds, toggleCollectionHost } from '../../../huabu/apps/web/src/lcos/nodes/collectionHost.ts';
import { createCollectionDragCompanions, withCollectionGeometryCompanions } from '../../../huabu/apps/web/src/lcos/nodes/collectionDragCompanions.ts';
import { canvasDragHandlers } from '../../../huabu/apps/web/src/lcos-seam/nodeDragPolicy.ts';
import { readCollapsedFrames, writeCollapsedFrames } from '../../../huabu/apps/web/src/store/canvasCollapsedFrames.ts';
import { buildComposerRunInput } from '../../../huabu/apps/web/src/lcos/composer/composerSubmission.ts';
import { CoreCollectionClient } from '../src/backend/collections.ts';
import { HttpClient } from '../src/backend/client.ts';
const node=(id:string,x=0,y=0,more:any={})=>({id,type:'image',position:{x,y},width:100,height:70,data:{},...more});
const click=(id:string,shiftKey=false)=>({target:{closest:()=>({dataset:{id}})},shiftKey,preventDefault(){},stopPropagation(){}} as any);
test('R12 reference: consumes only the exact trailing click once',()=>{
 markReferencePickCompleted('a');assert.equal(handleReferenceClickSuppression(click('b')),false);assert.equal(handleReferenceClickSuppression(click('a')),true);assert.equal(handleReferenceClickSuppression(click('a')),false);
});
test('R12 reference: a fresh pointer press clears even same-node suppression',()=>{markReferencePickCompleted('a');clearReferenceTrailingClick();assert.equal(handleReferenceClickSuppression(click('a')),false)});
test('R12 reference: Shift selection never becomes reference click suppression',()=>{markReferencePickCompleted('a');assert.equal(handleReferenceClickSuppression(click('a',true)),false);assert.equal(handleReferenceClickSuppression(click('a')),false)});
test('R12 reference: menu/editor clicks outside a node remain live',()=>{markReferencePickCompleted('a');assert.equal(handleReferenceClickSuppression({...click('a'),target:{closest:()=>null}}),false);clearReferenceTrailingClick()});
// R14 retires the equal-max-cell geometry: donor packing includes the real
// visible margins (7px on either image edge) and fills the available row.
test('R14 replaces R12 max-cell grid: scattered images keep visible 30px horizontal gaps',()=>{
 const ns=[node('a',20,15),node('b',700,100),node('c',90,500)], before=JSON.stringify(ns);
 const r=planSelectionLayout(ns,['a','b','c'],'tidy');
 assert.equal(r.length,2); assert.deepEqual(r.find(x=>x.nodeId==='b')?.position,{x:164,y:15});
 assert.deepEqual(r.find(x=>x.nodeId==='c')?.position,{x:20,y:136}); assert.equal(JSON.stringify(ns),before);
});
test('R14 donor packing uses heterogeneous widths without reserving the widest cell for every image',()=>{
 const r=planSelectionLayout([node('a',0,0,{measured:{width:320,height:250}}),node('b',500,99),node('c',10,500)],['a','b','c'],'tidy');
 const b=r.find(x=>x.nodeId==='b')!.position!,c=r.find(x=>x.nodeId==='c')!.position!;
 assert.equal(b.x,364); assert.equal(c.x-b.x,144); assert.equal(c.y,0);
});
test('R12 layout: unselected and locked objects are not moved',()=>{const r=planSelectionLayout([node('a'),node('b',700,99,{data:{locked:true}}),node('c',10,500),node('unselected',9,9)],['a','b','c'],'tidy');assert(!r.some(x=>x.nodeId==='b'||x.nodeId==='unselected'))});
test('R12 layout: parent+child selection cannot independently move both',()=>{const ns=[node('parent',100,200,{type:'frame'}),node('child',10,20,{parentId:'parent'}),node('other',800,500)];assert.deepEqual(selectionVisibleBounds(ns,['parent','child','other']).map(x=>x.node.id),['parent','other']);assert(!planSelectionLayout(ns,['parent','child','other'],'tidy').some(x=>x.nodeId==='child'))});
test('R12 layout: children retain relative coordinates after world-space planning',()=>{const ns=[node('parent',500,600,{type:'frame'}),node('a',10,10,{parentId:'parent'}),node('b',800,900)];const r=planSelectionLayout(ns,['a','b'],'tidy');assert.deepEqual(r.find(x=>x.nodeId==='b')?.position,{x:654,y:610})});
test('R12 layout: distribution is explicit and nonnegative for packed objects',()=>{const ns=[node('a',0),node('b',50),node('c',100)];const r=planSelectionLayout(ns,['a','b','c'],'distribute-x');assert.deepEqual(r.map(x=>x.position?.x),[118,236]);assert.deepEqual(planSelectionLayout(ns,['a','b'],'distribute-x'),[])});
test('R12 collection: membership does not steal another physical host',()=>{const ns=[node('owner'),node('free'),node('hosted',10,10,{parentId:'elsewhere'}),node('locked',0,0,{data:{locked:true}})];assert.deepEqual(collectionHostMemberIds(ns,['free','hosted','locked'],'owner'),['free'])});
test('R12 collection: a nested collection carries its existing host only once',()=>{const ns=[node('nested'),node('host',0,0,{type:'frame',data:{lcosCollectionNodeId:'nested'}})];assert.deepEqual(collectionHostMemberIds(ns,['nested','host'],'owner'),['nested','host'])});
test('R12 collection: reopen toggles the same host with no layout/membership write',()=>{let toggles=0,creates=0;const nodes=[node('owner'),node('host',100,0,{type:'frame',data:{lcosCollectionId:'c'}})];const state={nodes,collapsedFrameIds:new Set(['host']),frameSelectedNodes(){creates++},toggleFrameCollapse(){toggles++}};assert(toggleCollectionHost(()=>state,'c','owner','测试',['new-member']));assert.equal(toggles,1);assert.equal(creates,0);assert.equal(nodes[1]!.position.x,100)});
test('R12 collection: an empty valid collection can still open in place',()=>{let calls:any[]=[];const state={nodes:[node('owner',50,80)],collapsedFrameIds:new Set<string>(),frameSelectedNodes(o:any){calls.push(o);state.nodes.push(node('host',0,0,{type:'frame',data:{lcosCollectionId:'c'}}))},toggleFrameCollapse(){}};assert(toggleCollectionHost(()=>state,'c','owner','空集合',[]));assert.deepEqual(calls[0].nodeIds,[]);assert.deepEqual(calls[0].emptyBounds,{x:342,y:80,width:320,height:220})});
test('R12 collection: no owner means no empty host invented',()=>{let calls=0;assert.equal(toggleCollectionHost(()=>({nodes:[],collapsedFrameIds:new Set(),frameSelectedNodes(){calls++},toggleFrameCollapse(){}}),'c','missing','x',[]),false);assert.equal(calls,0)});
test('R12 collection motion: moving the folder also moves its existing frame with the same delta',()=>{
 let ns=[node('folder',100,100),node('frame',200,100,{type:'frame',data:{lcosCollectionNodeId:'folder'}}),node('child',10,10,{parentId:'frame'})];const p=createCollectionDragCompanions(()=>ns);assert.deepEqual(p.companionNodes([ns[0]!]).map(n=>n.id),['frame']);p.onStart([ns[0]!]);const changes=p.filterChanges([{type:'position',id:'folder',position:{x:150,y:120},dragging:true}]);assert.deepEqual(changes[1],{type:'position',id:'frame',position:{x:250,y:120},dragging:true});assert(!changes.some(c=>'id'in c&&c.id==='child'));
 ns=ns.map(n=>{const c=changes.find(c=>'id'in c&&c.id===n.id);return c?.type==='position'?{...n,position:c.position!}:n});assert.deepEqual(p.externallyChanged(),[]);
});
test('R12 collection motion: another edit wins over a stale folder gesture',()=>{let ns=[node('f'),node('h',200,0,{type:'frame',data:{lcosCollectionNodeId:'f'}})];const p=createCollectionDragCompanions(()=>ns);p.onStart([ns[0]!]);ns[1]={...ns[1]!,position:{x:500,y:0}};assert.deepEqual(p.filterChanges([{type:'position',id:'f',position:{x:10,y:0},dragging:true}]),[]);assert.deepEqual(p.externallyChanged(),['h'])});
test('R12 collection motion: companion already in drag group is not duplicated',()=>{const ns=[node('f'),node('h',0,0,{type:'frame',data:{lcosCollectionNodeId:'f'}})];const p=createCollectionDragCompanions(()=>ns);assert.deepEqual(p.companionNodes(ns),[])});
test('R12 native seam: companions join native save/cancel but not semantic payloads',()=>{const body=node('b'),host=node('h'),seen:any[]=[];const handler=canvasDragHandlers({onNodeDragStart:(_e,_n,ns)=>seen.push(['native',ns.map(n=>n.id)]),onNodeDrag(){},onNodeDragStop(){},onNodesChange(){}},{companionNodes:()=>[host],onStart:(_e,_n,ns)=>seen.push(['semantic',ns.map(n=>n.id)]),onMove:()=>false,onStop:()=>false,filterChanges:c=>c});handler.onNodeDragStart({}as any,body,[body]);assert.deepEqual(seen,[['native',['b','h']],['semantic',['b']]])});
const memory=()=>{const map=new Map<string,string>();return {getItem:(k:string)=>map.get(k)??null,setItem:(k:string,v:string)=>map.set(k,v),map}};
test('R12 fold: restore only live frames for that canvas, not removed nodes',()=>{const storage=memory();writeCollapsedFrames('c1',new Set(['f','gone','image']),storage);assert.deepEqual([...readCollapsedFrames('c1',[node('f',0,0,{type:'frame'}),node('image')],storage)],['f']);assert.equal(readCollapsedFrames('c2',[node('f',0,0,{type:'frame'})],storage).size,0)});
test('R12 fold: disabled or corrupt local storage cannot crash the canvas',()=>{const storage={getItem(){throw Error('disabled')},setItem(){throw Error('disabled')}};assert.equal(readCollapsedFrames('c',[],storage).size,0);assert.doesNotThrow(()=>writeCollapsedFrames('c',new Set(['f']),storage))});
test('R12 AI Work: selected targets and extra refs are separate UI sets but both reach exact Run input',()=>{
 const r=buildComposerRunInput({projectId:'p',workspaceId:'w',instruction:'compare',target:{nodeId:'a',title:'2 items',anchor:{x:0,y:0,width:100,height:100},intent:'delegate',targetNodeIds:['a','b'],targetReferences:[{entityType:'artifact',entityId:'a',revisionId:'old'},{entityType:'artifact',entityId:'b',revisionId:'b1'}]},refs:[{entityType:'artifact',entityId:'a',revisionId:'old'},{entityType:'artifact',entityId:'extra',revisionId:'e1'}]});
 assert.deepEqual(r.contextArtifactIds,['a','b','extra']);assert.equal(r.orderedReferences?.length,3);assert.equal((r.orderedReferences![0]!.ref as any).revisionId,'old');
});
test('R12 AI Work: unsupported targets cannot be silently omitted at submit',()=>{
 assert.throws(()=>buildComposerRunInput({projectId:'p',workspaceId:'w',instruction:'go',target:{nodeId:'a',title:'x',anchor:{x:0,y:0,width:1,height:1},targetReferences:[{entityType:'unsupported',entityId:'x'}]},refs:[]}),/暂不能用于本次输入/);
});
for (const [label,meta,project] of [['missing members',{},'p'],['different project',{members:[{type:'artifact',id:'a'}]},'q'],['contradictory count',{members:[]},'p'],['different member',{members:[{type:'artifact',id:'b'}]},'p']] as const) test(`R12 collect: ${label} acknowledgement cannot hide source nodes`,async()=>{
 let requests=0;const client=new CoreCollectionClient(new HttpClient({baseUrl:'http://local',fetch:async()=>{requests++;return new Response(JSON.stringify({ok:true,value:{id:'c',projectId:project},meta}),{status:201})}}));await assert.rejects(()=>client.createFromMembers('p','集合',[{type:'artifact',id:'a'}]),/未完整确认/);assert.equal(requests,1);
});
test('R12 collect: duplicate selection identities are accepted exactly once',async()=>{
 const members=[{type:'artifact' as const,id:'a'}];const client=new CoreCollectionClient(new HttpClient({baseUrl:'http://local',fetch:async()=>new Response(JSON.stringify({ok:true,value:{id:'c',projectId:'p'},meta:{changeSetId:'cs',members}}),{status:201})}));assert.equal((await client.createFromMembers('p','集合',[...members,...members])).changeSetId,'cs');
});

test('R12 explicit layout carries folder host without moving local children twice',()=>{
 const ns=[node('f',100,100),node('h',200,100,{type:'frame',data:{lcosCollectionNodeId:'f'}}),node('child',10,10,{parentId:'h'})];
 const result=withCollectionGeometryCompanions(ns,[{nodeId:'f' as any,position:{x:350,y:200}}]);
 assert.deepEqual(result,[{nodeId:'f',position:{x:350,y:200}},{nodeId:'h',position:{x:450,y:200}}]);
 assert.equal(result.some(item=>item.nodeId==='child'),false);
});
test('R12 explicit layout respects a locked companion instead of detaching folder from it',()=>{
 const ns=[node('f'),node('h',200,0,{type:'frame',data:{lcosCollectionNodeId:'f',locked:true}})];
 assert.deepEqual(withCollectionGeometryCompanions(ns,[{nodeId:'f' as any,position:{x:20,y:30}}]),[]);
});
test('R12 explicit layout never appends an already moved host twice',()=>{
 const ns=[node('f'),node('h',200,0,{type:'frame',data:{lcosCollectionNodeId:'f'}})];
 const items=[{nodeId:'f' as any,position:{x:30,y:30}},{nodeId:'h' as any,position:{x:230,y:30}}];
 assert.deepEqual(withCollectionGeometryCompanions(ns,items),items);
});
