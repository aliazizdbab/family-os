import { DEFAULT_ACCENT, createEmptyRoomState } from './schema.js';
import { localStore } from './store-idb.js';

export const DEFAULT_ROOM_ID = 'family-v2-local';
export const DEFAULT_FIREBASE_PROJECT_ID = 'family-requests-9e431';
export const DEFAULT_RTDB_URL = 'https://family-requests-9e431-default-rtdb.firebaseio.com';

export const state = {
  tab: 'home',
  roomId: DEFAULT_ROOM_ID,
  prefs: {
    accent: DEFAULT_ACCENT,
    dark: false,
    fontSize: 16,
    firebaseApiKey: '',
    firebaseAppId: '',
    rtdbUrl: DEFAULT_RTDB_URL,
    useEmulator: false,
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

  if (!snap.meta && Object.keys(snap.cats).length === 0) {
    state.localSnapshot = createEmptyRoomState('عائلتي');
  } else {
    state.localSnapshot = snap;
  }
  return state.localSnapshot;
}
