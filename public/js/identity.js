/**
 * Shared identity helpers for the Family OS v3 platform.
 *
 * Family members sign in with: family name + member name + password.
 * Firebase Auth requires an email, so we derive a deterministic, non-guessable
 * synthetic email from SHA-256 hashes of the normalized names plus a credential
 * "generation" counter (bumped whenever staff re-issue a member's credentials).
 * Passwords are never stored by the app; Firebase Auth hashes them server-side.
 */

export const OWNER_EMAIL = 'aliazizdbab@gmail.com';
export const MEMBER_EMAIL_DOMAIN = 'members.family-os.app';
export const MIN_PASSWORD_LENGTH = 8;

export const FAMILY_ROLES = Object.freeze(['admin', 'mother', 'member', 'child']);
export const STAFF_ROLES = Object.freeze(['owner', 'developer', 'support']);
export const FAMILY_STATUSES = Object.freeze(['pending', 'active', 'suspended']);

export const FAMILY_FEATURES = Object.freeze([
  { id: 'store', label: '🏪 المتجر ووضع التسوق' },
  { id: 'tasks', label: '📋 المهام والمكافآت' },
  { id: 'maint', label: '🔧 صيانة المنزل والسيارة' },
  { id: 'ai', label: '🤖 المساعد الذكي' },
  { id: 'import', label: '📥 الاستيراد والتصدير' },
]);

export function defaultFeatureFlags() {
  return Object.fromEntries(FAMILY_FEATURES.map((f) => [f.id, true]));
}

export const FAMILY_ROLE_LABELS = Object.freeze({
  admin: '👑 مدير العائلة',
  mother: '🤱 الأم (الطلبات والمهام)',
  member: '🧑 عضو',
  child: '🧒 الأبناء',
});

export const STAFF_ROLE_LABELS = Object.freeze({
  owner: '🛡️ المالك',
  developer: '👨‍💻 مبرمج',
  support: '🎧 دعم فني',
});

/**
 * Normalize an Arabic/Latin display name so that visually-equivalent spellings
 * map to the same identity ("أحمد" == "احمد", extra spaces, diacritics, tatweel).
 */
export function normalizeName(raw) {
  return String(raw ?? '')
    .normalize('NFKC')
    .replace(/[\u064B-\u0652\u0670\u0640]/g, '') // harakat, superscript alef, tatweel
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ة/g, 'ه')
    .replace(/ؤ/g, 'و')
    .replace(/ئ/g, 'ي')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

export function isValidDisplayName(raw, { min = 2, max = 40 } = {}) {
  const clean = String(raw ?? '').trim();
  return clean.length >= min && clean.length <= max && normalizeName(clean).length >= min;
}

export async function sha256Hex(text) {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) throw new Error('WebCrypto غير متوفر في هذا المتصفح');
  const bytes = new globalThis.TextEncoder().encode(String(text));
  const digest = await subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

/** Hash used as the key of /v3/familyIndex/{hash}. */
export async function familyNameHash(familyName) {
  return (await sha256Hex(`fam|${normalizeName(familyName)}`)).slice(0, 40);
}

/** Hash used as the key of /v3/loginIndex/{fid}/{memberHash}. */
export async function memberNameHash(memberName) {
  return (await sha256Hex(`mem|${normalizeName(memberName)}`)).slice(0, 40);
}

/**
 * Deterministic synthetic Firebase Auth email for a member credential generation.
 * Bound to the immutable family id (not the display name) so families can be renamed.
 */
export async function memberAuthEmail(fid, memberName, gen = 1) {
  const digest = await sha256Hex(
    `login|${String(fid)}|${normalizeName(memberName)}|${Number(gen) || 1}`
  );
  return `m${digest.slice(0, 40)}@${MEMBER_EMAIL_DOMAIN}`;
}

export function validatePassword(password) {
  const pwd = String(password ?? '');
  if (pwd.length < MIN_PASSWORD_LENGTH) {
    return { ok: false, message: `كلمة المرور يجب ألا تقل عن ${MIN_PASSWORD_LENGTH} أحرف` };
  }
  if (!/[0-9]/.test(pwd) || !/[^0-9]/.test(pwd)) {
    return { ok: false, message: 'كلمة المرور يجب أن تحتوي على أرقام وأحرف معاً' };
  }
  return { ok: true, message: '' };
}

export function isValidEmail(raw) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(raw ?? '').trim());
}

export function isValidPhone(raw) {
  const clean = String(raw ?? '').replace(/[\s()-]/g, '');
  return clean === '' || /^\+?[0-9]{7,15}$/.test(clean);
}

/** Email keys in RTDB cannot contain '.', mirror the rules: lower-case and '.' -> ','. */
export function emailKey(email) {
  return String(email ?? '')
    .trim()
    .toLowerCase()
    .replace(/\./g, ',');
}

export function newId(prefix) {
  const bytes = new Uint8Array(8);
  globalThis.crypto.getRandomValues(bytes);
  return `${prefix}_${Date.now().toString(36)}${Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('').slice(0, 10)}`;
}

/** Map Firebase Auth error codes to clear Arabic messages. */
export function describeAuthError(err) {
  const code = String(err?.code || err?.message || '');
  if (/invalid-credential|wrong-password|user-not-found|INVALID_LOGIN_CREDENTIALS|invalid-login/i.test(code)) {
    return 'اسم الفرد أو كلمة المرور غير صحيحة.';
  }
  if (/too-many-requests/i.test(code)) {
    return 'تم إيقاف المحاولات مؤقتاً بسبب كثرة المحاولات الخاطئة. حاول بعد قليل.';
  }
  if (/network-request-failed/i.test(code)) {
    return 'تعذّر الاتصال بالخادم. تحقق من اتصال الإنترنت ثم حاول مجدداً.';
  }
  if (/user-disabled/i.test(code)) return 'هذا الحساب معطّل. تواصل مع مدير العائلة أو الدعم الفني.';
  if (/email-already-in-use/i.test(code)) return 'يوجد حساب مسجّل بنفس البيانات مسبقاً.';
  if (/weak-password/i.test(code)) return 'كلمة المرور ضعيفة جداً.';
  if (/operation-not-allowed|PASSWORD_LOGIN_DISABLED/i.test(code)) {
    return 'تسجيل الدخول بالبريد/كلمة المرور غير مفعّل في Firebase. فعّله من Firebase Console ← Authentication ← Sign-in method ← Email/Password (بريد/كلمة مرور).';
  }
  if (/popup-closed|cancelled-popup/i.test(code)) return 'تم إغلاق نافذة تسجيل الدخول قبل الإكمال.';
  if (/PERMISSION_DENIED|permission-denied|permission_denied/i.test(code)) {
    return 'لا تملك صلاحية لتنفيذ هذا الإجراء.';
  }
  return 'حدث خطأ غير متوقع. حاول مرة أخرى.';
}
