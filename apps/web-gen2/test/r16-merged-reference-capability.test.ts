import assert from 'node:assert/strict';
import test from 'node:test';
import { runReferenceUnavailableReason, prepareDraftReferences } from '../../../huabu/apps/web/src/lcos/composer/referenceSnapshot.js';
import { buildComposerRunInput, buildComposerContinuationInput } from '../../../huabu/apps/web/src/lcos/composer/composerSubmission.js';

const text = { entityType: 'artifact', entityId: 'brief', revisionId: 'r1', mimeType: 'text/markdown' };
const target = { nodeId: 'node', title: '简报', anchor: { x: 0, y: 0, width: 1, height: 1 }, intent: 'delegate' as const };
const run = (refs: Parameters<typeof buildComposerRunInput>[0]['refs']) => buildComposerRunInput({
  projectId: 'project', workspaceId: 'workspace', instruction: '分析', target, refs,
});

for (const ref of [
  { ...text, mimeType: 'image/png' },
  { ...text, mimeType: 'application/pdf' },
  { ...text, mode: 'summary' as const },
  { entityType: 'scope', entityId: 'scope' },
]) test(`R16 task preflight rejects unsupported content without deleting draft: ${JSON.stringify(ref)}`, () => {
  assert(prepareDraftReferences([ref], 'delegate').ok, 'Reference acquisition remains available');
  assert(runReferenceUnavailableReason(ref));
  assert.throws(() => run([text, ref]), /当前任务/);
  assert.equal(text.revisionId, 'r1');
});

test('R16 Run preflight retains supported historical body address', () => {
  assert.equal(runReferenceUnavailableReason(text), undefined);
  assert.deepEqual(run([text]).orderedReferences, [{ ref: { type: 'artifact', artifactId: 'brief', revisionId: 'r1' }, order: 0 }]);
});

test('R16 Run preflight cannot narrow the separate continuation transport', () => {
  const image = { ...text, mimeType: 'image/png' };
  const send = buildComposerContinuationInput({ conversationId: 'c', continuationOperationId: 'op', messageId: 'm', text: '看看图片', refs: [image] });
  assert.equal(send.orderedReferences?.[0]?.ref.type, 'artifact');
  // This asserts serialization only; actual multimodal support remains provider-owned.
});
