import {
  DEFAULT_CATS,
  SCHEMA_VERSION,
  createBudget,
  createCategory,
  createMember,
  createMeta,
} from './schema.js';
import {
  DEFAULT_FIREBASE_CONFIG,
  DEFAULT_FIREBASE_PROJECT_ID,
  DEFAULT_RTDB_URL,
  state,
} from './state.js';
import { localStore } from './store-idb.js';

const FIREBASE_APP_CDN = 'https://www.gstatic.com/firebasejs/13.1.0/firebase-app.js';
const FIREBASE_AUTH_CDN = 'https://www.gstatic.com/firebasejs/13.1.0/firebase-auth.js';
const FIREBASE_DB_CDN = 'https://www.gstatic.com/firebasejs/13.1.0/firebase-database.js';

const WEAK_PINS = new Set(['1234', '0000', '1111', '12345678']);

let firebaseAppInstance = null;
let firebaseAuthInstance = null;
let firebaseDbInstance = null;
let authEmulatorConnected = false;
let dbEmulatorConnected = false;
let sdkOverride = null;

export function setFirebaseSdkOverrideForTests(override) {
  sdkOverride = override;
  firebaseAppInstance = null;
  firebaseAuthInstance = null;
  firebaseDbInstance = null;
  authEmulatorConnected = false;
  dbEmulatorConnected = false;
}

async function loadFirebaseSdkModules() {
  if (sdkOverride) return sdkOverride;
  const [appMod, authMod, dbMod] = await Promise.all([
    import(FIREBASE_APP_CDN),
    import(FIREBASE_AUTH_CDN),
    import(FIREBASE_DB_CDN),
  ]);
  return { appMod, authMod, dbMod };
}

export async function resolveFirebaseConfig(overrides = {}) {
  const baseConfig = {
    ...DEFAULT_FIREBASE_CONFIG,
    apiKey: overrides.apiKey || state.prefs.firebaseApiKey || DEFAULT_FIREBASE_CONFIG.apiKey,
    authDomain: `${DEFAULT_FIREBASE_PROJECT_ID}.firebaseapp.com`,
    databaseURL: overrides.databaseURL || state.prefs.rtdbUrl || DEFAULT_RTDB_URL,
    projectId: overrides.projectId || DEFAULT_FIREBASE_PROJECT_ID,
    appId: overrides.appId || state.prefs.firebaseAppId || DEFAULT_FIREBASE_CONFIG.appId,
  };

  if (typeof fetch === 'function' && !overrides.skipHostingInit) {
    try {
      const res = await fetch('/__/firebase/init.json', { cache: 'no-store' });
      if (res.ok) {
        const hostedConfig = await res.json();
        if (hostedConfig && hostedConfig.projectId) {
          return {
            ...baseConfig,
            ...hostedConfig,
            databaseURL: hostedConfig.databaseURL || baseConfig.databaseURL,
          };
        }
      }
    } catch {
      // Not running on Firebase Hosting or offline; use fallback config
    }
  }

  return baseConfig;
}

export function generateInviteToken(ttlMs = 7 * 24 * 60 * 60 * 1000, nowMs = Date.now()) {
  const bytes = new Uint8Array(16);
  if (globalThis.crypto?.getRandomValues) {
    globalThis.crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < bytes.length; i += 1) {
      bytes[i] = Math.floor(Math.random() * 256);
    }
  }
  const token = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return {
    token,
    expiresAt: nowMs + ttlMs,
  };
}

export function buildInviteUrl(
  roomId,
  token,
  baseOrigin = globalThis.location?.origin || 'https://family-requests-9e431.web.app'
) {
  const cleanOrigin = String(baseOrigin || '').replace(/\/+$/, '');
  return `${cleanOrigin}/#join=${encodeURIComponent(roomId)}.${encodeURIComponent(token)}`;
}

export function parseJoinHash(hashString = globalThis.location?.hash || '') {
  const raw = String(hashString || '').replace(/^#/, '');
  if (!raw.startsWith('join=')) return null;
  const value = raw.slice('join='.length).trim();
  const dotIndex = value.indexOf('.');
  if (dotIndex <= 0 || dotIndex >= value.length - 1) return null;
  const roomId = decodeURIComponent(value.slice(0, dotIndex));
  const token = decodeURIComponent(value.slice(dotIndex + 1));
  if (!roomId || !token || token.length < 6) return null;
  return { roomId, token };
}

export async function initFirebaseServices({
  useEmulator = state.prefs.useEmulator,
  rtdbUrl = state.prefs.rtdbUrl,
} = {}) {
  const config = await resolveFirebaseConfig({
    databaseURL: rtdbUrl,
    skipHostingInit: Boolean(useEmulator),
  });
  const { appMod, authMod, dbMod } = await loadFirebaseSdkModules();

  const effectiveConfig = {
    ...config,
    apiKey: config.apiKey || (useEmulator ? 'demo-family-os-emulator-key' : ''),
    databaseURL: useEmulator
      ? `http://127.0.0.1:9000/?ns=${config.projectId}-default-rtdb`
      : config.databaseURL,
  };

  if (!effectiveConfig.apiKey) {
    return {
      ok: false,
      sdkLoaded: true,
      reason: 'missing-api-key',
      config: effectiveConfig,
    };
  }

  if (!firebaseAppInstance) {
    const existing = appMod.getApps?.() || [];
    firebaseAppInstance = existing.length ? existing[0] : appMod.initializeApp(effectiveConfig);
  }
  if (!firebaseAuthInstance) {
    firebaseAuthInstance = authMod.getAuth(firebaseAppInstance);
  }
  if (!firebaseDbInstance) {
    firebaseDbInstance = dbMod.getDatabase(firebaseAppInstance, effectiveConfig.databaseURL);
  }

  if (useEmulator && !authEmulatorConnected) {
    authMod.connectAuthEmulator(firebaseAuthInstance, 'http://127.0.0.1:9099', {
      disableWarnings: true,
    });
    authEmulatorConnected = true;
  }

  if (useEmulator && !dbEmulatorConnected) {
    dbMod.connectDatabaseEmulator(firebaseDbInstance, '127.0.0.1', 9000);
    dbEmulatorConnected = true;
  }

  return {
    ok: true,
    sdkLoaded: true,
    app: firebaseAppInstance,
    auth: firebaseAuthInstance,
    db: firebaseDbInstance,
    appMod,
    authMod,
    dbMod,
    config: effectiveConfig,
  };
}

export async function initFirebaseAuth(options = {}) {
  return initFirebaseServices(options);
}

export async function signInAnonymouslyIfConfigured(options = {}) {
  const services = await initFirebaseServices(options);
  if (!services.ok) return services;
  const { auth, authMod } = services;
  if (auth.currentUser) {
    state.firebaseStatus.authReady = true;
    state.firebaseStatus.uid = auth.currentUser.uid;
    return {
      ...services,
      ok: true,
      uid: auth.currentUser.uid,
      isAnonymous: auth.currentUser.isAnonymous,
    };
  }
  const cred = await authMod.signInAnonymously(auth);
  state.firebaseStatus.authReady = true;
  state.firebaseStatus.uid = cred.user.uid;
  return {
    ...services,
    ok: true,
    uid: cred.user.uid,
    isAnonymous: cred.user.isAnonymous,
  };
}

export async function createRoom({
  roomId,
  roomName = 'عائلتي',
  adminName = 'المسؤول',
  adminIcon = '🛡️',
  store = localStore,
  useEmulator = state.prefs.useEmulator,
  nowMs = Date.now(),
} = {}) {
  const cleanRoomId =
    String(roomId || '')
      .trim()
      .replace(/[^a-zA-Z0-9_-]/g, '') || `family-${Math.random().toString(36).slice(2, 8)}`;

  const authRes = await signInAnonymouslyIfConfigured({ useEmulator });
  if (!authRes.ok) return authRes;

  const { uid, db, dbMod } = authRes;
  const invite = generateInviteToken(7 * 24 * 60 * 60 * 1000, nowMs);
  const meta = createMeta({
    name: roomName,
    createdAt: nowMs,
    schemaVersion: SCHEMA_VERSION,
    invite,
  });
  const adminMember = createMember({
    id: uid,
    name: adminName,
    icon: adminIcon,
    role: 'admin',
    off: false,
    joinedAt: nowMs,
  });
  const budget = createBudget({ monthly: 250, perCat: {} });

  // Persist to local store first (offline-first)
  await store.setRoomDoc(cleanRoomId, { meta, budget });
  const adminPayload = { ...adminMember };
  delete adminPayload.id;
  await store.putEntity(cleanRoomId, 'members', uid, adminPayload);

  for (const catDef of DEFAULT_CATS) {
    const cat = createCategory({ ...catDef, updatedAt: nowMs, deleted: false });
    const { id: catId, ...catPayload } = cat;
    await store.putEntity(cleanRoomId, 'cats', catId, catPayload);
  }

  // Write to RTDB if online
  if (db && dbMod) {
    const memberRef = dbMod.ref(db, `v2/rooms/${cleanRoomId}/members/${uid}`);
    await dbMod.set(memberRef, adminPayload);

    const metaRef = dbMod.ref(db, `v2/rooms/${cleanRoomId}/meta`);
    await dbMod.set(metaRef, meta);

    const budgetRef = dbMod.ref(db, `v2/rooms/${cleanRoomId}/budget`);
    await dbMod.set(budgetRef, budget);

    for (const catDef of DEFAULT_CATS) {
      const cat = createCategory({ ...catDef, updatedAt: nowMs, deleted: false });
      const { id: catId, ...catPayload } = cat;
      const catRef = dbMod.ref(db, `v2/rooms/${cleanRoomId}/cats/${catId}`);
      await dbMod.set(catRef, catPayload);
    }
  }

  return {
    ok: true,
    roomId: cleanRoomId,
    uid,
    role: 'admin',
    meta,
    member: adminMember,
    inviteUrl: buildInviteUrl(cleanRoomId, invite.token),
  };
}

export async function joinRoomWithInvite({
  roomId,
  token,
  memberName = 'عضو العائلة',
  memberIcon = '🏠',
  role = 'member',
  store = localStore,
  useEmulator = state.prefs.useEmulator,
  nowMs = Date.now(),
} = {}) {
  const cleanRoomId = String(roomId || '').trim();
  const cleanToken = String(token || '').trim();
  if (!cleanRoomId || cleanToken.length < 6) {
    return { ok: false, reason: 'invalid-invite' };
  }

  const authRes = await signInAnonymouslyIfConfigured({ useEmulator });
  if (!authRes.ok) return authRes;

  const { uid, db, dbMod } = authRes;
  const safeRole = role === 'child' ? 'child' : 'member';
  const memberObj = createMember({
    id: uid,
    name: memberName,
    icon: memberIcon,
    role: safeRole,
    off: false,
    joinedAt: nowMs,
  });
  const memberPayload = { ...memberObj };
  delete memberPayload.id;

  if (db && dbMod) {
    const memberRef = dbMod.ref(db, `v2/rooms/${cleanRoomId}/members/${uid}`);
    await dbMod.set(memberRef, {
      ...memberPayload,
      token: cleanToken,
    });
  }

  await store.putEntity(cleanRoomId, 'members', uid, memberPayload);

  return {
    ok: true,
    roomId: cleanRoomId,
    uid,
    role: safeRole,
    member: memberObj,
  };
}

export async function rotateInviteToken({
  roomId,
  ttlMs = 7 * 24 * 60 * 60 * 1000,
  store = localStore,
  useEmulator = state.prefs.useEmulator,
  nowMs = Date.now(),
} = {}) {
  const invite = generateInviteToken(ttlMs, nowMs);
  const snap = await store.loadRoomSnapshot(roomId);
  const nextMeta = createMeta({
    ...(snap.meta || {}),
    invite,
  });
  await store.setRoomDoc(roomId, { meta: nextMeta });

  const authRes = await signInAnonymouslyIfConfigured({ useEmulator });
  if (authRes.ok && authRes.db && authRes.dbMod) {
    const inviteRef = authRes.dbMod.ref(authRes.db, `v2/rooms/${roomId}/meta/invite`);
    await authRes.dbMod.set(inviteRef, invite);
  }

  return {
    ok: true,
    invite,
    inviteUrl: buildInviteUrl(roomId, invite.token),
  };
}

export async function revokeInviteToken({
  roomId,
  store = localStore,
  useEmulator = state.prefs.useEmulator,
} = {}) {
  const revokedInvite = { token: 'revoked-000000', expiresAt: 0 };
  const snap = await store.loadRoomSnapshot(roomId);
  const nextMeta = createMeta({
    ...(snap.meta || {}),
    invite: revokedInvite,
  });
  await store.setRoomDoc(roomId, { meta: nextMeta });

  const authRes = await signInAnonymouslyIfConfigured({ useEmulator });
  if (authRes.ok && authRes.db && authRes.dbMod) {
    const inviteRef = authRes.dbMod.ref(authRes.db, `v2/rooms/${roomId}/meta/invite`);
    await authRes.dbMod.set(inviteRef, revokedInvite);
  }

  return { ok: true, invite: revokedInvite };
}

export async function relinkMemberUid({
  roomId,
  oldUid,
  newUid,
  store = localStore,
  useEmulator = state.prefs.useEmulator,
  nowMs = Date.now(),
} = {}) {
  const members = await store.getCollection(roomId, 'members');
  const existing = members[oldUid];
  if (!existing) {
    return { ok: false, reason: 'member-not-found' };
  }

  const relinked = createMember({
    id: newUid,
    name: existing.name,
    icon: existing.icon,
    role: existing.role,
    off: false,
    joinedAt: existing.joinedAt || nowMs,
  });
  const relinkedPayload = { ...relinked };
  delete relinkedPayload.id;

  await store.putEntity(roomId, 'members', newUid, relinkedPayload);
  if (oldUid !== newUid) {
    await store.removeEntityHard(roomId, 'members', oldUid);
  }

  const authRes = await signInAnonymouslyIfConfigured({ useEmulator });
  if (authRes.ok && authRes.db && authRes.dbMod) {
    const newRef = authRes.dbMod.ref(authRes.db, `v2/rooms/${roomId}/members/${newUid}`);
    await authRes.dbMod.set(newRef, relinkedPayload);
    if (oldUid !== newUid) {
      const oldRef = authRes.dbMod.ref(authRes.db, `v2/rooms/${roomId}/members/${oldUid}`);
      await authRes.dbMod.remove(oldRef);
    }
  }

  return { ok: true, member: relinked };
}

/* ---------- Local Convenience PIN Lock (WebCrypto PBKDF2, IndexedDB only) ---------- */

function bytesToHex(bytes) {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

function hexToBytes(hex) {
  const clean = String(hex || '');
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i += 1) {
    out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16) || 0;
  }
  return out;
}

export async function derivePinHash(pin, saltHex, iterations = 100000) {
  const enc = new globalThis.TextEncoder();
  const keyMaterial = await globalThis.crypto.subtle.importKey(
    'raw',
    enc.encode(String(pin)),
    { name: 'PBKDF2' },
    false,
    ['deriveBits']
  );
  const bits = await globalThis.crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      salt: hexToBytes(saltHex),
      iterations,
      hash: 'SHA-256',
    },
    keyMaterial,
    256
  );
  return bytesToHex(new Uint8Array(bits));
}

export async function setLocalPinLock(pin, store = localStore) {
  const cleanPin = String(pin ?? '').trim();
  if (!/^\d{4,8}$/.test(cleanPin)) {
    return { ok: false, reason: 'invalid-length', message: 'يجب أن يتكون الرمز من 4 إلى 8 أرقام' };
  }
  if (WEAK_PINS.has(cleanPin)) {
    return { ok: false, reason: 'weak-pin', message: 'الرمز ضعيف جداً، اختر رمزاً آخر' };
  }
  const saltBytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(saltBytes);
  const saltHex = bytesToHex(saltBytes);
  const hashHex = await derivePinHash(cleanPin, saltHex);

  await store.setPref('pinLock', {
    enabled: true,
    salt: saltHex,
    hash: hashHex,
    algorithm: 'PBKDF2-SHA256-100000',
  });
  return { ok: true };
}

export async function verifyLocalPinLock(pin, store = localStore) {
  const rec = await store.getPref('pinLock', null);
  if (!rec || !rec.enabled || !rec.salt || !rec.hash) {
    return { ok: true, enabled: false };
  }
  const computed = await derivePinHash(String(pin ?? '').trim(), rec.salt);
  return {
    ok: computed === rec.hash,
    enabled: true,
  };
}

export async function clearLocalPinLock(store = localStore) {
  await store.setPref('pinLock', { enabled: false });
  return { ok: true };
}
