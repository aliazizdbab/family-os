import { TOMBSTONE_TTL_MS, compareLww, mergeEntity } from './schema.js';
import { DEFAULT_RTDB_URL, notifyState, refreshLocalSnapshot, state } from './state.js';
import { initFirebaseAuth, resolveFirebaseConfig, getAuthenticatedServices } from './auth.js';
import { localStore } from './store-idb.js';

const FIREBASE_DB_CDN = 'https://www.gstatic.com/firebasejs/13.1.0/firebase-database.js';

export const SYNC_COLLECTIONS = Object.freeze([
  'members',
  'cats',
  'items',
  'requests',
  'tasks',
  'history',
  'log',
]);

export const LWW_COLLECTIONS = new Set(['cats', 'items', 'requests', 'tasks']);

/**
 * Produce a plain, acyclic, RTDB-safe copy of a value.
 * The local room meta can accidentally hold references back to itself
 * (e.g. meta.room === meta), which makes RTDB writes fail with a depth/cycle
 * error. Deep-copy only JSON-safe primitives, skipping self references.
 */
export function sanitizeForRtdb(value, seen = new WeakSet()) {
  if (value === null || typeof value !== 'object') return value;
  if (seen.has(value)) return undefined;
  seen.add(value);
  if (Array.isArray(value)) {
    return value.map((v) => sanitizeForRtdb(v, seen)).filter((v) => v !== undefined);
  }
  const out = {};
  for (const [k, v] of Object.entries(value)) {
    if (k === 'room' || k === 'id') continue;
    const clean = sanitizeForRtdb(v, seen);
    if (clean !== undefined) out[k] = clean;
  }
  return out;
}

export function getSyncBadgeLabel(
  syncState = state.syncStatus,
  online = globalThis.navigator ? globalThis.navigator.onLine : true
) {
  const pending = Number(syncState?.pendingCount) || 0;
  if (!online) {
    return pending > 0 ? `🟡 غير متصل · ${pending} تغييرات معلّقة` : '🟡 غير متصل (وضع دون إنترنت)';
  }
  if (syncState?.state === 'syncing') {
    return pending > 0 ? `🔄 جارٍ المزامنة (${pending} تغييرات معلّقة)` : '🔄 جارٍ المزامنة';
  }
  if (pending > 0) {
    return `🟢 متصل · ${pending} تغييرات معلّقة`;
  }
  return '🟢 متصل';
}

export class SyncEngine {
  constructor({
    roomId,
    store = localStore,
    useEmulator = state.prefs.useEmulator,
    rtdbUrl = state.prefs.rtdbUrl,
    onUpdate = null,
  } = {}) {
    this.roomId = roomId;
    this.store = store;
    this.useEmulator = useEmulator;
    this.rtdbUrl = rtdbUrl;
    this.onUpdate = onUpdate;
    this.unsubscribers = [];
    this.flushing = false;
    this.retryAttempt = 0;
    this.retryTimer = null;
    this.started = false;
  }

  isOnline() {
    return globalThis.navigator ? Boolean(globalThis.navigator.onLine) : true;
  }

  /**
   * Resolve Firebase services using the LIVE authenticated family/staff identity.
   * The sync engine must never sign in anonymously: anonymous users are not room
   * members, so every write would be rejected by the security rules and the
   * outbox would stay pending forever.
   */
  async authServices() {
    const services = await getAuthenticatedServices();
    if (!services.ok) {
      throw new Error(services.reason === 'no-auth-session' ? 'Firebase Auth session not ready' : services.reason || 'firebase-unavailable');
    }
    return services;
  }

  async refreshPendingCount() {
    const outbox = await this.store.listOutbox(this.roomId);
    state.syncStatus.pendingCount = outbox.length;
    if (!this.isOnline()) {
      state.syncStatus.state = 'offline';
    } else if (!this.flushing) {
      state.syncStatus.state = 'online';
    }
    this.emitUpdate();
    return outbox.length;
  }

  emitUpdate() {
    notifyState();
    if (typeof this.onUpdate === 'function') {
      try {
        this.onUpdate(state.syncStatus);
      } catch {
        // Ignore callback error
      }
    }
  }

  async mutateEntity(
    collection,
    entityId,
    payload,
    { op = 'upsert', nowMs = Date.now(), by = '' } = {}
  ) {
    const existing = await this.store.getEntity(this.roomId, collection, entityId);
    let nextValue;

    if (op === 'delete') {
      const base = existing || payload || { id: entityId };
      nextValue = {
        ...base,
        id: entityId,
        deleted: true,
        updatedAt: Math.max(nowMs, (Number(base.updatedAt) || 0) + 1),
        by: by || base.by || '',
      };
    } else if (LWW_COLLECTIONS.has(collection) && existing) {
      const candidate = {
        ...payload,
        id: entityId,
        updatedAt: Number(payload?.updatedAt) || nowMs,
      };
      nextValue = mergeEntity({ ...existing, id: entityId }, candidate);
    } else {
      nextValue = {
        ...payload,
        id: entityId,
      };
      if (LWW_COLLECTIONS.has(collection) && !nextValue.updatedAt) {
        nextValue.updatedAt = nowMs;
      }
    }

    const storedPayload = { ...nextValue };
    delete storedPayload.id;
    await this.store.putEntity(this.roomId, collection, entityId, storedPayload);
    await this.store.enqueueOutbox({
      roomId: this.roomId,
      collection,
      entityId,
      op: 'upsert',
      payload: storedPayload,
      createdAt: nowMs,
    });

    await this.refreshPendingCount();
    if (this.isOnline()) {
      void this.flushOutbox();
    }
    return nextValue;
  }

  async mutateRoomDoc(field, value, nowMs = Date.now()) {
    await this.store.setRoomDoc(this.roomId, { [field]: value });
    await this.store.enqueueOutbox({
      roomId: this.roomId,
      collection: '__room__',
      entityId: field,
      op: 'set',
      payload: value,
      createdAt: nowMs,
    });
    await this.refreshPendingCount();
    if (this.isOnline()) {
      void this.flushOutbox();
    }
    return value;
  }

  async applyIncomingRemoteEntity(collection, entityId, remotePayload) {
    if (!remotePayload || typeof remotePayload !== 'object') return false;
    const existing = await this.store.getEntity(this.roomId, collection, entityId);

    if (LWW_COLLECTIONS.has(collection) && existing) {
      const localWithId = { ...existing, id: entityId };
      const remoteWithId = { ...remotePayload, id: entityId };
      const cmp = compareLww(localWithId, remoteWithId);
      if (cmp > 0) {
        // Local entity is strictly newer than incoming remote entity; keep local
        return false;
      }
      const merged = mergeEntity(localWithId, remoteWithId);
      const cleanMerged = { ...merged };
      delete cleanMerged.id;
      await this.store.putEntity(this.roomId, collection, entityId, cleanMerged);
      return true;
    }

    const cleanRemote = { ...remotePayload };
    delete cleanRemote.id;
    delete cleanRemote.token;
    await this.store.putEntity(this.roomId, collection, entityId, cleanRemote);
    return true;
  }

  async applyIncomingRemoteRemoval(collection, entityId) {
    const outbox = await this.store.listOutbox(this.roomId);
    const hasPendingLocalWrite = outbox.some(
      (entry) => entry.collection === collection && entry.entityId === entityId
    );
    if (hasPendingLocalWrite) return false;
    await this.store.removeEntityHard(this.roomId, collection, entityId);
    return true;
  }

  async flushOutbox() {
    if (this.flushPromise) {
      await this.flushPromise;
    }
    if (!this.isOnline()) {
      await this.refreshPendingCount();
      return { ok: false, flushed: 0 };
    }
    this.flushPromise = this._doFlushOutbox();
    try {
      return await this.flushPromise;
    } finally {
      this.flushPromise = null;
    }
  }

  async _doFlushOutbox() {
    const outbox = await this.store.listOutbox(this.roomId);
    state.syncStatus.pendingCount = outbox.length;
    if (outbox.length === 0) {
      state.syncStatus.state = this.isOnline() ? 'online' : 'offline';
      this.emitUpdate();
      return { ok: true, flushed: 0 };
    }

    this.flushing = true;
    state.syncStatus.state = 'syncing';
    this.emitUpdate();

    let flushed = 0;
    try {
      const authRes = await this.authServices();
      if (!authRes || !authRes.db || !authRes.dbMod) {
        throw new Error('Firebase Database not ready');
      }

      const { db, dbMod } = authRes;

      for (const entry of outbox) {
        if (!this.isOnline()) break;

        if (entry.collection === '__room__') {
          const docRef = dbMod.ref(db, `v2/rooms/${this.roomId}/${entry.entityId}`);
          await dbMod.set(docRef, entry.payload);
          await this.store.removeOutbox(entry.opId);
          flushed += 1;
          continue;
        }

        // The room meta entity ("meta"/"room") maps to v2/rooms/{id}/meta, not
        // .../meta/room, and its local payload may hold cyclic references.
        if (entry.collection === 'meta') {
          const targetRef = dbMod.ref(db, `v2/rooms/${this.roomId}/meta`);
          const clean = sanitizeForRtdb(entry.payload);
          // Preserve the server-side invite token: the client meta payload does
          // not carry it, and overwriting would silently invalidate invitations.
          try {
            const remoteSnap = await dbMod.get(targetRef);
            const remoteInvite = remoteSnap.exists() ? remoteSnap.val()?.invite : null;
            if (remoteInvite && !clean.invite) clean.invite = remoteInvite;
          } catch {
            // ignore read issues
          }
          await dbMod.set(targetRef, clean);
          await this.store.removeOutbox(entry.opId);
          flushed += 1;
          continue;
        }

        const targetRef = dbMod.ref(
          db,
          `v2/rooms/${this.roomId}/${entry.collection}/${entry.entityId}`
        );

        if (
          entry.op !== 'delete-hard' &&
          LWW_COLLECTIONS.has(entry.collection) &&
          typeof dbMod.get === 'function'
        ) {
          const remoteSnap = await dbMod.get(targetRef);
          if (remoteSnap.exists()) {
            const remoteVal = remoteSnap.val();
            const cmp = compareLww(
              { ...entry.payload, id: entry.entityId },
              { ...remoteVal, id: entry.entityId }
            );
            if (cmp < 0) {
              // Remote is already newer than this queued outbox write; adopt remote and drop outbox item
              await this.applyIncomingRemoteEntity(entry.collection, entry.entityId, remoteVal);
              await this.store.removeOutbox(entry.opId);
              flushed += 1;
              continue;
            }
          }
        }

        if (entry.op === 'delete-hard') {
          await dbMod.remove(targetRef);
        } else {
          await dbMod.set(targetRef, entry.payload);
        }
        await this.store.removeOutbox(entry.opId);
        flushed += 1;
      }

      this.retryAttempt = 0;
      clearTimeout(this.retryTimer);
      this.flushing = false;
      await this.refreshPendingCount();
      return { ok: true, flushed };
    } catch {
      this.flushing = false;
      this.retryAttempt += 1;
      const delayMs = Math.min(30000, 500 * 2 ** Math.min(this.retryAttempt, 6));
      clearTimeout(this.retryTimer);
      this.retryTimer = setTimeout(() => {
        if (this.isOnline()) {
          void this.flushOutbox();
        }
      }, delayMs);
      this.retryTimer?.unref?.();
      await this.refreshPendingCount();
      return { ok: false, flushed, retryInMs: delayMs };
    }
  }

  async cleanupExpiredTombstones(nowMs = Date.now()) {
    let removedCount = 0;
    for (const col of ['cats', 'items']) {
      const entities = await this.store.getCollection(this.roomId, col);
      for (const [id, entity] of Object.entries(entities)) {
        if (
          entity &&
          entity.deleted === true &&
          nowMs - (Number(entity.updatedAt) || 0) > TOMBSTONE_TTL_MS
        ) {
          await this.store.removeEntityHard(this.roomId, col, id);
          await this.store.enqueueOutbox({
            roomId: this.roomId,
            collection: col,
            entityId: id,
            op: 'delete-hard',
            payload: null,
            createdAt: nowMs,
          });
          removedCount += 1;
        }
      }
    }
    if (removedCount > 0) {
      await this.refreshPendingCount();
      if (this.isOnline()) {
        await this.flushOutbox();
      }
    }
    return removedCount;
  }

  async start() {
    if (this.started) return { ok: true };
    this.started = true;
    await this.refreshPendingCount();

    let authRes;
    try {
      authRes = await this.authServices();
    } catch (err) {
      this.started = false;
      return { ok: false, reason: err?.message || 'auth-unavailable' };
    }
    if (!authRes.db || !authRes.dbMod) {
      this.started = false;
      return { ok: false, reason: 'db-unavailable' };
    }

    const { db, dbMod } = authRes;

    // Subscribe per collection with onChildAdded / onChildChanged / onChildRemoved
    for (const col of SYNC_COLLECTIONS) {
      const colRef = dbMod.ref(db, `v2/rooms/${this.roomId}/${col}`);

      if (typeof dbMod.onChildAdded === 'function') {
        const unsubAdd = dbMod.onChildAdded(colRef, async (snap) => {
          const changed = await this.applyIncomingRemoteEntity(col, snap.key, snap.val());
          if (changed) {
            await refreshLocalSnapshot(this.roomId);
            this.emitUpdate();
          }
        });
        this.unsubscribers.push(unsubAdd);
      }

      if (typeof dbMod.onChildChanged === 'function') {
        const unsubChange = dbMod.onChildChanged(colRef, async (snap) => {
          const changed = await this.applyIncomingRemoteEntity(col, snap.key, snap.val());
          if (changed) {
            await refreshLocalSnapshot(this.roomId);
            this.emitUpdate();
          }
        });
        this.unsubscribers.push(unsubChange);
      }

      if (typeof dbMod.onChildRemoved === 'function') {
        const unsubRemove = dbMod.onChildRemoved(colRef, async (snap) => {
          const removed = await this.applyIncomingRemoteRemoval(col, snap.key);
          if (removed) {
            await refreshLocalSnapshot(this.roomId);
            this.emitUpdate();
          }
        });
        this.unsubscribers.push(unsubRemove);
      }
    }

    // Subscribe to meta and budget documents
    if (typeof dbMod.onValue === 'function') {
      for (const docField of ['meta', 'budget']) {
        const docRef = dbMod.ref(db, `v2/rooms/${this.roomId}/${docField}`);
        const unsubDoc = dbMod.onValue(docRef, async (snap) => {
          if (snap.exists()) {
            await this.store.setRoomDoc(this.roomId, { [docField]: snap.val() });
            await refreshLocalSnapshot(this.roomId);
            this.emitUpdate();
          }
        });
        this.unsubscribers.push(unsubDoc);
      }
    }

    if (this.isOnline()) {
      await this.flushOutbox();
    }

    return { ok: true, uid: authRes.uid };
  }

  stop() {
    clearTimeout(this.retryTimer);
    for (const unsub of this.unsubscribers) {
      try {
        if (typeof unsub === 'function') unsub();
      } catch {
        // Ignore unsubscribe error
      }
    }
    this.unsubscribers = [];
    this.started = false;
  }
}

export async function probeFirebaseConnection({
  rtdbUrl = state.prefs.rtdbUrl || DEFAULT_RTDB_URL,
  useEmulator = state.prefs.useEmulator,
} = {}) {
  const result = {
    checked: true,
    rtdbReachable: false,
    sdkLoaded: false,
    authReady: false,
    uid: null,
    mode: useEmulator ? 'emulator' : 'cloud',
    message: '',
  };

  try {
    await import(FIREBASE_DB_CDN);
    result.sdkLoaded = true;
  } catch {
    result.sdkLoaded = false;
  }

  const cleanUrl = String(rtdbUrl || DEFAULT_RTDB_URL).replace(/\/+$/, '');
  const probeTarget = useEmulator
    ? 'http://127.0.0.1:9000/.lp?ns=family-requests-9e431-default-rtdb'
    : `${cleanUrl}/rooms/family/t.json`;

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 6000);
    const response = await fetch(probeTarget, {
      method: 'GET',
      cache: 'no-store',
      signal: controller.signal,
    });
    clearTimeout(timer);
    result.rtdbReachable = response.status >= 200 && response.status < 500;
  } catch {
    result.rtdbReachable = false;
  }

  try {
    const config = await resolveFirebaseConfig({ databaseURL: cleanUrl });
    if (config.apiKey || useEmulator) {
      const authInit = await initFirebaseAuth({ useEmulator, rtdbUrl: cleanUrl });
      result.authReady = Boolean(authInit.ok);
    }
  } catch {
    result.authReady = false;
  }

  if (result.rtdbReachable && result.sdkLoaded) {
    result.message = result.authReady
      ? '✅ قاعدة بيانات Firebase وحزمة SDK والمصادقة المجهولة جاهزة للعمل'
      : '✅ اتصال قاعدة بيانات Firebase وحزمة SDK v13.1.0 يعملان بنجاح';
  } else if (result.sdkLoaded && !result.rtdbReachable) {
    result.message = '⚠️ حزمة Firebase SDK محمّلة لكن تعذّر الوصول لرابط قاعدة البيانات حالياً';
  } else {
    result.message = '⚠️ تعذّر التحقق من اتصال Firebase (تحقق من الاتصال بالإنترنت)';
  }

  Object.assign(state.firebaseStatus, result);
  return result;
}
