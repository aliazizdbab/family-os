/**
 * Admin Controller for Family OS Developer & Staff Portal
 *
 * Handles fetching families, approving pending families, managing RBAC roles,
 * toggling per-family features, executing diagnostics, and testing AI/Firebase connections.
 */

import {
  getFirebaseServices,
} from './auth-v3.js';
import {
  familyNameHash,
  memberAuthEmail,
  memberNameHash,
  sha256Hex,
} from './identity.js';
import { state } from './state.js';
import { AI_PROVIDER_INDEX, fetchAiSettings } from './ai-config.js';
import { callAiProvider, AI_PROVIDER_PRESETS } from './ai.js';
import { scanModelCatalog, probeModel } from './models-scan.js';
import { describeModel } from './model-catalog.js';
import { localStore } from './store-idb.js';

export async function fetchAdminDashboardData(selectedFid = null) {
  const { db, dbMod } = await getFirebaseServices();

  const familiesList = [];
  const auditLogs = [];
  let familyMembers = [];

  // 1. Fetch families from /v3/familyIndex
  try {
    const famIndexRef = dbMod.ref(db, 'v3/familyIndex');
    const snap = await dbMod.get(famIndexRef);
    if (snap.exists()) {
      const data = snap.val();
      Object.entries(data).forEach(([hash, fam]) => {
        if (fam && typeof fam === 'object') {
          familiesList.push({
            hash,
            fid: fam.fid || hash,
            name: fam.name || 'عائلة بدون اسم',
            ownerEmail: fam.ownerEmail || '',
            ownerPhone: fam.ownerPhone || '',
            status: fam.status || 'active',
            features: fam.features || {},
            createdAt: fam.createdAt || Date.now(),
          });
        }
      });
    }
  } catch (err) {
    console.warn('[admin-controller] fetch familyIndex error:', err);
  }

  // Merge locally registered families if any.
  // These exist only in this device's IndexedDB — they are NOT in the cloud, so
  // admin lifecycle actions (suspend/delete) cannot apply to them. Flag them so
  // the UI can disable those buttons instead of failing with PERMISSION_DENIED.
  try {
    const localDir = await localStore.getPref('familyDirectory', []);
    if (Array.isArray(localDir)) {
      localDir.forEach((lf) => {
        if (lf && !familiesList.some((f) => f.fid === lf.fid)) {
          familiesList.push({ ...lf, isLocal: true });
        }
      });
    }
  } catch (err) {
    console.warn('[admin-controller] fetch local directory error:', err);
  }

  // Do NOT inject a phantom fallback family: an empty cloud means there is
  // nothing real to manage. The UI renders an explicit empty state instead.

  const activeFid = selectedFid || familiesList[0]?.fid || 'family-v2-local';

  // 2. Fetch members of selected family
  try {
    const memRef = dbMod.ref(db, `v3/families/${activeFid}/members`);
    const snap = await dbMod.get(memRef);
    if (snap.exists()) {
      const data = snap.val();
      Object.entries(data).forEach(([id, mem]) => {
        if (mem && typeof mem === 'object') {
          familyMembers.push({ id, ...mem });
        }
      });
    }
  } catch (err) {
    console.warn('[admin-controller] fetch members error:', err);
  }

  // If no members found via v3/families, fall back to local snapshot members if matching active room
  if (familyMembers.length === 0 && activeFid === state.roomId) {
    const localMems = state.localSnapshot?.members || {};
    familyMembers = Object.entries(localMems).map(([id, m]) => ({ id, ...m }));
  }

  // 3. Fetch audit logs from /v3/audit
  try {
    const auditRef = dbMod.ref(db, 'v3/audit');
    const snap = await dbMod.get(auditRef);
    if (snap.exists()) {
      const scopes = snap.val();
      Object.entries(scopes).forEach(([scope, entries]) => {
        if (entries && typeof entries === 'object') {
          Object.entries(entries).forEach(([id, entry]) => {
            if (entry && typeof entry === 'object') {
              auditLogs.push({ id, scope, ...entry });
            }
          });
        }
      });
      auditLogs.sort((a, b) => (b.at || 0) - (a.at || 0));
    }
  } catch (err) {
    console.warn('[admin-controller] fetch audit error:', err);
  }

  let staffList = [];
  let staffInvites = [];
  if ((state.adminActiveTab || 'families') === 'staff') {
    try {
      const dir = await fetchStaffDirectory();
      staffList = dir.staff;
      staffInvites = dir.invites;
    } catch (err) {
      console.warn('[admin-controller] staff directory error:', err);
    }
  }

  let familyDetail = null;
  const manageFid = state.adminManageFid || null;
  if (manageFid && manageFid === activeFid) {
    try {
      familyDetail = await fetchFamilyDetail(activeFid);
    } catch (err) {
      console.warn('[admin-controller] family detail error:', err);
    }
  }

  let aiGlobal = null;
  let aiFamily = null;
  if ((state.adminActiveTab || 'families') === 'integrations') {
    try {
      const ai = await fetchAiSettings(activeFid);
      aiGlobal = ai.global;
      aiFamily = ai.family;
    } catch (err) {
      console.warn('[admin-controller] ai config error:', err);
    }
  }

  return {
    staffSession: state.session,
    activeTab: state.adminActiveTab || 'families',
    families: familiesList,
    selectedFid: activeFid,
    familyMembers,
    auditLogs: auditLogs.slice(0, 50),
    staffList,
    staffInvites,
    aiGlobal,
    aiFamily,
    manageFid,
    familyDetail,
    // Only owner/developer may mutate families per the RTDB rules; support is
    // read-only, so the UI must not offer actions that would be rejected.
    canManage:
      state.session?.email === 'aliazizdbab@gmail.com' ||
      state.session?.staffRole === 'owner' ||
      state.session?.staffRole === 'developer',
  };
}

export async function approvePendingFamily(fid, familyName) {
  const { db, dbMod } = await getFirebaseServices();
  const famHash = await familyNameHash(familyName);

  const updates = {};
  updates[`v3/familyIndex/${famHash}/status`] = 'active';
  updates[`v3/familyIndex/${famHash}/updatedAt`] = Date.now();
  updates[`v3/families/${fid}/meta/status`] = 'active';

  await dbMod.update(dbMod.ref(db), updates);
  await recordStaffAuditLog('قبول وتفعيل طلب عائلة', `${familyName} (${fid})`);
}

export async function updateFamilyStatus(fid, familyName, nextStatus) {
  const { db, dbMod } = await getFirebaseServices();
  const famHash = await familyNameHash(familyName);

  const updates = {};
  updates[`v3/familyIndex/${famHash}/status`] = nextStatus;
  updates[`v3/familyIndex/${famHash}/updatedAt`] = Date.now();
  updates[`v3/families/${fid}/meta/status`] = nextStatus;

  await dbMod.update(dbMod.ref(db), updates);
  await recordStaffAuditLog(`تغيير حالة العائلة إلى ${nextStatus}`, `${familyName} (${fid})`);
}

export async function deleteFamilyRecord(fid, familyName) {
  const { db, dbMod } = await getFirebaseServices();
  const famHash = await familyNameHash(familyName);

  const updates = {};
  updates[`v3/familyIndex/${famHash}`] = null;
  updates[`v3/families/${fid}`] = null;

  await dbMod.update(dbMod.ref(db), updates);
  await recordStaffAuditLog('حذف عائلة نهائياً', `${familyName} (${fid})`);
}

export async function saveFamilyFeatureFlags(fid, familyName, features) {
  const { db, dbMod } = await getFirebaseServices();
  const famHash = await familyNameHash(familyName);

  const updates = {};
  updates[`v3/familyIndex/${famHash}/features`] = features;
  updates[`v3/families/${fid}/meta/features`] = features;

  await dbMod.update(dbMod.ref(db), updates);
  await recordStaffAuditLog('تحديث ميزات العائلة', `${familyName} (${fid})`);
}

export async function resetMemberCredentialGeneration(fid, memberName) {
  const { db, dbMod } = await getFirebaseServices();
  const memHash = await memberNameHash(memberName);

  const loginRef = dbMod.ref(db, `v3/loginIndex/${fid}/${memHash}`);
  const snap = await dbMod.get(loginRef);
  const currentGen = snap.exists() ? snap.val().gen || 1 : 1;
  const nextGen = currentGen + 1;

  await dbMod.update(loginRef, {
    gen: nextGen,
    updatedAt: Date.now(),
  });

  await recordStaffAuditLog('إعادة تعيين اعتماد الفرد (Reset Credential Generation)', `${memberName} (${fid})`);
  return { nextGen };
}

export async function recordStaffAuditLog(action, target) {
  const { db, dbMod } = await getFirebaseServices();
  const now = Date.now();
  const auditId = `aud_${now}_${Math.random().toString(36).slice(2, 7)}`;
  const entry = {
    at: now,
    actorUid: state.session.uid || 'owner',
    actorName: state.session.staffName || state.session.email || 'المبرمج',
    actorType: 'staff',
    action,
    target: target || '',
  };

  try {
    await dbMod.set(dbMod.ref(db, `v3/audit/staff/${auditId}`), entry);
  } catch (err) {
    console.warn('[admin-controller] write audit error:', err);
  }
}

// ============================================================================
// Staff & support team management (owner only)
// ============================================================================

/** Mirrors the RTDB rules key derivation: lowercase email with dots → commas. */
export function staffEmailKey(email) {
  return String(email || '')
    .trim()
    .toLowerCase()
    .replace(/\./g, ',');
}

export async function fetchStaffDirectory() {
  const { db, dbMod } = await getFirebaseServices();
  const staff = [];
  const invites = [];
  try {
    const snap = await dbMod.get(dbMod.ref(db, 'v3/staff'));
    if (snap.exists()) {
      Object.entries(snap.val() || {}).forEach(([uid, rec]) => {
        if (rec && typeof rec === 'object') {
          staff.push({
            uid,
            email: rec.email || '',
            name: rec.name || '',
            role: rec.role || 'developer',
            disabled: rec.disabled === true,
          });
        }
      });
      staff.sort((a, b) => String(a.role).localeCompare(String(b.role)));
    }
  } catch (err) {
    console.warn('[admin-controller] fetch staff error:', err);
  }
  try {
    const snap = await dbMod.get(dbMod.ref(db, 'v3/staffInvites'));
    if (snap.exists()) {
      Object.entries(snap.val() || {}).forEach(([key, rec]) => {
        if (rec && typeof rec === 'object') {
          invites.push({
            key,
            email: rec.email || key.replace(/,/g, '.'),
            name: rec.name || '',
            role: rec.role || 'support',
            createdAt: rec.invitedAt || rec.createdAt || 0,
          });
        }
      });
      invites.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
    }
  } catch (err) {
    console.warn('[admin-controller] fetch staff invites error:', err);
  }
  return { staff, invites };
}

export async function saveStaffInvite({ email, name, role }) {
  const cleanEmail = String(email || '').trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(cleanEmail)) {
    throw new Error('بريد إلكتروني غير صحيح');
  }
  const cleanRole = ['owner', 'developer', 'support'].includes(role) ? role : 'support';
  const key = staffEmailKey(cleanEmail);
  const { db, dbMod } = await getFirebaseServices();
  await dbMod.set(dbMod.ref(db, `v3/staffInvites/${key}`), {
    email: cleanEmail,
    name: String(name || '').trim().slice(0, 60),
    role: cleanRole,
    invitedBy: state.session?.uid || 'owner',
    // RTDB rules require `invitedAt` (number) on every invite.
    invitedAt: Date.now(),
    createdAt: Date.now(),
  });
  await recordStaffAuditLog('دعوة عضو لفريق الدعم', `${cleanEmail} (${cleanRole})`);
  return { ok: true, key };
}

export async function revokeStaffInvite(email) {
  const { db, dbMod } = await getFirebaseServices();
  await dbMod.remove(dbMod.ref(db, `v3/staffInvites/${staffEmailKey(email)}`));
  await recordStaffAuditLog('إلغاء دعوة موظف', String(email));
}

export async function setStaffDisabled(uid, disabled) {
  const { db, dbMod } = await getFirebaseServices();
  await dbMod.update(dbMod.ref(db, `v3/staff/${uid}`), { disabled: Boolean(disabled) });
  await recordStaffAuditLog(disabled ? 'تعطيل حساب موظف' : 'تفعيل حساب موظف', String(uid));
}

export async function removeStaffMember(uid, email) {
  const { db, dbMod } = await getFirebaseServices();
  await dbMod.remove(dbMod.ref(db, `v3/staff/${uid}`));
  await recordStaffAuditLog('حذف عضو من فريق الدعم', `${email || ''} (${uid})`);
}

// ============================================================================
// AI provider configuration (global + per-family)
// ============================================================================

const AI_PROVIDER_KEYS = [...Object.keys(AI_PROVIDER_INDEX), 'custom'];

export async function saveAiConfig({ scope, fid, provider, model, apiKey, url, name, type }) {
  const cleanProvider = AI_PROVIDER_KEYS.includes(provider) ? provider : 'gemini';
  const cleanKey = String(apiKey || '').trim();
  if (cleanKey.length < 8) throw new Error('مفتاح API قصير جداً');
  if (cleanProvider === 'custom') {
    const cleanUrl = String(url || '').trim();
    if (!/^https?:\/\//i.test(cleanUrl)) throw new Error('أدخل رابط API صحيحاً يبدأ بـ https://');
  }
  if (scope === 'family' && !fid) throw new Error('اختر العائلة أولاً');

  const { db, dbMod } = await getFirebaseServices();
  const path = scope === 'family' ? `v3/aiConfig/families/${fid}` : 'v3/aiConfig/global';
  const record = {
    provider: cleanProvider,
    apiKey: cleanKey,
    updatedAt: Date.now(),
    updatedBy: state.session?.uid || 'owner',
  };
  if (model && String(model).trim()) record.model = String(model).trim();
  if (url && String(url).trim()) record.url = String(url).trim().replace(/\/+$/, '');
  if (name && String(name).trim()) record.name = String(name).trim().slice(0, 40);
  if (type) record.type = String(type) === 'gemini' ? 'gemini' : 'openai';
  await dbMod.set(dbMod.ref(db, path), record);
  await recordStaffAuditLog(
    scope === 'family' ? 'تحديث مفتاح الذكاء الاصطناعي لعائلة' : 'تحديث مفتاح الذكاء الاصطناعي العام',
    scope === 'family' ? String(fid) : 'global'
  );
  return record;
}

export async function clearAiConfig({ scope, fid }) {
  if (scope === 'family' && !fid) throw new Error('اختر العائلة أولاً');
  const { db, dbMod } = await getFirebaseServices();
  const path = scope === 'family' ? `v3/aiConfig/families/${fid}` : 'v3/aiConfig/global';
  await dbMod.remove(dbMod.ref(db, path));
  await recordStaffAuditLog(
    scope === 'family' ? 'حذف مفتاح الذكاء الاصطناعي لعائلة' : 'حذف مفتاح الذكاء الاصطناعي العام',
    scope === 'family' ? String(fid) : 'global'
  );
}

export async function testAiConfig({ provider, apiKey, model, url }) {
  const idx = AI_PROVIDER_INDEX[provider] ?? AI_PROVIDER_INDEX.gemini;
  const presets = {
    gemini: ['Google Gemini', 'gemini', 'https://generativelanguage.googleapis.com/v1beta', 'gemini-2.5-flash'],
    openai: ['OpenAI', 'openai', 'https://api.openai.com/v1', 'gpt-4o-mini'],
    anthropic: ['Anthropic', 'anthropic', 'https://api.anthropic.com/v1', 'claude-sonnet-5-5'],
    openrouter: ['OpenRouter', 'openai', 'https://openrouter.ai/api/v1', 'openai/gpt-4o-mini'],
    groq: ['Groq', 'openai', 'https://api.groq.com/openai/v1', 'llama-3.3-70b-versatile'],
    deepseek: ['DeepSeek', 'openai', 'https://api.deepseek.com', 'deepseek-chat'],
  };
  void idx;
  if (provider === 'custom') {
    const cleanUrl = String(url || '').trim().replace(/\/+$/, '');
    if (!cleanUrl) throw new Error('أدخل رابط API للمزود المخصص');
    const prov = {
      name: 'مزود مخصص',
      type: 'openai',
      url: cleanUrl,
      model: model || '',
      key: String(apiKey || '').trim(),
    };
    const startedAt0 = Date.now();
    const reply0 = await callAiProvider(
      prov,
      'Reply with the single word OK.',
      [{ role: 'user', content: 'ping' }],
      { maxTokens: 20, timeoutMs: 15000 }
    );
    return { ok: true, ms: Date.now() - startedAt0, reply: String(reply0 || '').trim().slice(0, 40) };
  }

  const [name, type, defUrl, defModel] = presets[provider] || presets.gemini;
  const prov = {
    name,
    type,
    url: (url || defUrl).replace(/\/+$/, ''),
    model: model || defModel,
    key: String(apiKey || '').trim(),
  };
  const startedAt = Date.now();
  const reply = await callAiProvider(
    prov,
    'Reply with the single word OK.',
    [{ role: 'user', content: 'ping' }],
    { maxTokens: 20, timeoutMs: 12000 }
  );
  return { ok: true, ms: Date.now() - startedAt, reply: String(reply || '').trim().slice(0, 40) };
}

export { fetchAiSettings };


/** Build a runtime provider object from a saved/edited AI config. */
export function providerFromConfig({ provider, apiKey, model, url, type }) {
  if (provider === 'custom') {
    return {
      name: 'مزود مخصص',
      type: type === 'gemini' ? 'gemini' : 'openai',
      url: String(url || '').replace(/\/+$/, ''),
      model: model || '',
      key: String(apiKey || '').trim(),
    };
  }
  const idx = AI_PROVIDER_INDEX[provider] ?? AI_PROVIDER_INDEX.gemini;
  const [name, ptype, defUrl, defModel] = AI_PROVIDER_PRESETS[idx] || AI_PROVIDER_PRESETS[2];
  return {
    name,
    type: ptype,
    url: String(url || defUrl).replace(/\/+$/, ''),
    model: model || defModel,
    key: String(apiKey || '').trim(),
  };
}

/** Fetch the full model list (enriched with price + free flags). */
export async function listModelsForConfig(cfg) {
  const prov = providerFromConfig(cfg);
  const rows = await scanModelCatalog(prov, { limit: 800 });
  return rows.map((row) =>
    describeModel({
      providerId: cfg.provider,
      modelId: row.id,
      baseUrl: prov.url,
      meta: row,
    })
  );
}

/** Probe a single model with a tiny request. */
export async function testModelForConfig(cfg, modelId) {
  const prov = providerFromConfig({ ...cfg, model: modelId });
  return probeModel(prov, modelId);
}

// ============================================================================
// Per-family management: members, credentials, forced updates
// ============================================================================

function memberIdFromHash(memHash) {
  return `mem_${String(memHash).slice(0, 8)}`;
}

export async function fetchFamilyDetail(fid) {
  const { db, dbMod } = await getFirebaseServices();
  const detail = { fid, members: [], credentials: {}, meta: null };

  try {
    const snap = await dbMod.get(dbMod.ref(db, `v3/families/${fid}/members`));
    if (snap.exists()) {
      Object.entries(snap.val() || {}).forEach(([id, rec]) => {
        if (rec && typeof rec === 'object') {
          detail.members.push({
            id,
            name: rec.name || '',
            role: rec.role || 'member',
            icon: rec.icon || '👤',
            off: rec.off === true,
            uid: rec.uid || '',
          });
        }
      });
    }
  } catch (err) {
    console.warn('[admin-controller] family members error:', err);
  }

  try {
    const snap = await dbMod.get(dbMod.ref(db, `v3/credentials/${fid}`));
    if (snap.exists()) detail.credentials = snap.val() || {};
  } catch (err) {
    console.warn('[admin-controller] credentials error:', err);
  }

  let loginIndex = {};
  try {
    const snap = await dbMod.get(dbMod.ref(db, `v3/loginIndex/${fid}`));
    if (snap.exists()) loginIndex = snap.val() || {};
  } catch {
    // ignore
  }

  try {
    const snap = await dbMod.get(dbMod.ref(db, `v3/families/${fid}/meta`));
    if (snap.exists()) detail.meta = snap.val() || {};
  } catch {
    // ignore
  }

  for (const member of detail.members) {
    const memHash = await memberNameHash(member.name);
    member.memHash = memHash;
    const li = loginIndex[memHash] || null;
    member.gen = Number(li?.gen) || 1;
    try {
      member.email = await memberAuthEmail(fid, member.name, member.gen);
    } catch {
      member.email = '';
    }
    const cred = detail.credentials[memHash] || null;
    member.pin = cred?.pin || '';
  }

  detail.members.sort((a, b) => String(a.name).localeCompare(String(b.name)));
  return detail;
}

export async function setMemberAccess(fid, memberId, off) {
  const { db, dbMod } = await getFirebaseServices();
  await dbMod.update(dbMod.ref(db, `v3/families/${fid}/members/${memberId}`), {
    off: Boolean(off),
  });
  // Mirror the flag into the public login index so login can block the member
  // before Firebase Auth is involved.
  try {
    const nameSnap = await dbMod.get(dbMod.ref(db, `v3/families/${fid}/members/${memberId}/name`));
    const memberName = nameSnap.exists() ? String(nameSnap.val()) : '';
    if (memberName) {
      const memHash = await memberNameHash(memberName);
      await dbMod.update(dbMod.ref(db, `v3/loginIndex/${fid}/${memHash}`), { off: Boolean(off) });
    }
  } catch (err) {
    console.warn('[admin-controller] loginIndex off mirror failed:', err);
  }
  await recordStaffAuditLog(off ? 'إيقاف وصول عضو عن العائلة' : 'تمكين عضو في العائلة', `${fid}/${memberId}`);
}

/** Set (or reset) a member PIN. Bumps the credential generation so the next
 *  login creates a fresh Firebase account bound to the new PIN. */
export async function setMemberPin(fid, memberName, pin) {
  const cleanPin = String(pin || '').trim();
  if (cleanPin.length < 4) throw new Error('الرقم السري يجب أن يكون 4 خانات على الأقل');
  const memHash = await memberNameHash(memberName);
  const { db, dbMod } = await getFirebaseServices();

  const liRef = dbMod.ref(db, `v3/loginIndex/${fid}/${memHash}`);
  const snap = await dbMod.get(liRef);
  const current = snap.exists() ? snap.val() || {} : {};
  const nextGen = (Number(current.gen) || 0) + 1;

  await dbMod.set(liRef, {
    gen: nextGen,
    fid,
    role: current.role || 'member',
    memberName,
    memberId: current.memberId || memberIdFromHash(memHash),
    pinHash: await sha256Hex(`pin|${fid}|${memHash}|${cleanPin}`),
    off: Boolean(current.off),
  });

  await dbMod.set(dbMod.ref(db, `v3/credentials/${fid}/${memHash}`), {
    pin: cleanPin,
    memberName,
    updatedAt: Date.now(),
  });

  await recordStaffAuditLog('تعيين/تغيير رقم سري لعضو', `${fid}/${memberName} (gen ${nextGen})`);
  return { gen: nextGen, pin: cleanPin };
}

export async function addFamilyMemberByStaff({ fid, name, role, pin }) {
  const cleanName = String(name || '').trim();
  if (cleanName.length < 2) throw new Error('اسم العضو قصير جداً');
  const cleanRole = ['admin', 'mother', 'member', 'child'].includes(role) ? role : 'member';
  const cleanPin = String(pin || '').trim();
  if (cleanPin.length < 4) throw new Error('الرقم السري يجب أن يكون 4 خانات على الأقل');

  const memHash = await memberNameHash(cleanName);
  const memberId = memberIdFromHash(memHash);
  const { db, dbMod } = await getFirebaseServices();

  const iconByRole = { admin: '👑', mother: '🤱', member: '🧑', child: '🧒' };
  await dbMod.set(dbMod.ref(db, `v3/families/${fid}/members/${memberId}`), {
    uid: '',
    name: cleanName,
    role: cleanRole,
    icon: iconByRole[cleanRole] || '👤',
    off: false,
    joinedAt: Date.now(),
  });

  await dbMod.set(dbMod.ref(db, `v3/credentials/${fid}/${memHash}`), {
    pin: cleanPin,
    memberName: cleanName,
    updatedAt: Date.now(),
  });

  await dbMod.set(dbMod.ref(db, `v3/loginIndex/${fid}/${memHash}`), {
    gen: 1,
    fid,
    role: cleanRole,
    memberName: cleanName,
    memberId,
    pinHash: await sha256Hex(`pin|${fid}|${memHash}|${cleanPin}`),
    off: false,
  });

  await recordStaffAuditLog('إضافة عضو لعائلة', `${fid}/${cleanName} (${cleanRole})`);
  return { memberId, memHash, email: await memberAuthEmail(fid, cleanName, 1) };
}

export async function forceFamilyUpdate(fid) {
  const { db, dbMod } = await getFirebaseServices();
  const stamp = Date.now();
  await dbMod.set(dbMod.ref(db, `v3/forceUpdate/${fid}`), stamp);
  await recordStaffAuditLog('إجبار تطبيق العائلة على التحديث', fid);
  return stamp;
}

export async function setMemberRole(fid, memberId, role) {
  const cleanRole = ['admin', 'mother', 'member', 'child'].includes(role) ? role : 'member';
  const iconByRole = { admin: '👑', mother: '🤱', member: '🧑', child: '🧒' };
  const { db, dbMod } = await getFirebaseServices();
  await dbMod.update(dbMod.ref(db, `v3/families/${fid}/members/${memberId}`), {
    role: cleanRole,
    icon: iconByRole[cleanRole] || '👤',
  });
  try {
    const nameSnap = await dbMod.get(dbMod.ref(db, `v3/families/${fid}/members/${memberId}/name`));
    if (nameSnap.exists()) {
      const memHash = await memberNameHash(String(nameSnap.val()));
      await dbMod.update(dbMod.ref(db, `v3/loginIndex/${fid}/${memHash}`), { role: cleanRole });
    }
  } catch {
    // loginIndex mirror is best-effort
  }
  await recordStaffAuditLog('تغيير صلاحية عضو', `${fid}/${memberId} → ${cleanRole}`);
}

