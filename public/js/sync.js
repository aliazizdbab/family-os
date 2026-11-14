import { DEFAULT_RTDB_URL, state } from './state.js';
import { initFirebaseAuth, resolveFirebaseConfig } from './auth.js';

const FIREBASE_DB_CDN = 'https://www.gstatic.com/firebasejs/13.1.0/firebase-database.js';

export function getSyncBadgeLabel(syncState = state.syncStatus, online = navigator.onLine) {
  if (!online) {
    return syncState.pendingCount > 0
      ? `🟡 غير متصل (${syncState.pendingCount} تغييرات معلّقة)`
      : '🟡 وضع دون إنترنت';
  }
  if (syncState.state === 'syncing') {
    return '🔄 جارٍ المزامنة...';
  }
  if (syncState.pendingCount > 0) {
    return `🟢 متصل (${syncState.pendingCount} تغييرات معلّقة)`;
  }
  return '🟢 متصل بالإنترنت';
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
      const authInit = await initFirebaseAuth({ useEmulator });
      result.authReady = Boolean(authInit.ok);
    }
  } catch {
    result.authReady = false;
  }

  if (result.rtdbReachable && result.sdkLoaded) {
    result.message = result.authReady
      ? '✅ قاعدة بيانات Firebase وحزمة SDK والمصادقة جاهزة للعمل'
      : '✅ اتصال قاعدة بيانات Firebase وحزمة SDK v13.1.0 يعملان بنجاح (المصادقة المجهولة تُفعّل عند النشر أو إدخال Web API Key)';
  } else if (result.sdkLoaded && !result.rtdbReachable) {
    result.message = '⚠️ حزمة Firebase SDK محمّلة لكن تعذّر الوصول لرابط قاعدة البيانات حالياً';
  } else {
    result.message = '⚠️ تعذّر التحقق من اتصال Firebase (تحقق من الاتصال بالإنترنت)';
  }

  Object.assign(state.firebaseStatus, result);
  return result;
}
