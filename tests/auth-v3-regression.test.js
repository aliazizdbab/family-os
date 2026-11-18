/**
 * Phase 1 regression test — Family Portal login MUST go through Firebase Auth.
 *
 * Documents the root-cause defect (RC1) in docs/FEATURE_REQUEST_CROSS_FAMILY_SYNC.md:
 * the family portal login (`app.js handleFamilyLogin`) authenticates purely locally and
 * never calls `loginFamilyMember` from `auth-v3.js`, so registered families never appear
 * on other devices and every copy runs as an island.
 *
 * This test pins the CONTRACT that `loginFamilyMember` must satisfy so the app can be
 * wired to it later:
 *   1. Given a family registered via `registerFamilyRequest`,
 *   2. `loginFamilyMember` for the same family+member+password MUST return ok:true
 *      with a session whose `fid` matches the registered family.
 *   3. A wrong password MUST be rejected (ok:false).
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { IDBFactory } from 'fake-indexeddb';

// auth-v3.js captures `localStore` (a LocalStore bound to globalThis.indexedDB) at import
// time, so fake IndexedDB must be installed BEFORE importing any app module.
globalThis.indexedDB = new IDBFactory();

const {
  setFirebaseSdkOverride,
  loginFamilyMember,
  registerFamilyRequest,
} = await import('../public/js/auth-v3.js');

function createV3MockCloud() {
  // A minimal RTDB-like nested tree. set/get/update/remove operate on dot/slash paths.
  const root = {};
  const users = new Map(); // email -> { uid, password }
  let uidCounter = 0;

  const nextUid = () => `uid-${++uidCounter}`;

  const getIn = (tree, path) => {
    let node = tree;
    for (const seg of path.split('/').filter(Boolean)) {
      if (node == null || typeof node !== 'object') return undefined;
      node = node[seg];
    }
    return node;
  };

  const setIn = (tree, path, value) => {
    const segs = path.split('/').filter(Boolean);
    let node = tree;
    for (let i = 0; i < segs.length - 1; i += 1) {
      const seg = segs[i];
      if (node[seg] == null || typeof node[seg] !== 'object') node[seg] = {};
      node = node[seg];
    }
    if (value === null) {
      delete node[segs[segs.length - 1]];
    } else {
      node[segs[segs.length - 1]] = value;
    }
  };

  const updateIn = (tree, path, patch) => {
    for (const [rel, value] of Object.entries(patch)) {
      const fullPath = path ? `${path}/${rel}` : rel;
      setIn(tree, fullPath, structuredClone(value));
    }
  };

  const dbMod = {
    ref: (_db, path) => ({ path: path == null ? '' : path }),
    set: async (refObj, val) => {
      setIn(root, refObj.path || '', structuredClone(val));
    },
    update: async (refObj, patch) => {
      updateIn(root, refObj.path || '', patch);
    },
    remove: async (refObj) => {
      setIn(root, refObj.path || '', null);
    },
    get: async (refObj) => {
      const val = getIn(root, refObj.path || '');
      return {
        exists: () => val !== undefined && val !== null,
        val: () => structuredClone(val),
      };
    },
  };

  const authMod = {
    getAuth: () => ({ currentUser: null }),
    connectAuthEmulator: () => {},
    createUserWithEmailAndPassword: async (_auth, email, password) => {
      if (users.has(email)) {
        const err = new Error('email-already-in-use');
        err.code = 'auth/email-already-in-use';
        throw err;
      }
      const uid = nextUid();
      users.set(email, { uid, password });
      return { user: { uid, email, isAnonymous: false } };
    },
    signInWithEmailAndPassword: async (_auth, email, password) => {
      const rec = users.get(email);
      if (!rec || rec.password !== password) {
        const err = new Error('invalid-credential');
        err.code = 'auth/invalid-credential';
        throw err;
      }
      return { user: { uid: rec.uid, email, isAnonymous: false } };
    },
  };

  const appMod = {
    getApps: () => [{}],
    initializeApp: () => ({}),
  };

  return {
    sdk: { appMod, authMod, dbMod },
    root,
    // helpers for assertions / approvals
    getNode: (path) => getIn(root, path),
    setNode: (path, val) => setIn(root, path, structuredClone(val)),
    users,
  };
}

test('RC1 contract: registerFamilyRequest writes v3/ and loginFamilyMember authenticates against it', async () => {
  const cloud = createV3MockCloud();
  setFirebaseSdkOverride(cloud.sdk);

  // 1. Register a new family (this writes to /v3/... in the mock cloud)
  const reg = await registerFamilyRequest({
    familyName: 'العائلة الأولى',
    ownerName: 'الأب',
    email: 'owner@example.com',
    phone: '',
    password: 'Passw0rd!23',
  });
  assert.equal(reg.ok, true, `registerFamilyRequest should succeed: ${JSON.stringify(reg)}`);
  assert.ok(reg.fid, 'registered family must have a fid');

  // Sanity: the v3 familyIndex node exists in the mock cloud.
  const famIndex = cloud.getNode('v3/familyIndex');
  assert.ok(famIndex && typeof famIndex === 'object', 'v3/familyIndex must contain the registered family');
  const famHash = Object.keys(famIndex)[0];
  assert.equal(famIndex[famHash].fid, reg.fid);

  // 1b. Staff approves the pending family (mirrors admin-controller.approvePendingFamily).
  cloud.setNode(`v3/familyIndex/${famHash}/status`, 'active');
  cloud.setNode(`v3/families/${reg.fid}/meta/status`, 'active');

  // 2. Login with the SAME family name + member name + password.
  const login = await loginFamilyMember({
    familyName: 'العائلة الأولى',
    memberName: 'الأب',
    password: 'Passw0rd!23',
  });

  assert.equal(login.ok, true, `loginFamilyMember should succeed: ${JSON.stringify(login)}`);
  assert.equal(login.session.fid, reg.fid, 'session fid must match the registered family fid');
  assert.equal(login.session.loggedIn, true, 'session must be marked loggedIn');
});

test('RC1 contract: loginFamilyMember rejects a wrong password', async () => {
  const cloud = createV3MockCloud();
  setFirebaseSdkOverride(cloud.sdk);

  await registerFamilyRequest({
    familyName: 'عائلة الرفض',
    ownerName: 'الأب',
    email: 'reject@example.com',
    phone: '',
    password: 'GoodPass123',
  });

  const login = await loginFamilyMember({
    familyName: 'عائلة الرفض',
    memberName: 'الأب',
    password: 'WrongPass999',
  });

  assert.equal(login.ok, false, 'wrong password must fail');
  assert.equal(login.session, undefined, 'failed login must not return a session');
});

test('RC4 fix: successful login bootstraps the v2 sync room for the family exactly once', async () => {
  const cloud = createV3MockCloud();
  setFirebaseSdkOverride(cloud.sdk);

  const reg = await registerFamilyRequest({
    familyName: 'عائلة المزامنة',
    ownerName: 'الأب',
    email: 'sync@example.com',
    phone: '',
    password: 'SyncPass123',
  });
  assert.equal(reg.ok, true);

  // Approve the pending family (as staff would).
  const famIndex = cloud.getNode('v3/familyIndex');
  const famHash = Object.keys(famIndex)[0];
  cloud.setNode(`v3/familyIndex/${famHash}/status`, 'active');
  cloud.setNode(`v3/families/${reg.fid}/meta/status`, 'active');

  // Before login, the v2 sync room must not exist yet.
  assert.equal(cloud.getNode(`v2/rooms/${reg.fid}/meta`), undefined, 'v2 room must not exist before login');

  // Login — this must bootstrap the v2 room.
  const login = await loginFamilyMember({
    familyName: 'عائلة المزامنة',
    memberName: 'الأب',
    password: 'SyncPass123',
  });
  assert.equal(login.ok, true, `login should succeed: ${JSON.stringify(login)}`);

  const meta = cloud.getNode(`v2/rooms/${reg.fid}/meta`);
  assert.ok(meta, 'v2 room meta must be created on login');
  assert.equal(meta.schemaVersion, 1, 'v2 room meta must use schema v1');

  const members = cloud.getNode(`v2/rooms/${reg.fid}/members`);
  assert.ok(members, 'v2 room members must be created');
  const adminUid = Object.keys(members)[0];
  assert.equal(members[adminUid].role, 'admin', 'the logging-in user must be the room admin');

  const cats = cloud.getNode(`v2/rooms/${reg.fid}/cats`);
  assert.ok(cats && Object.keys(cats).length > 0, 'default categories must be seeded');

  const budget = cloud.getNode(`v2/rooms/${reg.fid}/budget`);
  assert.ok(budget && typeof budget.monthly === 'number', 'budget must be seeded');

  // Idempotency: logging in again must NOT overwrite the room meta.
  const metaBefore = JSON.stringify(cloud.getNode(`v2/rooms/${reg.fid}/meta`));
  await loginFamilyMember({
    familyName: 'عائلة المزامنة',
    memberName: 'الأب',
    password: 'SyncPass123',
  });
  assert.equal(
    JSON.stringify(cloud.getNode(`v2/rooms/${reg.fid}/meta`)),
    metaBefore,
    're-login must not overwrite the existing v2 room meta (idempotent)'
  );
});
