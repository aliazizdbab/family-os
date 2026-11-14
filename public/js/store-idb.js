const DB_NAME = 'family_os_v2';
const DB_VERSION = 1;

const STORES = {
  ROOMS: 'rooms',
  ENTITIES: 'entities',
  OUTBOX: 'outbox',
  PREFS: 'prefs',
};

function requestToPromise(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error('IndexedDB request failed'));
  });
}

function txDone(tx) {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error || new Error('IndexedDB transaction failed'));
    tx.onabort = () => reject(tx.error || new Error('IndexedDB transaction aborted'));
  });
}

function entityKey(roomId, collection, id) {
  return `${roomId}:${collection}:${id}`;
}

export class LocalStore {
  constructor(idbFactory = globalThis.indexedDB) {
    this.idbFactory = idbFactory;
    this._dbPromise = null;
  }

  open() {
    if (this._dbPromise) return this._dbPromise;
    if (!this.idbFactory) {
      return Promise.reject(new Error('IndexedDB is unavailable in this environment'));
    }
    this._dbPromise = new Promise((resolve, reject) => {
      const req = this.idbFactory.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORES.ROOMS)) {
          db.createObjectStore(STORES.ROOMS, { keyPath: 'roomId' });
        }
        if (!db.objectStoreNames.contains(STORES.ENTITIES)) {
          const entities = db.createObjectStore(STORES.ENTITIES, { keyPath: 'k' });
          entities.createIndex('byRoomCollection', ['roomId', 'collection'], { unique: false });
        }
        if (!db.objectStoreNames.contains(STORES.OUTBOX)) {
          const outbox = db.createObjectStore(STORES.OUTBOX, {
            keyPath: 'opId',
            autoIncrement: true,
          });
          outbox.createIndex('byRoom', 'roomId', { unique: false });
        }
        if (!db.objectStoreNames.contains(STORES.PREFS)) {
          db.createObjectStore(STORES.PREFS, { keyPath: 'key' });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error || new Error('Failed to open IndexedDB'));
    });
    return this._dbPromise;
  }

  async getRoomDoc(roomId) {
    const db = await this.open();
    const tx = db.transaction(STORES.ROOMS, 'readonly');
    const row = await requestToPromise(tx.objectStore(STORES.ROOMS).get(roomId));
    return row || null;
  }

  async setRoomDoc(roomId, patch) {
    const db = await this.open();
    const tx = db.transaction(STORES.ROOMS, 'readwrite');
    const store = tx.objectStore(STORES.ROOMS);
    const existing = (await requestToPromise(store.get(roomId))) || { roomId };
    // Never persist AI keys or secrets into IndexedDB
    const safePatch = { ...patch };
    delete safePatch.ai;
    const next = { ...existing, ...safePatch, roomId };
    store.put(next);
    await txDone(tx);
    return next;
  }

  async getCollection(roomId, collection) {
    const db = await this.open();
    const tx = db.transaction(STORES.ENTITIES, 'readonly');
    const index = tx.objectStore(STORES.ENTITIES).index('byRoomCollection');
    const rows = await requestToPromise(index.getAll([roomId, collection]));
    const map = {};
    for (const row of rows) {
      map[row.id] = row.data;
    }
    return map;
  }

  async putEntity(roomId, collection, id, data) {
    const db = await this.open();
    const tx = db.transaction(STORES.ENTITIES, 'readwrite');
    tx.objectStore(STORES.ENTITIES).put({
      k: entityKey(roomId, collection, id),
      roomId,
      collection,
      id,
      data,
    });
    await txDone(tx);
    return data;
  }

  async putEntitiesBatch(roomId, collection, entitiesMap) {
    const db = await this.open();
    const tx = db.transaction(STORES.ENTITIES, 'readwrite');
    const store = tx.objectStore(STORES.ENTITIES);
    for (const [id, data] of Object.entries(entitiesMap || {})) {
      store.put({
        k: entityKey(roomId, collection, id),
        roomId,
        collection,
        id,
        data,
      });
    }
    await txDone(tx);
  }

  async removeEntityHard(roomId, collection, id) {
    const db = await this.open();
    const tx = db.transaction(STORES.ENTITIES, 'readwrite');
    tx.objectStore(STORES.ENTITIES).delete(entityKey(roomId, collection, id));
    await txDone(tx);
  }

  async enqueueOutbox({ roomId, collection, entityId, op, payload }) {
    const db = await this.open();
    const tx = db.transaction(STORES.OUTBOX, 'readwrite');
    const entry = {
      roomId,
      collection,
      entityId,
      op,
      payload,
      createdAt: Date.now(),
      retries: 0,
      lastError: '',
    };
    const opId = await requestToPromise(tx.objectStore(STORES.OUTBOX).add(entry));
    await txDone(tx);
    return { ...entry, opId };
  }

  async listOutbox(roomId) {
    const db = await this.open();
    const tx = db.transaction(STORES.OUTBOX, 'readonly');
    const index = tx.objectStore(STORES.OUTBOX).index('byRoom');
    const rows = await requestToPromise(index.getAll(roomId));
    return rows.sort((a, b) => a.opId - b.opId);
  }

  async countOutbox(roomId) {
    const db = await this.open();
    const tx = db.transaction(STORES.OUTBOX, 'readonly');
    const index = tx.objectStore(STORES.OUTBOX).index('byRoom');
    return requestToPromise(index.count(roomId));
  }

  async updateOutbox(opId, patch) {
    const db = await this.open();
    const tx = db.transaction(STORES.OUTBOX, 'readwrite');
    const store = tx.objectStore(STORES.OUTBOX);
    const existing = await requestToPromise(store.get(opId));
    if (existing) {
      store.put({ ...existing, ...patch, opId });
    }
    await txDone(tx);
  }

  async removeOutbox(opId) {
    const db = await this.open();
    const tx = db.transaction(STORES.OUTBOX, 'readwrite');
    tx.objectStore(STORES.OUTBOX).delete(opId);
    await txDone(tx);
  }

  async getPref(key, fallback = null) {
    const db = await this.open();
    const tx = db.transaction(STORES.PREFS, 'readonly');
    const row = await requestToPromise(tx.objectStore(STORES.PREFS).get(key));
    return row ? row.value : fallback;
  }

  async setPref(key, value) {
    const db = await this.open();
    const tx = db.transaction(STORES.PREFS, 'readwrite');
    tx.objectStore(STORES.PREFS).put({ key, value });
    await txDone(tx);
    return value;
  }

  async loadRoomSnapshot(roomId) {
    const [doc, members, cats, items, requests, history, log] = await Promise.all([
      this.getRoomDoc(roomId),
      this.getCollection(roomId, 'members'),
      this.getCollection(roomId, 'cats'),
      this.getCollection(roomId, 'items'),
      this.getCollection(roomId, 'requests'),
      this.getCollection(roomId, 'history'),
      this.getCollection(roomId, 'log'),
    ]);
    return {
      meta: doc?.meta || null,
      budget: doc?.budget || null,
      members,
      cats,
      items,
      requests,
      history,
      log,
    };
  }
}

export const localStore = new LocalStore();
