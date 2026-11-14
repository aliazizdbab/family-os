import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { IDBFactory } from 'fake-indexeddb';
import { LocalStore } from '../public/js/store-idb.js';
import {
  buildInviteUrl,
  clearLocalPinLock,
  createRoom,
  generateInviteToken,
  joinRoomWithInvite,
  parseJoinHash,
  relinkMemberUid,
  revokeInviteToken,
  rotateInviteToken,
  setFirebaseSdkOverrideForTests,
  setLocalPinLock,
  verifyLocalPinLock,
} from '../public/js/auth.js';
import {
  CONFIRM_REQUIRED_AI_ACTIONS,
  SUPPORTED_AI_ACTIONS,
  parseAiEnvelope,
} from '../public/js/ai-actions.js';
import { filterCandidateGeminiModels } from '../public/js/models-scan.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');

function isPortOpen(port, host = '127.0.0.1', timeoutMs = 400) {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    let settled = false;
    const done = (result) => {
      if (!settled) {
        settled = true;
        socket.destroy();
        resolve(result);
      }
    };
    socket.setTimeout(timeoutMs);
    socket.once('connect', () => done(true));
    socket.once('timeout', () => done(false));
    socket.once('error', () => done(false));
    socket.connect(port, host);
  });
}

function createMockFirebaseSdk(initialAuthUid = 'uid-admin-1') {
  const dbStore = new Map();
  const currentUser = { uid: initialAuthUid, isAnonymous: true };
  return {
    dbStore,
    setUid(uid) {
      currentUser.uid = uid;
    },
    sdk: {
      appMod: {
        getApps: () => [{}],
        initializeApp: () => ({}),
      },
      authMod: {
        getAuth: () => ({ currentUser }),
        connectAuthEmulator: () => {},
        signInAnonymously: async () => ({ user: currentUser }),
      },
      dbMod: {
        getDatabase: () => ({}),
        connectDatabaseEmulator: () => {},
        ref: (_db, refPath) => ({ path: refPath }),
        set: async (refObj, val) => {
          dbStore.set(refObj.path, structuredClone(val));
        },
        remove: async (refObj) => {
          dbStore.delete(refObj.path);
        },
        get: async (refObj) => ({
          exists: () => dbStore.has(refObj.path),
          val: () => structuredClone(dbStore.get(refObj.path)),
        }),
      },
    },
  };
}

test('firebase.json, .firebaserc, and database.rules.json are valid and preserve legacy paths', () => {
  const firebaserc = JSON.parse(fs.readFileSync(path.join(projectRoot, '.firebaserc'), 'utf8'));
  assert.equal(firebaserc.projects?.default, 'family-requests-9e431');

  const firebaseJson = JSON.parse(fs.readFileSync(path.join(projectRoot, 'firebase.json'), 'utf8'));
  assert.equal(firebaseJson.hosting?.public, 'public');
  assert.equal(firebaseJson.database?.rules, 'database.rules.json');
  assert.equal(firebaseJson.emulators?.auth?.port, 9099);
  assert.equal(firebaseJson.emulators?.database?.port, 9000);
  assert.equal(firebaseJson.emulators?.hosting?.port, 5000);

  const swHeader = firebaseJson.hosting.headers.find((h) => h.source === '/sw.js');
  assert.ok(swHeader, 'sw.js cache-control header must exist');
  assert.match(swHeader.headers[0].value, /no-cache/);

  const rulesDoc = JSON.parse(
    fs.readFileSync(path.join(projectRoot, 'database.rules.json'), 'utf8')
  );
  const rules = rulesDoc.rules;

  // Legacy paths preserved until Gate G1
  assert.equal(rules.rooms?.$legacyRoom?.['.read'], true);
  assert.equal(rules.rooms?.$legacyRoom?.['.write'], true);
  assert.equal(rules.ai?.$legacyRoom?.['.read'], true);
  assert.equal(rules.ai?.$legacyRoom?.['.write'], true);

  // v2 room rules and role checks
  const roomRules = rules.v2?.rooms?.$rid;
  assert.ok(roomRules, '/v2/rooms/$rid rules must exist');
  assert.match(roomRules['.read'], /auth != null/);
  assert.match(roomRules['.read'], /members/);

  // Children cannot write items, cats, budget, or ai
  assert.match(roomRules.items?.$iid?.['.write'], /role.*admin.*role.*member/);
  assert.doesNotMatch(roomRules.items?.$iid?.['.write'], /'child'/);
  assert.match(roomRules.cats?.$cid?.['.write'], /role.*admin.*role.*member/);
  assert.doesNotMatch(roomRules.cats?.$cid?.['.write'], /'child'/);
  assert.match(roomRules.budget?.['.write'], /role.*=== 'admin'/);
  assert.match(roomRules.ai?.['.write'], /role.*=== 'admin'/);

  // Members rule forbids storing PIN salt/hash and validates invite token expiry
  assert.match(roomRules.members?.$uid?.['.validate'], /!newData\.hasChild\('salt'\)/);
  assert.match(roomRules.members?.$uid?.['.validate'], /!newData\.hasChild\('hash'\)/);
  assert.match(roomRules.members?.$uid?.['.write'], /meta\/invite\/expiresAt.*> now/);

  // Daily AI usage counter increments only by 1
  assert.match(
    roomRules.aiUsage?.$uid?.$yyyymmdd?.['.validate'],
    /newData\.val\(\) === data\.val\(\) \+ 1/
  );
});

test('auth workflows: createRoom, joinRoomWithInvite, rotate/revoke invite, and relinkMemberUid', async () => {
  const store = new LocalStore(new IDBFactory());
  const mock = createMockFirebaseSdk('uid-admin-1');
  setFirebaseSdkOverrideForTests(mock.sdk);

  try {
    const created = await createRoom({
      roomId: 'room-test-1',
      roomName: 'بيت العائلة',
      adminName: 'الأب',
      store,
      nowMs: 1_700_000_000_000,
    });
    assert.equal(created.ok, true);
    assert.equal(created.uid, 'uid-admin-1');
    assert.equal(created.role, 'admin');
    assert.match(created.inviteUrl, /#join=room-test-1\./);

    // Join as a second member using the invite token
    mock.setUid('uid-member-2');
    const joined = await joinRoomWithInvite({
      roomId: 'room-test-1',
      token: created.meta.invite.token,
      memberName: 'الأم',
      memberIcon: '❤️',
      role: 'member',
      store,
      nowMs: 1_700_000_010_000,
    });
    assert.equal(joined.ok, true);
    assert.equal(joined.uid, 'uid-member-2');
    assert.equal(joined.role, 'member');

    // Rotate invite token
    mock.setUid('uid-admin-1');
    const rotated = await rotateInviteToken({
      roomId: 'room-test-1',
      store,
      nowMs: 1_700_000_020_000,
    });
    assert.equal(rotated.ok, true);
    assert.notEqual(rotated.invite.token, created.meta.invite.token);

    // Revoke invite token
    const revoked = await revokeInviteToken({ roomId: 'room-test-1', store });
    assert.equal(revoked.ok, true);
    assert.equal(revoked.invite.expiresAt, 0);

    // Relink member from old UID (e.g. lost device) to new UID
    const relinked = await relinkMemberUid({
      roomId: 'room-test-1',
      oldUid: 'uid-member-2',
      newUid: 'uid-member-2-new-phone',
      store,
      nowMs: 1_700_000_030_000,
    });
    assert.equal(relinked.ok, true);
    assert.equal(relinked.member.name, 'الأم');
    const membersMap = await store.getCollection('room-test-1', 'members');
    assert.equal(membersMap['uid-member-2'], undefined);
    assert.equal(membersMap['uid-member-2-new-phone'].name, 'الأم');
  } finally {
    setFirebaseSdkOverrideForTests(null);
  }
});

test('local convenience PIN lock uses WebCrypto PBKDF2 in IndexedDB only and rejects weak PINs', async () => {
  const store = new LocalStore(new IDBFactory());

  const weakRes = await setLocalPinLock('1234', store);
  assert.equal(weakRes.ok, false);
  assert.equal(weakRes.reason, 'weak-pin');

  const shortRes = await setLocalPinLock('12', store);
  assert.equal(shortRes.ok, false);
  assert.equal(shortRes.reason, 'invalid-length');

  const okRes = await setLocalPinLock('5839', store);
  assert.equal(okRes.ok, true);

  const storedPref = await store.getPref('pinLock', null);
  assert.equal(storedPref.enabled, true);
  assert.equal(storedPref.algorithm, 'PBKDF2-SHA256-100000');
  assert.equal(storedPref.salt.length, 32);
  assert.equal(storedPref.hash.length, 64);

  const verifyGood = await verifyLocalPinLock('5839', store);
  assert.equal(verifyGood.ok, true);

  const verifyBad = await verifyLocalPinLock('9999', store);
  assert.equal(verifyBad.ok, false);

  await clearLocalPinLock(store);
  const afterClear = await verifyLocalPinLock('0000', store);
  assert.equal(afterClear.enabled, false);
  assert.equal(afterClear.ok, true);
});

test('auth invite helpers generate and parse #join=<rid>.<token> links', () => {
  const invite = generateInviteToken(3600_000, 1_700_000_000_000);
  assert.equal(invite.token.length, 32);
  assert.equal(invite.expiresAt, 1_700_003_600_000);

  const url = buildInviteUrl('family-room', invite.token, 'https://family-requests-9e431.web.app');
  const parsed = parseJoinHash(new URL(url).hash);
  assert.deepEqual(parsed, { roomId: 'family-room', token: invite.token });
  assert.equal(parseJoinHash('#join=invalid'), null);
});

test('AI action envelope parser and Gemini free-model filter work as specified', () => {
  assert.ok(SUPPORTED_AI_ACTIONS.includes('add_items'));
  assert.ok(SUPPORTED_AI_ACTIONS.includes('add_request'));
  assert.ok(CONFIRM_REQUIRED_AI_ACTIONS.includes('delete_items'));

  const parsed = parseAiEnvelope(
    '```json\n{"reply":"تمت الإضافة","actions":[{"name":"add_items","args":{"items":[{"n":"حليب"}]}}]}\n```'
  );
  assert.equal(parsed.reply, 'تمت الإضافة');
  assert.equal(parsed.actions.length, 1);
  assert.equal(parsed.actions[0].name, 'add_items');

  const models = filterCandidateGeminiModels([
    { name: 'models/gemini-2.5-flash', supportedGenerationMethods: ['generateContent'] },
    { name: 'models/gemini-2.5-pro-tts', supportedGenerationMethods: ['generateContent'] },
    { name: 'models/text-embedding-004', supportedGenerationMethods: ['embedContent'] },
    { name: 'models/gemini-2.0-flash-exp', supportedGenerationMethods: ['generateContent'] },
  ]);
  assert.deepEqual(models, ['gemini-2.5-flash']);
});

test('RTDB emulator security rules enforcement (@firebase/rules-unit-testing when emulator port 9000 is running)', async (t) => {
  const emulatorUp = await isPortOpen(9000);
  if (!emulatorUp) {
    // Validated via static rules assertions above when RTDB emulator is not running in background
    return;
  }

  const { initializeTestEnvironment, assertFails, assertSucceeds } =
    await import('@firebase/rules-unit-testing');
  const rulesText = fs.readFileSync(path.join(projectRoot, 'database.rules.json'), 'utf8');

  const testEnv = await initializeTestEnvironment({
    projectId: 'family-requests-9e431',
    database: {
      host: '127.0.0.1',
      port: 9000,
      rules: rulesText,
    },
  });

  t.after(async () => {
    await testEnv.cleanup();
  });

  await testEnv.clearDatabase();

  const roomId = 'test-room-1';
  const adminDb = testEnv.authenticatedContext('admin-uid').database();
  const memberDb = testEnv.authenticatedContext('member-uid').database();
  const childDb = testEnv.authenticatedContext('child-uid').database();
  const outsiderDb = testEnv.authenticatedContext('outsider-uid').database();

  // 1. Admin creates room (members/$uid then meta)
  await assertSucceeds(
    adminDb.ref(`v2/rooms/${roomId}/members/admin-uid`).set({
      name: 'الأب',
      icon: '🛡️',
      role: 'admin',
      off: false,
      joinedAt: 1700000000000,
    })
  );
  await assertSucceeds(
    adminDb.ref(`v2/rooms/${roomId}/meta`).set({
      name: 'عائلتي',
      createdAt: 1700000000000,
      schemaVersion: 1,
      invite: {
        token: 'valid-token-123456',
        expiresAt: Date.now() + 3600_000,
      },
    })
  );

  // 2. Non-member cannot read
  await assertFails(outsiderDb.ref(`v2/rooms/${roomId}/items`).get());

  // 3. Member joins with valid token; expired/wrong token fails
  await assertFails(
    outsiderDb.ref(`v2/rooms/${roomId}/members/outsider-uid`).set({
      name: 'غريب',
      icon: '👤',
      role: 'member',
      off: false,
      joinedAt: Date.now(),
      token: 'wrong-token',
    })
  );
  await assertSucceeds(
    memberDb.ref(`v2/rooms/${roomId}/members/member-uid`).set({
      name: 'الأم',
      icon: '❤️',
      role: 'member',
      off: false,
      joinedAt: Date.now(),
      token: 'valid-token-123456',
    })
  );
  await assertSucceeds(
    childDb.ref(`v2/rooms/${roomId}/members/child-uid`).set({
      name: 'الابن',
      icon: '👦',
      role: 'child',
      off: false,
      joinedAt: Date.now(),
      token: 'valid-token-123456',
    })
  );

  // 4. Member cannot write ai or rotate invite
  await assertFails(memberDb.ref(`v2/rooms/${roomId}/ai`).set({ on: 'p1', t: Date.now() }));
  await assertFails(
    memberDb.ref(`v2/rooms/${roomId}/meta/invite`).set({
      token: 'hacked-token',
      expiresAt: Date.now() + 999999,
    })
  );

  // 5. Child cannot write items, but can submit a pending request
  await assertFails(
    childDb.ref(`v2/rooms/${roomId}/items/i1`).set({
      n: 'عصير',
      q: '1',
      p: 5,
      c: 'super',
      u: false,
      by: 'child-uid',
      byName: 'الابن',
      dn: false,
      dnBy: '',
      dnAt: 0,
      cl: '',
      note: '',
      updatedAt: Date.now(),
      createdAt: Date.now(),
      deleted: false,
    })
  );
  await assertSucceeds(
    childDb.ref(`v2/rooms/${roomId}/requests/r1`).set({
      by: 'child-uid',
      n: 'عصير',
      q: '1',
      c: 'super',
      status: 'pending',
      updatedAt: Date.now(),
    })
  );

  // 6. Malformed item (negative price) is rejected even for admin
  await assertFails(
    adminDb.ref(`v2/rooms/${roomId}/items/bad1`).set({
      n: 'غرض خاطئ',
      q: '1',
      p: -10,
      c: 'super',
      u: false,
      by: 'admin-uid',
      byName: 'الأب',
      dn: false,
      dnBy: '',
      dnAt: 0,
      cl: '',
      note: '',
      updatedAt: Date.now(),
      createdAt: Date.now(),
      deleted: false,
    })
  );
});
