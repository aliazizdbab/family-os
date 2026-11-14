import { DEFAULT_ACCENT, SCHEMA_VERSION, createEmptyRoomState } from './schema.js';
import { DEFAULT_ROOM_ID, DEFAULT_RTDB_URL, refreshLocalSnapshot, state } from './state.js';
import { localStore } from './store-idb.js';
import { importLegacyToIdb, planLegacyImport } from './migrate.js';
import { getSyncBadgeLabel, probeFirebaseConnection } from './sync.js';
import { esc, showConfirmDialog, showToast } from './ui/dialogs.js';
import { renderSampleItemRow } from './ui/list.js';
import { renderFirebaseDiagnosticsCard, renderThemeSettingsCard } from './ui/settings.js';

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

const ROOM_ID = DEFAULT_ROOM_ID;

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
  const box = document.getElementById('intent-banner');
  if (!box) return;

  if (sharedText) {
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
    await refreshLocalSnapshot(ROOM_ID);
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
        <h2>🧱 أساس المرحلة 0</h2>
        <span class="badge-ok">الإصدار v${SCHEMA_VERSION}</span>
      </div>
      <p class="mu">هذه هي البنية التمهيدية القابلة للتثبيت (PWA) والعمل دون إنترنت. لا تمس بيانات النسخة القديمة حتى تأكيد الانتقال في المرحلة 1.</p>
      <div class="chips">
        <span class="chip">🗂️ الأقسام: ${catsCount}</span>
        <span class="chip">🛒 الأغراض المحلية: ${itemsCount}</span>
        <span class="chip">👥 الأعضاء: ${membersCount}</span>
        <span class="chip">💰 الميزانية: ${budget} د.ل</span>
      </div>
    </section>

    <section class="card">
      <div class="ch">
        <span>✅ جاهزية التشغيل المحلي</span>
        <span class="mu">IndexedDB + Service Worker</span>
      </div>
      <div class="list-item"><span>ملف التثبيت والاختصارات (Manifest)</span><span class="badge-ok">مفعّل</span></div>
      <div class="list-item"><span>التخزين المؤقت للعمل دون إنترنت (SW)</span><span class="badge-ok" id="sw-status">جارٍ الفحص…</span></div>
      <div class="list-item"><span>محرك قواعد البيانات المحلي (IndexedDB)</span><span class="badge-ok">متصل</span></div>
      <div class="list-item"><span>ملفات وقواعد Firebase (v13.1.0 + Rules)</span><span class="badge-ok">مجهّزة</span></div>
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
      <p class="mu">اختر ملف النسخة الاحتياطية (<code>family-backup.json</code>) من التطبيق القديم. تُجرى معاينة للأعداد أولاً مع تجاهل رموز PIN ومفاتيح الذكاء الاصطناعي.</p>
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
  return renderThemeSettingsCard(state.prefs, COLORS);
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

  // Apply color swatches via CSSOM (CSP-safe, no inline HTML style attribute)
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

  document.getElementById('dry-run-btn')?.addEventListener('click', () => {
    const ta = document.getElementById('legacy-json');
    state.rawImportText = ta ? ta.value : '';
    runDryRun();
  });

  document.getElementById('apply-import-btn')?.addEventListener('click', async () => {
    if (!state.rawImportText.trim()) return;
    const { plan, applied } = await importLegacyToIdb(localStore, ROOM_ID, state.rawImportText, {
      dryRun: false,
    });
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
    const snap = await localStore.loadRoomSnapshot(ROOM_ID);
    for (const col of ['cats', 'members', 'items', 'log']) {
      for (const id of Object.keys(snap[col] || {})) {
        await localStore.removeEntityHard(ROOM_ID, col, id);
      }
    }
    await localStore.setRoomDoc(ROOM_ID, { meta: null, budget: null });
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
  updateNetworkStatus();
  window.addEventListener('online', updateNetworkStatus);
  window.addEventListener('offline', updateNetworkStatus);

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
  } catch {
    // Keep default theme when storage is restricted
  }

  await refreshSnapshot();
  handleLaunchIntents();
  registerServiceWorker();
  render();
}

init();
