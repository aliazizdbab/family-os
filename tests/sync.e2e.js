import test from 'node:test';
import assert from 'node:assert/strict';
import { IDBFactory } from 'fake-indexeddb';
import { TOMBSTONE_TTL_MS, createItem, mergeEntity } from '../public/js/schema.js';
import { LocalStore } from '../public/js/store-idb.js';
import { setFirebaseSdkOverrideForTests } from '../public/js/auth.js';
import { SyncEngine, getSyncBadgeLabel } from '../public/js/sync.js';

function createSharedMockCloud() {
  const cloudDb = new Map();
  let currentUid = 'uid-a';

  return {
    cloudDb,
    setUid(uid) {
      currentUid = uid;
    },
    sdk: {
      appMod: {
        getApps: () => [{}],
        initializeApp: () => ({}),
      },
      authMod: {
        getAuth: () => ({ currentUser: { uid: currentUid, isAnonymous: true } }),
        connectAuthEmulator: () => {},
        signInAnonymously: async () => ({ user: { uid: currentUid, isAnonymous: true } }),
      },
      dbMod: {
        getDatabase: () => ({}),
        connectDatabaseEmulator: () => {},
        ref: (_db, refPath) => ({ path: refPath }),
        set: async (refObj, val) => {
          cloudDb.set(refObj.path, structuredClone(val));
        },
        remove: async (refObj) => {
          cloudDb.delete(refObj.path);
        },
        get: async (refObj) => ({
          exists: () => cloudDb.has(refObj.path),
          val: () => structuredClone(cloudDb.get(refObj.path)),
        }),
        onChildAdded: () => () => {},
        onChildChanged: () => () => {},
        onChildRemoved: () => () => {},
        onValue: () => () => {},
      },
    },
  };
}

test('Phase 1 sync scenarios (a)-(e): offline additions, delete vs edit tombstone, LWW, offline reload outbox persistence, and status labels', async () => {
  const idbA = new IDBFactory();
  const idbB = new IDBFactory();
  const storeA = new LocalStore(idbA);
  const storeB = new LocalStore(idbB);
  const roomId = 'family-sync-room';

  const cloud = createSharedMockCloud();
  setFirebaseSdkOverrideForTests(cloud.sdk);

  const engineA = new SyncEngine({ roomId, store: storeA });
  const engineB = new SyncEngine({ roomId, store: storeB });

  try {
    let onlineA = false;
    let onlineB = false;
    engineA.isOnline = () => onlineA;
    engineB.isOnline = () => onlineB;

    // (a) Both offline add different items -> queued in outbox, then both present after reconnect
    const itemA = createItem({
      id: 'item-a',
      n: 'حليب',
      c: 'super',
      p: 10,
      by: 'uid-a',
      byName: 'علي',
      updatedAt: 1000,
      createdAt: 1000,
    });
    const itemB = createItem({
      id: 'item-b',
      n: 'خبز',
      c: 'bakery',
      p: 5,
      by: 'uid-b',
      byName: 'سارة',
      updatedAt: 1005,
      createdAt: 1005,
    });

    await engineA.mutateEntity('items', 'item-a', itemA, { nowMs: 1000 });
    await engineB.mutateEntity('items', 'item-b', itemB, { nowMs: 1005 });

    // (d) Reload while offline keeps pending changes in IndexedDB outbox
    const reloadedStoreA = new LocalStore(idbA);
    const pendingOnReload = await reloadedStoreA.listOutbox(roomId);
    assert.equal(pendingOnReload.length, 1);
    assert.equal(pendingOnReload[0].entityId, 'item-a');

    // Verify Arabic sync status indicator while offline with pending changes
    assert.match(
      getSyncBadgeLabel({ state: 'offline', pendingCount: pendingOnReload.length }, false),
      /غير متصل.*1 تغييرات معلّقة/
    );
    assert.match(getSyncBadgeLabel({ state: 'syncing', pendingCount: 1 }, true), /جارٍ المزامنة/);
    assert.match(getSyncBadgeLabel({ state: 'online', pendingCount: 0 }, true), /متصل/);

    // Reconnect both and flush outbox to cloud
    onlineA = true;
    onlineB = true;
    await engineA.flushOutbox();
    await engineB.flushOutbox();

    assert.equal((await storeA.listOutbox(roomId)).length, 0);
    assert.equal((await storeB.listOutbox(roomId)).length, 0);

    // Replicate cloud items across both clients
    await engineA.applyIncomingRemoteEntity(
      'items',
      'item-b',
      cloud.cloudDb.get(`v2/rooms/${roomId}/items/item-b`)
    );
    await engineB.applyIncomingRemoteEntity(
      'items',
      'item-a',
      cloud.cloudDb.get(`v2/rooms/${roomId}/items/item-a`)
    );

    const itemsOnA = await storeA.getCollection(roomId, 'items');
    const itemsOnB = await storeB.getCollection(roomId, 'items');
    assert.deepEqual(Object.keys(itemsOnA).sort(), ['item-a', 'item-b']);
    assert.deepEqual(Object.keys(itemsOnB).sort(), ['item-a', 'item-b']);

    // (b) A deletes while B edits the same item -> newer delete tombstone wins, no resurrection after 30-day cleanup
    await engineB.mutateEntity(
      'items',
      'item-a',
      { ...itemsOnB['item-a'], q: '3 علب', updatedAt: 2000 },
      { nowMs: 2000 }
    );
    await engineB.flushOutbox();

    await engineA.mutateEntity('items', 'item-a', itemsOnA['item-a'], {
      op: 'delete',
      nowMs: 2500,
      by: 'uid-a',
    });
    await engineA.flushOutbox();

    // Apply A's tombstone to B; B's stale edit (2000) cannot overwrite A's delete (2500)
    const deletedOnCloud = cloud.cloudDb.get(`v2/rooms/${roomId}/items/item-a`);
    assert.equal(deletedOnCloud.deleted, true);
    await engineB.applyIncomingRemoteEntity('items', 'item-a', deletedOnCloud);
    const staleAttempt = await engineB.applyIncomingRemoteEntity('items', 'item-a', {
      ...itemsOnB['item-a'],
      q: 'محاولة قديمة',
      updatedAt: 2100,
      deleted: false,
    });
    assert.equal(staleAttempt, false);
    assert.equal((await storeB.getEntity(roomId, 'items', 'item-a')).deleted, true);

    // Cleanup expired tombstones after 30 days -> removed cleanly without resurrection
    const cleanedCount = await engineB.cleanupExpiredTombstones(2500 + TOMBSTONE_TTL_MS + 1000);
    assert.equal(cleanedCount, 1);
    assert.equal(await storeB.getEntity(roomId, 'items', 'item-a'), null);

    // (c) Both edit the same field -> LWW by updatedAt (and tie-break by uid)
    const edit1 = { ...itemB, p: 14, updatedAt: 3000, by: 'uid-a' };
    const edit2 = { ...itemB, p: 18, updatedAt: 3100, by: 'uid-b' };
    assert.equal(mergeEntity(edit1, edit2).p, 18);

    const tie1 = { ...itemB, p: 20, updatedAt: 4000, by: 'uid-a' };
    const tie2 = { ...itemB, p: 22, updatedAt: 4000, by: 'uid-z' };
    assert.equal(mergeEntity(tie1, tie2).p, 22);
  } finally {
    engineA?.stop();
    engineB?.stop();
    setFirebaseSdkOverrideForTests(null);
  }
});
