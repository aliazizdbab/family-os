import test from 'node:test';
import assert from 'node:assert/strict';

import {
  DEFAULT_BUDGET,
  DEFAULT_CATS,
  SCHEMA_VERSION,
  TOMBSTONE_TTL_MS,
  compareLww,
  createBudget,
  createCategory,
  createEmptyRoomState,
  createItem,
  createMember,
  createMeta,
  createRequest,
  mergeEntity,
  migrateRoomSchema,
  pruneExpiredTombstones,
  validateBudget,
  validateCategory,
  validateItem,
  validateMember,
  validateMeta,
  validateRequest,
} from '../public/js/schema.js';
import {
  applyLegacyImport,
  normalizeLegacyBackup,
  planLegacyImport,
} from '../public/js/migrate.js';
import {
  buildWhatsAppReport,
  computeBudgetSummary,
  extractHistorySuggestions,
  parseSharedTextCandidates,
} from '../public/js/ui/list.js';
import { sortCategoriesByAisle } from '../public/js/ui/store-mode.js';

function buildSampleLegacyBackup() {
  return {
    t: 1794600000000,
    budget: 450,
    cats: [
      { id: 'super', i: '🏪', n: 'السوبرماركت' },
      { id: 'produce', i: '🥬', n: 'الخضّار' },
      { id: 'butcher', i: '🥩', n: 'القصّاب (آخراً ❄️)' },
      { id: 'custom1', i: '🧼', n: 'المنظفات' },
    ],
    members: [
      {
        id: 'm_admin',
        name: 'الأب',
        icon: '🛡️',
        admin: true,
        off: false,
        salt: 'secret_salt_1',
        hash: 'deadbeef1234567890',
      },
      {
        id: 'm_member',
        name: 'الأم',
        icon: '❤️',
        admin: false,
        off: false,
        salt: 'secret_salt_2',
        hash: 'cafebabe1234567890',
      },
    ],
    items: [
      {
        id: 'it1',
        n: 'حليب طازج',
        q: '2 لتر',
        p: 14,
        c: 'super',
        u: true,
        by: 'الأم',
        dn: 0,
        cl: 'الأب',
      },
      {
        id: 'it2',
        n: 'طماطم',
        q: '3 كيلو',
        p: 9.5,
        c: 'produce',
        u: false,
        by: 'الأب',
        dn: 1,
        dnBy: 'الأب',
        dnAt: '14/11/2026، 10:00 ص',
        cl: '',
      },
      {
        id: 'it3',
        n: 'صابون غسيل',
        q: 'عبوة',
        p: 22,
        c: 'missing_cat',
        u: false,
        by: 'ضيف',
        dn: 0,
        cl: '',
      },
    ],
    log: [
      { w: 'الأب', a: 'أنجز', n: 'طماطم', t: '14/11/2026، 10:00 ص' },
      { w: 'الأم', a: 'أضاف', n: 'حليب طازج', t: '14/11/2026، 09:30 ص' },
    ],
    ai: { on: 'gemini', ps: [{ id: 'gemini', key: 'SHOULD_NEVER_MIGRATE' }] },
  };
}

test('DEFAULT_CATS matches the 9 legacy categories', () => {
  assert.equal(DEFAULT_CATS.length, 9);
  assert.deepEqual(
    DEFAULT_CATS.map((c) => c.id),
    ['laundry', 'appliances', 'car', 'herbs', 'pharmacy', 'super', 'produce', 'bakery', 'butcher']
  );
});

test('schema builders produce valid v1 entities and validators reject malformed inputs', () => {
  const meta = createMeta({
    name: 'بيتنا',
    invite: { token: 'abc1234567', expiresAt: 9999999999 },
  });
  assert.equal(validateMeta(meta).ok, true);
  assert.equal(validateMeta({ ...meta, name: '' }).ok, false);
  assert.equal(validateMeta({ ...meta, invite: { token: 'short', expiresAt: 1 } }).ok, false);

  const member = createMember({ id: 'u1', name: 'علي', role: 'admin' });
  assert.equal(validateMember(member).ok, true);
  assert.equal(validateMember({ ...member, role: 'superuser' }).ok, false);

  const cat = createCategory({ id: 'super', n: 'السوبرماركت', i: '🏪', order: 0 });
  assert.equal(validateCategory(cat).ok, true);
  assert.equal(validateCategory({ ...cat, n: '' }).ok, false);

  const item = createItem({
    id: 'i1',
    n: 'خبز',
    q: '4',
    p: 2,
    c: 'bakery',
    by: 'u1',
    byName: 'علي',
  });
  assert.equal(validateItem(item).ok, true);
  assert.equal(validateItem({ ...item, p: -5 }).ok, false);
  assert.equal(validateItem({ ...item, n: '' }).ok, false);

  const req = createRequest({ id: 'r1', by: 'child1', n: 'عصير', c: 'super' });
  assert.equal(validateRequest(req).ok, true);
  assert.equal(validateRequest({ ...req, status: 'unknown' }).ok, false);

  const budget = createBudget({ monthly: 300, perCat: { super: 150 } });
  assert.equal(validateBudget(budget).ok, true);
  assert.equal(validateBudget({ monthly: -1, perCat: {} }).ok, false);
});

test('migrateRoomSchema upgrades v0 to v1 and guards against future versions', () => {
  const empty = createEmptyRoomState('العائلة');
  assert.equal(empty.meta.schemaVersion, SCHEMA_VERSION);
  assert.equal(empty.budget.monthly, DEFAULT_BUDGET);
  assert.equal(Object.keys(empty.cats).length, 9);

  const v0 = { meta: { name: 'تجربة' }, items: { a: { n: 'ماء' } } };
  const upgraded = migrateRoomSchema(v0);
  assert.equal(upgraded.meta.schemaVersion, 1);
  assert.equal(Object.keys(upgraded.cats).length, 9);
  assert.ok(upgraded.items.a);

  assert.throws(
    () => migrateRoomSchema({ meta: { schemaVersion: 99 } }),
    /Unsupported schemaVersion/
  );
});

test('LWW merge and 30-day tombstone pruning behave deterministically', () => {
  const older = { id: 'x', n: 'قديم', updatedAt: 1000, by: 'uid_b', deleted: false };
  const newer = { id: 'x', n: 'جديد', updatedAt: 2000, by: 'uid_a', deleted: false };
  assert.equal(mergeEntity(older, newer).n, 'جديد');
  assert.equal(mergeEntity(newer, older).n, 'جديد');

  // Equal updatedAt breaks ties deterministically by uid
  const tieA = { id: 'x', n: 'A', updatedAt: 2000, by: 'uid_a', deleted: false };
  const tieB = { id: 'x', n: 'B', updatedAt: 2000, by: 'uid_b', deleted: false };
  assert.ok(compareLww(tieB, tieA) > 0);
  assert.equal(mergeEntity(tieA, tieB).n, 'B');
  assert.equal(mergeEntity(tieB, tieA).n, 'B');

  // Newer delete beats older edit
  const deletedNewer = { id: 'x', n: 'قديم', updatedAt: 3000, by: 'uid_a', deleted: true };
  assert.equal(mergeEntity(newer, deletedNewer).deleted, true);

  const now = 1_000_000_000_000;
  const entities = {
    active: { updatedAt: now - TOMBSTONE_TTL_MS - 1000, deleted: false },
    recentTomb: { updatedAt: now - 1000, deleted: true },
    expiredTomb: { updatedAt: now - TOMBSTONE_TTL_MS - 5000, deleted: true },
  };
  const pruned = pruneExpiredTombstones(entities, now);
  assert.ok(pruned.active);
  assert.ok(pruned.recentTomb);
  assert.equal(pruned.expiredTomb, undefined);
});

test('normalizeLegacyBackup discards PIN hashes and AI keys while preserving domain data', () => {
  const sample = buildSampleLegacyBackup();
  const res = normalizeLegacyBackup(sample, { roomName: 'عائلة الاختبار' });
  assert.equal(res.ok, true);
  assert.ok(res.warnings.some((w) => w.includes('PIN')));
  assert.ok(res.warnings.some((w) => w.includes('الذكاء الاصطناعي')));

  const { normalized } = res;
  assert.equal(normalized.meta.schemaVersion, 1);
  assert.equal(normalized.meta.name, 'عائلة الاختبار');
  assert.equal(normalized.budget.monthly, 450);

  // Members keep name/icon/role and never retain salt/hash
  const adminMember = normalized.members.legacy_m_admin;
  assert.equal(adminMember.name, 'الأب');
  assert.equal(adminMember.role, 'admin');
  assert.equal(adminMember.pendingRelink, true);
  assert.equal('salt' in adminMember, false);
  assert.equal('hash' in adminMember, false);

  const normalMember = normalized.members.legacy_m_member;
  assert.equal(normalMember.role, 'member');

  // Items map fields, category fallback, and claim uid
  const milk = normalized.items.legacy_it1;
  assert.equal(milk.dn, false);
  assert.equal(milk.u, true);
  assert.equal(milk.by, 'legacy_m_member');
  assert.equal(milk.cl, 'legacy_m_admin');

  const tomatoes = normalized.items.legacy_it2;
  assert.equal(tomatoes.dn, true);
  assert.equal(tomatoes.cl, '');

  const soap = normalized.items.legacy_it3;
  assert.equal(soap.c, 'super'); // fallback when category missing

  // Ensure no AI secret leaked anywhere in normalized state
  assert.equal('ai' in normalized, false);
  assert.equal(JSON.stringify(normalized).includes('SHOULD_NEVER_MIGRATE'), false);
});

test('planLegacyImport and applyLegacyImport are idempotent with accurate dry-run counts', () => {
  const sample = buildSampleLegacyBackup();
  const plan1 = planLegacyImport(sample, null);
  assert.equal(plan1.ok, true);
  assert.deepEqual(plan1.counts.cats, { total: 4, add: 4, skip: 0 });
  assert.deepEqual(plan1.counts.members, { total: 2, add: 2, skip: 0 });
  assert.deepEqual(plan1.counts.items, { total: 3, add: 3, skip: 0, done: 1, todo: 2 });
  assert.deepEqual(plan1.counts.log, { total: 2, add: 2, skip: 0 });
  assert.equal(plan1.counts.budgetMonthly, 450);

  const firstApply = applyLegacyImport(plan1, null);
  assert.equal(firstApply.applied.items, 3);
  assert.equal(firstApply.applied.cats, 4);
  assert.equal(firstApply.applied.members, 2);
  assert.equal(firstApply.applied.log, 2);
  assert.equal(firstApply.applied.budgetUpdated, true);

  // Second dry-run against imported state must detect 0 additions
  const plan2 = planLegacyImport(sample, firstApply.state);
  assert.equal(plan2.ok, true);
  assert.deepEqual(plan2.counts.items, { total: 3, add: 0, skip: 3, done: 1, todo: 2 });
  assert.deepEqual(plan2.counts.cats, { total: 4, add: 0, skip: 4 });
  assert.deepEqual(plan2.counts.members, { total: 2, add: 0, skip: 2 });

  const secondApply = applyLegacyImport(plan2, firstApply.state);
  assert.equal(secondApply.applied.items, 0);
  assert.equal(secondApply.applied.cats, 0);
  assert.equal(secondApply.applied.members, 0);
  assert.equal(secondApply.applied.log, 0);
  assert.equal(secondApply.applied.budgetUpdated, false);
  assert.deepEqual(secondApply.state, firstApply.state);
});

test('normalizeLegacyBackup also accepts Firebase object maps and rejects invalid payloads', () => {
  const objectMapSample = {
    items: {
      a: { id: 'a', n: 'خبز', c: 'bakery', dn: 0, p: 5 },
    },
    members: {
      m1: { id: 'm1', name: 'سالم', admin: true },
    },
    budget: 100,
  };
  const plan = planLegacyImport(JSON.stringify(objectMapSample), null);
  assert.equal(plan.ok, true);
  assert.equal(plan.counts.items.total, 1);

  const badPlan = planLegacyImport('{invalid json', null);
  assert.equal(badPlan.ok, false);
  assert.ok(badPlan.errors.length > 0);
});

test('Phase 2 shopping helpers: budget summary, history suggestions, shared text parser, WhatsApp report, and aisle sort', () => {
  const items = [
    createItem({ id: '1', n: 'حليب', q: '2', p: 90, c: 'super', dn: true }),
    createItem({ id: '2', n: 'لحم', q: '2 كجم', p: 85, c: 'meat', dn: false }),
  ];
  const budget = createBudget({ monthly: 200, perCat: { super: 100, meat: 80 } });
  const summary = computeBudgetSummary(items, budget);
  assert.equal(summary.estTotal, 175);
  assert.equal(summary.paidTotal, 90);
  assert.equal(summary.status, 'near'); // 175 / 200 = 87.5% >= 85%
  assert.equal(summary.perCatWarnings.super.status, 'near'); // 90 / 100 = 90%
  assert.equal(summary.perCatWarnings.meat.status, 'over'); // 85 / 80 > 100%

  const suggestions = extractHistorySuggestions(
    { h1: { itemName: 'زعتر', c: 'spices', p: 12, q: 'علبة' } },
    {}
  );
  assert.ok(suggestions.some((s) => s.itemName === 'زعتر' && s.p === 12));

  const shared = parseSharedTextCandidates('1. تفاح\n• موز\nخبز');
  assert.equal(shared.length, 3);
  assert.equal(shared[0].n, 'تفاح');
  assert.equal(shared[1].n, 'موز');
  assert.equal(shared[2].n, 'خبز');

  const report = buildWhatsAppReport({
    roomName: 'عائلتي',
    categoriesList: [
      { id: 'super', n: 'السوبرماركت', i: '🏪' },
      { id: 'meat', n: 'اللحوم', i: '🥩' },
    ],
    itemsList: items,
    summary,
  });
  assert.ok(report.includes('*قائمة مقاضي عائلتي*'));
  assert.ok(report.includes('✅ حليب (2) - 90 د.ل'));
  assert.ok(report.includes('⬜ لحم (2 كجم) - 85 د.ل'));

  const sortedAisles = sortCategoriesByAisle(
    {
      super: { id: 'super', n: 'السوبرماركت', order: 0 },
      bakery: { id: 'bakery', n: 'المخبز', order: 1 },
      meat: { id: 'meat', n: 'اللحوم', order: 2 },
    },
    ['meat', 'bakery', 'super']
  );
  assert.deepEqual(
    sortedAisles.map((c) => c.id),
    ['meat', 'bakery', 'super']
  );
});
