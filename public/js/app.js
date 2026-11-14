import { DEFAULT_ACCENT, SCHEMA_VERSION, createEmptyRoomState } from './schema.js';
import {
  DEFAULT_ROOM_ID,
  DEFAULT_RTDB_URL,
  refreshLocalSnapshot,
  state,
  subscribeState,
} from './state.js';
import { localStore } from './store-idb.js';
import { importLegacyToIdb, planLegacyImport } from './migrate.js';
import {
  clearLocalPinLock,
  createRoom,
  joinRoomWithInvite,
  parseJoinHash,
  revokeInviteToken,
  rotateInviteToken,
  setLocalPinLock,
} from './auth.js';
import { SyncEngine, getSyncBadgeLabel, probeFirebaseConnection } from './sync.js';
import { esc, showConfirmDialog, showToast } from './ui/dialogs.js';
import { renderSampleItemRow } from './ui/list.js';
import {
  renderFirebaseDiagnosticsCard,
  renderRoomAndAuthCard,
  renderThemeSettingsCard,
} from './ui/settings.js';

export { esc };

const COLORS = [
  '#0f766e',
  '#2563eb',
  '#7c3aed',
  '#db2777',
  '#ea580c',
  '#16a34a',
  '#0891b2',
  '#475569',
];

let activeSyncEngine = null;
let pinLockEnabled = false;

function applyTheme() {
  const root = document.documentElement;
  root.style.setProperty('--ac', state.prefs.accent || DEFAULT_ACCENT);
  root.style.setProperty('--fs', `${state.prefs.fontSize || 16}px`);
  root.dataset.theme = state.prefs.dark ? 'dark' : '';
  const metaTheme = document.querySelector('meta[name="theme-color"]');
  if (metaTheme) metaTheme.content = state.prefs.accent || DEFAULT_ACCENT;
}

function updateNetworkStatus() {
  const pill = document.getElementById('net-pill');
  if (!pill) return;
  pill.textContent = getSyncBadgeLabel(state.syncStatus, navigator.onLine);
}

function handleLaunchIntents() {
  const params = new URLSearchParams(window.location.search);
  const sharedText = params.get('text') || params.get('title') || params.get('url');
  const action = params.get('action');
  const mode = params.get('mode');
  const joinData = parseJoinHash(window.location.hash);
  const box = document.getElementById('intent-banner');
  if (!box) return;

  if (joinData) {
    box.hidden = false;
    box.innerHTML = `
      <div class="stack">
        <strong>🎟️ دعوة انضمام لغرفة: <code>${esc(joinData.roomId)}</code></strong>
        <input id="join-member-name" class="input" placeholder="اكتب اسمك للانضمام" value="عضو جديد" />
        <button type="button" id="accept-join-btn" class="btn">✅ انضمام الآن</button>
      </div>`;
  } else if (sharedText) {
    box.hidden = false;
    box.innerHTML = `
      <div class="stack">
        <strong>📩 نص مُشارك للتطبيق (جاهز للتحليل في المرحلة 2/3)</strong>
        <p class="mu">${esc(sharedText)}</p>
      </div>`;
  } else if (action === 'add') {
    box.hidden = false;
    box.innerHTML = `<p class="mu">⚡ اختصار «إضافة غرض» جاهز ومُفعل في التطبيق المثبّت.</p>`;
  } else if (mode === 'store') {
    box.hidden = false;
    box.innerHTML = `<p class="mu">🛒 اختصار «وضع السوبرماركت» جاهز وسيُربط في المرحلة 2.</p>`;
  } else {
    box.hidden = true;
  }
}

async function refreshSnapshot() {
  try {
    await refreshLocalSnapshot(state.roomId);
  } catch {
    state.localSnapshot = createEmptyRoomState('عائلتي');
    showToast('⚠️ تعذّر الوصول للتخزين المحلي IndexedDB');
  }
}

function renderHomeTab() {
  const snap = state.localSnapshot;
  const catsCount = Object.keys(snap?.cats || {}).length;
  const itemsCount = Object.keys(snap?.items || {}).length;
  const membersCount = Object.keys(snap?.members || {}).length;
  const budget = snap?.budget?.monthly ?? 250;

  return `
    <section class="sec stack">
      <div class="row">
        <h2>🧱 التأسيس والمزامنة (Phase 0 + Phase 1)</h2>
        <span class="badge-ok">الإصدار v${SCHEMA_VERSION}</span>
      </div>
      <p class="mu">تقرأ الواجهة من التخزين المحلي IndexedDB فقط، وتُرسل التعديلات عبر طابور Outbox مع دمج LWW التلقائي دون المساس ببيانات النسخة القديمة.</p>
      <div class="chips">
        <span class="chip">🗂️ الأقسام: ${catsCount}</span>
        <span class="chip">🛒 الأغراض المحلية: ${itemsCount}</span>
        <span class="chip">👥 الأعضاء: ${membersCount}</span>
        <span class="chip">💰 الميزانية: ${budget} د.ل</span>
        <span class="chip">📤 بالانتظار: ${state.syncStatus.pendingCount}</span>
      </div>
    </section>

    ${renderRoomAndAuthCard(state)}

    <section class="card">
      <div class="ch">
        <span>✅ جاهزية التشغيل المحلي والسحابي</span>
        <span class="mu">IndexedDB + Outbox + SW</span>
      </div>
      <div class="list-item"><span>ملف التثبيت والاختصارات (Manifest)</span><span class="badge-ok">مفعّل</span></div>
      <div class="list-item"><span>التخزين المؤقت للعمل دون إنترنت (SW)</span><span class="badge-ok" id="sw-status">جارٍ الفحص…</span></div>
      <div class="list-item"><span>محرك قواعد البيانات المحلي (IndexedDB)</span><span class="badge-ok">متصل</span></div>
      <div class="list-item"><span>قواعد الأمان والمصادقة المجهولة (v2 Rules)</span><span class="badge-ok">مفعّلة</span></div>
    </section>

    ${renderFirebaseDiagnosticsCard(state.firebaseStatus, state.prefs)}
  `;
}

function renderImportTab() {
  const plan = state.lastPlan;
  let planHtml = '';

  if (plan) {
    if (!plan.ok) {
      planHtml = `
        <div class="sec stack">
          <span class="badge-warn">❌ تعذّر تحليل الملف</span>
          ${plan.errors.map((e) => `<p class="mu">• ${esc(e)}</p>`).join('')}
        </div>`;
    } else {
      const c = plan.counts;
      planHtml = `
        <div class="sec stack">
          <div class="row">
            <h3>📊 معاينة تجريبية (Dry-Run)</h3>
            <span class="badge-ok">جاهز للاستيراد</span>
          </div>
          <div class="chips">
            <span class="chip">الأغراض: ${c.items.total} (جديد: ${c.items.add} / متخطّى: ${c.items.skip})</span>
            <span class="chip">متبقي: ${c.items.todo} · منجز: ${c.items.done}</span>
            <span class="chip">الأقسام: ${c.cats.total} (جديد: ${c.cats.add})</span>
            <span class="chip">الأعضاء: ${c.members.total} (جديد: ${c.members.add})</span>
            <span class="chip">السجل: ${c.log.total}</span>
            <span class="chip">الميزانية: ${c.budgetMonthly} د.ل</span>
          </div>
          ${
            plan.warnings.length
              ? `<div class="stack">${plan.warnings.map((w) => `<p class="mu">⚠️ ${esc(w)}</p>`).join('')}</div>`
              : ''
          }
          ${
            plan.preview.sampleItems.length
              ? `<div class="card">
                  <div class="ch"><span>عينة من الأغراض (${plan.preview.sampleItems.length})</span></div>
                  ${plan.preview.sampleItems.map(renderSampleItemRow).join('')}
                </div>`
              : ''
          }
          <button type="button" id="apply-import-btn" class="btn full" ${
            c.items.add + c.cats.add + c.members.add + c.log.add === 0 ? 'disabled' : ''
          }>💾 حفظ النسخة محلياً في IndexedDB</button>
        </div>`;
    }
  }

  return `
    <section class="sec stack">
      <h2>📥 استيراد بيانات التطبيق القديم (تجريبي)</h2>
      <p class="mu">يمكنك جلب بيانات العائلة مباشرة من قاعدة بيانات Firebase القديمة بضغطة واحدة، أو اختيار ملف النسخة الاحتياطية (<code>family-backup.json</code>). تُجرى معاينة للأعداد أولاً مع تجاهل رموز PIN ومفاتيح الذكاء الاصطناعي.</p>
      <button type="button" id="fetch-legacy-rtdb-btn" class="btn full">☁️ جلب بيانات العائلة مباشرة من Firebase القديم</button>
      <input type="file" id="legacy-file" class="input" accept="application/json,.json">
      <textarea id="legacy-json" class="textarea" rows="4" dir="ltr" placeholder="أو الصق محتوى JSON هنا...">${esc(state.rawImportText)}</textarea>
      <div class="g2">
        <button type="button" id="dry-run-btn" class="btn">🔍 معاينة تجريبية (Dry-Run)</button>
        <button type="button" id="clear-local-btn" class="btn g">🧹 تصفير التجربة المحلية</button>
      </div>
    </section>
    ${planHtml}
  `;
}

function renderPrefsTab() {
  return renderThemeSettingsCard(state.prefs, COLORS, pinLockEnabled);
}

function render() {
  applyTheme();
  updateNetworkStatus();
  document.querySelectorAll('.nav button').forEach((btn) => {
    btn.classList.toggle('on', btn.dataset.tab === state.tab);
  });

  const root = document.getElementById('view-root');
  if (!root) return;

  if (state.tab === 'home') root.innerHTML = renderHomeTab();
  else if (state.tab === 'import') root.innerHTML = renderImportTab();
  else root.innerHTML = renderPrefsTab();

  root.querySelectorAll('[data-color]').forEach((btn) => {
    btn.style.background = btn.dataset.color;
  });

  const swEl = document.getElementById('sw-status');
  if (swEl && 'serviceWorker' in navigator) {
    swEl.textContent = navigator.serviceWorker.controller ? 'مفعّل وجاهز دون نت' : 'مُسجّل';
  }
  bindViewEvents();
}

function bindViewEvents() {
  document.getElementById('accept-join-btn')?.addEventListener('click', async () => {
    const joinData = parseJoinHash(window.location.hash);
    if (!joinData) return;
    const memberName = document.getElementById('join-member-name')?.value?.trim() || 'عضو العائلة';
    showToast('⏳ جارٍ الانضمام للغرفة...');
    try {
      const res = await joinRoomWithInvite({
        roomId: joinData.roomId,
        token: joinData.token,
        memberName,
      });
      if (res.ok) {
        state.roomId = res.roomId;
        await localStore.setPref('activeRoomId', res.roomId);
        window.history.replaceState(null, '', window.location.pathname);
        handleLaunchIntents();
        await refreshSnapshot();
        showToast(`✅ تم الانضمام لغرفة ${res.roomId} بنجاح`);
        render();
      } else {
        showToast('❌ تعذّر الانضمام: تحقق من صلاحية رابط الدعوة');
      }
    } catch {
      showToast('❌ رُفض الانضمام أو انتهت صلاحية الدعوة');
    }
  });

  document.getElementById('create-room-btn')?.addEventListener('click', async () => {
    const roomName = document.getElementById('room-name-inp')?.value?.trim() || 'عائلتي';
    const adminName = document.getElementById('admin-name-inp')?.value?.trim() || 'الأب';
    showToast('⏳ جارٍ إنشاء وتفعيل غرفة الجيل الثاني...');
    try {
      const res = await createRoom({
        roomId: state.roomId,
        roomName,
        adminName,
      });
      if (res.ok) {
        state.roomId = res.roomId;
        await refreshSnapshot();
        showToast('✅ تم تفعيل الغرفة وتوليد رابط الدعوة');
        render();
      } else {
        showToast('⚠️ تعذّر التفعيل السحابي، حُفظت الغرفة محلياً');
      }
    } catch {
      showToast('⚠️ حُفظت الغرفة محلياً في IndexedDB (تُزامن عند الاتصال)');
      await refreshSnapshot();
      render();
    }
  });

  document.getElementById('start-sync-btn')?.addEventListener('click', async () => {
    if (activeSyncEngine) activeSyncEngine.stop();
    activeSyncEngine = new SyncEngine({
      roomId: state.roomId,
      store: localStore,
      useEmulator: state.prefs.useEmulator,
      rtdbUrl: state.prefs.rtdbUrl,
    });
    showToast('🔄 جارٍ تشغيل محرك المزامنة الحية...');
    const res = await activeSyncEngine.start();
    await refreshSnapshot();
    showToast(res.ok ? '🟢 محرك المزامنة متصل ويعمل' : '🟡 المزامنة في وضع الاستعداد المحلي');
    render();
  });

  document.getElementById('rotate-invite-btn')?.addEventListener('click', async () => {
    try {
      await rotateInviteToken({ roomId: state.roomId });
    } catch {
      // Saved locally even if offline
    }
    await refreshSnapshot();
    showToast('♻️ تم توليد رابط دعوة جديد');
    render();
  });

  document.getElementById('revoke-invite-btn')?.addEventListener('click', async () => {
    try {
      await revokeInviteToken({ roomId: state.roomId });
    } catch {
      // Saved locally even if offline
    }
    await refreshSnapshot();
    showToast('🚫 تم إلغاء رابط الدعوة');
    render();
  });

  const fileInput = document.getElementById('legacy-file');
  if (fileInput) {
    fileInput.addEventListener('change', async (e) => {
      const file = e.target.files?.[0];
      if (!file) return;
      state.rawImportText = await file.text();
      const ta = document.getElementById('legacy-json');
      if (ta) ta.value = state.rawImportText;
      runDryRun();
    });
  }

  document.getElementById('fetch-legacy-rtdb-btn')?.addEventListener('click', async () => {
    const baseUrl = String(state.prefs.rtdbUrl || DEFAULT_RTDB_URL).replace(/\/+$/, '');
    const targetUrl = `${baseUrl}/rooms/family.json?t=${Date.now()}`;
    showToast('⏳ جارٍ جلب بيانات العائلة من Firebase القديم...');
    try {
      const response = await fetch(targetUrl, { cache: 'no-store' });
      if (!response.ok) {
        showToast(`❌ تعذّر الجلب (HTTP ${response.status})`);
        return;
      }
      const rawData = await response.json();
      if (!rawData || typeof rawData !== 'object') {
        showToast('⚠️ لم يتم العثور على بيانات في المسار /rooms/family');
        return;
      }
      state.rawImportText = JSON.stringify(rawData);
      const ta = document.getElementById('legacy-json');
      if (ta) ta.value = state.rawImportText;
      runDryRun();
      showToast('✅ تم جلب بيانات العائلة وعرض المعاينة التجريبية');
    } catch {
      showToast('⚠️ تعذّر الاتصال بقاعدة البيانات؛ تحقق من الإنترنت');
    }
  });

  document.getElementById('dry-run-btn')?.addEventListener('click', () => {
    const ta = document.getElementById('legacy-json');
    state.rawImportText = ta ? ta.value : '';
    runDryRun();
  });

  document.getElementById('apply-import-btn')?.addEventListener('click', async () => {
    if (!state.rawImportText.trim()) return;
    const { plan, applied } = await importLegacyToIdb(
      localStore,
      state.roomId,
      state.rawImportText,
      {
        dryRun: false,
      }
    );
    if (plan.ok && applied) {
      await refreshSnapshot();
      state.lastPlan = planLegacyImport(state.rawImportText, state.localSnapshot);
      showToast(`✅ تم حفظ ${applied.items} غرض و${applied.cats} قسم محلياً`);
      render();
    }
  });

  document.getElementById('clear-local-btn')?.addEventListener('click', async () => {
    const confirmed = await showConfirmDialog(
      'هل تريد مسح بيانات التجربة المحلية فقط من IndexedDB؟'
    );
    if (!confirmed) return;
    const snap = await localStore.loadRoomSnapshot(state.roomId);
    for (const col of ['cats', 'members', 'items', 'log']) {
      for (const id of Object.keys(snap[col] || {})) {
        await localStore.removeEntityHard(state.roomId, col, id);
      }
    }
    await localStore.setRoomDoc(state.roomId, { meta: null, budget: null });
    state.lastPlan = null;
    await refreshSnapshot();
    showToast('🧹 تم تصفير التجربة المحلية');
    render();
  });

  document.getElementById('probe-firebase-btn')?.addEventListener('click', async () => {
    const urlInput = document.getElementById('fb-rtdb-url');
    if (urlInput && urlInput.value.trim()) {
      state.prefs.rtdbUrl = urlInput.value.trim();
      await localStore.setPref('theme', state.prefs);
    }
    showToast('⏳ جارٍ فحص الاتصال مع Firebase...');
    const res = await probeFirebaseConnection({
      rtdbUrl: state.prefs.rtdbUrl,
      useEmulator: state.prefs.useEmulator,
    });
    showToast(res.message);
    render();
  });

  document.getElementById('toggle-emulator-btn')?.addEventListener('click', async () => {
    state.prefs.useEmulator = !state.prefs.useEmulator;
    await localStore.setPref('theme', state.prefs);
    showToast(
      state.prefs.useEmulator
        ? '🧪 تم التبديل إلى محاكي Firebase المحلي'
        : '☁️ تم التبديل إلى سحابة Firebase'
    );
    render();
  });

  document.querySelectorAll('[data-color]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      state.prefs.accent = btn.dataset.color;
      await localStore.setPref('theme', state.prefs);
      render();
    });
  });

  document.getElementById('toggle-dark')?.addEventListener('click', async () => {
    state.prefs.dark = !state.prefs.dark;
    await localStore.setPref('theme', state.prefs);
    render();
  });

  document.getElementById('font-range')?.addEventListener('input', async (e) => {
    state.prefs.fontSize = Number(e.target.value) || 16;
    await localStore.setPref('theme', state.prefs);
    applyTheme();
  });

  document.getElementById('save-pin-btn')?.addEventListener('click', async () => {
    const pinVal = document.getElementById('local-pin-inp')?.value || '';
    const res = await setLocalPinLock(pinVal, localStore);
    if (!res.ok) {
      showToast(`⚠️ ${res.message}`);
      return;
    }
    pinLockEnabled = true;
    showToast('🔒 تم حفظ قفل الشاشة المحلي (PBKDF2) على هذا الجهاز');
    render();
  });

  document.getElementById('clear-pin-btn')?.addEventListener('click', async () => {
    await clearLocalPinLock(localStore);
    pinLockEnabled = false;
    showToast('🔓 تم إلغاء قفل الشاشة المحلي');
    render();
  });
}

function runDryRun() {
  if (!state.rawImportText.trim()) {
    showToast('أدخل بيانات JSON أو اختر ملف النسخة الاحتياطية');
    return;
  }
  const hasStored =
    Object.keys(state.localSnapshot?.items || {}).length > 0 ||
    Boolean(state.localSnapshot?.meta?.createdAt && state.lastPlan);
  state.lastPlan = planLegacyImport(state.rawImportText, hasStored ? state.localSnapshot : null);
  render();
}

function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;

  navigator.serviceWorker
    .register('/sw.js')
    .then((reg) => {
      state.swRegistration = reg;
      const updateBanner = document.getElementById('sw-update');
      const showUpdate = () => {
        if (updateBanner) updateBanner.hidden = false;
      };

      if (reg.waiting && navigator.serviceWorker.controller) {
        showUpdate();
      }
      reg.addEventListener('updatefound', () => {
        const worker = reg.installing;
        if (!worker) return;
        worker.addEventListener('statechange', () => {
          if (worker.state === 'installed' && navigator.serviceWorker.controller) {
            showUpdate();
          }
        });
      });
    })
    .catch(() => {
      // Service worker unavailable in restricted contexts
    });

  let refreshing = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!refreshing) {
      refreshing = true;
      window.location.reload();
    }
  });

  document.getElementById('sw-reload')?.addEventListener('click', () => {
    const waiting = state.swRegistration?.waiting;
    if (waiting) {
      waiting.postMessage({ type: 'SKIP_WAITING' });
    } else {
      window.location.reload();
    }
  });
}

async function init() {
  state.roomId = DEFAULT_ROOM_ID;
  subscribeState(() => {
    updateNetworkStatus();
  });

  updateNetworkStatus();
  window.addEventListener('online', () => {
    updateNetworkStatus();
    if (activeSyncEngine) {
      void activeSyncEngine.flushOutbox();
    }
  });
  window.addEventListener('offline', updateNetworkStatus);
  window.addEventListener('hashchange', handleLaunchIntents);

  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    state.deferredInstallPrompt = e;
    const banner = document.getElementById('install-banner');
    if (banner) banner.hidden = false;
  });

  document.getElementById('install-btn')?.addEventListener('click', async () => {
    const promptEvent = state.deferredInstallPrompt;
    if (!promptEvent) return;
    promptEvent.prompt();
    await promptEvent.userChoice;
    state.deferredInstallPrompt = null;
    const banner = document.getElementById('install-banner');
    if (banner) banner.hidden = true;
  });

  document.querySelectorAll('.nav button').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.tab = btn.dataset.tab;
      render();
    });
  });

  try {
    const savedTheme = await localStore.getPref('theme', null);
    if (savedTheme && typeof savedTheme === 'object') {
      const safeAccent = /^#[0-9a-f]{6}$/i.test(savedTheme.accent || '')
        ? savedTheme.accent
        : DEFAULT_ACCENT;
      const safeFs = Math.min(20, Math.max(14, Number(savedTheme.fontSize) || 16));
      const safeRtdb =
        typeof savedTheme.rtdbUrl === 'string' && savedTheme.rtdbUrl.startsWith('http')
          ? savedTheme.rtdbUrl
          : DEFAULT_RTDB_URL;
      state.prefs = {
        ...state.prefs,
        accent: safeAccent,
        dark: Boolean(savedTheme.dark),
        fontSize: safeFs,
        rtdbUrl: safeRtdb,
        useEmulator: Boolean(savedTheme.useEmulator),
      };
    }
    const pinRec = await localStore.getPref('pinLock', null);
    pinLockEnabled = Boolean(pinRec?.enabled);
  } catch {
    // Keep default theme when storage is restricted
  }

  await refreshSnapshot();
  handleLaunchIntents();
  registerServiceWorker();
  render();
}

init();
