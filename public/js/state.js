import { DEFAULT_ACCENT, createEmptyRoomState } from './schema.js';
import { localStore } from './store-idb.js';

export const DEFAULT_ROOM_ID = 'family-v2-local';
export const DEFAULT_FIREBASE_PROJECT_ID = 'family-requests-9e431';
export const DEFAULT_RTDB_URL = 'https://family-requests-9e431-default-rtdb.firebaseio.com';
export const DEFAULT_FIREBASE_CONFIG = Object.freeze({
  projectId: 'family-requests-9e431',
  appId: '1:405801026869:web:d0018ee630e330773c387c',
  databaseURL: 'https://family-requests-9e431-default-rtdb.firebaseio.com',
  storageBucket: 'family-requests-9e431.firebasestorage.app',
  apiKey: 'AIzaSyDrMLHEOl7GZ7mLle48I1ZypzCF3p6r9ww',
  authDomain: 'family-requests-9e431.firebaseapp.com',
  messagingSenderId: '405801026869',
});

export const state = {
  tab: 'home',
  roomId: DEFAULT_ROOM_ID,
  listFilter: 'todo',
  taskFilter: 'all',
  showDone: false,
  searchQuery: '',
  storeCatFilter: 'all',
  storeSearchQuery: '',
  showAiStoreSuggestions: false,
  loginSelectedMemberId: 'mem_father',
  session: {
    loggedIn: false,
    memberId: 'mem_father',
    isDeveloper: false,
  },
  prefs: {
    accent: DEFAULT_ACCENT,
    dark: false,
    fontSize: 16,
    firebaseApiKey: DEFAULT_FIREBASE_CONFIG.apiKey,
    firebaseAppId: DEFAULT_FIREBASE_CONFIG.appId,
    rtdbUrl: DEFAULT_RTDB_URL,
    useEmulator: false,
    currentRole: 'admin',
    memberName: 'الأب',
    collapsedCats: [],
    aisleOrder: [],
    weeklyTemplate: [],
    customCatalog: [],
    familyRegistry: [DEFAULT_ROOM_ID],
    personalCatOrder: {},
    personalPrefsByMember: {},
  },
  localSnapshot: null,
  lastPlan: null,
  rawImportText: '',
  swRegistration: null,
  deferredInstallPrompt: null,
  firebaseStatus: {
    checked: false,
    rtdbReachable: false,
    sdkLoaded: false,
    authReady: false,
    uid: null,
    mode: 'idle',
    message: 'لم يتم فحص الاتصال بعد',
  },
  syncStatus: {
    state: 'offline',
    pendingCount: 0,
  },
};

const listeners = new Set();

export function subscribeState(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function notifyState() {
  for (const fn of listeners) {
    try {
      fn(state);
    } catch {
      // Ignore listener errors
    }
  }
}

export async function refreshLocalSnapshot(roomId = state.roomId) {
  const snap = await localStore.loadRoomSnapshot(roomId);
  const outbox = await localStore.listOutbox(roomId);
  state.syncStatus.pendingCount = outbox.length;

  const fallback = createEmptyRoomState('عائلتي');
  state.localSnapshot = {
    meta: snap.meta || fallback.meta,
    budget: snap.budget || fallback.budget,
    cats: Object.keys(snap.cats || {}).length > 0 ? snap.cats : fallback.cats,
    members: snap.members || {},
    items: snap.items || {},
    requests: snap.requests || {},
    tasks: snap.tasks || {},
    history: snap.history || {},
    log: snap.log || {},
  };
  return state.localSnapshot;
}
