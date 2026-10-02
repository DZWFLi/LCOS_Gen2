import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeCollaborationSendReceipt } from '../src/backend/collaborationSendReceipt';
import { CoreCollaborationClient } from '../src/backend/collaboration';
import { HttpClient } from '../src/backend/client';
import { unavailableCollaborationCapabilitiesV1, type CollaborationSessionProjectionV1, type CollaborationSendInputV1, type ContinuationRecoveryProjectionV1 } from '@local-creative-os/contracts';
import { captureConversationSend, conversationSendWasRecorded, hasUnconfirmedConversationMessage, sameConversationSend, conversationSendKey, isComposerSendShortcut } from '../../../huabu/apps/web/src/lcos/composer/conversationSendAttempt';
import { buildSelectedContextReferences } from '../../../huabu/apps/web/src/lcos/professional/conversationContinuationActions';
import { recoverConversationOperation, cancelConversationRun } from '../../../huabu/apps/web/src/lcos/collaboration/conversationCommands';
import { glythSessionLabel, glythDropFeedback, mayOpenGlythFromKeyboard } from '../../../huabu/apps/web/src/lcos/collaboration/glythInteraction';
import { SessionRefreshQueue } from '../../../huabu/apps/web/src/lcos/collaboration/sessionRefreshQueue';
import { buildLcosNodeCommands } from '../src/interaction/nodeCommandModel';
import type { LcosDropFeedback } from '../../../huabu/apps/web/src/lcos/lcosDropState';

const input: CollaborationSendInputV1 = { conversationId: 'c', continuationOperationId: 'op', messageId: 'message', text: '保留原消息',
  orderedReferences: [{ order: 0, ref: { type: 'view', viewId: 'historical' } }] };
const accepted = { schemaVersion: 1, command: 'send', acceptedAt: '2026-09-30T01:00:00Z', conversationId: 'c', continuationOperationId: 'op' };
for (const [label, value] of Object.entries({ raw: accepted, receipt: { receipt: accepted }, product: { ok: true, receipt: accepted } })) {
  test(`R3 send accepts documented ${label} identity-bound receipt`, () => assert.equal(normalizeCollaborationSendReceipt(value, input).ok, true));
}
for (const [label, value] of Object.entries({ empty: {}, missing: undefined, array: [], wrongConversation: { ...accepted, conversationId: 'other' },
  wrongOperation: { ...accepted, continuationOperationId: 'other' }, wrongCommand: { ...accepted, command: 'delegate' }, wrongTime: { ...accepted, acceptedAt: 'unknown' },
  missingTime: { ...accepted, acceptedAt: undefined }, wrongSchema: { ...accepted, schemaVersion: 2 }, rejected: { ...accepted, ok: false } })) {
  test(`R3 HTTP-success ${label} cannot clear a draft`, () => { const result = normalizeCollaborationSendReceipt(value, input); assert.equal(result.ok, false); if (!result.ok) assert.equal(result.error.code, 'operation_unknown'); });
}
for (const code of ['operation_unknown','needs_recovery','input_required','cancelled'] as const) test(`R3 preserve product error ${code}`, () => {
  const result = normalizeCollaborationSendReceipt({ ok:false,error:{code,userMessage:'请处理原消息',retryable:false} },input);
  assert(!result.ok); assert.equal(result.error.code,code);assert.equal(result.error.retryable,false);
});
test('R3 live client does not fall back to Run or report success for empty send response', async () => {
  const calls: string[]=[]; const client = new CoreCollaborationClient(new HttpClient({ baseUrl:'http://test', fetch:async(url)=> { calls.push(String(url));return new Response(JSON.stringify({ok:true,value:{}}),{status:200}); } }));
  assert.equal((await client.send('p',input)).ok,false);assert.equal(calls.length,1);assert(calls[0]!.endsWith('/collaboration-send'));
});
test('R3 lost POST response is unknown rather than an offline/not-sent claim', async () => {
  const client = new CoreCollaborationClient(new HttpClient({baseUrl:'http://test',fetch:async()=>{throw new TypeError('network lost');}}));
  const result=await client.send('p',input);assert(!result.ok);assert.equal(result.error.code,'operation_unknown');
});
test('R3 retained send snapshot cannot change when draft text or references are edited', () => {
  const draft=structuredClone(input);const attempt=captureConversationSend('p',draft);(draft as {text:string}).text='新草稿';
  (draft.orderedReferences![0]!.ref as {viewId:string}).viewId='new';assert.equal(attempt.input.text,'保留原消息');assert.equal((attempt.input.orderedReferences![0]!.ref as {viewId:string}).viewId,'historical');assert(!sameConversationSend(attempt.input,draft));
});
test('R3 exact same-message retry matches, changed target/op/order/text do not', () => {
  assert(sameConversationSend(input,structuredClone(input)));
  for(const patch of [{conversationId:'b'},{continuationOperationId:'b'},{messageId:'b'},{text:'b'},{orderedReferences:[]},{targetRefs:['b']}]) assert(!sameConversationSend(input,{...input,...patch}));
});
test('R3 same conversation id in two projects cannot share pending-send memory', () => assert.notEqual(conversationSendKey('a:b','c'),conversationSendKey('a','b:c')));
test('R3 precise historical artifactView maps to typed view and never upgrades to current', () => {
  const refs=buildSelectedContextReferences([{entityType:'artifactView',entityId:'historical'},{entityType:'view',entityId:'v2'}]);
  assert.deepEqual(refs,{orderedReferences:[{order:0,ref:{type:'view',viewId:'historical'}},{order:1,ref:{type:'view',viewId:'v2'}}],unsupportedEntityTypes:[]});
});
test('R3 artifact snapshot with explicit view identity preserves it', () => {
  const refs=[{entityType:'artifact',entityId:'a',artifactViewId:'historical'}];assert.deepEqual(buildSelectedContextReferences(refs).orderedReferences,[{order:0,ref:{type:'view',viewId:'historical'}}]);
});
test('R3 unsupported reference is reported, never silently removed then sent', () => assert.deepEqual(buildSelectedContextReferences([{entityType:'unknown',entityId:'u'}]).unsupportedEntityTypes,['unknown']));
for(const patch of [{isComposing:true},{keyCode:229},{repeat:true},{key:'Escape'},{ctrlKey:false}]) test(`R3 IME/shortcut protection ${JSON.stringify(patch)}`,()=>assert.equal(isComposerSendShortcut({key:'Enter',ctrlKey:true,metaKey:false,...patch}),false));
test('R3 intentional Ctrl/Cmd Enter remains functional',()=>{assert(isComposerSendShortcut({key:'Enter',ctrlKey:true,metaKey:false}));assert(isComposerSendShortcut({key:'Enter',ctrlKey:false,metaKey:true}));});
for(const event of [{key:' ' ,repeat:false},{key:'Enter',repeat:true},{key:'Enter',repeat:false,isComposing:true}]) test(`R3 Glyth keyboard does not steal pan/repeat/IME ${JSON.stringify(event)}`,()=>assert.equal(mayOpenGlythFromKeyboard(event),false));
test('R3 Glyth Enter opens the same workview',()=>assert(mayOpenGlythFromKeyboard({key:'Enter',repeat:false})));
function session(patch: Partial<CollaborationSessionProjectionV1>={}):CollaborationSessionProjectionV1 {
 return {schemaVersion:1,projectId:'p',conversationId:'c',identity:{title:'真实会话'},userState:'ready',relation:{targetRefs:[]},activity:{},
  ...unavailableCollaborationCapabilitiesV1('尚未确认'),recentReturns:[],...patch};
}
for(const state of ['ready','thinking','working','needs_user','done','unavailable'] as const) test(`R3 ${state} has a real human-facing state`,()=>{assert(glythSessionLabel(session({userState:state})).length>0);});
test('R3 input/review/recovery states come from explicit identities, not a guessed run',()=>{
 assert.equal(glythSessionLabel(session({activity:{pendingInputId:'q'}})),'等你回答');
 assert.equal(glythSessionLabel(session({recentReturns:[{returnId:'r',title:'候选',status:'pending_review',returnedAt:'now'}]})),'需要复核');
 assert.equal(glythSessionLabel(session({recovery:{state:'recovering'}})),'正在恢复');
 assert.equal(glythSessionLabel(undefined,'error'),'状态读取失败');
});
test('R3 only successful durable context receipt reacts on matching Glyth',()=>{
 const feedback={originalIntent:{status:'ready',intent:{kind:'assembly-apply',targetId:'glyth',targetRef:{kind:'conversation',id:'c'},sourceRefs:[]}},receipt:{status:'success',transactionId:'tx',targetId:'glyth',message:'已保存'}} as unknown as LcosDropFeedback;
 assert.equal(glythDropFeedback('c',feedback)?.reaction?.id,'tx');assert.equal(glythDropFeedback('other',feedback),undefined);
 assert.equal(glythDropFeedback('c',{...feedback,receipt:{...feedback.receipt,status:'partial'}})?.reaction,undefined);
 assert.equal(glythDropFeedback('c',{...feedback,receipt:{...feedback.receipt,status:'failed'}})?.reaction,undefined);
});
test('R3 Arc exposes progress/stop only with an actual active run and capability',()=>{
 const c=session({userState:'working',activity:{activeRunId:'r'},capabilities:{...session().capabilities,canCancel:true}});
 const commands=buildLcosNodeCommands({nodeType:'note',entityType:'conversation',entityId:'c',capabilities:[],referenced:false,conversation:c});
 assert.equal(commands[0]!.id,'view-progress');assert(commands.some(c=>c.id==='cancel-work'));assert(!commands.some(c=>c.id==='convert-text'));
});
test('R3 Arc recovery and diagnostics use existing WorkView, no invented send',()=>{
 const c=session({userState:'unavailable',recovery:{state:'recoverable'},capabilities:{...session().capabilities,canRecover:true}});
 const commands=buildLcosNodeCommands({nodeType:'note',entityType:'conversation',entityId:'c',capabilities:[],referenced:false,conversation:c});
 assert.equal(commands[0]!.id,'recover-session');assert(!commands.some(c=>c.id==='compose'));assert(commands.some(c=>c.id==='session-diagnostics'));
});
const op={projectId:'p',operationId:'op',connectedConversationId:'c',revision:1,allowedActions:[{action:'reconcile',requiresFreshRead:true}]} as unknown as ContinuationRecoveryProjectionV1;
test('R3 recovery reads fresh same operation then passes current revision, no new session',async()=>{
 const calls:unknown[]=[];
 await recoverConversationOperation({readDiagnostics:async()=>({schemaVersion:1,conversationId:'c',connected:true,operations:[{...op,revision:8}]}),recover:async(p,input)=>{calls.push([p,input]);return{ok:true,receipt:{schemaVersion:1,command:'recover',continuationOperationId:'op',acceptedAt:'now'}};}},'p',op,'reconcile');
 assert.deepEqual(calls,[['p',{continuationOperationId:'op',action:'reconcile',expectedRevision:8}]]);
});
for(const what of ['wrongConversation','wrongOperation','wrongProject','withdrawnAction','aborted'] as const) test(`R3 recovery refuses ${what} without mutation`,async()=>{
 let calls=0;const controller=new AbortController();if(what==='aborted')controller.abort();
 const fresh=what==='wrongProject'?{...op,projectId:'other'}:what==='wrongOperation'?{...op,operationId:'other'}:what==='withdrawnAction'?{...op,allowedActions:[]}:op;
 await assert.rejects(()=>recoverConversationOperation({readDiagnostics:async()=>({schemaVersion:1,conversationId:what==='wrongConversation'?'other':'c',connected:true,operations:[fresh]}),recover:async()=>{calls++;throw new Error('should not mutate');}},'p',op,'reconcile',controller.signal));assert.equal(calls,0);
});
test('R3 stop rechecks current run and passes exact id',async()=>{
 let called='';await cancelConversationRun({readSession:async()=>session({activity:{activeRunId:'r'},capabilities:{...session().capabilities,canCancel:true}}),cancel:async(p,input)=>{called=`${p}:${input.runId}`;return{ok:true,receipt:{schemaVersion:1,command:'cancel',runId:'r',acceptedAt:'now'}};}},'p','c','r');assert.equal(called,'p:r');
});
for(const what of ['wrongRun','wrongProject','wrongConversation','withdrawn']) test(`R3 stop ${what} never cancels a different task`,async()=>{
 let calls=0; const s=session({projectId:what==='wrongProject'?'other':'p',conversationId:what==='wrongConversation'?'other':'c',activity:{activeRunId:what==='wrongRun'?'other':'r'},capabilities:{...session().capabilities,canCancel:what!=='withdrawn'}});
 await assert.rejects(()=>cancelConversationRun({readSession:async()=>s,cancel:async()=>{calls++;throw Error('forbidden');}},'p','c','r'));assert.equal(calls,0);
});
const tick=()=>new Promise<void>(r=>setTimeout(r,0));
test('R3 overlapping SSE invalidations serialize, keep live progress and refresh once',async()=>{
 const queue=new SessionRefreshQueue();const pending:((n:number)=>void)[]=[];const outputs:number[]=[];let calls=0;
 const read=async()=>{calls++;return new Promise<number>(r=>pending.push(r));};const publish=(n:number)=>outputs.push(n);
 const first=queue.refresh('k',read,publish,()=>assert.fail('read failed'));
 queue.refresh('k',read,publish,()=>{});queue.refresh('k',read,publish,()=>{});
 assert.equal(calls,1);pending[0]!(1);await tick();assert.deepEqual(outputs,[1]);assert.equal(calls,2);pending[1]!(2);await first;assert.deepEqual(outputs,[1,2]);
});
test('R3 release aborts in-flight session and does not overwrite a remount',async()=>{
 const queue=new SessionRefreshQueue();let done!:(n:number)=>void;let oldSignal!:AbortSignal;const outputs:number[]=[];
 const first=queue.refresh('k',signal=>{oldSignal=signal;return new Promise<number>(r=>done=r);},n=>outputs.push(n),()=>{});
 queue.release('k');assert(oldSignal.aborted);
 await queue.refresh('k',async()=>2,n=>outputs.push(n),()=>{});done(1);await first;assert.deepEqual(outputs,[2]);
});
test('R3 failed latest read remains an error, not an empty successful session',async()=>{
 const queue=new SessionRefreshQueue();let errors=0;await queue.refresh('k',async()=>{throw Error('offline');},()=>assert.fail('no successful projection'),()=>errors++);assert.equal(errors,1);
});

function messageDiagnostics(outcome: 'sent' | 'unresolved' | 'attached', change: Record<string, unknown> = {}) {
  const receipt = { schemaVersion: 1, operationId: 'op', action: outcome === 'attached' ? 'attach_context' : 'send', outcome,
    error: outcome === 'unresolved' ? { outcomeUnknown: true } : undefined };
  return { schemaVersion:1,conversationId:'c',connected:true,operations:[{...op,projectId:'p',promptReceipts:[{
    messageId:'message',explicitReferences:input.orderedReferences,orderedReferences:input.orderedReferences,receipt,
    ...(outcome==='attached'?{attachReceipt:receipt}:{sendReceipt:receipt}),...change,
  }]}]} as unknown as import('@local-creative-os/contracts').CollaborationDiagnosticsV1;
}
test('R3 lost response can reconcile exact sent journal without sending again',()=>assert(conversationSendWasRecorded(captureConversationSend('p',input),messageDiagnostics('sent'))));
for(const outcome of ['attached','unresolved'] as const) test(`R3 ${outcome} is not proof a prompt was sent`,()=>assert.equal(conversationSendWasRecorded(captureConversationSend('p',input),messageDiagnostics(outcome)),false));
for(const change of [{messageId:'different'},{explicitReferences:[]}]) test(`R3 unrelated journal receipt does not clear original message ${JSON.stringify(change)}`,()=>assert.equal(conversationSendWasRecorded(captureConversationSend('p',input),messageDiagnostics('sent',change)),false));
test('R3 journal project identity isolates same-id messages across projects',()=>assert.equal(conversationSendWasRecorded(captureConversationSend('other',input),messageDiagnostics('sent')),false));
test('R3 after reload a real unknown receipt blocks a new identity, without inventing pending state',()=>{assert(hasUnconfirmedConversationMessage('p','c',messageDiagnostics('unresolved')));assert(!hasUnconfirmedConversationMessage('other','c',messageDiagnostics('unresolved')));assert(!hasUnconfirmedConversationMessage('p','c',messageDiagnostics('sent')));assert(!hasUnconfirmedConversationMessage('p','c',undefined));});
test('R3 known question takes priority over an overlapping working state on both Glyth and Arc',()=>{const s=session({userState:'working',activity:{activeRunId:'r',pendingInputId:'q'}});assert.equal(glythSessionLabel(s),'等你回答');assert.equal(buildLcosNodeCommands({nodeType:'note',entityType:'conversation',entityId:'c',capabilities:[],referenced:false,conversation:s})[0]?.id,'answer-input');});
