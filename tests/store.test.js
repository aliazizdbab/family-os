import test from 'node:test';
import assert from 'node:assert/strict';
import { IDBFactory } from 'fake-indexeddb';

import { LocalStore } from '../public/js/store-idb.js';
import { importLegacyToIdb } from '../public/js/migrate.js';

function createTestStore() {
  return new LocalStore(new IDBFactory());
}

test('LocalStore persists entities per room and isolates rooms', async () => {
  const store = createTestStore();
  await store.putEntity('roomA', 'items', 'i1', { id: 'i1', n: 'خبز' });
  await store.putEntity('roomB', 'items', 'i1', { id: 'i1', n: 'حليب' });

  const roomAItems = await store.getCollection('roomA', 'items');
  const roomBItems = await store.getCollection('roomB', 'items');
  assert.equal(roomAItems.i1.n, 'خبز');
  assert.equal(roomBItems.i1.n, 'حليب');

  await store.removeEntityHard('roomA', 'items', 'i1');
  assert.deepEqual(await store.getCollection('roomA', 'items'), {});
  assert.equal((await store.getCollection('roomB', 'items')).i1.n, 'حليب');
});

test('LocalStore strips ai secrets from room doc and manages outbox FIFO', async () => {
  const store = createTestStore();
  await store.setRoomDoc('r1', {
    meta: { name: 'بيتنا', schemaVersion: 1 },
    ai: { on: 'gemini', ps: [{ key: 'SECRET_KEY' }] },
  });
  const doc = await store.getRoomDoc('r1');
  assert.equal(doc.meta.name, 'بيتنا');
  assert.equal('ai' in doc, false);

  const op1 = await store.enqueueOutbox({
    roomId: 'r1',
    collection: 'items',
    entityId: 'i1',
    op: 'upsert',
    payload: { n: 'تفاح' },
  });
  const op2 = await store.enqueueOutbox({
    roomId: 'r1',
    collection: 'items',
    entityId: 'i2',
    op: 'delete',
    payload: { deleted: true },
  });

  assert.equal(await store.countOutbox('r1'), 2);
  const queued = await store.listOutbox('r1');
  assert.deepEqual(
    queued.map((q) => q.opId),
    [op1.opId, op2.opId]
  );

  await store.updateOutbox(op1.opId, { retries: 1, lastError: 'offline' });
  const updated = await store.listOutbox('r1');
  assert.equal(updated[0].retries, 1);

  await store.removeOutbox(op1.opId);
  assert.equal(await store.countOutbox('r1'), 1);

  await store.setPref('theme', { accent: '#2563eb', dark: true, fontSize: 18 });
  assert.deepEqual(await store.getPref('theme'), { accent: '#2563eb', dark: true, fontSize: 18 });
});

test('importLegacyToIdb supports dry-run and idempotent persistence in IndexedDB', async () => {
  const store = createTestStore();
  const legacySample = {
    t: 1794600000000,
    budget: 380,
    cats: [{ id: 'super', i: '🏪', n: 'السوبرماركت' }],
    members: [{ id: 'm1', name: 'الأب', icon: '🛡️', admin: true, salt: 's', hash: 'h' }],
    items: [
      { id: 'x1', n: 'أرز', q: '5 كغ', p: 25, c: 'super', u: true, by: 'الأب', dn: 0, cl: '' },
      {
        id: 'x2',
        n: 'زيت',
        q: '2 لتر',
        p: 18,
        c: 'super',
        u: false,
        by: 'الأب',
        dn: 1,
        dnBy: 'الأب',
      },
    ],
    log: [{ w: 'الأب', a: 'أضاف', n: 'أرز', t: 'الآن' }],
  };

  // Dry-run must NOT write to IndexedDB
  const dry = await importLegacyToIdb(store, 'room1', legacySample, { dryRun: true });
  assert.equal(dry.plan.ok, true);
  assert.equal(dry.applied, null);
  assert.equal(dry.plan.counts.items.add, 2);
  assert.deepEqual(await store.getCollection('room1', 'items'), {});

  // Real apply writes entities
  const run1 = await importLegacyToIdb(store, 'room1', legacySample, { dryRun: false });
  assert.equal(run1.applied.items, 2);
  assert.equal(run1.applied.members, 1);
  assert.equal(run1.applied.cats, 1);
  assert.equal(run1.applied.budgetUpdated, true);

  const snap = await store.loadRoomSnapshot('room1');
  assert.equal(snap.budget.monthly, 380);
  assert.equal('salt' in snap.members.legacy_m1, false);
  assert.equal('hash' in snap.members.legacy_m1, false);

  // Second run must be 100% idempotent
  const run2 = await importLegacyToIdb(store, 'room1', legacySample, { dryRun: false });
  assert.equal(run2.plan.counts.items.add, 0);
  assert.equal(run2.plan.counts.items.skip, 2);
  assert.equal(run2.applied.items, 0);
  assert.equal(run2.applied.cats, 0);
  assert.equal(run2.applied.members, 0);
});
