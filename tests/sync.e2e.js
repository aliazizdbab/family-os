import test from 'node:test';
import assert from 'node:assert/strict';
import { IDBFactory } from 'fake-indexeddb';
import { createItem, mergeEntity } from '../public/js/schema.js';
import { LocalStore } from '../public/js/store-idb.js';

test('sync scenarios: two offline clients add different items, delete vs edit, and LWW tie-break', async () => {
  const clientA = new LocalStore(new IDBFactory());
  const clientB = new LocalStore(new IDBFactory());
  const roomId = 'family-sync-room';

  // (a) Both offline add different items -> both present after merge
  const itemA = createItem({
    id: 'item-a',
    n: 'حليب',
    c: 'super',
    by: 'uid-a',
    byName: 'علي',
    updatedAt: 1000,
    createdAt: 1000,
  });
  const itemB = createItem({
    id: 'item-b',
    n: 'خبز',
    c: 'bakery',
    by: 'uid-b',
    byName: 'سارة',
    updatedAt: 1005,
    createdAt: 1005,
  });

  await clientA.putEntity(roomId, 'items', 'item-a', itemA);
  await clientB.putEntity(roomId, 'items', 'item-b', itemB);

  // Simulate flush & cross-replication
  await clientA.putEntity(roomId, 'items', 'item-b', itemB);
  await clientB.putEntity(roomId, 'items', 'item-a', itemA);

  const itemsOnA = await clientA.getCollection(roomId, 'items');
  const itemsOnB = await clientB.getCollection(roomId, 'items');
  assert.ok(itemsOnA['item-a']);
  assert.ok(itemsOnA['item-b']);
  assert.deepEqual(Object.keys(itemsOnA).sort(), Object.keys(itemsOnB).sort());

  // (b) A deletes while B edits earlier -> tombstone with newer updatedAt wins, no resurrection
  const editedByB = { ...itemA, q: '3 علب', updatedAt: 2000 };
  const deletedByA = { ...itemA, deleted: true, updatedAt: 2500 };
  const mergedDelete = mergeEntity(editedByB, deletedByA);
  assert.equal(mergedDelete.deleted, true);
  assert.equal(mergedDelete.updatedAt, 2500);

  // (c) Both edit the same field -> LWW by updatedAt
  const edit1 = { ...itemB, p: 10, updatedAt: 3000 };
  const edit2 = { ...itemB, p: 12, updatedAt: 3100 };
  assert.equal(mergeEntity(edit1, edit2).p, 12);
});
