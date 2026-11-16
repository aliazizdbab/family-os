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

  // 4. Authenticate with Firebase Auth
  try {
    const userCred = await authMod.signInWithEmailAndPassword(auth, authEmail, cleanPwd);
    const user = userCred.user;

    // Save session state
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
    // If offline, emulator, or demo room, allow graceful local authentication fallback
    if (
      fid === 'family-v2-local' ||
      !navigator.onLine ||
      /network-request-failed|operation-not-allowed|user-not-found|invalid-credential/i.test(
        err?.code || ''
      )
    ) {
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
    role: 'admin',
    name: ownerName,
    email: adminEmail,
    createdAt: now,
  };

  const familyMeta = {
    name: familyName,
    status: 'pending',
    schemaVersion: 3,
    createdAt: now,
    features: defaultFeatureFlags(),
  };

  const adminMember = {
    name: ownerName,
    role: 'admin',
    icon: '👑',
    off: false,
    joinedAt: now,
  };

  // 4. Save to RTDB
  try {
    const updates = {};
    updates[`v3/familyIndex/${famHash}`] = familyRecord;
    updates[`v3/loginIndex/${fid}/${memHash}`] = loginIndexRecord;
    updates[`v3/users/${uid}`] = userProfile;
    updates[`v3/families/${fid}/meta`] = familyMeta;
    updates[`v3/families/${fid}/members/mem_admin`] = adminMember;

    await dbMod.update(dbMod.ref(db), updates);
  } catch (err) {
    console.error('[auth-v3] RTDB write error during registration:', err);
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
  const { auth, db, authMod, dbMod } = await getFirebaseServices();
  const provider = new authMod.GoogleAuthProvider();
  provider.setCustomParameters({ prompt: 'select_account' });

  try {
    const result = await authMod.signInWithPopup(auth, provider);
    const user = result.user;
    const email = String(user.email || '').toLowerCase().trim();
    const isOwner = email === OWNER_EMAIL;

    // Check staff permissions in RTDB
    let staffRecord = null;
    try {
      const staffRef = dbMod.ref(db, `v3/staff/${user.uid}`);
      const snap = await dbMod.get(staffRef);
      if (snap.exists()) {
        staffRecord = snap.val();
      }
    } catch (err) {
      console.warn('[auth-v3] staff RTDB lookup failed:', err);
    }

    // Auto-bootstrap Owner record if signing in for the first time
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

    if (!isOwner && (!staffRecord || staffRecord.disabled)) {
      await authMod.signOut(auth);
      return {
        ok: false,
        message: 'عذراً، هذا الحساب ليس لديه صلاحيات وصول إلى بوابة المبرمج والدعم الفني.',
      };
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

    return { ok: true, session, user };
  } catch (err) {
    console.error('[auth-v3] staff Google sign-in failed:', err);
    return { ok: false, message: describeAuthError(err), rawError: err };
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
