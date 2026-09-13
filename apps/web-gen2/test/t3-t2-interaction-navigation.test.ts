// Sprint 3（T3 + T2）headless 测试：local intents / action descriptors / snapshot stale /
// canonical target resolver / capture receipt target / focus occurrence。
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  CONTINUATION_ACTION_DESCRIPTORS,
  assertKnownContinuationActionsV1,
  describeContinuationActionV1,
  intentKindForContinuationActionV1,
} from '../src/interaction/actionArcModel.js';
import { createT3InteractionSnapshotV1, isT3SnapshotStaleV1 } from '../src/interaction/t3InteractionSnapshot.js';
import { createContinuationLocalIntentV1 } from '../src/interaction/continuationIntent.js';
import {
  resolveCanonicalConversationTargetV1,
  resolveCanonicalWorkViewTargetV1,
  resolveCanonicalViewTargetV1,
} from '../src/navigation/canonicalTargetResolver.js';
import { targetFromCaptureReceiptV1 } from '../src/navigation/captureReceiptTarget.js';
import { focusOccurrenceV1 } from '../src/navigation/focusOccurrence.js';

// ---- T3: action → 唯一 local intent ----

test('each canonical continuation action maps to exactly one named local intent', () => {
  const actions = ['recover_external', 'recover_bind', 'retry_attach', 'retry_projection', 'reconcile', 'cancel_request'] as const;
  assert.equal(Object.keys(CONTINUATION_ACTION_DESCRIPTORS).length, actions.length);
  const kinds = new Set(actions.map((action) => intentKindForContinuationActionV1(action)));
  assert.equal(kinds.size, 5); // 五类分开：recover(2) / attach / projection / reconcile / cancel
  assert.ok(![...kinds].includes('continue_submission_requested')); // 无万能 recover
  assert.doesNotThrow(() => assertKnownContinuationActionsV1(actions));
});

test('action labels never drive dispatch; descriptor carries the action value', () => {
  const recoverExternal = describeContinuationActionV1('recover_external');
  const recoverBind = describeContinuationActionV1('recover_bind');
  assert.equal(recoverExternal.intentKind, 'binding_recovery_requested');
  assert.equal(recoverBind.intentKind, 'binding_recovery_requested');
  assert.notEqual(recoverExternal.action, recoverBind.action);
});

test('createContinuationLocalIntentV1 binds target/operation/snapshot', () => {
  const intent = createContinuationLocalIntentV1('binding_recovery_requested', {
    targetConversationRef: 'conv-1',
    operationId: 'op-1',
    snapshotId: 'snap-1',
  });
  assert.equal(intent.kind, 'binding_recovery_requested');
});

test('isT3SnapshotStaleV1 rejects on target/operation/revision mismatch', () => {
  const snapshot = createT3InteractionSnapshotV1({
    snapshotId: 's1',
    projectId: 'p1',
    targetConversationRef: 'conv-a',
    operationId: 'op-a',
    status: 'binding',
    revision: 3,
    allowedActions: ['recover_bind'],
    capabilities: { externalCreate: true },
  });
  assert.equal(isT3SnapshotStaleV1(snapshot, { targetConversationRef: 'conv-a', operationId: 'op-a', revision: 3 }), false);
  assert.equal(isT3SnapshotStaleV1(snapshot, { targetConversationRef: 'conv-b', operationId: 'op-a', revision: 3 }), true);
  assert.equal(isT3SnapshotStaleV1(snapshot, { targetConversationRef: 'conv-a', operationId: 'op-a', revision: 4 }), true);
});

// ---- T2: canonical target resolver ----

test('conversation target accepts exact ConnectedConversation.id, rejects cross-project auto-open', () => {
  const ok = resolveCanonicalConversationTargetV1(
    { currentProjectId: 'p1', connectedConversationId: 'conv-1', projectionState: 'ready' },
    'p1',
  );
  assert.equal(ok.status, 'resolved');
  assert.deepEqual(ok, { status: 'resolved', target: { kind: 'conversation', connectedConversationId: 'conv-1' } });
  const cross = resolveCanonicalConversationTargetV1(
    { currentProjectId: 'p1', connectedConversationId: 'conv-1', projectionState: 'ready' },
    'p2',
  );
  assert.equal(cross.status, 'destination_unavailable');
});

test('projection failed → not_projected; no (0,0) fallback', () => {
  const outcome = resolveCanonicalConversationTargetV1(
    { currentProjectId: 'p1', connectedConversationId: 'conv-1', projectionState: 'failed' },
    'p1',
  );
  assert.equal(outcome.status, 'not_projected');
});

test('work view target opens identity-only regardless of projection (Locate 才禁)', () => {
  const outcome = resolveCanonicalWorkViewTargetV1(
    { currentProjectId: 'p1', connectedConversationId: 'conv-1', projectionState: 'failed' },
    'p1',
  );
  assert.equal(outcome.status, 'resolved');
  assert.equal(outcome.status === 'resolved' ? outcome.target.kind : '', 'workView');
});

test('resolveCanonicalViewTargetV1 rejects empty and cross-project', () => {
  assert.equal(resolveCanonicalViewTargetV1({ currentProjectId: 'p1', viewId: '', projectionState: 'ready' }, 'p1').status, 'not_found');
  assert.equal(resolveCanonicalViewTargetV1({ currentProjectId: 'p1', viewId: 'v1', projectionState: 'ready' }, 'p2').status, 'destination_unavailable');
  assert.equal(resolveCanonicalViewTargetV1({ currentProjectId: 'p1', viewId: 'v1', projectionState: 'failed' }, 'p1').status, 'not_projected');
});

// ---- T2: capture receipt target ----

test('capture receipt target order: memberViewId > viewId > artifactId', () => {
  const r1 = targetFromCaptureReceiptV1({ receipt: { memberViewId: 'mv-1', viewId: 'v-1', artifactId: 'a-1' } });
  assert.deepEqual(r1, { status: 'resolved', target: { kind: 'artifactView', viewId: 'mv-1' } });
  const r2 = targetFromCaptureReceiptV1({ receipt: { viewId: 'v-1', artifactId: 'a-1' } });
  assert.deepEqual(r2, { status: 'resolved', target: { kind: 'artifactView', viewId: 'v-1' } });
  const r3 = targetFromCaptureReceiptV1({ receipt: { artifactId: 'a-1' } });
  assert.deepEqual(r3, { status: 'resolved', target: { kind: 'artifact', artifactId: 'a-1' } });
});

test('resource/staging/label never fabricate a canvas target', () => {
  assert.deepEqual(targetFromCaptureReceiptV1({ receipt: { resourceId: 'r-1', destinationLabel: 'xxx' } }), { status: 'unavailable' });
  assert.deepEqual(targetFromCaptureReceiptV1({ receipt: { stagingId: 's-1' } }), { status: 'unavailable' });
});

test('apply item memberViewId wins over receipt viewId', () => {
  const r = targetFromCaptureReceiptV1({ receipt: { viewId: 'v-1' }, applyItem: { memberViewId: 'mv-2' } });
  assert.deepEqual(r, { status: 'resolved', target: { kind: 'artifactView', viewId: 'mv-2' } });
});

// ---- T2: focus occurrence ----

test('focusOccurrence: binding + live node → focused; failed/missing → not_projected/partial', () => {
  assert.deepEqual(focusOccurrenceV1({ binding: { spatialId: 's1' }, liveNode: true, projectionState: 'ready' }), {
    status: 'focused',
    spatialId: 's1',
  });
  assert.equal(focusOccurrenceV1({ binding: { spatialId: 's1' }, liveNode: true, projectionState: 'failed' }).status, 'not_projected');
  assert.equal(focusOccurrenceV1({ binding: undefined, liveNode: false, projectionState: 'ready' }).status, 'not_projected');
  assert.equal(focusOccurrenceV1({ binding: { spatialId: 's1' }, liveNode: false, projectionState: 'ready' }).status, 'partial');
  assert.equal(focusOccurrenceV1({ binding: { spatialId: 's1' }, liveNode: true, projectionState: 'ready', aborted: true }).status, 'cancelled');
});
