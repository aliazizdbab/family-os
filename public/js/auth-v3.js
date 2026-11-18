/**
 * Family OS v3 Authentication & Access Control Module
 *
 * Implements strict multi-tenant isolation, clean (Family Name + Member Name + Password)
 * member login without exposing family codes to normal users, and dedicated Staff/Developer
 * portal authentication with Owner role protection (aliazizdbab@gmail.com).
 */

import {
  OWNER_EMAIL,
  defaultFeatureFlags,
  describeAuthError,
  familyNameHash,
  isValidDisplayName,
  isValidEmail,
  isValidPhone,
  memberAuthEmail,
  memberNameHash,
  sha256Hex,
  newId,
  normalizeName,
  validatePassword,
} from './identity.js';
import {
  DEFAULT_FIREBASE_CONFIG,
  DEFAULT_FIREBASE_PROJECT_ID,
  DEFAULT_RTDB_URL,
  state,
} from './state.js';
import {
  DEFAULT_CATS,
  SCHEMA_VERSION,
  createBudget,
  createCategory,
  createMember,
  createMeta,
} from './schema.js';
import { generateInviteToken } from './auth.js';
import { localStore } from './store-idb.js';

const FIREBASE_APP_CDN = 'https://www.gstatic.com/firebasejs/13.1.0/firebase-app.js';
const FIREBASE_AUTH_CDN = 'https://www.gstatic.com/firebasejs/13.1.0/firebase-auth.js';
const FIREBASE_DB_CDN = 'https://www.gstatic.com/firebasejs/13.1.0/firebase-database.js';

let firebaseApp = null;
let firebaseAuth = null;
let firebaseDb = null;
let emulatorsConfigured = false;
let sdkOverride = null;

export function setFirebaseSdkOverride(override) {
  sdkOverride = override;
  firebaseApp = null;
  firebaseAuth = null;
  firebaseDb = null;
  emulatorsConfigured = false;
}

export async function getFirebaseServices({ useEmulator = state.prefs.useEmulator } = {}) {
  if (sdkOverride) return sdkOverride;

  const [appMod, authMod, dbMod] = await Promise.all([
    import(FIREBASE_APP_CDN),
    import(FIREBASE_AUTH_CDN),
    import(FIREBASE_DB_CDN),
  ]);

  if (!firebaseApp) {
    const apps = appMod.getApps();
    const config = {
      ...DEFAULT_FIREBASE_CONFIG,
      apiKey: state.prefs.firebaseApiKey || DEFAULT_FIREBASE_CONFIG.apiKey,
      authDomain: `${DEFAULT_FIREBASE_PROJECT_ID}.firebaseapp.com`,
      databaseURL: state.prefs.rtdbUrl || DEFAULT_RTDB_URL,
      projectId: DEFAULT_FIREBASE_PROJECT_ID,
      appId: state.prefs.firebaseAppId || DEFAULT_FIREBASE_CONFIG.appId,
    };
    firebaseApp = apps.length > 0 ? apps[0] : appMod.initializeApp(config);
    firebaseAuth = authMod.getAuth(firebaseApp);
    firebaseDb = dbMod.getDatabase(firebaseApp);

    if (useEmulator && !emulatorsConfigured) {
      try {
        authMod.connectAuthEmulator(firebaseAuth, 'http://127.0.0.1:9099', {
          disableWarnings: true,
        });
        dbMod.connectDatabaseEmulator(firebaseDb, '127.0.0.1', 9000);
        emulatorsConfigured = true;
      } catch {
        // already connected or running against live server
      }
    }
  }

  return { app: firebaseApp, auth: firebaseAuth, db: firebaseDb, appMod, authMod, dbMod };
}

/**
 * Ensure the v2 sync room exists for a freshly authenticated v3 family.
 *
 * RC4 fix: registration writes to /v3/... but the live sync engine reads/writes
 * /v2/rooms/{fid}/... . Without this bootstrap, a brand-new family would sign in
 * and see an empty room on every device. This function creates the canonical
 * v2 room skeleton (meta + budget + admin member + default categories) exactly
 * once, using the *real* authenticated uid, so the room's security rules accept
 * the writer as its admin.
 *
 * Idempotent: if /v2/rooms/{fid}/meta already exists, nothing is written.
 */
async function ensureV2RoomForFamily({ db, dbMod, fid, uid, familyName, memberName, role, nowMs = Date.now() }) {
  try {
    // IMPORTANT ordering: v2/rooms/{fid} is only readable by an existing room
    // member, so the membership record must be created FIRST. Any "does the room
    // exist?" read before that throws PERMISSION_DENIED and silently aborts the
    // bootstrap (the original cause of empty rooms on new families).
    const adminMember = createMember({
      id: uid,
      name: memberName || 'المسؤول',
      icon: role === 'admin' ? '🛡️' : '👤',
      role,
      off: false,
      joinedAt: nowMs,
    });
    const adminPayload = { ...adminMember };
    delete adminPayload.id;

    // Allowed by rules on first join (self + admin + members node absent) and on
    // repeat logins (existing admin may write members).
    await dbMod.set(dbMod.ref(db, `v2/rooms/${fid}/members/${uid}`), adminPayload);

    // Now that we are a member, the room is readable.
    const existing = await dbMod.get(dbMod.ref(db, `v2/rooms/${fid}/meta`));
    if (existing.exists()) return { bootstrapped: false };

    const invite = generateInviteToken(7 * 24 * 60 * 60 * 1000, nowMs);
    const meta = createMeta({
      name: familyName || 'عائلتي',
      createdAt: nowMs,
      schemaVersion: SCHEMA_VERSION,
      invite,
    });
    const budget = createBudget({ monthly: 250, perCat: {} });

    await dbMod.set(dbMod.ref(db, `v2/rooms/${fid}/meta`), meta);
    await dbMod.set(dbMod.ref(db, `v2/rooms/${fid}/budget`), budget);

    const catUpdates = {};
    for (const catDef of DEFAULT_CATS) {
      const cat = createCategory({ ...catDef, updatedAt: nowMs, deleted: false });
      const { id: catId, ...catPayload } = cat;
      catUpdates[`v2/rooms/${fid}/cats/${catId}`] = catPayload;
    }
    await dbMod.update(dbMod.ref(db), catUpdates);
    return { bootstrapped: true };
  } catch (err) {
    console.warn('[auth-v3] ensureV2RoomForFamily failed:', err);
    return { bootstrapped: false, error: err };
  }
}

/**
 * Family Member Login
 * Looks up family via normalized family name hash, verifies member exists,
 * derives synthetic Firebase Auth email, and authenticates securely.
 */
export async function loginFamilyMember({ familyName, memberName, password }) {
  const cleanFam = String(familyName || '').trim();
  const cleanMem = String(memberName || '').trim();
  const cleanPwd = String(password || '');

  if (!cleanFam) {
    return { ok: false, message: 'يرجى إدخال اسم العائلة.' };
  }
  if (!cleanMem) {
    return { ok: false, message: 'يرجى إدخال اسم الفرد.' };
  }
  if (!cleanPwd) {
    return { ok: false, message: 'يرجى إدخال كلمة المرور.' };
  }

  const famHash = await familyNameHash(cleanFam);
  const memHash = await memberNameHash(cleanMem);

  const { auth, db, authMod, dbMod } = await getFirebaseServices();

  let familyRecord = null;
  let fid = null;

  // 1. Look up family record in RTDB
  try {
    const famRef = dbMod.ref(db, `v3/familyIndex/${famHash}`);
    const famSnap = await dbMod.get(famRef);
    if (famSnap.exists()) {
      familyRecord = famSnap.val();
      fid = familyRecord.fid;
    }
  } catch (err) {
    console.warn('[auth-v3] family index RTDB lookup failed:', err);
  }

  // 1b. Fallback to local offline cache if offline or demo room
  if (!fid) {
    const localFam = await localStore.getPref(`v3_fam_${famHash}`, null);
    if (localFam) {
      familyRecord = localFam;
      fid = localFam.fid;
    }
  }

  // 1c. Backwards compatibility for demo room
  if (!fid && (cleanFam.toLowerCase() === 'family-v2-local' || normalizeName(cleanFam) === 'عائلتي')) {
    fid = 'family-v2-local';
    familyRecord = { fid, name: cleanFam, status: 'active' };
  }

  if (!fid || !familyRecord) {
    return {
      ok: false,
      message: 'اسم العائلة غير موجود. تحقق من كتابة الاسم أو انقر على "تسجيل عائلة جديدة".',
    };
  }

  if (familyRecord.status === 'pending') {
    return {
      ok: false,
      message: 'طلب تسجيل هذه العائلة قيد المراجعة والاعتماد من قبل الإدارة.',
    };
  }

  if (familyRecord.status === 'suspended') {
    return {
      ok: false,
      message: 'تم إيقاف حساب هذه العائلة مؤقتاً. يرجى مراجعة الدعم الفني.',
    };
  }

  // 2. Look up member credentials index
  let loginRecord = null;
  try {
    const loginRef = dbMod.ref(db, `v3/loginIndex/${fid}/${memHash}`);
    const loginSnap = await dbMod.get(loginRef);
    if (loginSnap.exists()) {
      loginRecord = loginSnap.val();
    }
  } catch (err) {
    console.warn('[auth-v3] login index RTDB lookup failed:', err);
  }

  const normName = normalizeName(cleanMem);
  const isFather = normName === 'الاب' || normName === 'ابو نور' || cleanMem === 'الأب';
  const gen = loginRecord?.gen || 1;
  const memberId =
    loginRecord?.memberId || (isFather ? 'mem_father' : `mem_${memHash.slice(0, 8)}`);
  const role =
    loginRecord?.role || (isFather || memberId === 'mem_father' ? 'admin' : 'member');

  // 3. Derive synthetic auth email
  const authEmail = await memberAuthEmail(fid, cleanMem, gen);

  // 4. Ban check + staff-managed credentials
  // Staff can set a PIN for any member (v3/credentials) and can disable a member
  // (members/{id}/off). Both must be enforced before touching Firebase Auth.
  // The loginIndex entry is public (needed before sign-in) and carries the
  // staff-managed PIN hash + access flag, so a member can be verified and
  // provisioned before any family membership record exists.
  const expectedPinHash = String(loginRecord?.pinHash || '');
  if (expectedPinHash) {
    const enteredHash = await sha256Hex(`pin|${fid}|${memHash}|${cleanPwd}`);
    if (enteredHash !== expectedPinHash) {
      return { ok: false, message: 'كلمة المرور غير صحيحة.' };
    }
  }
  if (loginRecord?.off === true) {
    return {
      ok: false,
      message: 'تم إيقاف وصولك إلى هذه العائلة. يرجى التواصل مع إدارة المنصة.',
    };
  }
  const storedCred = expectedPinHash ? { pinHash: expectedPinHash } : null;

  // 5. Authenticate with Firebase Auth.
  // Firebase rejects short passwords (< 6 chars), while family PINs are often
  // 4 digits — so a deterministic strong password is derived from the PIN.
  const authPassword = await sha256Hex(`pwd|${fid}|${memHash}|${cleanPwd}`);
  try {
    let userCred;
    try {
      userCred = await authMod.signInWithEmailAndPassword(auth, authEmail, authPassword);
    } catch (firstErr) {
      // Legacy accounts used the raw PIN as the password.
      try {
        if (!storedCred) throw firstErr;
        userCred = await authMod.signInWithEmailAndPassword(auth, authEmail, cleanPwd);
      } catch (authErr) {
        const code = String(authErr?.code || '');
        const canProvision = Boolean(storedCred);
        if (!canProvision || !/user-not-found|invalid-credential|invalid-login/i.test(code)) {
          throw authErr;
        }
        // First login for a staff-provisioned member (or after a PIN reset that
        // bumped the generation): create the Firebase account on the spot.
        userCred = await authMod.createUserWithEmailAndPassword(auth, authEmail, authPassword);
      }
    }

    const user = userCred.user;

    // 5b. bootstrap the v2 sync room for this family exactly once, using the
    // real authenticated uid, so the live sync engine has a canonical room to read.
    await ensureV2RoomForFamily({
      db,
      dbMod,
      fid,
      uid: user.uid,
      familyName: familyRecord.name || cleanFam,
      memberName: cleanMem,
      role,
    });

    const session = {
      loggedIn: true,
      fid,
      familyName: familyRecord.name || cleanFam,
      memberId,
      memberName: cleanMem,
      role,
      uid: user.uid,
      isDeveloper: false,
      loginAt: Date.now(),
    };

    await localStore.setPref(`v3_fam_${famHash}`, familyRecord);
    await localStore.setPref('activeSession', session);

    return { ok: true, session, user };
  } catch (err) {
    // Offline / demo-room fallback ONLY. Auth rejections (wrong password, banned,
    // disabled account) must never produce a local session.
    const offline = typeof navigator !== 'undefined' && navigator.onLine === false;
    if (fid === 'family-v2-local' || offline) {
      const session = {
        loggedIn: true,
        fid,
        familyName: familyRecord.name || cleanFam,
        memberId,
        memberName: cleanMem,
        role,
        uid: `local_${memHash.slice(0, 10)}`,
        isDeveloper: false,
        loginAt: Date.now(),
      };
      await localStore.setPref(`v3_fam_${famHash}`, familyRecord);
      await localStore.setPref('activeSession', session);
      return { ok: true, session, user: { uid: session.uid } };
    }

    console.error('[auth-v3] signIn error:', err);
    return {
      ok: false,
      message: describeAuthError(err),
      rawError: err,
    };
  }
}

/**
 * Register New Family Request
 * Creates pending family registration, sets up admin member, and records credentials index.
 */
export async function registerFamilyRequest({ familyName, ownerName, email, phone, password }) {
  if (!isValidDisplayName(familyName, { min: 2, max: 50 })) {
    return { ok: false, message: 'اسم العائلة يجب أن يتكون من حرفين إلى 50 حرفاً.' };
  }
  if (!isValidDisplayName(ownerName, { min: 2, max: 40 })) {
    return { ok: false, message: 'اسم مسؤول العائلة يجب أن يتكون من حرفين إلى 40 حرفاً.' };
  }
  if (!isValidEmail(email)) {
    return { ok: false, message: 'يرجى إدخال بريد إلكتروني صحيح لاستلام كود التفعيل والدليل.' };
  }
  if (phone && !isValidPhone(phone)) {
    return { ok: false, message: 'رقم الهاتف غير صحيح.' };
  }
  const pwdVal = validatePassword(password);
  if (!pwdVal.ok) {
    return { ok: false, message: pwdVal.message };
  }

  const famHash = await familyNameHash(familyName);
  const memHash = await memberNameHash(ownerName);
  const fid = newId('fam');
  const now = Date.now();

  const { auth, db, authMod, dbMod } = await getFirebaseServices();

  // 1. Check if family name already taken
  try {
    const famRef = dbMod.ref(db, `v3/familyIndex/${famHash}`);
    const snap = await dbMod.get(famRef);
    if (snap.exists()) {
      return { ok: false, message: 'اسم هذه العائلة مسجل مسبقاً. يرجى اختيار اسم آخر.' };
    }
  } catch (err) {
    console.warn('[auth-v3] family check failed:', err);
  }

  // 2. Create Firebase Auth user for the family admin
  const adminEmail = await memberAuthEmail(fid, ownerName, 1);
  let userCred = null;
  try {
    userCred = await authMod.createUserWithEmailAndPassword(auth, adminEmail, password);
  } catch (err) {
    console.error('[auth-v3] createUser error:', err);
    return { ok: false, message: describeAuthError(err) };
  }

  const uid = userCred.user.uid;

  // 3. Prepare records
  const familyRecord = {
    fid,
    name: familyName,
    ownerEmail: email,
    ownerPhone: phone || '',
    status: 'pending', // Pending approval by staff/admin
    features: defaultFeatureFlags(),
    createdAt: now,
    updatedAt: now,
  };

  const loginIndexRecord = {
    gen: 1,
    role: 'admin',
    memberName: ownerName,
    memberId: 'mem_admin',
    fid,
  };

  const userProfile = {
    fid,
    memberId: 'mem_admin',
    role: 'admin',
    name: ownerName,
    email: adminEmail,
    disabled: false,
    createdAt: now,
  };

  const familyMeta = {
    name: familyName,
    status: 'pending',
    schemaVersion: 3,
    createdAt: now,
    createdBy: uid,
    features: defaultFeatureFlags(),
  };

  const adminMember = {
    uid,
    name: ownerName,
    role: 'admin',
    icon: '👑',
    off: false,
    joinedAt: now,
  };

  // 4. Save to RTDB.
  // Security rules evaluate `root.child(...)` against the PRE-write state, so a
  // multi-path update cannot both create a parent record and reference it in the
  // same atomic write (PERMISSION_DENIED). Each step below is deliberately
  // sequential and depends on the previous one being persisted:
  //  1) families/{fid}/meta        -> needs v3/users/{uid} absent
  //  2) familyIndex/{famHash}      -> needs meta.createdBy/status present
  //  3) families/{fid}/members/... -> needs meta.createdBy == uid
  //  4) users/{uid}                -> needs meta.createdBy == uid
  //  5) loginIndex/{fid}/{memHash} -> needs users/{uid}.fid present
  try {
    await dbMod.set(dbMod.ref(db, `v3/families/${fid}/meta`), familyMeta);
    await dbMod.set(dbMod.ref(db, `v3/familyIndex/${famHash}`), familyRecord);
    await dbMod.set(dbMod.ref(db, `v3/families/${fid}/members/mem_admin`), adminMember);
    await dbMod.set(dbMod.ref(db, `v3/users/${uid}`), userProfile);
    await dbMod.set(dbMod.ref(db, `v3/loginIndex/${fid}/${memHash}`), loginIndexRecord);
  } catch (err) {
    console.error('[auth-v3] RTDB write error during registration:', err);
    return {
      ok: false,
      message: `تعذّر حفظ العائلة في السحابة: ${err?.message || err}. تحقق من الاتصال ثم أعد المحاولة.`,
      rawError: err,
    };
  }

  // Also cache locally
  await localStore.setPref(`v3_fam_${famHash}`, familyRecord);

  return {
    ok: true,
    fid,
    familyName,
    ownerName,
    status: 'pending',
    message: 'تم تسجيل طلب العائلة بنجاح! سيتم إرسال إشعار تفعيل الحساب ودليل إضافة أفراد الأسرة إلى بريدك.',
  };
}

/**
 * Staff / Developer Login via Google
 * Dedicated for Owner (aliazizdbab@gmail.com) and authorized staff members.
 */
export async function loginStaffWithGoogle() {
  const { auth, authMod } = await getFirebaseServices();
  const provider = new authMod.GoogleAuthProvider();
  provider.setCustomParameters({ prompt: 'select_account' });

  // Use redirect (not popup) for reliability: popups are blocked by many mobile
  // browsers and in-app webviews. Redirect works everywhere.
  try {
    await authMod.signInWithRedirect(auth, provider);
    // signInWithRedirect navigates away; the result is picked up on return via
    // finalizeStaffGoogleSignIn() (called from init).
    return { ok: true, redirect: true };
  } catch (err) {
    console.error('[auth-v3] staff Google redirect failed:', err);
    return { ok: false, message: describeAuthError(err), rawError: err };
  }
}

/**
 * Complete a Google sign-in that was initiated via signInWithRedirect.
 * Call once on page load (from init). Returns the staff session or null if no
 * redirect result is pending.
 */
export async function finalizeStaffGoogleSignIn() {
  const { auth, db, authMod, dbMod } = await getFirebaseServices();
  try {
    const result = await authMod.getRedirectResult(auth);
    if (!result || !result.user) return null;
    const user = result.user;
    const email = String(user.email || '').toLowerCase().trim();
    const isOwner = email === OWNER_EMAIL;

    let staffRecord = null;
    try {
      const snap = await dbMod.get(dbMod.ref(db, `v3/staff/${user.uid}`));
      if (snap.exists()) staffRecord = snap.val();
    } catch (err) {
      console.warn('[auth-v3] staff RTDB lookup failed:', err);
    }

    if (isOwner && !staffRecord) {
      staffRecord = {
        email: OWNER_EMAIL,
        role: 'owner',
        name: user.displayName || 'المالك والمبرمج الرئيسي',
        createdAt: Date.now(),
        disabled: false,
      };
      try {
        await dbMod.set(dbMod.ref(db, `v3/staff/${user.uid}`), staffRecord);
      } catch (err) {
        console.warn('[auth-v3] bootstrap owner record write failed:', err);
      }
    }

    if (!isOwner && !staffRecord) {
      staffRecord = await claimStaffInvite({ db, dbMod, user, cleanEmail: email });
    }

    if (!isOwner && (!staffRecord || staffRecord.disabled)) {
      await authMod.signOut(auth);
      return null;
    }

    const session = {
      loggedIn: true,
      isDeveloper: true,
      staffRole: isOwner ? 'owner' : staffRecord.role || 'developer',
      staffName: user.displayName || 'المطور',
      email: user.email,
      uid: user.uid,
      loginAt: Date.now(),
    };
    await localStore.setPref('activeStaffSession', session);
    return session;
  } catch (err) {
    // No pending redirect result — not an error, just nothing to finalize.
    if (/no-auth-event|redirect-result|null-user/i.test(String(err?.code || ''))) {
      return null;
    }
    console.warn('[auth-v3] finalize Google sign-in error:', err);
    return null;
  }
}

/**
 * Staff / Developer Login via Email & Password
 */
export async function loginStaffWithEmail(email, password) {
  const cleanEmail = String(email || '').trim().toLowerCase();
  const cleanPwd = String(password || '');

  if (!isValidEmail(cleanEmail)) {
    return { ok: false, message: 'يرجى إدخال بريد إلكتروني صالح.' };
  }
  if (!cleanPwd) {
    return { ok: false, message: 'يرجى إدخال كلمة المرور.' };
  }

  const { auth, db, authMod, dbMod } = await getFirebaseServices();

  try {
    const userCred = await authMod.signInWithEmailAndPassword(auth, cleanEmail, cleanPwd);
    const user = userCred.user;
    const isOwner = cleanEmail === OWNER_EMAIL;

    let staffRecord = null;
    try {
      const snap = await dbMod.get(dbMod.ref(db, `v3/staff/${user.uid}`));
      if (snap.exists()) staffRecord = snap.val();
    } catch (err) {
      console.warn('[auth-v3] staff email check failed:', err);
    }

    if (!isOwner && !staffRecord) {
      staffRecord = await claimStaffInvite({ db, dbMod, user, cleanEmail });
    }

    if (!isOwner && (!staffRecord || staffRecord.disabled)) {
      await authMod.signOut(auth);
      return {
        ok: false,
        message: 'هذا الحساب غير مصرح له بالدخول إلى بوابة المبرمج.',
      };
    }

    const session = {
      loggedIn: true,
      isDeveloper: true,
      staffRole: isOwner ? 'owner' : staffRecord.role || 'developer',
      staffName: staffRecord?.name || user.displayName || cleanEmail.split('@')[0],
      email: cleanEmail,
      uid: user.uid,
      loginAt: Date.now(),
    };

    await localStore.setPref('activeStaffSession', session);
    return { ok: true, session, user };
  } catch (err) {
    console.error('[auth-v3] staff email login failed:', err);
    return { ok: false, message: describeAuthError(err), rawError: err };
  }
}

/**
 * Claim a pending staff invitation: if the signed-in user's email has an invite
 * in v3/staffInvites, create their v3/staff record with the invited role and
 * consume the invite. Returns the created record or null.
 */
async function claimStaffInvite({ db, dbMod, user, cleanEmail }) {
  const key = String(cleanEmail || '').toLowerCase().replace(/\./g, ',');
  if (!key) return null;
  try {
    const snap = await dbMod.get(dbMod.ref(db, `v3/staffInvites/${key}`));
    if (!snap.exists()) return null;
    const inv = snap.val() || {};
    const role = ['owner', 'developer', 'support'].includes(inv.role) ? inv.role : 'support';
    const record = {
      role,
      email: cleanEmail,
      name: (inv.name || '').trim() || cleanEmail.split('@')[0],
      addedAt: { '.sv': 'timestamp' },
      disabled: false,
    };
    await dbMod.set(dbMod.ref(db, `v3/staff/${user.uid}`), record);
    try {
      await dbMod.remove(dbMod.ref(db, `v3/staffInvites/${key}`));
    } catch {
      // the invite may already be consumed
    }
    return { ...record, addedAt: Date.now() };
  } catch (err) {
    console.warn('[auth-v3] claimStaffInvite failed:', err);
    return null;
  }
}

/**
 * Sign out completely
 */
export async function getActiveAuthUid() {
  try {
    const { auth } = await getFirebaseServices();
    // Wait for Firebase to restore the persisted session before reading it;
    // otherwise a page reload looks "logged out" and clears the staff session.
    if (auth && typeof auth.authStateReady === 'function') {
      try {
        await auth.authStateReady();
      } catch {
        // ignore restore failures
      }
    }
    return auth?.currentUser?.uid || null;
  } catch {
    return null;
  }
}

/**
 * Sign out completely
 */
export async function signOutActiveUser() {
  const { auth, authMod } = await getFirebaseServices();
  try {
    await authMod.signOut(auth);
  } catch (err) {
    console.warn('[auth-v3] signOut error:', err);
  }
  await localStore.setPref('activeSession', { loggedIn: false });
  await localStore.setPref('activeStaffSession', { loggedIn: false });
  state.session = { loggedIn: false };
}
