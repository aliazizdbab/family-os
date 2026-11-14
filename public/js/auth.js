import {
  DEFAULT_FIREBASE_CONFIG,
  DEFAULT_FIREBASE_PROJECT_ID,
  DEFAULT_RTDB_URL,
  state,
} from './state.js';

const FIREBASE_APP_CDN = 'https://www.gstatic.com/firebasejs/13.1.0/firebase-app.js';
const FIREBASE_AUTH_CDN = 'https://www.gstatic.com/firebasejs/13.1.0/firebase-auth.js';

let firebaseAppInstance = null;
let firebaseAuthInstance = null;
let emulatorConnected = false;

export async function resolveFirebaseConfig(overrides = {}) {
  const baseConfig = {
    ...DEFAULT_FIREBASE_CONFIG,
    apiKey: overrides.apiKey || state.prefs.firebaseApiKey || DEFAULT_FIREBASE_CONFIG.apiKey,
    authDomain: `${DEFAULT_FIREBASE_PROJECT_ID}.firebaseapp.com`,
    databaseURL: overrides.databaseURL || state.prefs.rtdbUrl || DEFAULT_RTDB_URL,
    projectId: DEFAULT_FIREBASE_PROJECT_ID,
    appId: overrides.appId || state.prefs.firebaseAppId || DEFAULT_FIREBASE_CONFIG.appId,
  };

  if (typeof fetch === 'function') {
    try {
      const res = await fetch('/__/firebase/init.json', { cache: 'no-store' });
      if (res.ok) {
        const hostedConfig = await res.json();
        if (hostedConfig && hostedConfig.projectId) {
          return {
            ...baseConfig,
            ...hostedConfig,
            databaseURL: hostedConfig.databaseURL || baseConfig.databaseURL,
          };
        }
      }
    } catch {
      // Not running on Firebase Hosting or offline; use fallback config
    }
  }

  return baseConfig;
}

export function generateInviteToken(ttlMs = 7 * 24 * 60 * 60 * 1000, nowMs = Date.now()) {
  const bytes = new Uint8Array(16);
  if (globalThis.crypto?.getRandomValues) {
    globalThis.crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < bytes.length; i += 1) {
      bytes[i] = Math.floor(Math.random() * 256);
    }
  }
  const token = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return {
    token,
    expiresAt: nowMs + ttlMs,
  };
}

export function parseJoinHash(hashString = globalThis.location?.hash || '') {
  const raw = String(hashString || '').replace(/^#/, '');
  if (!raw.startsWith('join=')) return null;
  const value = raw.slice('join='.length).trim();
  const dotIndex = value.indexOf('.');
  if (dotIndex <= 0 || dotIndex >= value.length - 1) return null;
  const roomId = decodeURIComponent(value.slice(0, dotIndex));
  const token = decodeURIComponent(value.slice(dotIndex + 1));
  if (!roomId || !token || token.length < 6) return null;
  return { roomId, token };
}

export async function initFirebaseAuth({ useEmulator = state.prefs.useEmulator } = {}) {
  const config = await resolveFirebaseConfig();
  const appMod = await import(FIREBASE_APP_CDN);
  const authMod = await import(FIREBASE_AUTH_CDN);

  const effectiveConfig = {
    ...config,
    apiKey: config.apiKey || (useEmulator ? 'demo-family-os-emulator-key' : ''),
  };

  if (!effectiveConfig.apiKey) {
    return {
      ok: false,
      sdkLoaded: true,
      reason: 'missing-api-key',
      config: effectiveConfig,
    };
  }

  if (!firebaseAppInstance) {
    const existing = appMod.getApps?.() || [];
    firebaseAppInstance = existing.length ? existing[0] : appMod.initializeApp(effectiveConfig);
  }
  if (!firebaseAuthInstance) {
    firebaseAuthInstance = authMod.getAuth(firebaseAppInstance);
  }

  if (useEmulator && !emulatorConnected) {
    authMod.connectAuthEmulator(firebaseAuthInstance, 'http://127.0.0.1:9099', {
      disableWarnings: true,
    });
    emulatorConnected = true;
  }

  return {
    ok: true,
    sdkLoaded: true,
    app: firebaseAppInstance,
    auth: firebaseAuthInstance,
    authMod,
    config: effectiveConfig,
  };
}

export async function signInAnonymouslyIfConfigured(options = {}) {
  const initialized = await initFirebaseAuth(options);
  if (!initialized.ok) return initialized;
  const { auth, authMod } = initialized;
  if (auth.currentUser) {
    return {
      ok: true,
      uid: auth.currentUser.uid,
      isAnonymous: auth.currentUser.isAnonymous,
    };
  }
  const cred = await authMod.signInAnonymously(auth);
  return {
    ok: true,
    uid: cred.user.uid,
    isAnonymous: cred.user.isAnonymous,
  };
}
