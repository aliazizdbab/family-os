export const SCHEMA_VERSION = 1;
export const TOMBSTONE_TTL_MS = 30 * 24 * 60 * 60 * 1000;
export const MAX_LOG_ENTRIES = 200;
export const DEFAULT_BUDGET = 250;
export const DEFAULT_ACCENT = '#0f766e';
export const ROLES = Object.freeze(['developer', 'admin', 'mother', 'member', 'child']);
export const REQUEST_STATUSES = Object.freeze(['pending', 'approved', 'rejected']);
export const TASK_RECURRENCES = Object.freeze(['once', 'daily', 'weekly', 'monthly']);

export const DEFAULT_FAMILY_MEMBERS = Object.freeze([
  { id: 'mem_father', name: 'الأب', icon: '👑', role: 'admin', accessCode: '1234', points: 0 },
  { id: 'mem_mother', name: 'الأم', icon: '🤱', role: 'mother', accessCode: '2222', points: 0 },
  {
    id: 'mem_son',
    name: 'الابن (أحمد)',
    icon: '🧒',
    role: 'child',
    accessCode: '0000',
    points: 20,
  },
  {
    id: 'mem_daughter',
    name: 'الابنة (سارة)',
    icon: '👧',
    role: 'child',
    accessCode: '0000',
    points: 15,
  },
]);

export const DEFAULT_CATS = Object.freeze([
  { id: 'laundry', i: '🧺', n: 'المغسلة', order: 0 },
  { id: 'appliances', i: '🔌', n: 'صيانة الأجهزة', order: 1 },
  { id: 'car', i: '🔧', n: 'السيارة', order: 2 },
  { id: 'herbs', i: '🌿', n: 'العطّار', order: 3 },
  { id: 'pharmacy', i: '💊', n: 'الصيدلية', order: 4 },
  { id: 'super', i: '🏪', n: 'السوبرماركت', order: 5 },
  { id: 'produce', i: '🥬', n: 'الخضّار', order: 6 },
  { id: 'bakery', i: '🥖', n: 'المخبز', order: 7 },
  { id: 'butcher', i: '🥩', n: 'القصّاب (آخراً ❄️)', order: 8 },
]);

export function clampStr(val, maxLen) {
  return String(val ?? '')
    .trim()
    .slice(0, maxLen);
}

export function nonNegNum(val, fallback = 0) {
  const n = Number(val);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

export function createMeta({
  name = 'عائلتي',
  createdAt = Date.now(),
  schemaVersion = SCHEMA_VERSION,
  invite = null,
} = {}) {
  return {
    name: clampStr(name, 50) || 'عائلتي',
    createdAt: nonNegNum(createdAt, Date.now()),
    schemaVersion: Number.isInteger(schemaVersion) ? schemaVersion : SCHEMA_VERSION,
    invite:
      invite && typeof invite === 'object'
        ? {
            token: clampStr(invite.token, 64),
            expiresAt: nonNegNum(invite.expiresAt, 0),
          }
        : null,
  };
}

export function createMember({
  id = '',
  name = '',
  icon = '🏠',
  role = 'member',
  accessCode = '0000',
  points = 0,
  off = false,
  joinedAt = Date.now(),
  updatedAt = Date.now(),
  deleted = false,
  pendingRelink = false,
  legacyId = '',
} = {}) {
  const safeRole = ROLES.includes(role) ? role : 'member';
  const out = {
    id: clampStr(id, 128),
    name: clampStr(name, 40),
    icon: clampStr(icon, 8) || '🏠',
    role: safeRole,
    accessCode: clampStr(accessCode, 16) || '0000',
    points: nonNegNum(points, 0),
    off: Boolean(off),
    joinedAt: joinedAt === null ? null : nonNegNum(joinedAt, Date.now()),
    updatedAt: nonNegNum(updatedAt, Date.now()),
    deleted: Boolean(deleted),
  };
  if (pendingRelink) out.pendingRelink = true;
  if (legacyId) out.legacyId = clampStr(legacyId, 64);
  return out;
}

export function createTask({
  id = '',
  title = '',
  category = 'عامة',
  assigneeId = 'all',
  assigneeName = 'الجميع',
  recurrence = 'once',
  points = 10,
  done = false,
  doneBy = '',
  doneAt = 0,
  createdBy = '',
  updatedAt = Date.now(),
  deleted = false,
} = {}) {
  return {
    id: clampStr(id, 64),
    title: clampStr(title, 80),
    category: clampStr(category, 40) || 'عامة',
    assigneeId: clampStr(assigneeId, 128) || 'all',
    assigneeName: clampStr(assigneeName, 40) || 'الجميع',
    recurrence: TASK_RECURRENCES.includes(recurrence) ? recurrence : 'once',
    points: nonNegNum(points, 0),
    done: Boolean(done),
    doneBy: done ? clampStr(doneBy, 40) : '',
    doneAt: done ? nonNegNum(doneAt, Date.now()) : 0,
    createdBy: clampStr(createdBy, 40),
    updatedAt: nonNegNum(updatedAt, Date.now()),
    deleted: Boolean(deleted),
  };
}

export function createCategory({
  id = '',
  n = '',
  i = '🛒',
  order = 0,
  updatedAt = Date.now(),
  deleted = false,
} = {}) {
  return {
    id: clampStr(id, 64),
    n: clampStr(n, 30),
    i: clampStr(i, 8) || '🛒',
    order: nonNegNum(order, 0),
    updatedAt: nonNegNum(updatedAt, Date.now()),
    deleted: Boolean(deleted),
  };
}

export function createItem({
  id = '',
  n = '',
  q = '',
  p = 0,
  c = 'super',
  u = false,
  by = '',
  byName = '',
  dn = false,
  dnBy = '',
  dnAt = '',
  cl = '',
  note = '',
  deferred = false,
  createdAt = Date.now(),
  updatedAt = Date.now(),
  deleted = false,
} = {}) {
  const ts = nonNegNum(updatedAt, Date.now());
  return {
    id: clampStr(id, 64),
    n: clampStr(n, 60),
    q: clampStr(q, 30),
    p: nonNegNum(p, 0),
    c: clampStr(c, 64) || 'super',
    u: Boolean(u),
    by: clampStr(by, 128),
    byName: clampStr(byName, 40),
    dn: Boolean(dn),
    dnBy: dn ? clampStr(dnBy, 40) : '',
    dnAt: dn ? (typeof dnAt === 'number' ? nonNegNum(dnAt, ts) : clampStr(dnAt, 40)) : '',
    cl: dn ? '' : clampStr(cl, 128),
    note: clampStr(note, 200),
    deferred: dn ? false : Boolean(deferred),
    createdAt: nonNegNum(createdAt, ts),
    updatedAt: ts,
    deleted: Boolean(deleted),
  };
}

export function createHistoryEntry({
  id = '',
  itemName = '',
  c = 'super',
  p = 0,
  q = '',
  at = Date.now(),
  uid = '',
} = {}) {
  return {
    id: clampStr(id, 80),
    itemName: clampStr(itemName, 60),
    c: clampStr(c, 64) || 'super',
    p: nonNegNum(p, 0),
    q: clampStr(q, 30),
    at: nonNegNum(at, Date.now()),
    uid: clampStr(uid, 128),
  };
}

export function createRequest({
  id = '',
  by = '',
  byName = '',
  n = '',
  q = '',
  c = 'super',
  status = 'pending',
  updatedAt = Date.now(),
  deleted = false,
} = {}) {
  return {
    id: clampStr(id, 64),
    by: clampStr(by, 128),
    byName: clampStr(byName, 40),
    n: clampStr(n, 60),
    q: clampStr(q, 30),
    c: clampStr(c, 64) || 'super',
    status: REQUEST_STATUSES.includes(status) ? status : 'pending',
    updatedAt: nonNegNum(updatedAt, Date.now()),
    deleted: Boolean(deleted),
  };
}

export function createLogEntry({
  id = '',
  at = Date.now(),
  uid = '',
  actorName = '',
  action = '',
  target = '',
  legacyTime = '',
} = {}) {
  const entry = {
    id: clampStr(id, 80),
    at: nonNegNum(at, Date.now()),
    uid: clampStr(uid, 128),
    actorName: clampStr(actorName, 40),
    action: clampStr(action, 40),
    target: clampStr(target, 80),
  };
  if (legacyTime) entry.legacyTime = clampStr(legacyTime, 40);
  return entry;
}

export function createBudget({ monthly = DEFAULT_BUDGET, perCat = {} } = {}) {
  const cleanPerCat = {};
  if (perCat && typeof perCat === 'object') {
    for (const [cid, amt] of Object.entries(perCat)) {
      const key = clampStr(cid, 64);
      if (key) cleanPerCat[key] = nonNegNum(amt, 0);
    }
  }
  return {
    monthly: nonNegNum(monthly, DEFAULT_BUDGET),
    perCat: cleanPerCat,
  };
}

export function validateMeta(meta) {
  const errors = [];
  if (!meta || typeof meta !== 'object') return { ok: false, errors: ['meta must be object'] };
  if (typeof meta.name !== 'string' || !meta.name.trim() || meta.name.length > 50) {
    errors.push('meta.name must be 1..50 chars');
  }
  if (!Number.isFinite(meta.createdAt) || meta.createdAt < 0) {
    errors.push('meta.createdAt must be non-negative number');
  }
  if (!Number.isInteger(meta.schemaVersion) || meta.schemaVersion < 1) {
    errors.push('meta.schemaVersion must be integer >= 1');
  }
  if (meta.invite !== null && meta.invite !== undefined) {
    if (
      typeof meta.invite !== 'object' ||
      typeof meta.invite.token !== 'string' ||
      meta.invite.token.length < 8 ||
      !Number.isFinite(meta.invite.expiresAt)
    ) {
      errors.push('meta.invite is invalid');
    }
  }
  return { ok: errors.length === 0, errors };
}

export function validateMember(m) {
  const errors = [];
  if (!m || typeof m !== 'object') return { ok: false, errors: ['member must be object'] };
  if (typeof m.name !== 'string' || !m.name.trim() || m.name.length > 40) {
    errors.push('member.name must be 1..40 chars');
  }
  if (!ROLES.includes(m.role)) {
    errors.push('member.role invalid');
  }
  if (typeof m.off !== 'boolean') {
    errors.push('member.off must be boolean');
  }
  return { ok: errors.length === 0, errors };
}

export function validateCategory(c) {
  const errors = [];
  if (!c || typeof c !== 'object') return { ok: false, errors: ['category must be object'] };
  if (typeof c.n !== 'string' || !c.n.trim() || c.n.length > 30) {
    errors.push('cat.n must be 1..30 chars');
  }
  if (typeof c.i !== 'string' || !c.i.trim() || c.i.length > 8) {
    errors.push('cat.i must be 1..8 chars');
  }
  if (!Number.isFinite(c.order) || c.order < 0) {
    errors.push('cat.order must be >= 0');
  }
  if (!Number.isFinite(c.updatedAt) || c.updatedAt < 0) {
    errors.push('cat.updatedAt must be >= 0');
  }
  if (typeof c.deleted !== 'boolean') {
    errors.push('cat.deleted must be boolean');
  }
  return { ok: errors.length === 0, errors };
}

export function validateItem(i) {
  const errors = [];
  if (!i || typeof i !== 'object') return { ok: false, errors: ['item must be object'] };
  if (typeof i.n !== 'string' || !i.n.trim() || i.n.length > 60) {
    errors.push('item.n must be 1..60 chars');
  }
  if (typeof i.q !== 'string' || i.q.length > 30) {
    errors.push('item.q must be string <= 30 chars');
  }
  if (!Number.isFinite(i.p) || i.p < 0) {
    errors.push('item.p must be >= 0');
  }
  if (typeof i.c !== 'string' || !i.c.trim()) {
    errors.push('item.c required');
  }
  if (typeof i.u !== 'boolean' || typeof i.dn !== 'boolean' || typeof i.deleted !== 'boolean') {
    errors.push('item booleans (u, dn, deleted) invalid');
  }
  if (!Number.isFinite(i.updatedAt) || !Number.isFinite(i.createdAt)) {
    errors.push('item timestamps invalid');
  }
  return { ok: errors.length === 0, errors };
}

export function validateRequest(r) {
  const errors = [];
  if (!r || typeof r !== 'object') return { ok: false, errors: ['request must be object'] };
  if (typeof r.n !== 'string' || !r.n.trim() || r.n.length > 60) {
    errors.push('request.n must be 1..60 chars');
  }
  if (!REQUEST_STATUSES.includes(r.status)) {
    errors.push('request.status invalid');
  }
  if (!Number.isFinite(r.updatedAt) || r.updatedAt < 0) {
    errors.push('request.updatedAt invalid');
  }
  return { ok: errors.length === 0, errors };
}

export function validateTask(t) {
  const errors = [];
  if (!t || typeof t !== 'object') return { ok: false, errors: ['task must be object'] };
  if (typeof t.title !== 'string' || !t.title.trim() || t.title.length > 80) {
    errors.push('task.title must be 1..80 chars');
  }
  if (!TASK_RECURRENCES.includes(t.recurrence)) {
    errors.push('task.recurrence invalid');
  }
  if (!Number.isFinite(t.points) || t.points < 0) {
    errors.push('task.points must be >= 0');
  }
  return { ok: errors.length === 0, errors };
}

export function validateBudget(b) {
  const errors = [];
  if (!b || typeof b !== 'object') return { ok: false, errors: ['budget must be object'] };
  if (!Number.isFinite(b.monthly) || b.monthly < 0) {
    errors.push('budget.monthly must be >= 0');
  }
  if (!b.perCat || typeof b.perCat !== 'object' || Array.isArray(b.perCat)) {
    errors.push('budget.perCat must be object');
  } else {
    for (const [k, v] of Object.entries(b.perCat)) {
      if (!k || !Number.isFinite(v) || v < 0) {
        errors.push(`budget.perCat[${k}] invalid`);
      }
    }
  }
  return { ok: errors.length === 0, errors };
}

/**
 * Deterministic LWW comparison by updatedAt, tie-breaking on actor uid / id.
 * Returns > 0 if `a` wins over `b`, < 0 if `b` wins, 0 if equal.
 */
export function compareLww(a, b) {
  const ta = nonNegNum(a?.updatedAt, 0);
  const tb = nonNegNum(b?.updatedAt, 0);
  if (ta !== tb) return ta - tb;
  const tieA = String(a?.updatedBy || a?.by || a?.id || '');
  const tieB = String(b?.updatedBy || b?.by || b?.id || '');
  return tieA.localeCompare(tieB);
}

export function mergeEntity(localEntity, remoteEntity) {
  if (!localEntity) return remoteEntity ?? null;
  if (!remoteEntity) return localEntity;
  return compareLww(remoteEntity, localEntity) >= 0 ? remoteEntity : localEntity;
}

export function pruneExpiredTombstones(entities, nowMs = Date.now(), ttlMs = TOMBSTONE_TTL_MS) {
  const cutoff = nowMs - ttlMs;
  if (Array.isArray(entities)) {
    return entities.filter((e) => !(e?.deleted && nonNegNum(e.updatedAt, 0) < cutoff));
  }
  const out = {};
  for (const [id, entity] of Object.entries(entities || {})) {
    if (!(entity?.deleted && nonNegNum(entity.updatedAt, 0) < cutoff)) {
      out[id] = entity;
    }
  }
  return out;
}

const MIGRATIONS = {
  // v0 -> v1: normalize collections and guarantee default structure
  1(data) {
    const out = {
      meta: createMeta({ ...(data.meta || {}), schemaVersion: 1 }),
      members: data.members && typeof data.members === 'object' ? { ...data.members } : {},
      cats: data.cats && typeof data.cats === 'object' ? { ...data.cats } : {},
      items: data.items && typeof data.items === 'object' ? { ...data.items } : {},
      requests: data.requests && typeof data.requests === 'object' ? { ...data.requests } : {},
      tasks: data.tasks && typeof data.tasks === 'object' ? { ...data.tasks } : {},
      history: data.history && typeof data.history === 'object' ? { ...data.history } : {},
      log: data.log && typeof data.log === 'object' ? { ...data.log } : {},
      budget: createBudget(data.budget || {}),
    };
    if (Object.keys(out.cats).length === 0) {
      for (const cat of DEFAULT_CATS) {
        out.cats[cat.id] = createCategory(cat);
      }
    }
    return out;
  },
};

export function migrateRoomSchema(roomData, targetVersion = SCHEMA_VERSION) {
  const input = roomData && typeof roomData === 'object' ? roomData : {};
  let currentVersion = Number.isInteger(input?.meta?.schemaVersion) ? input.meta.schemaVersion : 0;
  if (currentVersion > targetVersion) {
    throw new Error(`Unsupported schemaVersion ${currentVersion} > ${targetVersion}`);
  }
  let state = input;
  while (currentVersion < targetVersion) {
    const nextVersion = currentVersion + 1;
    const step = MIGRATIONS[nextVersion];
    if (!step) {
      throw new Error(`Missing migration step for v${nextVersion}`);
    }
    state = step(state);
    currentVersion = nextVersion;
  }
  return state;
}

export function createEmptyRoomState(roomName = 'عائلتي') {
  return migrateRoomSchema({ meta: { name: roomName, createdAt: Date.now() } }, SCHEMA_VERSION);
}
