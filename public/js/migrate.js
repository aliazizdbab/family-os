import {
  DEFAULT_BUDGET,
  DEFAULT_CATS,
  MAX_LOG_ENTRIES,
  SCHEMA_VERSION,
  clampStr,
  createBudget,
  createCategory,
  createItem,
  createLogEntry,
  createMember,
  createMeta,
  nonNegNum,
  validateBudget,
  validateCategory,
  validateItem,
  validateMember,
} from './schema.js';

function toArray(val) {
  if (Array.isArray(val)) return val.filter(Boolean);
  if (val && typeof val === 'object') return Object.values(val).filter(Boolean);
  return [];
}

function stableHash(str) {
  let h = 2166136261;
  const s = String(str);
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(36);
}

function safeId(raw, prefix, fallbackSeed) {
  const cleaned = String(raw || '')
    .trim()
    .replace(/[^a-zA-Z0-9_-]/g, '');
  if (cleaned) return `${prefix}${cleaned}`.slice(0, 64);
  return `${prefix}h_${stableHash(fallbackSeed)}`;
}

function parseLegacyInput(rawInput) {
  if (typeof rawInput === 'string') {
    return JSON.parse(rawInput);
  }
  if (rawInput && typeof rawInput === 'object') {
    return rawInput;
  }
  throw new Error('ملف النسخة الاحتياطية غير صالح');
}

/**
 * Strips any legacy sensitive fields (PIN hashes/salts/API keys) and maps
 * legacy family_list.html backup JSON into deterministic v2 room schema.
 */
export function normalizeLegacyBackup(rawInput, { roomName = 'عائلتي', nowMs } = {}) {
  const data = parseLegacyInput(rawInput);
  const warnings = [];
  const errors = [];

  if (
    !('items' in data) &&
    !('members' in data) &&
    !('cats' in data) &&
    !('budget' in data) &&
    !('log' in data)
  ) {
    errors.push('الملف لا يحتوي على بنية بيانات مقاضي العائلة المتوقعة');
    return { ok: false, errors, warnings, normalized: null };
  }

  const baseTs = nonNegNum(data.t, nonNegNum(nowMs, Date.now()));
  const rawCats = toArray(data.cats);
  const rawMembers = toArray(data.members);
  const rawItems = toArray(data.items);
  const rawLog = toArray(data.log).slice(0, MAX_LOG_ENTRIES);

  // 1. Categories
  const cats = {};
  const catInput = rawCats.length ? rawCats : DEFAULT_CATS;
  catInput.forEach((rawCat, idx) => {
    const cid = rawCat.id
      ? safeId(rawCat.id, '', `cat:${idx}:${rawCat.n}`)
      : `cat_${stableHash(rawCat.n || idx)}`;
    const cat = createCategory({
      id: cid,
      n: rawCat.n || 'قسم',
      i: rawCat.i || '🛒',
      order: Number.isFinite(rawCat.order) ? rawCat.order : idx,
      updatedAt: baseTs,
      deleted: false,
    });
    const v = validateCategory(cat);
    if (v.ok) {
      cats[cid] = cat;
    } else {
      warnings.push(`تخطّي قسم غير صالح: ${rawCat.n || cid}`);
    }
  });

  if (Object.keys(cats).length === 0) {
    for (const def of DEFAULT_CATS) {
      cats[def.id] = createCategory({ ...def, updatedAt: baseTs });
    }
  }
  const fallbackCatId = cats.super ? 'super' : Object.keys(cats)[0];

  // 2. Members (PIN salt & hash are intentionally discarded; members re-join via invite)
  const members = {};
  const memberByName = new Map();
  let strippedPinCount = 0;

  rawMembers.forEach((rawM, idx) => {
    if (rawM.salt || rawM.hash) strippedPinCount++;
    const mid = safeId(rawM.id, 'legacy_', `m:${idx}:${rawM.name}`);
    const member = createMember({
      id: mid,
      name: rawM.name || `عضو ${idx + 1}`,
      icon: rawM.icon || '🏠',
      role: rawM.admin ? 'admin' : 'member',
      off: Boolean(rawM.off),
      joinedAt: null,
      pendingRelink: true,
      legacyId: String(rawM.id || ''),
    });
    const v = validateMember(member);
    if (v.ok) {
      members[mid] = member;
      if (!memberByName.has(member.name)) {
        memberByName.set(member.name, mid);
      }
    } else {
      warnings.push(`تخطّي عضو غير صالح: ${rawM.name || idx}`);
    }
  });

  if (strippedPinCount > 0) {
    warnings.push(`تم تجاهل ${strippedPinCount} رمز PIN مشفّر (سيُعاد الربط عبر رابط الدعوة في v2)`);
  }
  if (data.ai || data.ps) {
    warnings.push('تم تجاهل بيانات إعدادات الذكاء الاصطناعي لحماية المفاتيح');
  }

  // 3. Items
  const items = {};
  rawItems.forEach((rawItem, idx) => {
    const nm = clampStr(rawItem.n, 60);
    if (!nm) {
      warnings.push(`تخطّي غرض بلا اسم (#${idx + 1})`);
      return;
    }
    const iid = safeId(rawItem.id, 'legacy_', `item:${idx}:${nm}:${rawItem.c || ''}`);
    const catId = cats[rawItem.c] ? rawItem.c : fallbackCatId;
    const byName = clampStr(rawItem.by, 40) || 'غير معروف';
    const byUid = memberByName.get(byName) || 'legacy';
    const clName = clampStr(rawItem.cl, 40);
    const clUid = clName ? memberByName.get(clName) || `legacy_name:${clName}` : '';

    const item = createItem({
      id: iid,
      n: nm,
      q: rawItem.q || '',
      p: rawItem.p,
      c: catId,
      u: Boolean(rawItem.u),
      by: byUid,
      byName,
      dn: Boolean(rawItem.dn),
      dnBy: rawItem.dn ? rawItem.dnBy || byName : '',
      dnAt: rawItem.dn ? rawItem.dnAt || '' : '',
      cl: rawItem.dn ? '' : clUid,
      note: rawItem.note || '',
      createdAt: baseTs,
      updatedAt: baseTs,
      deleted: false,
    });
    const v = validateItem(item);
    if (v.ok) {
      items[iid] = item;
    } else {
      warnings.push(`تخطّي غرض غير صالح: ${nm}`);
    }
  });

  // 4. Budget
  const budget = createBudget({
    monthly: 'budget' in data ? nonNegNum(data.budget, DEFAULT_BUDGET) : DEFAULT_BUDGET,
    perCat: {},
  });
  if (!validateBudget(budget).ok) {
    errors.push('قيمة الميزانية غير صالحة');
  }

  // 5. Log
  const log = {};
  rawLog.forEach((rawEntry, idx) => {
    const w = clampStr(rawEntry.w, 40) || 'النظام';
    const a = clampStr(rawEntry.a, 40);
    const n = clampStr(rawEntry.n, 80);
    const t = clampStr(rawEntry.t, 40);
    const lid = `legacy_log_${stableHash(`${idx}|${w}|${a}|${n}|${t}`)}`;
    log[lid] = createLogEntry({
      id: lid,
      at: Math.max(0, baseTs - idx * 1000),
      uid: memberByName.get(w) || 'legacy',
      actorName: w,
      action: a,
      target: n,
      legacyTime: t,
    });
  });

  const normalized = {
    meta: createMeta({
      name: roomName,
      createdAt: baseTs,
      schemaVersion: SCHEMA_VERSION,
      invite: null,
    }),
    members,
    cats,
    items,
    requests: {},
    history: {},
    log,
    budget,
  };

  return { ok: errors.length === 0, errors, warnings, normalized };
}

function diffCollection(incomingMap, existingMap) {
  let add = 0;
  let skip = 0;
  for (const id of Object.keys(incomingMap || {})) {
    if (existingMap && existingMap[id]) {
      skip++;
    } else {
      add++;
    }
  }
  return { total: Object.keys(incomingMap || {}).length, add, skip };
}

function createBlankImportTarget() {
  return {
    meta: null,
    members: {},
    cats: {},
    items: {},
    requests: {},
    history: {},
    log: {},
    budget: null,
  };
}

/**
 * Produces an idempotent dry-run import plan against existingRoomState.
 */
export function planLegacyImport(rawInput, existingRoomState = null, options = {}) {
  let norm;
  try {
    norm = normalizeLegacyBackup(rawInput, options);
  } catch (err) {
    return {
      ok: false,
      errors: [err.message || 'تعذّر قراءة ملف JSON'],
      warnings: [],
      counts: null,
      preview: null,
      normalized: null,
    };
  }

  if (!norm.ok || !norm.normalized) {
    return {
      ok: false,
      errors: norm.errors,
      warnings: norm.warnings,
      counts: null,
      preview: null,
      normalized: null,
    };
  }

  const existing = existingRoomState || createBlankImportTarget();
  const n = norm.normalized;
  const itemList = Object.values(n.items);

  const counts = {
    cats: diffCollection(n.cats, existing.cats),
    members: diffCollection(n.members, existing.members),
    items: {
      ...diffCollection(n.items, existing.items),
      done: itemList.filter((i) => i.dn).length,
      todo: itemList.filter((i) => !i.dn).length,
    },
    log: diffCollection(n.log, existing.log),
    budgetMonthly: n.budget.monthly,
  };

  const preview = {
    roomName: n.meta.name,
    budgetMonthly: n.budget.monthly,
    members: Object.values(n.members).map((m) => ({ name: m.name, icon: m.icon, role: m.role })),
    sampleCats: Object.values(n.cats)
      .slice(0, 6)
      .map((c) => `${c.i} ${c.n}`),
    sampleItems: itemList.slice(0, 8).map((i) => ({ n: i.n, q: i.q, p: i.p, dn: i.dn })),
  };

  return {
    ok: true,
    errors: [],
    warnings: norm.warnings,
    counts,
    preview,
    normalized: n,
  };
}

/**
 * Applies a validated import plan onto targetRoomState idempotently.
 * Existing entities with the same ID are preserved (never overwritten/duplicated).
 */
export function applyLegacyImport(plan, targetRoomState = null) {
  if (!plan?.ok || !plan.normalized) {
    throw new Error('خطة الاستيراد غير صالحة');
  }
  const base = targetRoomState ? structuredClone(targetRoomState) : createBlankImportTarget();
  const src = plan.normalized;
  const applied = { cats: 0, members: 0, items: 0, log: 0, budgetUpdated: false };

  for (const col of ['cats', 'members', 'items', 'log']) {
    base[col] = base[col] || {};
    for (const [id, entity] of Object.entries(src[col] || {})) {
      if (!base[col][id]) {
        base[col][id] = structuredClone(entity);
        applied[col]++;
      }
    }
  }

  if (!base.budget) {
    base.budget = structuredClone(src.budget);
    applied.budgetUpdated = true;
  }
  if (!base.meta) {
    base.meta = structuredClone(src.meta);
  }
  if (!base.requests) base.requests = {};
  if (!base.history) base.history = {};

  return { state: base, applied };
}

export async function importLegacyToIdb(store, roomId, rawInput, { dryRun = true, roomName } = {}) {
  const existing = await store.loadRoomSnapshot(roomId);
  const hasExistingData =
    Boolean(existing.meta) ||
    Object.keys(existing.items).length > 0 ||
    Object.keys(existing.cats).length > 0;

  const plan = planLegacyImport(rawInput, hasExistingData ? existing : null, { roomName });
  if (!plan.ok || dryRun) {
    return { plan, applied: null };
  }

  const { state, applied } = applyLegacyImport(plan, hasExistingData ? existing : null);
  await store.setRoomDoc(roomId, { meta: state.meta, budget: state.budget });
  await Promise.all([
    store.putEntitiesBatch(roomId, 'cats', state.cats),
    store.putEntitiesBatch(roomId, 'members', state.members),
    store.putEntitiesBatch(roomId, 'items', state.items),
    store.putEntitiesBatch(roomId, 'log', state.log),
  ]);
  return { plan, applied };
}
