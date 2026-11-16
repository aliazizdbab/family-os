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
  memberNameHash,
} from './identity.js';
import { state } from './state.js';
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

  // Merge locally registered families if any
  try {
    const localDir = await localStore.getPref('familyDirectory', []);
    if (Array.isArray(localDir)) {
      localDir.forEach((lf) => {
        if (lf && !familiesList.some((f) => f.fid === lf.fid)) {
          familiesList.push(lf);
        }
      });
    }
  } catch (err) {
    console.warn('[admin-controller] fetch local directory error:', err);
  }

  // Fallback / include default demo room if list is empty
  if (familiesList.length === 0) {
    familiesList.push({
      hash: 'default',
      fid: 'family-v2-local',
      name: 'عائلتي (العائلة الافتراضية)',
      ownerEmail: 'demo@family-os.app',
      status: 'active',
      features: { store: true, tasks: true, maint: true, ai: true, import: true },
      createdAt: Date.now() - 86400000,
    });
  }

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

  return {
    staffSession: state.session,
    activeTab: state.adminActiveTab || 'families',
    families: familiesList,
    selectedFid: activeFid,
    familyMembers,
    auditLogs: auditLogs.slice(0, 50),
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
