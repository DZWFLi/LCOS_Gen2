import { expect, it } from 'vitest';

import { useLcosReferenceStore } from './lcosReferenceState';

it('repeated take/add keeps a reference, while the explicit node toggle can remove it', () => {
  const store = useLcosReferenceStore.getState();
  store.reset(); store.setProject('a');
  const ref = { entityId: 'material', entityType: 'artifact' };
  store.addEntityToDraft(ref); store.addEntityToDraft({ ...ref });
  expect(store.orderedNodeReferences()).toEqual([ref]);
  store.registerNodeEntity('n', ref);
  store.toggleNodeReference('n');
  expect(store.orderedNodeReferences()).toEqual([]);
});

it('retains ordered references per project while discarding binding caches on switch', () => {
  const store = useLcosReferenceStore.getState();
  store.reset();
  store.setProject('a');
  store.registerNodeEntity('node-a', { entityId: 'first', entityType: 'artifact' });
  store.toggleNodeReference('node-a');
  store.addEntityToDraft({ entityId: 'second', entityType: 'context' });
  store.setProject('b');
  expect(store.orderedNodeReferences()).toEqual([]);
  expect(useLcosReferenceStore.getState().nodeEntityRefs.size).toBe(0);
  store.addEntityToDraft({ entityId: 'b-only', entityType: 'artifact' });
  store.setProject('b');
  expect(store.orderedNodeReferences().map((ref) => ref.entityId)).toEqual(['b-only']);
  store.setProject('a');
  expect(store.orderedNodeReferences().map((ref) => ref.entityId)).toEqual(['first', 'second']);
  expect(useLcosReferenceStore.getState().nodeEntityRefs.size).toBe(0);
  store.reset();
  store.setProject('a');
  expect(store.orderedNodeReferences()).toEqual([]);
});
