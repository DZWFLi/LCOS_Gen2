import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { railwayStableKeyV1, type RailwaySnapshotV1, type RailwayStoredRefV1 } from '@local-creative-os/contracts';
import type * as WebGen2 from '@local-creative-os/web-gen2';
import { LcosRailway } from './LcosRailway';
import { resolveDropIntent } from '../drop/dropIntentResolver';
import { useLcosDropStore } from '../lcosDropState';
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const m=vi.hoisted(()=>({read:vi.fn(),write:vi.fn(),watch:vi.fn(),stop:vi.fn(),list:vi.fn(),binding:vi.fn(),invalidate:undefined as (()=>void)|undefined,
 session:undefined as undefined|{status:string;projection:{userState:string}}}));
vi.mock('@local-creative-os/web-gen2',async(original)=>({...await original<typeof WebGen2>(),
 CoreRailwayClient:class{snapshot=m.read;save=m.write;},CoreConversationClient:class{listConnectedConversations=m.list;getReceiverBinding=m.binding;}}));
vi.mock('../app/lcosCoreClient',()=>({createLcosCoreSession:()=>({http:{}})}));
vi.mock('../collaboration/collaborationSessionStore',()=>({useCollaborationSessionStore:(select:(s:unknown)=>unknown)=>select({watchProjectChanges:m.watch})}));
vi.mock('../collaboration/useCollaborationSession',()=>({useCollaborationSession:()=>m.session}));
vi.mock('../composer/LcosReceiverIdentity',()=>({LcosReceiverIdentity:({conversationId}:{conversationId:string})=><span data-test-glyth-avatar={conversationId}/> }));
vi.mock('../navigation/RailwayPeek',()=>({RailwayPeek:()=><div>预览测试端口</div>}));
const roots:ReturnType<typeof createRoot>[]=[];
beforeEach(()=>{m.session=undefined;m.list.mockResolvedValue([]);m.binding.mockResolvedValue({activeReceiverId:null});m.watch.mockImplementation((_project,listener)=>{m.invalidate=listener;return m.stop;});});
afterEach(()=>{for(const root of roots.splice(0))act(()=>root.unmount());document.body.replaceChildren();useLcosDropStore.getState().reset();vi.resetAllMocks();});
function canonicalRead(count:number){
 let order={schemaVersion:1 as const,projectId:'p',version:7,updatedAt:'',orderedRefs:Array.from({length:count},(_,i)=>({kind:'worksite' as const,projectId:'p',worksiteId:String(i)})) as RailwayStoredRefV1[]};
 const snapshot=():RailwaySnapshotV1=>({schemaVersion:1,projectId:'p',order,candidates:[],migrationRequired:false,destinations:order.orderedRefs.map(ref=>({key:railwayStableKeyV1(ref),ref,role:'worksite',available:true,label:`现场${ref.kind==='worksite'?ref.worksiteId:''}`,workspaceId:ref.kind==='worksite'?ref.worksiteId:'',canvasId:`c${ref.kind==='worksite'?ref.worksiteId:''}`,surface:'main',accepts:['artifactView','note']}))});
 m.read.mockImplementation(async()=>snapshot());m.write.mockImplementation(async(_pid,refs:RailwayStoredRefV1[],version:number)=>{expect(version).toBe(order.version);order={...order,orderedRefs:refs,version:version+1};return snapshot();});return order;
}
async function mount(){const host=document.createElement('div');document.body.append(host);const root=createRoot(host);roots.push(root);await act(async()=>root.render(<LcosRailway projectId="p" surfaceByWorkspace={new Map()} activateDestination={()=>{}}/>));return host;}
const button=(label:string)=>document.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)!;
it('management Up/Down uses the current canonical snapshot version',async()=>{const order=canonicalRead(2);await mount();await act(async()=>button('管理现场目的地').click());expect(button('上移 现场0').disabled).toBe(true);await act(async()=>button('下移 现场0').click());expect(m.write).toHaveBeenCalledExactlyOnceWith('p',[order.orderedRefs[1],order.orderedRefs[0]],7);expect([...document.querySelectorAll('[data-lcos-railway-item]')].map(el=>el.getAttribute('aria-label'))).toEqual(['现场1','现场0']);});
it('Rail grows with available height instead of freezing to four items',async()=>{canonicalRead(5);await mount();expect([...document.querySelectorAll('[data-lcos-railway-item]')].map(el=>el.getAttribute('aria-label'))).toEqual(['现场0','现场1','现场2','现场3','现场4']);expect(document.querySelector('[data-lcos-railway-overflow-trigger]')).toBeNull();});
it('overflow management still edits canonical order when safe height is small',async()=>{const previous=window.innerHeight;Object.defineProperty(window,'innerHeight',{value:260,configurable:true});try{const order=canonicalRead(5);await mount();const trigger=document.querySelector<HTMLButtonElement>('[data-lcos-railway-overflow-trigger]')!;expect(trigger).not.toBeNull();await act(async()=>trigger.click());expect(button('下移 现场4').disabled).toBe(true);await act(async()=>button('上移 现场4').click());expect(m.write).toHaveBeenCalledWith('p',[...order.orderedRefs.slice(0,3),order.orderedRefs[4],order.orderedRefs[3]],7);}finally{Object.defineProperty(window,'innerHeight',{value:previous,configurable:true});}});
it('project invalidation refreshes destinations and active receiver without remounting',async()=>{canonicalRead(1);await mount();m.read.mockClear();m.binding.mockClear();await act(async()=>m.invalidate!());expect(m.read).toHaveBeenCalledTimes(1);expect(m.binding).toHaveBeenCalledTimes(1);expect(m.watch).toHaveBeenCalledTimes(1);expect(button('现场0')).not.toBeNull();});
it('active receiver preserves shared identity/state and rejects material receive',async()=>{canonicalRead(0);m.binding.mockResolvedValue({activeReceiverId:'conversation'});m.list.mockResolvedValue([{id:'conversation',label:'创意伙伴'}]);m.session={status:'ready',projection:{userState:'needs_user'}};await mount();expect(document.querySelector('[data-test-glyth-avatar="conversation"]')).not.toBeNull();expect(document.querySelector('[data-lcos-railway-receiver]')?.getAttribute('aria-label')).toContain('等你回应');const target=useLcosDropStore.getState().targets().find(t=>t.targetId==='railway-control:p:receiver');expect(target?.semantic.kind).toBe('drop-exclusion');expect(resolveDropIntent({kind:'object',entityType:'note',entityId:'n'},target!).status).toBe('ineligible');});
it('new project removes previous destinations/receiver before its slow read returns',async()=>{canonicalRead(1);m.binding.mockResolvedValue({activeReceiverId:'old'});m.list.mockResolvedValue([{id:'old',label:'上个项目伙伴'}]);await mount();expect(button('现场0')).not.toBeNull();m.read.mockImplementation(()=>new Promise(()=>{}));m.list.mockImplementation(()=>new Promise(()=>{}));m.binding.mockImplementation(()=>new Promise(()=>{}));await act(async()=>roots.at(-1)!.render(<LcosRailway projectId="next" surfaceByWorkspace={new Map()} activateDestination={()=>{}}/>));expect(document.querySelector('[data-lcos-railway-item]')).toBeNull();expect(document.querySelector('[data-lcos-railway-receiver]')).toBeNull();});
