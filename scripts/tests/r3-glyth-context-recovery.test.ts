/** Real Core SQLite + production Drop receipt / send-reconciliation tests.
 * Provider observations below are explicitly simulated journal evidence, not live provider execution.
 * npx tsx --test scripts/tests/r3-glyth-context-recovery.test.ts
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SqliteMetadataRepository } from '../../apps/local-core/src/metadata-repository.ts';
import { createMvpSampleSnapshot } from '../../apps/local-core/src/mvp-sample-project.ts';
import { ProjectEventHub } from '../../apps/local-core/src/project-events/project-event-hub.ts';
import { ReceiverRuntimeService } from '../../apps/local-core/src/receiver-runtime-service.ts';
import { ConversationImportService } from '../../apps/local-core/src/conversation-import-service.ts';
import { ConversationContinuationService } from '../../apps/local-core/src/conversation-continuation-service.ts';
import { PresentationApplicationService } from '../../apps/local-core/src/presentation-application-service.ts';
import { MutationSafetyService } from '../../apps/local-core/src/mutation-safety-service.ts';
import { AssemblyApplyService } from '../../apps/local-core/src/assembly-apply-service.ts';
import { DropCommitRouter } from '../../huabu/apps/web/src/lcos/drop/dropCommitRouter.ts';
import { resolveDropIntent } from '../../huabu/apps/web/src/lcos/drop/dropIntentResolver.ts';
import { captureConversationSend, conversationSendWasRecorded, hasUnconfirmedConversationMessage } from '../../huabu/apps/web/src/lcos/composer/conversationSendAttempt.ts';
import type { DropPayload } from '../../apps/web-gen2/src/interaction/semanticDropMachine.ts';
import type { DropTargetRegistration, DropAssemblyApplyIntent } from '../../huabu/apps/web/src/lcos/drop/dropTypes.ts';
import type { CollaborationDiagnosticsV1, ProviderContinuationOperationResultV1, CollaborationSendInputV1 } from '@local-creative-os/contracts';

async function setup() {
  const root = await mkdtemp(join(tmpdir(), 'lcos-r3-glyth-'));
  await mkdir(join(root, 'project'));
  const graph = createMvpSampleSnapshot(join(root, 'project'), '2026-09-30T00:00:00.000Z');
  const database = join(root, 'metadata.sqlite');
  let metadata = new SqliteMetadataRepository(database);
  metadata.save(graph);
  const projectId = String(graph.project.id);
  const events = new ProjectEventHub();
  const receivers = new ReceiverRuntimeService(metadata, events);
  const connected = receivers.connectConversation({ projectId, conversationRef:'r3-fixture-ref', executorId:'r3-fixture', provider:'codex', label:'隔离会话' });
  let imports = new ConversationImportService(metadata, { stagingRoot:join(root, 'imports') });
  const scope = graph.scopes.find(s => s.kind === 'root');
  assert(scope);
  const imported = await imports.importManual(projectId, { scopeId:String(scope.id), title:'Glyth 上下文测试', entries:[{role:'user',contentText:'保持这份原始会话记录'}] });
  const sessionId = imported.session.id;
  metadata.linkConnectedConversationSession(projectId, connected.id, sessionId);
  const service = () => new AssemblyApplyService(metadata, undefined, new MutationSafetyService(metadata, new PresentationApplicationService(metadata, metadata, undefined, events)), imports, undefined, undefined);
  const continuation = () => new ConversationContinuationService(metadata, events);
  const contexts = () => metadata.getRelations(projectId).filter(r => r.kind === 'conversation_context');
  const reopen = () => { imports.close(); metadata.close(); metadata = new SqliteMetadataRepository(database); imports = new ConversationImportService(metadata, {stagingRoot:join(root,'imports')}); };
  const cleanup = async () => { imports.close(); metadata.close(); await rm(root,{recursive:true,force:true}); };
  const target: DropTargetRegistration = {targetId:'glyth-fixture',kind:'collaboration-reference',label:'隔离会话',priority:30,enabled:true,
    rect:{left:200,top:100,width:100,height:100},semantic:{kind:'collaboration-reference',conversationId:connected.id}};
  const route = async (payload:DropPayload, tx:string, receiver = target) => {
    const resolved = resolveDropIntent(payload,receiver);assert.equal(resolved.status,'ready');if(resolved.status!=='ready')throw Error('invalid fixture');
    return new DropCommitRouter().commit(resolved.intent,tx,{projectId,applyAssembly: (intent:DropAssemblyApplyIntent)=>service().apply({schemaVersion:1,projectId,sourceRefs:intent.sourceRefs,targetRef:intent.targetRef}),addComposerReference:()=>{}});
  };
  const view = graph.artifactViews[0];assert(view);
  const payload:DropPayload = {kind:'object',entityType:'artifact',entityId:String(view.artifactId),artifactViewId:String(view.id)};
  const diagnostics = (operationId:string):CollaborationDiagnosticsV1 => {
    const op = continuation().read(projectId,operationId);assert(op);
    return {schemaVersion:1,conversationId:connected.id,connected:true,operations:[op]};
  };
  return {graph,projectId,connected,sessionId,payload,view,route,contexts,reopen,cleanup,continuation,diagnostics,metadata:()=>metadata,imports:()=>imports};
}

test('R3 Core: right-drop exact view persists as conversation context, remains after SQLite reopen',async()=>{
  const s=await setup();try {
    const receipt=await s.route(s.payload,'tx-durable');assert.equal(receipt.status,'success');
    assert.equal(s.contexts().length,1);assert.equal(String(s.contexts()[0]!.targetEntityId),String(s.view.id));
    s.reopen();assert.equal(s.contexts().length,1);assert.equal(s.metadata().getConnectedConversation(s.projectId,s.connected.id)?.conversationSessionId,s.sessionId);
    assert.equal((await s.route(s.payload,'tx-repeat')).status,'success');assert.equal(s.contexts().length,1);
  }finally{await s.cleanup();}
});
test('R3 Core: Composer reference never becomes persistent Glyth context',async()=>{
  const s=await setup();try {
    const target:DropTargetRegistration={targetId:'composer',kind:'composer-reference',label:'本轮引用',priority:30,enabled:true,rect:{left:0,top:0,width:100,height:100},semantic:{kind:'composer-reference'}};
    const resolved=resolveDropIntent(s.payload,target);assert.equal(resolved.status,'ready');if(resolved.status!=='ready')return;
    const draft:unknown[]=[];
    const result=await new DropCommitRouter().commit(resolved.intent,'draft-only',{applyAssembly:async()=>{throw Error('must not persist');},addComposerReference:(intent)=>{draft.push(intent.reference);}});
    assert.equal(result.status,'success');assert.deepEqual(draft,[{entityType:'artifactView',entityId:String(s.view.id)}]);assert.equal(s.contexts().length,0);
    s.reopen();assert.equal(s.contexts().length,0);
  }finally{await s.cleanup();}
});
test('R3 Core: partial source failure only persists matching valid context and reports partial',async()=>{
  const s=await setup();try {
    assert.equal(s.payload.kind,'object');if(s.payload.kind!=='object')return;
    const result=await s.route({kind:'objects',objects:[s.payload,{entityType:'artifactView',entityId:'missing-historical-view'}]},'partial');
    assert.equal(result.status,'partial');assert.equal(s.contexts().length,1);s.reopen();assert.equal(s.contexts().length,1);
  }finally{await s.cleanup();}
});
test('R3 Core: unlinked Glyth refuses context instead of declaring successful receive',async()=>{
  const s=await setup();try {
    s.metadata().linkConnectedConversationSession(s.projectId,s.connected.id,null);
    const result=await s.route(s.payload,'unlinked');assert.equal(result.status,'failed');assert.equal(s.contexts().length,0);
  }finally{await s.cleanup();}
});
test('R3 Core: reserved prompt survives reload, same message id cannot change text',async()=>{
  const s=await setup();try {
    const first=s.imports().reserveContinuationPrompt(s.projectId,s.sessionId,{messageId:'stable-message',userText:'原文，不是新草稿'});assert.equal(first.status,'reserved');
    const repeated=s.imports().reserveContinuationPrompt(s.projectId,s.sessionId,{messageId:'stable-message',userText:'原文，不是新草稿'});assert.equal(repeated.status,'pending');assert.equal(first.user.id,repeated.user.id);
    s.reopen();const read=s.imports().getContinuationTurn(s.projectId,s.sessionId,'stable-message');assert.equal(read?.status,'pending');assert.equal(read?.user.id,first.user.id);
    assert.throws(()=>s.imports().reserveContinuationPrompt(s.projectId,s.sessionId,{messageId:'stable-message',userText:'另一个草稿'}),/different content/);
  }finally{await s.cleanup();}
});
test('R3 Core: durable journal blocks new message after reload and releases only exact sent receipt',async()=>{
  const s=await setup();try {
    const input:CollaborationSendInputV1={conversationId:s.connected.id,continuationOperationId:'r3-op',messageId:'r3-message',text:'原消息',orderedReferences:[{order:0,ref:{type:'view',viewId:String(s.view.id)}}]};
    const attempt=captureConversationSend(s.projectId,input);
    s.continuation().submit({schemaVersion:1,operationId:'r3-op',projectId:s.projectId,connectedConversationId:s.connected.id,mode:'continue_existing',contextInheritance:'inherit',checkout:'shared',provider:'codex'});
    const common = {schemaVersion:1 as const,operationId:'r3-op',correlationId:'r3-message',provider:'codex' as const,adapterId:'test-evidence-only',contextAttached:true,nativeFork:false,degradedFromNativeFork:false,retryAction:'reconcile' as const,observedAt:'2026-09-30T00:00:00.000Z'};
    const attach:ProviderContinuationOperationResultV1={...common,action:'attach_context',outcome:'attached'};
    s.continuation().recordPromptReceipt(s.projectId,'r3-op','r3-message',input.orderedReferences!,attach,'attach',undefined,undefined,input.orderedReferences);
    assert.equal(conversationSendWasRecorded(attempt,s.diagnostics('r3-op')),false);
    const unknown:ProviderContinuationOperationResultV1={...common,action:'send',outcome:'unresolved',error:{code:'fixture_unknown',message:'simulated lost acknowledgement',retryable:false,outcomeUnknown:true}};
    s.continuation().recordPromptReceipt(s.projectId,'r3-op','r3-message',input.orderedReferences!,unknown,'send');
    s.reopen();assert.equal(hasUnconfirmedConversationMessage(s.projectId,s.connected.id,s.diagnostics('r3-op')),true);assert.equal(conversationSendWasRecorded(attempt,s.diagnostics('r3-op')),false);
    const sent:ProviderContinuationOperationResultV1={...common,action:'send',outcome:'sent'};
    s.continuation().recordPromptReceipt(s.projectId,'r3-op','r3-message',input.orderedReferences!,sent,'send');
    s.reopen();assert.equal(conversationSendWasRecorded(attempt,s.diagnostics('r3-op')),true);assert.equal(hasUnconfirmedConversationMessage(s.projectId,s.connected.id,s.diagnostics('r3-op')),false);
    assert.equal(conversationSendWasRecorded(captureConversationSend(s.projectId,{...input,messageId:'new-message'}),s.diagnostics('r3-op')),false);
    assert.equal(s.metadata().listContinuationOperationJournals(s.projectId).length,1);
  }finally{await s.cleanup();}
});
