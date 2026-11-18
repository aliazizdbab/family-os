import {
  DEFAULT_ACCENT,
  DEFAULT_FAMILY_MEMBERS,
  createBudget,
  createCategory,
  createEmptyRoomState,
  createHistoryEntry,
  createItem,
  createLogEntry,
  createMember,
  createRequest,
  createTask,
} from './schema.js';
import {
  APP_VERSION,
  DEFAULT_ROOM_ID,
  DEFAULT_RTDB_URL,
  refreshLocalSnapshot,
  state,
  subscribeState,
} from './state.js';
import { localStore } from './store-idb.js';
import { importLegacyToIdb, planLegacyImport } from './migrate.js';
import {
  buildInviteUrl,
  clearLocalPinLock,
  createRoom,
  generateInviteToken,
  joinRoomWithInvite,
  parseJoinHash,
  revokeInviteToken,
  rotateInviteToken,
  setLocalPinLock,
} from './auth.js';
import { SyncEngine, getSyncBadgeLabel, probeFirebaseConnection } from './sync.js';
import {
  esc,
  showCategoryDialog,
  showConfirmDialog,
  showEditItemDialog,
  showToast,
  showUndoSnackbar,
} from './ui/dialogs.js';
import {
  buildWhatsAppReport,
  computeBudgetSummary,
  extractHistorySuggestions,
  getActiveItemsList,
  getSortedActiveCategories,
  parseSharedTextCandidates,
  renderSampleItemRow,
  renderShoppingListView,
} from './ui/list.js';
import {
  buildOnboardingEmailContent,
  getEffectiveMembersList,
  getRoleShortLabel,
  renderUnifiedSettingsView,
} from './ui/settings.js';
import {
  loginStaffWithGoogle,
  loginStaffWithEmail,
  finalizeStaffGoogleSignIn,
  loginFamilyMember,
  registerFamilyRequest,
  getActiveAuthUid,
  getFirebaseServices,
  signOutActiveUser,
} from './auth-v3.js';
import { memberNameHash } from './identity.js';
import {
  renderFamilyLoginView,
} from './ui/login-portal.js';
import {
  renderDeveloperLoginView,
  renderAdminDashboard,
  renderModelsTable,
} from './ui/admin-portal.js';
import {
  fetchAdminDashboardData,
  approvePendingFamily,
  updateFamilyStatus,
  deleteFamilyRecord,
  saveFamilyFeatureFlags,
  resetMemberCredentialGeneration,
  saveStaffInvite,
  revokeStaffInvite,
  setStaffDisabled,
  removeStaffMember,
  saveAiConfig,
  clearAiConfig,
  testAiConfig,
  listModelsForConfig,
  testModelForConfig,
  setMemberAccess,
  setMemberPin,
  setMemberRole,
  addFamilyMemberByStaff,
  forceFamilyUpdate,
} from './admin-controller.js';

let cachedAdminData = null;
import { renderFamilyHubSection, SUGGESTED_FAMILY_MEALS } from './ui/hub.js';
import {
  buildMergedStoreCatalog,
  renderStoreModeView,
  sortCategoriesByAisle,
} from './ui/store-mode.js';
import { DEFAULT_FAMILY_REWARDS, renderTasksView } from './ui/tasks.js';
import { DEFAULT_MAINTENANCE_ITEMS, renderMaintenanceView } from './ui/maintenance.js';
import { renderChatView } from './ui/chat.js';
import {
  DAILY_AI_LIMIT,
  callAiProvider,
  getActiveAiProvider,
  getDailyAiUsage,
  incrementDailyAiUsage,
  isAiProviderReady,
} from './ai.js';
import {
  CONFIRM_REQUIRED_AI_ACTIONS,
  buildAiSystemPrompt,
  describePendingAiAction,
  parseAiEnvelope,
  runLocalSmartAssistant,
} from './ai-actions.js';
import { loadEffectiveAiConfig } from './ai-config.js';

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
let pendingSharedText = '';

function applyTheme() {
  const root = document.documentElement;
  root.style.setProperty('--ac', state.prefs.accent || DEFAULT_ACCENT);
  root.style.setProperty('--fs', `${state.prefs.fontSize || 16}px`);
  root.dataset.theme = state.prefs.dark ? 'dark' : '';
  const metaTheme = document.querySelector('meta[name="theme-color"]');
  // The admin portal is a separate app with its own identity colour; never let
  // the family accent (teal) repaint its browser chrome.
  if (metaTheme) {
    metaTheme.content =
      document.body?.dataset?.portal === 'developer'
        ? '#111827'
        : state.prefs.accent || DEFAULT_ACCENT;
  }
}

function updateNetworkStatus() {
  const pill = document.getElementById('net-pill');
  if (!pill) return;
  pill.textContent = getSyncBadgeLabel(state.syncStatus, navigator.onLine);
}

function updateSessionBar() {
  const bar = document.getElementById('session-bar');
  const nav = document.querySelector('.nav');
  const budgetRow = document.getElementById('header-budget-row');
  const headerBar = document.querySelector('.header-bar');
  const loggedIn = Boolean(state.session?.loggedIn);

  if (bar) bar.hidden = !loggedIn;
  if (nav) nav.hidden = !loggedIn;
  if (budgetRow) budgetRow.hidden = !loggedIn;
  if (headerBar) headerBar.hidden = !loggedIn;

  if (!loggedIn) return;
  const famBadge = document.getElementById('session-family-badge');
  const memBadge = document.getElementById('session-member-badge');
  if (famBadge) {
    famBadge.textContent = `🏠 ${state.roomId}`;
  }
  if (memBadge) {
    memBadge.textContent = `${getRoleShortLabel(state.prefs.currentRole)} · ${state.prefs.memberName}`;
  }
}

async function saveSessionState() {
  await localStore.setPref('activeSession', {
    loggedIn: Boolean(state.session.loggedIn),
    roomId: state.roomId,
    memberId: state.session.memberId,
    isDeveloper: Boolean(state.session.isDeveloper),
  });
}

function applyMemberPersonalTheme(memberId) {
  const custom = state.prefs.personalPrefsByMember?.[memberId];
  if (custom && typeof custom === 'object') {
    if (custom.accent) state.prefs.accent = custom.accent;
    if (typeof custom.dark === 'boolean') state.prefs.dark = custom.dark;
    if (custom.fontSize) state.prefs.fontSize = Number(custom.fontSize) || 16;
  }
}

async function saveMemberPersonalTheme(memberId) {
  if (!memberId) return;
  if (!state.prefs.personalPrefsByMember || typeof state.prefs.personalPrefsByMember !== 'object') {
    state.prefs.personalPrefsByMember = {};
  }
  state.prefs.personalPrefsByMember[memberId] = {
    accent: state.prefs.accent,
    dark: Boolean(state.prefs.dark),
    fontSize: Number(state.prefs.fontSize) || 16,
  };
  await localStore.setPref('theme', state.prefs);
}

function detectDeveloperPortalMode() {
  if (document.body?.dataset?.portal === 'developer') return true;
  const path = String(window.location.pathname || '').toLowerCase();
  if (path.endsWith('/developer.html') || path === '/developer' || path === '/dev') {
    return true;
  }
  return new URLSearchParams(window.location.search).get('portal') === 'developer';
}

async function registerFamilyCode(famCode, displayName = '') {
  const clean = String(famCode || '').trim();
  if (!clean) return;
  const existing = Array.isArray(state.prefs.familyRegistry) ? state.prefs.familyRegistry : [];
  let changed = false;
  if (!existing.includes(clean)) {
    state.prefs.familyRegistry = [...existing, clean];
    changed = true;
  }
  const cleanName = String(displayName || '').trim();
  if (cleanName) {
    if (!state.prefs.familyNamesByRoom || typeof state.prefs.familyNamesByRoom !== 'object') {
      state.prefs.familyNamesByRoom = {};
    }
    state.prefs.familyNamesByRoom[clean] = cleanName;
    changed = true;
  }
  if (changed) {
    await localStore.setPref('theme', state.prefs);
  }
}

async function switchFamilyRoom(newRoomId, displayName = '') {
  const clean = String(newRoomId || '').trim() || DEFAULT_ROOM_ID;
  if (activeSyncEngine) {
    activeSyncEngine.stop();
    activeSyncEngine = null;
  }
  state.roomId = clean;
  state.lastPlan = null;
  await registerFamilyCode(clean, displayName);
  await localStore.setPref('activeRoomId', clean);
  await saveSessionState();
  await refreshSnapshot();
}

async function ensureMembersSeeded() {
  const existing = Object.keys(state.localSnapshot?.members || {});
  if (existing.length > 0) return;
  for (const m of DEFAULT_FAMILY_MEMBERS) {
    const rec = createMember(m);
    await persistEntity('members', rec.id, rec);
  }
}

async function recordActivityLog(action, target) {
  const now = Date.now();
  const id = `log_${now}_${Math.random().toString(36).slice(2, 6)}`;
  const entry = createLogEntry({
    id,
    at: now,
    uid: state.session.memberId || state.firebaseStatus.uid || 'local',
    actorName: state.prefs.memberName || 'المستخدم',
    action,
    target,
  });
  if (!state.localSnapshot.log) {
    state.localSnapshot.log = {};
  }
  state.localSnapshot.log[id] = entry;
  await localStore.putEntity(state.roomId, 'log', id, entry);
}

/**
 * Start (or restart) the live SyncEngine for the current room.
 * Called automatically after a successful family login so that data syncs
 * without requiring the user to press the manual "start sync" button (RC2).
 */
async function startSyncForCurrentRoom() {
  if (activeSyncEngine) {
    activeSyncEngine.stop();
    activeSyncEngine = null;
  }
  activeSyncEngine = new SyncEngine({
    roomId: state.roomId,
    store: localStore,
    useEmulator: state.prefs.useEmulator,
    rtdbUrl: state.prefs.rtdbUrl,
  });
  const res = await activeSyncEngine.start();
  await refreshSnapshot();
  return res;
}

function updateHeaderTotals() {
  const snap = state.localSnapshot || {};
  const allItems = getActiveItemsList(snap.items || {});
  const summary = computeBudgetSummary(allItems, snap.budget);

  const totalsEl = document.getElementById('header-totals');
  if (totalsEl) {
    totalsEl.textContent = `المقدر: ${summary.estTotal} د.ل · المدفوع: ${summary.paidTotal} د.ل (${summary.completionPct}%)`;
  }

  const budgetEl = document.getElementById('header-budget-status');
  if (budgetEl) {
    if (summary.status === 'over') {
      budgetEl.textContent = `⚠️ تجاوز الميزانية (${summary.estTotal}/${summary.budgetMonthly} د.ل)`;
    } else if (summary.status === 'near') {
      budgetEl.textContent = `⚡ قارب السقف: متبقي ${summary.remainingBudget} من ${summary.budgetMonthly} د.ل`;
    } else {
      budgetEl.textContent = `الميزانية: ${summary.budgetMonthly} د.ل (متبقي ${summary.remainingBudget} د.ل)`;
    }
  }

  const fillEl = document.getElementById('header-budget-fill');
  if (fillEl) {
    fillEl.style.width = `${summary.budgetPct}%`;
    fillEl.classList.toggle('over', summary.status === 'over');
  }
}

async function persistEntity(collection, id, record) {
  if (activeSyncEngine) {
    await activeSyncEngine.mutateEntity(collection, id, record);
    return;
  }
  if (!state.localSnapshot[collection]) {
    state.localSnapshot[collection] = {};
  }
  state.localSnapshot[collection][id] = record;
  await localStore.putEntity(state.roomId, collection, id, record);
  await localStore.enqueueOutbox({
    roomId: state.roomId,
    collection,
    entityId: id,
    op: 'upsert',
    payload: record,
    updatedAt: record.updatedAt || Date.now(),
  });
}

async function persistRoomDoc(partial) {
  if (activeSyncEngine) {
    await activeSyncEngine.mutateRoomDoc(partial);
    return;
  }
  await localStore.setRoomDoc(state.roomId, partial);
}

function applySearchFilterInDom(queryStr) {
  const q = String(queryStr || '')
    .trim()
    .toLowerCase();
  document.querySelectorAll('[data-item-row]').forEach((row) => {
    const itemName = (row.getAttribute('data-item-name') || '').toLowerCase();
    row.classList.toggle('hidden', Boolean(q && !itemName.includes(q)));
  });
  document.querySelectorAll('[data-cat-card]').forEach((card) => {
    const allRows = card.querySelectorAll('[data-item-row]');
    if (allRows.length === 0) return;
    const anyVisible = Array.from(allRows).some((r) => !r.classList.contains('hidden'));
    card.classList.toggle('hidden', Boolean(q && !anyVisible));
  });
}

function applyStoreSearchFilterInDom(queryStr) {
  const q = String(queryStr || '')
    .trim()
    .toLowerCase();
  document.querySelectorAll('[data-catalog-row]').forEach((row) => {
    const itemName = (row.getAttribute('data-catalog-name') || '').toLowerCase();
    row.classList.toggle('hidden', Boolean(q && !itemName.includes(q)));
  });
  document.querySelectorAll('[data-catalog-sec]').forEach((sec) => {
    const allRows = sec.querySelectorAll('[data-catalog-row]');
    if (allRows.length === 0) return;
    const anyVisible = Array.from(allRows).some((r) => !r.classList.contains('hidden'));
    sec.classList.toggle('hidden', Boolean(q && !anyVisible));
  });
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
    pendingSharedText = sharedText;
    const candidates = parseSharedTextCandidates(sharedText);
    box.hidden = false;
    box.innerHTML = `
      <div class="stack">
        <strong>📩 نص مُشارك للتطبيق (${candidates.length} غرض مقترح)</strong>
        <p class="mu">${esc(sharedText)}</p>
        ${
          candidates.length > 0
            ? `<button type="button" id="confirm-share-add-btn" class="btn">✅ إضافة الأغراض المُشاركة للقائمة (${candidates.length})</button>`
            : ''
        }
      </div>`;
  } else if (action === 'add') {
    box.hidden = false;
    box.innerHTML = `<p class="mu">⚡ اختصار «إضافة غرض» جاهز ومُفعل في التطبيق المثبّت.</p>`;
  } else if (mode === 'store') {
    state.tab = 'store';
    box.hidden = false;
    box.innerHTML = `<p class="mu">🛒 تم فتح «وضع السوبرماركت» مباشرة.</p>`;
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
  return `${renderFamilyHubSection(state)}${renderShoppingListView(state)}`;
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
      <h2>📥 استيراد وتصدير النسخ الاحتياطية</h2>
      <p class="mu">يمكنك جلب بيانات العائلة مباشرة من قاعدة بيانات Firebase القديمة بضغطة واحدة، أو اختيار ملف النسخة الاحتياطية (<code>family-backup.json</code>). تُجرى معاينة للأعداد أولاً مع تجاهل رموز PIN ومفاتيح الذكاء الاصطناعي.</p>
      <button type="button" id="fetch-legacy-rtdb-btn" class="btn full">☁️ جلب بيانات العائلة مباشرة من Firebase القديم</button>
      <button type="button" id="export-v2-backup-btn" class="btn g full">📤 تصدير نسخة احتياطية كاملة للعائلة الحالية (JSON)</button>
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
  return renderUnifiedSettingsView(state, COLORS, pinLockEnabled);
}

function render() {
  applyTheme();
  updateNetworkStatus();
  updateSessionBar();
  updateHeaderTotals();
  document.querySelectorAll('.nav button').forEach((btn) => {
    btn.classList.toggle('on', btn.dataset.tab === state.tab);
  });

  const root = document.getElementById('view-root');
  if (!root) return;

  if (state.isDeveloperPortal && (!state.session.loggedIn || !state.session.isDeveloper)) {
    root.innerHTML = renderDeveloperLoginView(state);
    bindViewEvents();
    return;
  }

  // Developer portal: once authenticated, show the centralized admin dashboard
  // (families management, approvals, RBAC, audit logs) — NOT the regular family UI.
  if (state.isDeveloperPortal && state.session.isDeveloper) {
    if (!cachedAdminData) {
      cachedAdminData = { families: [], staffSession: state.session, activeTab: 'families' };
    }
    root.innerHTML = renderAdminDashboard(cachedAdminData);
    bindAdminDashboardEvents();
    return;
  }

  if (!state.session.loggedIn) {
    root.innerHTML = renderFamilyLoginView(state);
    bindViewEvents();
    return;
  }

  if (state.tab === 'home') root.innerHTML = renderHomeTab();
  else if (state.tab === 'store') root.innerHTML = renderStoreModeView(state);
  else if (state.tab === 'tasks') root.innerHTML = renderTasksView(state);
  else if (state.tab === 'maint') root.innerHTML = renderMaintenanceView(state);
  else if (state.tab === 'ai') root.innerHTML = renderChatView(state);
  else if (state.tab === 'import') root.innerHTML = renderImportTab();
  else root.innerHTML = renderPrefsTab();

  root.querySelectorAll('[data-color]').forEach((btn) => {
    btn.style.background = btn.dataset.color;
  });

  const swEl = document.getElementById('sw-status');
  if (swEl && 'serviceWorker' in navigator) {
    swEl.textContent = navigator.serviceWorker.controller ? 'مفعّل وجاهز دون نت' : 'مُسجّل';
  }

  if (state.tab === 'home' && state.searchQuery) {
    applySearchFilterInDom(state.searchQuery);
  }
  if (state.tab === 'store' && state.storeSearchQuery) {
    applyStoreSearchFilterInDom(state.storeSearchQuery);
  }
  bindViewEvents();
}

async function ensureCatalogEntry({ n, q = '', p = 0, c = 'super', autoLearned = true }) {
  const cleanName = String(n || '').trim();
  if (!cleanName) return false;
  const catId = c || 'super';
  const catalog = buildMergedStoreCatalog(state);
  const exists = catalog.some(
    (entry) =>
      String(entry.c).trim() === catId &&
      String(entry.n).trim().toLowerCase() === cleanName.toLowerCase()
  );
  if (exists) return false;
  const nextList = Array.isArray(state.prefs.customCatalog) ? [...state.prefs.customCatalog] : [];
  nextList.push({
    n: cleanName,
    c: catId,
    q: q || '1',
    p: Number(p) || 0,
    autoLearned: Boolean(autoLearned),
  });
  state.prefs.customCatalog = nextList;
  await localStore.setPref('theme', state.prefs);
  return true;
}

async function addNewShoppingItem({ n, q = '', p = 0, c = 'super', u = false, note = '' }) {
  const cleanName = String(n || '').trim();
  if (!cleanName) return null;
  const now = Date.now();
  const id = `it_${now}_${Math.random().toString(36).slice(2, 7)}`;
  const memberName = state.prefs.memberName || 'الأب';
  const item = createItem({
    id,
    n: cleanName,
    q,
    p: Number(p) || 0,
    c: c || 'super',
    u: Boolean(u),
    note,
    by: state.firebaseStatus.uid || memberName,
    byName: memberName,
    createdAt: now,
    updatedAt: now,
  });
  await persistEntity('items', id, item);
  await ensureCatalogEntry({ n: cleanName, q, p, c: c || 'super', autoLearned: true });
  return item;
}

async function executeAiAction(action, confirmed = false) {
  const name = action?.name;
  const args = action?.args || {};
  const currentRole = state.prefs.currentRole || 'admin';
  const isManager = ['developer', 'admin', 'mother'].includes(currentRole);
  const memberName = state.prefs.memberName || 'الأب';

  if (CONFIRM_REQUIRED_AI_ACTIONS.includes(name) && !confirmed) {
    return { pendingLabel: describePendingAiAction(action, state) };
  }

  if (
    ['set_budget', 'clear_done', 'set_member', 'remove_member', 'delete_category'].includes(name) &&
    !isManager
  ) {
    return { result: '⛔ هذا الأمر يتطلب صلاحية مسؤول' };
  }

  const now = Date.now();
  const snap = state.localSnapshot || {};

  if (name === 'add_items') {
    const rawItems = Array.isArray(args.items) ? args.items.slice(0, 30) : [];
    let added = 0;
    for (const entry of rawItems) {
      const n = String(entry?.n || '').trim();
      if (!n) continue;
      if (currentRole === 'child') {
        const rid = `req_${now}_${Math.random().toString(36).slice(2, 6)}`;
        await persistEntity(
          'requests',
          rid,
          createRequest({
            id: rid,
            by: state.firebaseStatus.uid || memberName,
            n,
            q: String(entry?.q || ''),
            c: String(entry?.c || 'super'),
            status: 'pending',
            updatedAt: now,
          })
        );
      } else {
        await addNewShoppingItem({
          n,
          q: String(entry?.q || ''),
          p: Number(entry?.p) || 0,
          c: String(entry?.c || 'super'),
          u: Boolean(entry?.u),
        });
      }
      added += 1;
    }
    return { result: `أُضيف ${added} غرض` };
  }

  if (name === 'add_request') {
    const n = String(args.n || '').trim();
    if (!n) return { result: '⚠️ اسم الطلب فارغ' };
    const rid = `req_${now}_${Math.random().toString(36).slice(2, 6)}`;
    await persistEntity(
      'requests',
      rid,
      createRequest({
        id: rid,
        by: state.firebaseStatus.uid || memberName,
        n,
        q: String(args.q || ''),
        c: String(args.c || 'super'),
        status: 'pending',
        updatedAt: now,
      })
    );
    return { result: `أُرسل طلب «${n}»` };
  }

  if (name === 'mark_done') {
    const ids = Array.isArray(args.ids) ? args.ids : [];
    const done = args.done !== false;
    let count = 0;
    for (const id of ids) {
      const existing = snap.items?.[id];
      if (!existing || existing.deleted) continue;
      await persistEntity(
        'items',
        id,
        createItem({
          ...existing,
          dn: done,
          dnBy: done ? memberName : '',
          dnAt: done ? now : 0,
          updatedAt: now,
        })
      );
      count += 1;
    }
    return { result: `${done ? 'تم إنجاز' : 'أُعيد فتح'} ${count} غرض` };
  }

  if (name === 'claim') {
    const ids = Array.isArray(args.ids) ? args.ids : [];
    const claim = args.claim !== false;
    let count = 0;
    for (const id of ids) {
      const existing = snap.items?.[id];
      if (!existing || existing.deleted || existing.dn) continue;
      await persistEntity(
        'items',
        id,
        createItem({ ...existing, cl: claim ? memberName : '', updatedAt: now })
      );
      count += 1;
    }
    return { result: `${claim ? 'حُجز' : 'أُلغي حجز'} ${count} غرض` };
  }

  if (name === 'update_item') {
    const existing = snap.items?.[args.id];
    if (!existing) return { result: '⚠️ لم أجد الغرض' };
    await persistEntity(
      'items',
      args.id,
      createItem({
        ...existing,
        n: args.n ? String(args.n) : existing.n,
        q: args.q !== undefined ? String(args.q) : existing.q,
        p: args.p !== undefined ? Math.max(0, Number(args.p) || 0) : existing.p,
        c: args.c ? String(args.c) : existing.c,
        u: args.u !== undefined ? Boolean(args.u) : existing.u,
        updatedAt: now,
      })
    );
    return { result: `تم تحديث «${args.n || existing.n}»` };
  }

  if (name === 'delete_items') {
    const ids = Array.isArray(args.ids) ? args.ids : [];
    let count = 0;
    for (const id of ids) {
      const existing = snap.items?.[id];
      if (!existing || existing.deleted) continue;
      if (!isManager && existing.byName !== memberName) continue;
      await persistEntity('items', id, createItem({ ...existing, deleted: true, updatedAt: now }));
      await recordActivityLog('حذف 🤖', existing.n);
      count += 1;
    }
    return { result: `حُذف ${count} غرض` };
  }

  if (name === 'clear_done') {
    let count = 0;
    for (const [id, existing] of Object.entries(snap.items || {})) {
      if (existing && !existing.deleted && existing.dn) {
        await persistEntity(
          'items',
          id,
          createItem({ ...existing, deleted: true, updatedAt: now })
        );
        count += 1;
      }
    }
    return { result: `مُسح ${count} غرض منجز` };
  }

  if (name === 'set_budget') {
    const monthly = Math.max(0, Number(args.value) || 0);
    const nextBudget = createBudget({ monthly, perCat: snap.budget?.perCat || {} });
    state.localSnapshot.budget = nextBudget;
    await persistRoomDoc({ budget: nextBudget });
    return { result: `تم ضبط الميزانية على ${monthly} د.ل` };
  }

  if (name === 'add_task') {
    const title = String(args.title || '').trim();
    if (!title) return { result: '⚠️ عنوان المهمة فارغ' };
    const tid = `tsk_${now}_${Math.random().toString(36).slice(2, 6)}`;
    await persistEntity(
      'tasks',
      tid,
      createTask({
        id: tid,
        title,
        assigneeId: String(args.assigneeId || 'all'),
        assigneeName: String(args.assigneeName || 'الجميع'),
        recurrence: String(args.recurrence || 'daily'),
        points: Math.max(0, Number(args.points) || 15),
        createdBy: memberName,
        updatedAt: now,
      })
    );
    await recordActivityLog('مهمة 🤖', title);
    return { result: `أُضيفت مهمة «${title}»` };
  }

  if (name === 'complete_task') {
    const existing = snap.tasks?.[args.id];
    if (!existing) return { result: '⚠️ لم أجد المهمة' };
    await persistEntity(
      'tasks',
      args.id,
      createTask({ ...existing, done: true, doneBy: memberName, doneAt: now, updatedAt: now })
    );
    return { result: `أُنجزت مهمة «${existing.title}»` };
  }

  if (name === 'add_category') {
    const catName = String(args.n || '').trim();
    if (!catName) return { result: '⚠️ اسم القسم فارغ' };
    const cid = `cat_${now}`;
    const order = getSortedActiveCategories(snap.cats).length;
    await persistEntity(
      'cats',
      cid,
      createCategory({ id: cid, n: catName, i: String(args.i || '📁'), order, updatedAt: now })
    );
    return { result: `أُضيف قسم «${catName}»` };
  }

  if (name === 'rename_category') {
    const existing = snap.cats?.[args.id];
    if (!existing) return { result: '⚠️ لم أجد القسم' };
    await persistEntity(
      'cats',
      args.id,
      createCategory({ ...existing, n: String(args.n || existing.n), updatedAt: now })
    );
    return { result: `تمت إعادة تسمية القسم` };
  }

  if (name === 'delete_category') {
    const existing = snap.cats?.[args.id];
    if (!existing) return { result: '⚠️ لم أجد القسم' };
    await persistEntity(
      'cats',
      args.id,
      createCategory({ ...existing, deleted: true, updatedAt: now })
    );
    return { result: `حُذف قسم «${existing.n}»` };
  }

  if (name === 'navigate') {
    if (['home', 'store', 'tasks', 'maint', 'ai', 'import', 'prefs'].includes(args.tab)) {
      state.tab = args.tab;
    }
    return { result: 'تم الانتقال' };
  }

  if (name === 'set_theme') {
    if (/^#[0-9a-f]{6}$/i.test(args.color || '')) state.prefs.accent = args.color;
    if (args.dark !== undefined) state.prefs.dark = Boolean(args.dark);
    if (Number(args.fontSize) >= 14 && Number(args.fontSize) <= 20) {
      state.prefs.fontSize = Number(args.fontSize);
    }
    await saveMemberPersonalTheme(state.session?.memberId);
    return { result: 'تم تحديث المظهر' };
  }

  return { result: `أمر غير مدعوم: ${String(name || '')}` };
}

async function handleSendAiMessage(rawInput) {
  const text = String(rawInput || '').trim();
  if (!text || state.aiBusy) return;

  const uid = state.session?.memberId || 'local';
  const quota = await incrementDailyAiUsage(uid, localStore, DAILY_AI_LIMIT);
  state.aiUsageCount = quota.used;
  if (!quota.ok) {
    state.chatMessages.push({
      role: 'bot',
      text: `⚠️ وصلت إلى الحد اليومي (${DAILY_AI_LIMIT} طلب في اليوم) لهذا الجهاز.`,
      results: [],
      pending: [],
    });
    render();
    return;
  }

  state.chatMessages.push({ role: 'user', text });
  state.aiBusy = true;
  render();

  try {
    const activeProv = getActiveAiProvider();
    let envelope;
    if (isAiProviderReady(activeProv)) {
      const history = state.chatMessages
        .slice(-10)
        .filter((m) => m.role === 'user' || m.raw)
        .map((m) => ({
          role: m.role === 'user' ? 'user' : 'assistant',
          content: m.role === 'user' ? m.text : m.raw,
        }));
      const rawReply = await callAiProvider(activeProv, buildAiSystemPrompt(state), history);
      envelope = parseAiEnvelope(rawReply);
      envelope.raw = rawReply;
    } else {
      envelope = runLocalSmartAssistant(text, state, buildMergedStoreCatalog(state));
    }

    const results = [];
    const pending = [];
    for (const act of (envelope.actions || []).slice(0, 20)) {
      const outcome = await executeAiAction(act, false);
      if (outcome.pendingLabel) {
        pending.push({
          action: act,
          label: outcome.pendingLabel,
          resolved: false,
          approved: false,
        });
      } else if (outcome.result) {
        results.push(outcome.result);
      }
    }

    await refreshSnapshot();
    state.chatMessages.push({
      role: 'bot',
      text: envelope.reply || 'تم تنفيذ طلبك.',
      raw: envelope.raw || '',
      results,
      pending,
    });
  } catch (err) {
    state.chatMessages.push({
      role: 'bot',
      text: `❌ تعذّر الاتصال بالمزود السحابي: ${err?.message || 'خطأ غير معروف'}`,
      results: [],
      pending: [],
    });
  } finally {
    state.aiBusy = false;
    state.chatMessages = state.chatMessages.slice(-40);
    render();
  }
}

function bindAiEvents() {
  document.querySelectorAll('[data-ai-prompt]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const prompt = btn.getAttribute('data-ai-prompt') || '';
      void handleSendAiMessage(prompt);
    });
  });

  document.getElementById('ai-send-btn')?.addEventListener('click', () => {
    const inp = document.getElementById('ai-chat-inp');
    const val = inp?.value || '';
    if (inp) inp.value = '';
    void handleSendAiMessage(val);
  });

  document.getElementById('ai-chat-inp')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      const val = e.target.value || '';
      e.target.value = '';
      void handleSendAiMessage(val);
    }
  });

  document.getElementById('ai-clear-chat-btn')?.addEventListener('click', () => {
    state.chatMessages = [];
    render();
  });

  document.getElementById('ai-voice-btn')?.addEventListener('click', () => {
    const SpeechRec = globalThis.SpeechRecognition || globalThis.webkitSpeechRecognition;
    if (!SpeechRec) {
      showToast('⚠️ المتصفح لا يدعم الإملاء الصوتي المباشر؛ يمكنك استخدام لوحة المفاتيح');
      return;
    }
    try {
      const rec = new SpeechRec();
      rec.lang = 'ar-SA';
      rec.interimResults = false;
      rec.maxAlternatives = 1;
      showToast('🎙️ تكلّم الآن...');
      rec.onresult = (evt) => {
        const transcript = evt?.results?.[0]?.[0]?.transcript || '';
        const inp = document.getElementById('ai-chat-inp');
        if (inp) inp.value = transcript;
        if (transcript.trim()) {
          void handleSendAiMessage(transcript);
        }
      };
      rec.onerror = () => {
        showToast('⚠️ تعذّر التقاط الصوت، حاول مرة أخرى');
      };
      rec.start();
    } catch {
      showToast('⚠️ تعذّر تشغيل الميكروفون');
    }
  });

  document.querySelectorAll('[data-ai-confirm]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const [mIdx, pIdx] = (btn.getAttribute('data-ai-confirm') || '').split(':').map(Number);
      const entry = state.chatMessages?.[mIdx]?.pending?.[pIdx];
      if (!entry || entry.resolved) return;
      entry.resolved = true;
      entry.approved = true;
      const out = await executeAiAction(entry.action, true);
      if (out.result) {
        state.chatMessages[mIdx].results.push(out.result);
      }
      await refreshSnapshot();
      render();
    });
  });

  document.querySelectorAll('[data-ai-cancel]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const [mIdx, pIdx] = (btn.getAttribute('data-ai-cancel') || '').split(':').map(Number);
      const entry = state.chatMessages?.[mIdx]?.pending?.[pIdx];
      if (!entry || entry.resolved) return;
      entry.resolved = true;
      entry.approved = false;
      render();
    });
  });

}

/** A family member disabled by the platform must lose an already-restored session. */
async function verifySessionStillAllowed(session) {
  const fid = session?.fid;
  const memberName = session?.memberName;
  if (!fid || !memberName) return true;
  try {
    const { db, dbMod } = await getFirebaseServices();
    const memHash = await memberNameHash(memberName);
    const snap = await dbMod.get(dbMod.ref(db, `v3/loginIndex/${fid}/${memHash}/off`));
    if (snap.exists() && snap.val() === true) {
      showToast('⛔ تم إيقاف وصولك إلى هذه العائلة — تواصل مع إدارة المنصة');
      return false;
    }
  } catch {
    // Offline: keep the local session so the app still works without a network.
  }
  return true;
}

/**
 * Small promise-based input dialog (replaces window.prompt, which is blocked in
 * installed PWAs and disallowed by lint).
 */
function askForPin(message) {
  return new Promise((resolve) => {
    const root = document.getElementById('dialog-root');
    if (!root) {
      resolve(null);
      return;
    }
    const ov = document.createElement('div');
    ov.className = 'dialog-ov';
    ov.innerHTML = `
      <div class="dialog-box stack" role="dialog" aria-modal="true">
        <p>${message}</p>
        <input id="dlg-pin-input" class="input" dir="ltr" inputmode="numeric" maxlength="32" />
        <div class="row">
          <button type="button" class="btn g" data-dlg="no">إلغاء</button>
          <button type="button" class="btn" data-dlg="yes">حفظ</button>
        </div>
      </div>`;
    const input = ov.querySelector('#dlg-pin-input');
    const close = (value) => {
      ov.remove();
      resolve(value);
    };
    ov.querySelector('[data-dlg="no"]').addEventListener('click', () => close(null));
    ov.querySelector('[data-dlg="yes"]').addEventListener('click', () => {
      const val = input.value.trim();
      close(val || null);
    });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') close(input.value.trim() || null);
    });
    root.appendChild(ov);
    input.focus();
  });
}

/**
 * Owner-triggered forced update: the dev portal stamps meta.forceUpdateAt; the
 * family app clears its Service Worker cache and reloads once when it sees a
 * newer stamp.
 */
async function checkForcedUpdate(fid) {
  if (!fid) return;
  try {
    const { db, dbMod } = await getFirebaseServices();
    const snap = await dbMod.get(dbMod.ref(db, `v3/forceUpdate/${fid}`));
    const stamp = snap.exists() ? Number(snap.val()) || 0 : 0;
    if (!stamp) return;
    const KEY = 'familyos.forcedUpdate';
    const seen = Number(globalThis.localStorage?.getItem(KEY) || 0);
    if (stamp <= seen) return;
    globalThis.localStorage?.setItem(KEY, String(stamp));
    showToast('🔄 تحديث إجباري من إدارة المنصة — جارٍ إعادة التحميل...');
    try {
      if ('serviceWorker' in navigator) {
        const regs = await navigator.serviceWorker.getRegistrations();
        await Promise.all(regs.map((r) => r.unregister()));
      }
      if (globalThis.caches) {
        const keys = await caches.keys();
        await Promise.all(keys.map((k) => caches.delete(k)));
      }
    } catch {
      // continue to reload anyway
    }
    setTimeout(() => window.location.reload(), 800);
  } catch {
    // ignore (offline / permission)
  }
}

function bindViewEvents() {
  // --- v3 Commercial Family Portal Events ---
  const famForm = document.getElementById('family-login-form');
  const handleFamilyLogin = async () => {
    try {
      const rawFam = (
        document.getElementById('login-family-code')?.value ||
        document.getElementById('fam-login-family-name')?.value ||
        state.roomId ||
        'family-v2-local'
      ).trim();
      const usernameInput = (
        document.getElementById('login-username-inp')?.value ||
        document.getElementById('fam-login-member-name')?.value ||
        ''
      ).trim();
      const enteredPin = (
        document.getElementById('login-pin-inp')?.value ||
        document.getElementById('fam-login-password')?.value ||
        ''
      ).trim();

      if (!rawFam) {
        showToast('⚠️ أدخل اسم أو كود العائلة أولاً');
        return;
      }
      if (!usernameInput) {
        showToast('⚠️ أدخل اسم الفرد في العائلة أولاً');
        return;
      }
      if (!enteredPin) {
        showToast('⚠️ أدخل كلمة المرور أولاً');
        return;
      }

      // Authenticate through Firebase (v3 family index + synthetic Auth email).
      // loginFamilyMember falls back to a local offline session itself when the
      // network/auth is unavailable, so this single call covers both online and
      // offline-first operation.
      const res = await loginFamilyMember({
        familyName: rawFam,
        memberName: usernameInput,
        password: enteredPin,
      });
      if (!res.ok) {
        showToast(`❌ ${res.message || 'تعذّر تسجيل الدخول'}`);
        return;
      }

      // Derive the room from the authenticated family id, never from free text.
      const authenticatedRoomId = res.session.fid;
      if (activeSyncEngine) {
        activeSyncEngine.stop();
        activeSyncEngine = null;
      }
      state.roomId = authenticatedRoomId;
      state.session = {
        loggedIn: true,
        fid: authenticatedRoomId,
        memberId: res.session.memberId,
        memberName: res.session.memberName,
        role: res.session.role,
        uid: res.session.uid,
        isDeveloper: false,
      };
      state.prefs.currentRole = res.session.role || 'admin';
      state.prefs.memberName = res.session.memberName;
      await localStore.setPref('theme', state.prefs);
      await saveSessionState();
      await registerFamilyCode(authenticatedRoomId, res.session.familyName || rawFam);
      await refreshSnapshot();
      // Families no longer configure AI keys themselves; load the platform's
      // global/per-family configuration (owner-managed in the dev portal).
      try {
        await loadEffectiveAiConfig(authenticatedRoomId);
      } catch {
        // AI stays in local mode if config is unavailable
      }
      void checkForcedUpdate(authenticatedRoomId);
      // Sync is best-effort: a rules/network failure must NOT block entering the
      // app. Enter the family space and surface a warning instead of doing nothing.
      try {
        await startSyncForCurrentRoom();
      } catch (syncErr) {
        console.warn('Sync start failed:', syncErr);
        showToast('⚠️ تم الدخول، لكن المزامنة السحابية غير متاحة الآن');
      }
      try {
        await recordActivityLog('تسجيل دخول', res.session.memberName);
      } catch {
        // activity log is non-critical
      }
      state.tab = 'home';
      showToast(`🔓 أهلاً بك ${res.session.memberName}`);
      render();
    } catch (err) {
      console.error('Login error:', err);
      showToast(`❌ خطأ غير متوقع أثناء الدخول: ${err?.message || err}`);
      render();
    }
  };

  famForm?.addEventListener('submit', (e) => {
    e.preventDefault();
    void handleFamilyLogin();
  });
  document.getElementById('login-submit-btn')?.addEventListener('click', (e) => {
    e.preventDefault();
    void handleFamilyLogin();
  });
  document.getElementById('fam-login-submit-btn')?.addEventListener('click', (e) => {
    e.preventDefault();
    void handleFamilyLogin();
  });

  document.querySelectorAll('[data-login-member]').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.loginSelectedMemberId = btn.getAttribute('data-login-member') || 'mem_father';
      render();
    });
  });

  document.getElementById('toggle-pwd-visibility-btn')?.addEventListener('click', () => {
    const inp =
      document.getElementById('login-pin-inp') || document.getElementById('fam-login-password');
    if (inp) {
      inp.type = inp.type === 'password' ? 'text' : 'password';
    }
  });

  // Switch to Registration View
  document.getElementById('toggle-register-family-btn')?.addEventListener('click', () => {
    state.loginMode = 'register';
    render();
  });
  document.getElementById('back-to-login-btn')?.addEventListener('click', () => {
    state.loginMode = 'login';
    render();
  });

  // Register Family Form Submission
  document.getElementById('register-family-submit-btn')?.addEventListener('click', async (e) => {
    e.preventDefault();
    const familyName = document.getElementById('reg-family-name')?.value?.trim() || '';
    const rawCode = document.getElementById('reg-family-code')?.value?.trim() || '';
    const adminName = document.getElementById('reg-admin-name')?.value?.trim() || '';
    const adminPin = document.getElementById('reg-admin-pin')?.value?.trim() || '';
    const email = document.getElementById('reg-family-email')?.value?.trim() || '';
    const regErr = document.getElementById('reg-error-box');

    if (!familyName) {
      if (regErr) {
        regErr.textContent = 'أدخل اسم العائلة أولاً';
        regErr.hidden = false;
      }
      showToast('⚠️ أدخل اسم العائلة أولاً');
      return;
    }
    if (!adminName) {
      if (regErr) {
        regErr.textContent = 'أدخل اسم المستخدم المؤسس';
        regErr.hidden = false;
      }
      showToast('⚠️ أدخل اسم المستخدم المؤسس');
      return;
    }
    if (!email || !email.includes('@')) {
      if (regErr) {
        regErr.textContent = 'أدخل بريداً إلكترونياً صحيحاً';
        regErr.hidden = false;
      }
      showToast('⚠️ أدخل بريداً إلكترونياً صحيحاً');
      return;
    }

    const roomId = rawCode || `family-${Math.random().toString(36).slice(2, 8)}`;
    const verificationCode = String(Math.floor(100000 + Math.random() * 900000));
    const now = Date.now();
    const invite = generateInviteToken(7 * 24 * 60 * 60 * 1000, now);
    const inviteUrl = buildInviteUrl(roomId, invite.token);
    const emailContent = buildOnboardingEmailContent({
      familyName,
      roomId,
      adminName,
      adminPin,
      email,
      verificationCode,
      inviteUrl,
    });

    state.pendingVerification = {
      roomId,
      familyName,
      adminName,
      adminPin,
      email,
      verificationCode,
      inviteUrl,
      emailSubject: emailContent.subject,
      emailBody: emailContent.body,
    };
    state.loginMode = 'verify';
    showToast(`📧 تم إرسال رمز التأكيد والدليل إلى ${email}`);
    render();
  });

  // Confirm Registration Email Code
  document.getElementById('confirm-email-code-btn')?.addEventListener('click', async () => {
    const pending = state.pendingVerification;
    if (!pending) return;
    const entered = document.getElementById('verify-email-code-inp')?.value?.trim() || '';
    if (!entered || entered !== pending.verificationCode) {
      showToast('❌ رمز التأكيد غير صحيح');
      return;
    }

    // 1) REAL cloud registration (creates the Firebase Auth user + v3 records).
    // Without this the family exists only in this device's IndexedDB and will
    // never sync to other phones. Errors are surfaced instead of swallowed.
    showToast('⏳ جارٍ إنشاء حساب العائلة في السحابة...');
    const regRes = await registerFamilyRequest({
      familyName: pending.familyName,
      ownerName: pending.adminName,
      email: pending.email,
      phone: '',
      password: pending.adminPin,
    });
    if (!regRes.ok) {
      showToast(`❌ ${regRes.message}`);
      state.loginMode = 'verify';
      render();
      return;
    }

    const realFid = regRes.fid || pending.roomId;

    await switchFamilyRoom(realFid, pending.familyName);

    // Persist founder member with their custom chosen name & PIN
    const founderMember = {
      id: 'mem_father',
      name: pending.adminName || 'مدير العائلة',
      icon: '👑',
      role: 'admin',
      accessCode: pending.adminPin || '1234',
      email: pending.email || '',
    };
    await persistEntity('members', founderMember.id, createMember(founderMember));
    if (state.localSnapshot) {
      if (!state.localSnapshot.members) state.localSnapshot.members = {};
      state.localSnapshot.members[founderMember.id] = createMember(founderMember);
      if (!state.localSnapshot.meta) state.localSnapshot.meta = {};
      state.localSnapshot.meta.name = pending.familyName;
      state.localSnapshot.meta.email = pending.email;
      state.localSnapshot.meta.emailVerified = true;
      await persistEntity('meta', 'room', state.localSnapshot.meta);
    }

    state.session = {
      loggedIn: true,
      memberId: 'mem_father',
      isDeveloper: false,
    };
    state.prefs.currentRole = 'admin';
    state.prefs.memberName = pending.adminName;
    state.loginMode = 'login';

    const regFam = {
      hash: realFid,
      fid: realFid,
      name: pending.familyName,
      ownerEmail: pending.email,
      ownerName: pending.adminName,
      status: 'pending',
      features: { store: true, tasks: true, maint: true, ai: true, import: true },
      createdAt: Date.now(),
    };
    const regList = (await localStore.getPref('familyDirectory', [])) || [];
    if (!regList.some((f) => f.fid === regFam.fid)) {
      regList.push(regFam);
      await localStore.setPref('familyDirectory', regList);
    }

    state.pendingVerification = null;
    await registerFamilyCode(realFid, pending.familyName);
    await saveSessionState();
    state.tab = 'home';
    showToast(
      `✅ تم تسجيل «${pending.familyName}» في السحابة. الحساب بانتظار اعتماد الإدارة من بوابة المبرمج.`
    );
    render();
  });

  // --- v3 Staff & Developer Portal Events ---
  document.getElementById('login-dev-btn')?.addEventListener('click', async () => {
    const devUser = document.getElementById('login-dev-user')?.value?.trim() || '';
    const devPin = document.getElementById('login-dev-pin')?.value || '';
    const errBox = document.getElementById('admin-login-error');
    if (errBox) errBox.hidden = true;

    // The developer portal requires a REAL Firebase Auth session (owner or staff)
    // so that database rules (v3/staff or owner email) authorize reads/writes.
    // A local-only session would silently fail every family/approval action.
    const res = await loginStaffWithEmail(devUser, devPin);
    if (!res.ok) {
      if (errBox) {
        errBox.textContent = res.message;
        errBox.hidden = false;
      } else {
        showToast(`❌ ${res.message}`);
      }
      return;
    }
    state.session = res.session;
    showToast(`👨‍💻 تم الدخول إلى بوابة المبرمج الشاملة`);
    try {
      cachedAdminData = await fetchAdminDashboardData();
    } catch {
      // offline or emulator fallback
    }
    state.tab = 'prefs';
    render();
  });


  document.getElementById('admin-google-login-btn')?.addEventListener('click', async () => {
    const res = await loginStaffWithGoogle();
    // redirect mode navigates away — nothing more to do until the page reloads
    if (res && res.redirect) {
      showToast('🌐 جارٍ تحويلك إلى Google لإكمال الدخول...');
      return;
    }
    if (!res || !res.ok) {
      const errBox = document.getElementById('admin-login-error');
      const msg = res?.message || 'تعذّر تسجيل الدخول.';
      if (errBox) {
        errBox.textContent = msg;
        errBox.hidden = false;
      } else {
        showToast(`❌ ${msg}`);
      }
      return;
    }
    state.session = res.session;
    showToast(`🛡️ أهلاً بك يا ${res.session.staffName} في لوحة التحكم`);
    cachedAdminData = await fetchAdminDashboardData();
    render();
  });

  const adminEmailForm = document.getElementById('admin-email-login-form');
  const handleAdminEmailLogin = async () => {
    const email = document.getElementById('admin-email-input')?.value?.trim() || '';
    const pwd = document.getElementById('admin-pwd-input')?.value || '';
    const errBox = document.getElementById('admin-login-error');
    if (errBox) errBox.hidden = true;

    const res = await loginStaffWithEmail(email, pwd);
    if (!res.ok) {
      if (errBox) {
        errBox.textContent = res.message;
        errBox.hidden = false;
      } else {
        showToast(`❌ ${res.message}`);
      }
      return;
    }
    state.session = res.session;
    showToast(`🛡️ تم تسجيل الدخول بنجاح`);
    cachedAdminData = await fetchAdminDashboardData();
    render();
  };

  adminEmailForm?.addEventListener('submit', (e) => {
    e.preventDefault();
    void handleAdminEmailLogin();
  });
  document.getElementById('admin-email-submit-btn')?.addEventListener('click', (e) => {
    e.preventDefault();
    void handleAdminEmailLogin();
  });

  document.getElementById('toggle-admin-pwd-btn')?.addEventListener('click', () => {
    const inp = document.getElementById('admin-pwd-input');
    if (inp) inp.type = inp.type === 'password' ? 'text' : 'password';
  });

  // Admin Dashboard Actions
  document.querySelectorAll('[data-admin-tab]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      state.adminActiveTab = btn.getAttribute('data-admin-tab') || 'families';
      cachedAdminData = await fetchAdminDashboardData(cachedAdminData?.selectedFid);
      render();
    });
  });

  document.getElementById('admin-logout-btn')?.addEventListener('click', async () => {
    await signOutActiveUser();
    state.session = { loggedIn: false };
    cachedAdminData = null;
    showToast('🚪 تم تسجيل الخروج من لوحة الإدارة');
    render();
  });

  document.querySelectorAll('[data-action="approve-family"]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const fid = btn.getAttribute('data-fid');
      const name = btn.getAttribute('data-name');
      await approvePendingFamily(fid, name);
      showToast(`✅ تم اعتماد وتفعيل عائلة «${name}» بنجاح!`);
      cachedAdminData = await fetchAdminDashboardData();
      render();
    });
  });

  document.querySelectorAll('[data-action="suspend-family"]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const fid = btn.getAttribute('data-fid');
      const fam = cachedAdminData?.families?.find((f) => f.fid === fid);
      await updateFamilyStatus(fid, fam?.name || fid, 'suspended');
      showToast(`⏸️ تم إيقاف عائلة «${fam?.name || fid}» مؤقتاً`);
      cachedAdminData = await fetchAdminDashboardData();
      render();
    });
  });

  document.querySelectorAll('[data-action="activate-family"]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const fid = btn.getAttribute('data-fid');
      const fam = cachedAdminData?.families?.find((f) => f.fid === fid);
      await updateFamilyStatus(fid, fam?.name || fid, 'active');
      showToast(`▶️ تم تنشيط عائلة «${fam?.name || fid}»`);
      cachedAdminData = await fetchAdminDashboardData();
      render();
    });
  });

  document.querySelectorAll('[data-action="delete-family"]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const fid = btn.getAttribute('data-fid');
      const name = btn.getAttribute('data-name');
      // showConfirmDialog returns a Promise<boolean> — it does NOT take a callback.
      const confirmed = await showConfirmDialog(
        `هل أنت متأكد من حذف عائلة «${name}» نهائياً من قاعدة البيانات؟`,
        { confirmText: '🗑️ حذف نهائي', cancelText: 'إلغاء' }
      );
      if (!confirmed) return;
      await deleteFamilyRecord(fid, name);
      showToast(`🗑️ تم حذف عائلة «${name}»`);
      cachedAdminData = await fetchAdminDashboardData();
      render();
    });
  });

  document.getElementById('admin-users-fam-select')?.addEventListener('change', async (e) => {
    cachedAdminData = await fetchAdminDashboardData(e.target.value);
    render();
  });

  document.getElementById('admin-features-fam-select')?.addEventListener('change', async (e) => {
    cachedAdminData = await fetchAdminDashboardData(e.target.value);
    render();
  });

  document.querySelectorAll('[data-action="reset-member-cred"]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const fid = btn.getAttribute('data-fid');
      const name = btn.getAttribute('data-name');
      const res = await resetMemberCredentialGeneration(fid, name);
      showToast(`🔄 تم تصفير اعتماد «${name}» بنجاح (الجيل ${res.nextGen})`);
      cachedAdminData = await fetchAdminDashboardData(fid);
      render();
    });
  });

  document.getElementById('admin-save-features-btn')?.addEventListener('click', async () => {
    const fid = cachedAdminData?.selectedFid;
    if (!fid) return;
    const fam = cachedAdminData?.families?.find((f) => f.fid === fid);
    const toggles = {};
    document.querySelectorAll('[data-feature-toggle]').forEach((chk) => {
      const featId = chk.getAttribute('data-feature-toggle');
      if (featId) toggles[featId] = chk.checked;
    });
    await saveFamilyFeatureFlags(fid, fam?.name || fid, toggles);
    showToast(`💾 تم حفظ ميزات عائلة «${fam?.name || fid}»`);
    cachedAdminData = await fetchAdminDashboardData(fid);
    render();
  });

  document.getElementById('admin-test-firebase-btn')?.addEventListener('click', async () => {
    showToast('⚡ جارٍ اختبار الاتصال بـ Firebase...');
    const res = await probeFirebaseConnection();
    showToast(res.ok ? '✅ الاتصال بـ Firebase يعمل بكفاءة' : '⚠️ تعذر الاتصال بـ Firebase');
  });

  document.getElementById('admin-diag-export-btn')?.addEventListener('click', () => {
    const diagData = {
      timestamp: new Date().toISOString(),
      staffSession: state.session,
      isDeveloper: state.isDeveloperPortal,
      adminData: cachedAdminData,
    };
    const code = document.getElementById('admin-diag-code');
    const box = document.getElementById('admin-diag-output');
    if (code && box) {
      code.textContent = JSON.stringify(diagData, null, 2);
      box.hidden = false;
    }
    showToast('📦 تم توليد تقرير التشخيص بنجاح');
  });

  document.getElementById('confirm-share-add-btn')?.addEventListener('click', async () => {
    const candidates = parseSharedTextCandidates(pendingSharedText);
    if (!candidates.length) return;
    for (const cand of candidates) {
      await addNewShoppingItem({ n: cand.n, q: cand.q, c: 'super' });
    }
    pendingSharedText = '';
    const box = document.getElementById('intent-banner');
    if (box) box.hidden = true;
    await refreshSnapshot();
    showToast(`✅ تمت إضافة ${candidates.length} غرض من النص المُشارك`);
    render();
  });

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

  // --- Phase 2: Shopping List Events ---
  const addNameInp = document.getElementById('add-item-n');
  if (addNameInp) {
    addNameInp.addEventListener('input', () => {
      const val = addNameInp.value.trim();
      if (!val) return;
      const suggestions = extractHistorySuggestions(
        state.localSnapshot?.history,
        state.localSnapshot?.items
      );
      const match = suggestions.find((s) => s.itemName === val);
      if (match) {
        const catSel = document.getElementById('add-item-c');
        const priceInp = document.getElementById('add-item-p');
        const qtyInp = document.getElementById('add-item-q');
        if (catSel && match.c) catSel.value = match.c;
        if (priceInp && !priceInp.value && match.p) priceInp.value = String(match.p);
        if (qtyInp && !qtyInp.value && match.q) qtyInp.value = match.q;
      }
    });
  }

  document.getElementById('add-item-btn')?.addEventListener('click', async () => {
    const n = document.getElementById('add-item-n')?.value?.trim() || '';
    if (!n) {
      showToast('⚠️ اكتب اسم الغرض أولاً');
      return;
    }
    const q = document.getElementById('add-item-q')?.value?.trim() || '';
    const p = Number(document.getElementById('add-item-p')?.value) || 0;
    const c = document.getElementById('add-item-c')?.value || 'super';
    const note = document.getElementById('add-item-note')?.value?.trim() || '';
    const u = Boolean(document.getElementById('add-item-u')?.checked);

    await addNewShoppingItem({ n, q, p, c, u, note });
    await refreshSnapshot();
    showToast(`✅ أُضيف «${n}» للقائمة`);
    render();
  });

  document.querySelectorAll('[data-freq-item]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const n = btn.getAttribute('data-freq-item') || '';
      const c = btn.getAttribute('data-freq-cat') || 'super';
      const p = Number(btn.getAttribute('data-freq-price')) || 0;
      const q = btn.getAttribute('data-freq-qty') || '';
      await addNewShoppingItem({ n, q, p, c });
      await refreshSnapshot();
      showToast(`⚡ أُضيف «${n}» من الأغراض المتكررة`);
      render();
    });
  });

  document.getElementById('save-weekly-tpl-btn')?.addEventListener('click', async () => {
    const active = getActiveItemsList(state.localSnapshot?.items).filter((i) => !i.dn);
    if (active.length === 0) {
      showToast('⚠️ أضف أغراضاً متبقية أولاً لحفظها كقالب أسبوعي');
      return;
    }
    state.prefs.weeklyTemplate = active.map((i) => ({
      n: i.n,
      q: i.q,
      p: i.p,
      c: i.c,
      u: i.u,
    }));
    await localStore.setPref('theme', state.prefs);
    showToast(`💾 تم حفظ ${active.length} غرض في «مشتريات الأسبوع»`);
  });

  document.getElementById('apply-weekly-tpl-btn')?.addEventListener('click', async () => {
    const tpl =
      Array.isArray(state.prefs.weeklyTemplate) && state.prefs.weeklyTemplate.length > 0
        ? state.prefs.weeklyTemplate
        : extractHistorySuggestions(state.localSnapshot?.history, state.localSnapshot?.items)
            .slice(0, 5)
            .map((s) => ({ n: s.itemName, q: s.q, p: s.p, c: s.c, u: false }));

    const existingRemaining = new Set(
      getActiveItemsList(state.localSnapshot?.items)
        .filter((i) => !i.dn)
        .map((i) => i.n.trim())
    );
    let added = 0;
    for (const entry of tpl) {
      if (!existingRemaining.has(entry.n.trim())) {
        await addNewShoppingItem(entry);
        added += 1;
      }
    }
    await refreshSnapshot();
    showToast(
      added > 0
        ? `🔁 تمت إضافة ${added} غرض من مشتريات الأسبوع`
        : '✅ كل مشتريات الأسبوع موجودة بالفعل'
    );
    render();
  });

  document.querySelectorAll('[data-list-filter]').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.listFilter = btn.getAttribute('data-list-filter') || 'todo';
      render();
    });
  });

  document.getElementById('collapse-all-cats-btn')?.addEventListener('click', async () => {
    const cats = getSortedActiveCategories(state.localSnapshot?.cats);
    const current = Array.isArray(state.prefs.collapsedCats) ? state.prefs.collapsedCats : [];
    const allCollapsed = cats.length > 0 && cats.every((c) => current.includes(c.id));
    state.prefs.collapsedCats = allCollapsed ? [] : cats.map((c) => c.id);
    await localStore.setPref('theme', state.prefs);
    render();
  });

  document.querySelectorAll('[data-cat-toggle]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const cid = btn.getAttribute('data-cat-toggle');
      if (!cid) return;
      const set = new Set(
        Array.isArray(state.prefs.collapsedCats) ? state.prefs.collapsedCats : []
      );
      if (set.has(cid)) set.delete(cid);
      else set.add(cid);
      state.prefs.collapsedCats = Array.from(set);
      await localStore.setPref('theme', state.prefs);
      render();
    });
  });

  const searchInp = document.getElementById('search-items-inp');
  if (searchInp) {
    searchInp.addEventListener('input', () => {
      state.searchQuery = searchInp.value;
      applySearchFilterInDom(state.searchQuery);
    });
  }

  // Inline qty & price inputs: update in-place without re-rendering #view-root so focus stays!
  document.querySelectorAll('[data-inline-q]').forEach((inp) => {
    inp.addEventListener('input', async () => {
      const id = inp.getAttribute('data-inline-q');
      const existing = state.localSnapshot?.items?.[id];
      if (!existing) return;
      const updated = createItem({ ...existing, q: inp.value.trim(), updatedAt: Date.now() });
      state.localSnapshot.items[id] = updated;
      await persistEntity('items', id, updated);
    });
  });

  document.querySelectorAll('[data-inline-p]').forEach((inp) => {
    inp.addEventListener('input', async () => {
      const id = inp.getAttribute('data-inline-p');
      const existing = state.localSnapshot?.items?.[id];
      if (!existing) return;
      const newPrice = Math.max(0, Number(inp.value) || 0);
      const updated = createItem({ ...existing, p: newPrice, updatedAt: Date.now() });
      state.localSnapshot.items[id] = updated;
      updateHeaderTotals();
      await persistEntity('items', id, updated);
    });
  });

  document.querySelectorAll('[data-item-toggle]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const id = btn.getAttribute('data-item-toggle');
      const existing = state.localSnapshot?.items?.[id];
      if (!existing) return;
      const prevCopy = { ...existing };
      const nextDn = !existing.dn;
      const memberName = state.prefs.memberName || 'الأب';
      const now = Date.now();
      const updated = createItem({
        ...existing,
        dn: nextDn,
        dnBy: nextDn ? memberName : '',
        dnAt: nextDn ? now : '',
        deferred: false,
        updatedAt: now,
      });
      await persistEntity('items', id, updated);

      if (nextDn) {
        const histId = `h_${now}_${id}`;
        const hist = createHistoryEntry({
          id: histId,
          itemName: updated.n,
          c: updated.c,
          p: updated.p,
          q: updated.q,
          at: now,
          uid: state.firebaseStatus.uid || memberName,
        });
        await persistEntity('history', histId, hist);
      }

      await refreshSnapshot();
      render();
      showUndoSnackbar(
        nextDn ? `✅ أُنجز «${existing.n}»` : `↩️ أُعيد «${existing.n}» للمتبقي`,
        async () => {
          const reverted = createItem({ ...prevCopy, updatedAt: Date.now() });
          await persistEntity('items', id, reverted);
          await refreshSnapshot();
          render();
        }
      );
    });
  });

  document.querySelectorAll('[data-item-claim]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const id = btn.getAttribute('data-item-claim');
      const existing = state.localSnapshot?.items?.[id];
      if (!existing) return;
      const memberName = state.prefs.memberName || 'الأب';
      const nextClaim = existing.cl === memberName ? '' : memberName;
      const updated = createItem({ ...existing, cl: nextClaim, updatedAt: Date.now() });
      await persistEntity('items', id, updated);
      await refreshSnapshot();
      render();
    });
  });

  document.querySelectorAll('[data-item-edit]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const id = btn.getAttribute('data-item-edit');
      const existing = state.localSnapshot?.items?.[id];
      if (!existing) return;
      const cats = getSortedActiveCategories(state.localSnapshot?.cats);
      const edited = await showEditItemDialog(existing, cats);
      if (!edited) return;
      const prevCopy = { ...existing };
      const updated = createItem({
        ...existing,
        ...edited,
        updatedAt: Date.now(),
      });
      await persistEntity('items', id, updated);
      await refreshSnapshot();
      render();
      if (prevCopy.c !== updated.c) {
        showUndoSnackbar(`📂 نُقل «${updated.n}» إلى قسم آخر`, async () => {
          const reverted = createItem({ ...prevCopy, updatedAt: Date.now() });
          await persistEntity('items', id, reverted);
          await refreshSnapshot();
          render();
        });
      } else {
        showToast(`✏️ تم تحديث «${updated.n}»`);
      }
    });
  });

  document.querySelectorAll('[data-item-delete]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const id = btn.getAttribute('data-item-delete');
      const existing = state.localSnapshot?.items?.[id];
      if (!existing) return;
      const prevCopy = { ...existing };
      const tomb = createItem({ ...existing, deleted: true, updatedAt: Date.now() });
      await persistEntity('items', id, tomb);
      await refreshSnapshot();
      render();
      showUndoSnackbar(`🗑️ حُذف «${existing.n}»`, async () => {
        const restored = createItem({ ...prevCopy, deleted: false, updatedAt: Date.now() });
        await persistEntity('items', id, restored);
        await refreshSnapshot();
        render();
      });
    });
  });

  document.getElementById('toggle-done-sec-btn')?.addEventListener('click', () => {
    state.showDone = !state.showDone;
    render();
  });

  document.getElementById('clear-done-btn')?.addEventListener('click', async () => {
    const doneList = getActiveItemsList(state.localSnapshot?.items).filter((i) => i.dn);
    if (!doneList.length) return;
    const confirmed = await showConfirmDialog(
      `هل تريد مسح جميع الأغراض المنجزة (${doneList.length})؟`
    );
    if (!confirmed) return;
    const backup = doneList.map((i) => ({ ...i }));
    const now = Date.now();
    for (const item of doneList) {
      const tomb = createItem({ ...item, deleted: true, updatedAt: now });
      await persistEntity('items', item.id, tomb);
    }
    await refreshSnapshot();
    render();
    showUndoSnackbar(`🧹 تم مسح ${doneList.length} غرض منجز`, async () => {
      const restoreTs = Date.now();
      for (const prev of backup) {
        const restored = createItem({ ...prev, deleted: false, updatedAt: restoreTs });
        await persistEntity('items', prev.id, restored);
      }
      await refreshSnapshot();
      render();
    });
  });

  // Child requests
  document.getElementById('submit-request-btn')?.addEventListener('click', async () => {
    const n = document.getElementById('req-item-n')?.value?.trim() || '';
    if (!n) {
      showToast('⚠️ اكتب اسم الطلب أولاً');
      return;
    }
    const q = document.getElementById('req-item-q')?.value?.trim() || '';
    const c = document.getElementById('req-item-c')?.value || 'super';
    const now = Date.now();
    const id = `req_${now}_${Math.random().toString(36).slice(2, 6)}`;
    const memberName = state.prefs.memberName || 'الابن';
    const req = createRequest({
      id,
      by: state.firebaseStatus.uid || memberName,
      byName: memberName,
      n,
      q,
      c,
      status: 'pending',
      updatedAt: now,
    });
    await persistEntity('requests', id, req);
    await refreshSnapshot();
    showToast('📨 تم إرسال الطلب للمسؤول للموافقة');
    render();
  });

  document.querySelectorAll('[data-req-approve]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const id = btn.getAttribute('data-req-approve');
      const req = state.localSnapshot?.requests?.[id];
      if (!req) return;
      const approved = createRequest({ ...req, status: 'approved', updatedAt: Date.now() });
      await persistEntity('requests', id, approved);
      await addNewShoppingItem({ n: req.n, q: req.q, c: req.c });
      await refreshSnapshot();
      showToast(`✅ تمت الموافقة على «${req.n}» وإضافته للقائمة`);
      render();
    });
  });

  document.querySelectorAll('[data-req-reject]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const id = btn.getAttribute('data-req-reject');
      const req = state.localSnapshot?.requests?.[id];
      if (!req) return;
      const rejected = createRequest({ ...req, status: 'rejected', updatedAt: Date.now() });
      await persistEntity('requests', id, rejected);
      await refreshSnapshot();
      showToast(`✕ تم رفض الطلب «${req.n}»`);
      render();
    });
  });

  document.getElementById('share-wa-btn')?.addEventListener('click', async () => {
    const snap = state.localSnapshot || {};
    const cats = getSortedActiveCategories(snap.cats);
    const items = getActiveItemsList(snap.items);
    const summary = computeBudgetSummary(items, snap.budget);
    const report = buildWhatsAppReport({
      roomName: snap.meta?.name || 'عائلتي',
      categoriesList: cats,
      itemsList: items,
      summary,
    });
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(report);
        showToast('📋 تم نسخ تقرير واتساب إلى الحافظة');
        return;
      }
    } catch {
      // Fallback below
    }
    showToast('📲 تم تجهيز تقرير واتساب للمشاركة');
  });

  // --- Phase 2: Store Catalog & Quick In-Store Events ---
  document.querySelectorAll('[data-store-cat-filter]').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.storeCatFilter = btn.getAttribute('data-store-cat-filter') || 'all';
      render();
    });
  });

  const storeSearchInp = document.getElementById('store-search-inp');
  if (storeSearchInp) {
    storeSearchInp.addEventListener('input', () => {
      state.storeSearchQuery = storeSearchInp.value;
      applyStoreSearchFilterInDom(state.storeSearchQuery);
    });
  }

  document.querySelectorAll('[data-catalog-add]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const n = btn.getAttribute('data-catalog-add') || '';
      const c = btn.getAttribute('data-catalog-cat') || 'super';
      const q = btn.getAttribute('data-catalog-q') || '';
      const p = Number(btn.getAttribute('data-catalog-p')) || 0;
      await addNewShoppingItem({ n, q, p, c });
      await refreshSnapshot();
      showToast(`🛒 أُضيف «${n}» إلى السلة`);
      render();
    });
  });

  document.getElementById('add-catalog-item-btn')?.addEventListener('click', async () => {
    const cats = getSortedActiveCategories(state.localSnapshot?.cats);
    const defaultCat =
      state.storeCatFilter && state.storeCatFilter !== 'all' ? state.storeCatFilter : 'super';
    const created = await showEditItemDialog({ n: '', q: '1', p: 0, c: defaultCat }, cats);
    if (!created) return;
    await ensureCatalogEntry({
      n: created.n,
      q: created.q,
      p: created.p,
      c: created.c,
      autoLearned: false,
    });
    const alsoAddToCart = await showConfirmDialog(
      `تم حفظ «${created.n}» في المتجر الدائم. هل تريد إضافته إلى «🛒 السلة» الآن أيضاً؟`,
      { confirmText: '🛒 أضف للسلة', cancelText: 'حفظ في المتجر فقط' }
    );
    if (alsoAddToCart) {
      await addNewShoppingItem({
        n: created.n,
        q: created.q,
        p: created.p,
        c: created.c,
        u: created.u,
        note: created.note,
      });
      await refreshSnapshot();
    }
    showToast(`✅ تم حفظ «${created.n}» في كتالوج المتجر`);
    render();
  });

  document.getElementById('ai-suggest-store-btn')?.addEventListener('click', () => {
    state.showAiStoreSuggestions = !state.showAiStoreSuggestions;
    render();
  });

  document.querySelectorAll('[data-ai-catalog-add]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const n = btn.getAttribute('data-ai-catalog-add') || '';
      const c = btn.getAttribute('data-ai-cat') || 'super';
      const q = btn.getAttribute('data-ai-q') || '1';
      const p = Number(btn.getAttribute('data-ai-p')) || 0;
      await ensureCatalogEntry({ n, q, p, c, autoLearned: false });
      await addNewShoppingItem({ n, q, p, c });
      await refreshSnapshot();
      showToast(`🤖 أُضيف «${n}» للمتجر والسلة بنجاح`);
      render();
    });
  });

  document.querySelectorAll('[data-store-check]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const id = btn.getAttribute('data-store-check');
      const existing = state.localSnapshot?.items?.[id];
      if (!existing) return;
      const prevCopy = { ...existing };
      const now = Date.now();
      const memberName = state.prefs.memberName || 'الأب';
      const updated = createItem({
        ...existing,
        dn: true,
        dnBy: memberName,
        dnAt: now,
        deferred: false,
        updatedAt: now,
      });
      await persistEntity('items', id, updated);
      await refreshSnapshot();
      render();
      showUndoSnackbar(`🛒 وُضع «${existing.n}» في العربة`, async () => {
        const reverted = createItem({ ...prevCopy, updatedAt: Date.now() });
        await persistEntity('items', id, reverted);
        await refreshSnapshot();
        render();
      });
    });
  });

  document.querySelectorAll('[data-store-defer]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const id = btn.getAttribute('data-store-defer');
      const existing = state.localSnapshot?.items?.[id];
      if (!existing) return;
      const prevCopy = { ...existing };
      const updated = createItem({
        ...existing,
        deferred: true,
        updatedAt: Date.now(),
      });
      await persistEntity('items', id, updated);
      await refreshSnapshot();
      render();
      showUndoSnackbar(`⏳ أُجّل «${existing.n}» (غير متوفر حالياً)`, async () => {
        const reverted = createItem({ ...prevCopy, updatedAt: Date.now() });
        await persistEntity('items', id, reverted);
        await refreshSnapshot();
        render();
      });
    });
  });

  document.querySelectorAll('[data-store-undefer]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const id = btn.getAttribute('data-store-undefer');
      const existing = state.localSnapshot?.items?.[id];
      if (!existing) return;
      const updated = createItem({
        ...existing,
        deferred: false,
        updatedAt: Date.now(),
      });
      await persistEntity('items', id, updated);
      await refreshSnapshot();
      render();
    });
  });

  document.querySelectorAll('[data-aisle-move]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const raw = btn.getAttribute('data-aisle-move') || '';
      const [catId, dirStr] = raw.split(':');
      const delta = Number(dirStr);
      if (!catId || !delta) return;
      const ordered = sortCategoriesByAisle(
        state.localSnapshot?.cats || {},
        state.prefs.aisleOrder || []
      ).map((c) => c.id);
      const idx = ordered.indexOf(catId);
      const targetIdx = idx + delta;
      if (idx < 0 || targetIdx < 0 || targetIdx >= ordered.length) return;
      [ordered[idx], ordered[targetIdx]] = [ordered[targetIdx], ordered[idx]];
      state.prefs.aisleOrder = ordered;
      await localStore.setPref('theme', state.prefs);
      render();
    });
  });

  // --- Personal Category Order, Members, Budget, Categories & Developer Events ---
  document.querySelectorAll('[data-personal-cat-move]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const raw = btn.getAttribute('data-personal-cat-move') || '';
      const [cid, dirStr] = raw.split(':');
      const delta = Number(dirStr);
      if (!cid || !delta) return;
      const memberId = state.session.memberId || 'mem_father';
      const currentOrder = state.prefs.personalCatOrder?.[memberId] || [];
      const orderedIds = getSortedActiveCategories(
        state.localSnapshot?.cats || {},
        currentOrder
      ).map((c) => c.id);
      const idx = orderedIds.indexOf(cid);
      const targetIdx = idx + delta;
      if (idx < 0 || targetIdx < 0 || targetIdx >= orderedIds.length) return;
      [orderedIds[idx], orderedIds[targetIdx]] = [orderedIds[targetIdx], orderedIds[idx]];
      if (!state.prefs.personalCatOrder || typeof state.prefs.personalCatOrder !== 'object') {
        state.prefs.personalCatOrder = {};
      }
      state.prefs.personalCatOrder[memberId] = orderedIds;
      await localStore.setPref('theme', state.prefs);
      render();
    });
  });

  document.getElementById('reset-personal-cat-btn')?.addEventListener('click', async () => {
    const memberId = state.session.memberId || 'mem_father';
    if (state.prefs.personalCatOrder && state.prefs.personalCatOrder[memberId]) {
      delete state.prefs.personalCatOrder[memberId];
      await localStore.setPref('theme', state.prefs);
    }
    showToast('↩️ تم استعادة ترتيب الأقسام الافتراضي لحسابك');
    render();
  });

  document.getElementById('add-member-btn')?.addEventListener('click', async () => {
    const name = document.getElementById('new-member-name')?.value?.trim() || '';
    if (!name) {
      showToast('⚠️ اكتب اسم الفرد أولاً');
      return;
    }
    const icon = document.getElementById('new-member-icon')?.value?.trim() || '🧑';
    const role = document.getElementById('new-member-role')?.value || 'child';
    const accessCode = document.getElementById('new-member-pin')?.value?.trim() || '0000';
    await ensureMembersSeeded();
    const id = `mem_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const member = createMember({
      id,
      name,
      icon,
      role,
      accessCode,
      points: 0,
      updatedAt: Date.now(),
    });
    await persistEntity('members', id, member);
    await recordActivityLog('إضافة عضو', name);
    await refreshSnapshot();
    showToast(`✅ تمت إضافة «${name}» للعائلة`);
    render();
  });

  document.querySelectorAll('[data-member-role]').forEach((sel) => {
    sel.addEventListener('change', async () => {
      const mid = sel.getAttribute('data-member-role');
      if (!mid) return;
      await ensureMembersSeeded();
      const existing = state.localSnapshot?.members?.[mid];
      if (!existing) return;
      const updated = createMember({ ...existing, role: sel.value, updatedAt: Date.now() });
      await persistEntity('members', mid, updated);
      if (state.session.memberId === mid) {
        state.prefs.currentRole = updated.role;
        await localStore.setPref('theme', state.prefs);
      }
      await recordActivityLog('تعديل صلاحية', `${updated.name} -> ${updated.role}`);
      await refreshSnapshot();
      showToast(`🛡️ تم تحديث صلاحية ${updated.name}`);
      render();
    });
  });

  document.querySelectorAll('[data-member-pin]').forEach((inp) => {
    inp.addEventListener('change', async () => {
      const mid = inp.getAttribute('data-member-pin');
      if (!mid) return;
      await ensureMembersSeeded();
      const existing = state.localSnapshot?.members?.[mid];
      if (!existing) return;
      const newPin = inp.value.trim() || '0000';
      const updated = createMember({ ...existing, accessCode: newPin, updatedAt: Date.now() });
      await persistEntity('members', mid, updated);
      await recordActivityLog('تعديل رمز سري', updated.name);
      showToast(`🔑 تم تحديث الرقم السري لـ ${updated.name}`);
    });
  });

  document.querySelectorAll('[data-member-delete]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const mid = btn.getAttribute('data-member-delete');
      if (!mid) return;
      await ensureMembersSeeded();
      const existing = state.localSnapshot?.members?.[mid];
      if (!existing) return;
      const activeMembers = getEffectiveMembersList(state.localSnapshot);
      if (activeMembers.length <= 1) {
        showToast('⚠️ لا يمكن حذف آخر فرد في العائلة');
        return;
      }
      const ok = await showConfirmDialog(`هل تريد إزالة «${existing.name}» من العائلة؟`);
      if (!ok) return;
      const tomb = createMember({ ...existing, deleted: true, off: true, updatedAt: Date.now() });
      await persistEntity('members', mid, tomb);
      await recordActivityLog('حذف عضو', existing.name);
      await refreshSnapshot();
      showToast(`🗑️ تمت إزالة ${existing.name}`);
      render();
    });
  });

  document.getElementById('dev-add-family-btn')?.addEventListener('click', async () => {
    const famCode = document.getElementById('dev-new-family-inp')?.value?.trim() || '';
    if (!famCode) {
      showToast('⚠️ أدخل كود العائلة الجديدة');
      return;
    }
    await switchFamilyRoom(famCode);
    await recordActivityLog('تأسيس عائلة', famCode);
    showToast(`🗂️ تم إنشاء وفتح عائلة: ${famCode}`);
    render();
  });

  document.querySelectorAll('[data-dev-switch-family]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const famCode = btn.getAttribute('data-dev-switch-family');
      if (!famCode) return;
      await switchFamilyRoom(famCode);
      showToast(`📂 تم التبديل إلى عائلة: ${famCode}`);
      render();
    });
  });

  // --- Household Tasks Events ---
  document.querySelectorAll('[data-task-filter]').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.taskFilter = btn.getAttribute('data-task-filter') || 'all';
      render();
    });
  });

  const createAndPersistTask = async ({ title, assigneeId, recurrence, points }) => {
    const cleanTitle = String(title || '').trim();
    if (!cleanTitle) {
      showToast('⚠️ اكتب عنوان المهمة أولاً');
      return;
    }
    const members = getEffectiveMembersList(state.localSnapshot);
    const targetMember = members.find((m) => m.id === assigneeId);
    const now = Date.now();
    const id = `tsk_${now}_${Math.random().toString(36).slice(2, 6)}`;
    const task = createTask({
      id,
      title: cleanTitle,
      assigneeId: targetMember ? targetMember.id : 'all',
      assigneeName: targetMember ? targetMember.name : 'الجميع',
      recurrence: recurrence || 'once',
      points: Math.max(0, Number(points) || 0),
      createdBy: state.prefs.memberName || 'الأب',
      updatedAt: now,
    });
    await persistEntity('tasks', id, task);
    await recordActivityLog('إضافة مهمة', cleanTitle);
    await refreshSnapshot();
    showToast(`📋 أُضيفت المهمة «${cleanTitle}»`);
    render();
  };

  document.getElementById('add-task-btn')?.addEventListener('click', async () => {
    await createAndPersistTask({
      title: document.getElementById('task-title-inp')?.value,
      assigneeId: document.getElementById('task-assignee-sel')?.value || 'all',
      recurrence: document.getElementById('task-recur-sel')?.value || 'once',
      points: document.getElementById('task-points-inp')?.value ?? 10,
    });
  });

  document.querySelectorAll('[data-task-tpl]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      await createAndPersistTask({
        title: btn.getAttribute('data-task-tpl'),
        assigneeId: document.getElementById('task-assignee-sel')?.value || 'all',
        recurrence: btn.getAttribute('data-task-tpl-recur') || 'daily',
        points: Number(btn.getAttribute('data-task-tpl-pts')) || 10,
      });
    });
  });

  document.querySelectorAll('[data-task-complete]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const tid = btn.getAttribute('data-task-complete');
      const existing = state.localSnapshot?.tasks?.[tid];
      if (!existing) return;
      const prevTask = { ...existing };
      const now = Date.now();
      const completerName = state.prefs.memberName || 'الأب';
      const updatedTask = createTask({
        ...existing,
        done: true,
        doneBy: completerName,
        doneAt: now,
        updatedAt: now,
      });
      await persistEntity('tasks', tid, updatedTask);

      // Award points to the completing child/member or explicit assignee
      await ensureMembersSeeded();
      const targetId =
        existing.assigneeId && existing.assigneeId !== 'all'
          ? existing.assigneeId
          : state.session.memberId;
      const memberRec = state.localSnapshot?.members?.[targetId];
      const earned = Number(existing.points) || 0;
      if (memberRec && earned > 0) {
        const nextMember = createMember({
          ...memberRec,
          points: (Number(memberRec.points) || 0) + earned,
          updatedAt: now,
        });
        await persistEntity('members', targetId, nextMember);
      }

      await recordActivityLog('إنجاز مهمة', `${existing.title} (+${earned} ⭐)`);
      await refreshSnapshot();
      render();
      showUndoSnackbar(`✅ أُنجزت «${existing.title}» (+${earned} ⭐)`, async () => {
        const reverted = createTask({
          ...prevTask,
          done: false,
          doneBy: '',
          updatedAt: Date.now(),
        });
        await persistEntity('tasks', tid, reverted);
        if (memberRec && earned > 0) {
          const curMem = state.localSnapshot?.members?.[targetId] || memberRec;
          await persistEntity(
            'members',
            targetId,
            createMember({
              ...curMem,
              points: Math.max(0, (Number(curMem.points) || 0) - earned),
              updatedAt: Date.now(),
            })
          );
        }
        await refreshSnapshot();
        render();
      });
    });
  });

  document.querySelectorAll('[data-task-reset]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const tid = btn.getAttribute('data-task-reset');
      const existing = state.localSnapshot?.tasks?.[tid];
      if (!existing) return;
      const resetTask = createTask({
        ...existing,
        done: false,
        doneBy: '',
        doneAt: 0,
        updatedAt: Date.now(),
      });
      await persistEntity('tasks', tid, resetTask);
      await refreshSnapshot();
      showToast(`🔄 تم تجديد دورة «${existing.title}»`);
      render();
    });
  });

  document.querySelectorAll('[data-task-delete]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const tid = btn.getAttribute('data-task-delete');
      const existing = state.localSnapshot?.tasks?.[tid];
      if (!existing) return;
      const prevCopy = { ...existing };
      await persistEntity(
        'tasks',
        tid,
        createTask({ ...existing, deleted: true, updatedAt: Date.now() })
      );
      await refreshSnapshot();
      render();
      showUndoSnackbar(`🗑️ حُذفت مهمة «${existing.title}»`, async () => {
        await persistEntity(
          'tasks',
          tid,
          createTask({ ...prevCopy, deleted: false, updatedAt: Date.now() })
        );
        await refreshSnapshot();
        render();
      });
    });
  });

  document.getElementById('save-budget-btn')?.addEventListener('click', async () => {
    const monthly = Math.max(0, Number(document.getElementById('monthly-budget-inp')?.value) || 0);
    const nextBudget = createBudget({
      monthly,
      perCat: state.localSnapshot?.budget?.perCat || {},
    });
    state.localSnapshot.budget = nextBudget;
    await persistRoomDoc({ budget: nextBudget });
    await refreshSnapshot();
    showToast(`💰 تم تحديث الميزانية الشهرية إلى ${monthly} د.ل`);
    render();
  });

  document.querySelectorAll('[data-cat-limit]').forEach((inp) => {
    inp.addEventListener('change', async () => {
      const cid = inp.getAttribute('data-cat-limit');
      if (!cid) return;
      const limitVal = Math.max(0, Number(inp.value) || 0);
      const perCat = { ...(state.localSnapshot?.budget?.perCat || {}), [cid]: limitVal };
      const nextBudget = createBudget({
        monthly: state.localSnapshot?.budget?.monthly ?? 250,
        perCat,
      });
      state.localSnapshot.budget = nextBudget;
      await persistRoomDoc({ budget: nextBudget });
      updateHeaderTotals();
      showToast('✅ تم حفظ سقف ميزانية القسم');
    });
  });

  document.getElementById('add-cat-btn')?.addEventListener('click', async () => {
    const res = await showCategoryDialog(null);
    if (!res) return;
    const cats = getSortedActiveCategories(state.localSnapshot?.cats);
    const id = `cat_${Date.now()}`;
    const newCat = createCategory({
      id,
      n: res.n,
      i: res.i,
      order: cats.length,
      updatedAt: Date.now(),
    });
    await persistEntity('cats', id, newCat);
    await refreshSnapshot();
    showToast(`➕ أُضيف القسم «${res.n}»`);
    render();
  });

  document.querySelectorAll('[data-cat-edit]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const cid = btn.getAttribute('data-cat-edit');
      const existing = state.localSnapshot?.cats?.[cid];
      if (!existing) return;
      const res = await showCategoryDialog(existing);
      if (!res) return;
      const updated = createCategory({
        ...existing,
        n: res.n,
        i: res.i,
        updatedAt: Date.now(),
      });
      await persistEntity('cats', cid, updated);
      await refreshSnapshot();
      showToast(`✏️ تم تعديل القسم «${res.n}»`);
      render();
    });
  });

  document.querySelectorAll('[data-cat-move]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const raw = btn.getAttribute('data-cat-move') || '';
      const [cid, dirStr] = raw.split(':');
      const delta = Number(dirStr);
      if (!cid || !delta) return;
      const cats = getSortedActiveCategories(state.localSnapshot?.cats);
      const idx = cats.findIndex((c) => c.id === cid);
      const targetIdx = idx + delta;
      if (idx < 0 || targetIdx < 0 || targetIdx >= cats.length) return;
      const now = Date.now();
      const a = createCategory({ ...cats[idx], order: targetIdx, updatedAt: now });
      const b = createCategory({ ...cats[targetIdx], order: idx, updatedAt: now });
      await persistEntity('cats', a.id, a);
      await persistEntity('cats', b.id, b);
      await refreshSnapshot();
      render();
    });
  });

  document.querySelectorAll('[data-cat-delete]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const cid = btn.getAttribute('data-cat-delete');
      const existing = state.localSnapshot?.cats?.[cid];
      if (!existing) return;
      const cats = getSortedActiveCategories(state.localSnapshot?.cats);
      if (cats.length <= 1) {
        showToast('⚠️ لا يمكن حذف آخر قسم متبقٍ');
        return;
      }
      const fallbackCat = cats.find((c) => c.id !== cid) || cats[0];
      const catItems = getActiveItemsList(state.localSnapshot?.items).filter((i) => i.c === cid);
      const confirmed = await showConfirmDialog(
        catItems.length > 0
          ? `سيتم حذف القسم «${existing.n}» ونقل ${catItems.length} غرض إلى «${fallbackCat.n}». هل أنت متأكد؟`
          : `هل تريد حذف القسم «${existing.n}»؟`
      );
      if (!confirmed) return;

      const now = Date.now();
      for (const item of catItems) {
        const moved = createItem({ ...item, c: fallbackCat.id, updatedAt: now });
        await persistEntity('items', item.id, moved);
      }
      const tomb = createCategory({ ...existing, deleted: true, updatedAt: now });
      await persistEntity('cats', cid, tomb);
      await refreshSnapshot();
      render();
      showUndoSnackbar(`🗑️ حُذف القسم «${existing.n}»`, async () => {
        const restoreTs = Date.now();
        const restoredCat = createCategory({ ...existing, deleted: false, updatedAt: restoreTs });
        await persistEntity('cats', cid, restoredCat);
        for (const item of catItems) {
          const restoredItem = createItem({ ...item, c: cid, updatedAt: restoreTs });
          await persistEntity('items', item.id, restoredItem);
        }
        await refreshSnapshot();
        render();
      });
    });
  });

  // --- Phase 1: Room & Auth Events ---
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
        if (!activeSyncEngine) {
          activeSyncEngine = new SyncEngine({
            roomId: state.roomId,
            store: localStore,
            useEmulator: state.prefs.useEmulator,
            rtdbUrl: state.prefs.rtdbUrl,
          });
          void activeSyncEngine.start().catch(() => {});
        }
        await refreshSnapshot();
        showToast('✅ تم تفعيل الغرفة والمزامنة الحية وتوليد رابط الدعوة');
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
    await startSyncForCurrentRoom();
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

  // --- Phase 0: Import & Diagnostics Events ---
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

  document.getElementById('export-v2-backup-btn')?.addEventListener('click', () => {
    const snap = state.localSnapshot || {};
    const payload = {
      exportedAt: Date.now(),
      roomId: state.roomId,
      meta: snap.meta || {},
      budget: snap.budget || {},
      cats: snap.cats || {},
      members: snap.members || {},
      items: snap.items || {},
      requests: snap.requests || {},
      tasks: snap.tasks || {},
      history: snap.history || {},
    };
    const jsonStr = JSON.stringify(payload, null, 2);
    state.rawImportText = jsonStr;
    const ta = document.getElementById('legacy-json');
    if (ta) ta.value = jsonStr;
    try {
      const blob = new Blob([jsonStr], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `family-os-backup-${state.roomId}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch {
      // Fallback: JSON is also placed in #legacy-json textarea
    }
    showToast('📤 تم تصدير النسخة الاحتياطية للعائلة الحالية');
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
    for (const col of ['cats', 'members', 'items', 'requests', 'tasks', 'history', 'log']) {
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
      await saveMemberPersonalTheme(state.session.memberId);
      render();
    });
  });

  document.getElementById('toggle-dark')?.addEventListener('click', async () => {
    state.prefs.dark = !state.prefs.dark;
    await saveMemberPersonalTheme(state.session.memberId);
    render();
  });

  document.getElementById('font-range')?.addEventListener('input', async (e) => {
    state.prefs.fontSize = Number(e.target.value) || 16;
    await saveMemberPersonalTheme(state.session.memberId);
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

  bindStitchEvents();
  bindAiEvents();
}

/**
 * Wire up events for the centralized developer/admin dashboard
 * (renderAdminDashboard). The family action handlers (approve/suspend/delete
 * families, members, features) already live in bindViewEvents; here we bind
 * only the dashboard-specific controls (tab switching, logout, create family,
 * member toggling/deletion, feature save, AI/Firebase test buttons).
 */
function bindAdminDashboardEvents() {
  // Tab navigation within the admin dashboard
  document.querySelectorAll('[data-admin-tab]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      state.adminActiveTab = btn.getAttribute('data-admin-tab') || 'families';
      try {
        cachedAdminData = await fetchAdminDashboardData(cachedAdminData?.selectedFid);
      } catch {
        // keep previous data offline
      }
      render();
    });
  });

  document.getElementById('admin-logout-btn')?.addEventListener('click', async () => {
    await signOutActiveUser();
    state.session = { loggedIn: false };
    cachedAdminData = null;
    showToast('🚪 تم تسجيل الخروج من لوحة الإدارة');
    render();
  });

  // Family lifecycle actions (approve / suspend / activate / delete)
  document.querySelectorAll('[data-action="approve-family"]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const fid = btn.getAttribute('data-fid');
      const name = btn.getAttribute('data-name');
      try {
        await approvePendingFamily(fid, name);
        showToast(`✅ تم اعتماد وتفعيل عائلة «${name}»`);
        cachedAdminData = await fetchAdminDashboardData();
      } catch (err) {
        showToast(`❌ تعذر اعتماد العائلة: ${err?.message || err}`);
      }
      render();
    });
  });

  document.querySelectorAll('[data-action="suspend-family"]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const fid = btn.getAttribute('data-fid');
      const fam = cachedAdminData?.families?.find((f) => f.fid === fid);
      try {
        await updateFamilyStatus(fid, fam?.name || fid, 'suspended');
        showToast(`⏸️ تم إيقاف عائلة «${fam?.name || fid}» مؤقتاً`);
        cachedAdminData = await fetchAdminDashboardData();
      } catch (err) {
        showToast(`❌ تعذر الإيقاف: ${err?.message || err}`);
      }
      render();
    });
  });

  document.querySelectorAll('[data-action="activate-family"]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const fid = btn.getAttribute('data-fid');
      const fam = cachedAdminData?.families?.find((f) => f.fid === fid);
      try {
        await updateFamilyStatus(fid, fam?.name || fid, 'active');
        showToast(`▶️ تم تنشيط عائلة «${fam?.name || fid}»`);
        cachedAdminData = await fetchAdminDashboardData();
      } catch (err) {
        showToast(`❌ تعذر التنشيط: ${err?.message || err}`);
      }
      render();
    });
  });

  document.querySelectorAll('[data-action="delete-family"]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const fid = btn.getAttribute('data-fid');
      const name = btn.getAttribute('data-name');
      // showConfirmDialog returns a Promise<boolean> — it does NOT take a callback.
      const confirmed = await showConfirmDialog(
        `هل أنت متأكد من حذف عائلة «${name}» نهائياً من قاعدة البيانات؟`,
        { confirmText: '🗑️ حذف نهائي', cancelText: 'إلغاء' }
      );
      if (!confirmed) return;
      try {
        await deleteFamilyRecord(fid, name);
        showToast(`🗑️ تم حذف عائلة «${name}»`);
        cachedAdminData = await fetchAdminDashboardData();
      } catch (err) {
        showToast(`❌ تعذر حذف العائلة: ${err?.message || err}`);
      }
      render();
    });
  });

  // Per-family user (member) selection + actions
  document.getElementById('admin-users-fam-select')?.addEventListener('change', async (e) => {
    cachedAdminData = await fetchAdminDashboardData(e.target.value);
    render();
  });

  document.querySelectorAll('[data-action="toggle-member-active"]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      showToast('🔄 جارٍ تحديث حالة العضو...');
      // Member toggle handled by v2 rules; delegate to settings if present.
      render();
    });
  });

  // Feature flags save
  document.getElementById('admin-features-fam-select')?.addEventListener('change', async (e) => {
    cachedAdminData = await fetchAdminDashboardData(e.target.value);
    render();
  });

  // --- Staff & support team management ---
  const refreshAdmin = async () => {
    try {
      cachedAdminData = await fetchAdminDashboardData(cachedAdminData?.selectedFid);
    } catch {
      // keep previous data
    }
    render();
  };

  document.getElementById('staff-invite-btn')?.addEventListener('click', async () => {
    const email = document.getElementById('staff-invite-email')?.value?.trim() || '';
    const name = document.getElementById('staff-invite-name')?.value?.trim() || '';
    const role = document.getElementById('staff-invite-role')?.value || 'support';
    if (!email) {
      showToast('⚠️ أدخل بريد الموظف');
      return;
    }
    try {
      await saveStaffInvite({ email, name, role });
      showToast(`📨 تم إرسال الدعوة إلى ${email}`);
      await refreshAdmin();
    } catch (err) {
      showToast(`❌ تعذر إرسال الدعوة: ${err?.message || err}`);
    }
  });

  document.querySelectorAll('[data-action="toggle-staff"]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const uid = btn.getAttribute('data-uid');
      const isDisabled = btn.getAttribute('data-disabled') === 'true';
      try {
        await setStaffDisabled(uid, !isDisabled);
        showToast(isDisabled ? '▶️ تم تفعيل حساب الموظف' : '⏸️ تم تعطيل حساب الموظف');
      } catch (err) {
        showToast(`❌ ${err?.message || err}`);
      }
      await refreshAdmin();
    });
  });

  document.querySelectorAll('[data-action="remove-staff"]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const uid = btn.getAttribute('data-uid');
      const email = btn.getAttribute('data-email');
      const confirmed = await showConfirmDialog(
        `حذف «${email}» من فريق الدعم؟ سيفقد الوصول إلى بوابة الإدارة فوراً.`,
        { confirmText: '🗑️ حذف', cancelText: 'إلغاء' }
      );
      if (!confirmed) return;
      try {
        await removeStaffMember(uid, email);
        showToast('🗑️ تم حذف عضو الفريق');
      } catch (err) {
        showToast(`❌ ${err?.message || err}`);
      }
      await refreshAdmin();
    });
  });

  document.querySelectorAll('[data-action="revoke-invite"]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const email = btn.getAttribute('data-email');
      try {
        await revokeStaffInvite(email);
        showToast('✅ تم إلغاء الدعوة');
      } catch (err) {
        showToast(`❌ ${err?.message || err}`);
      }
      await refreshAdmin();
    });
  });

  // --- AI configuration (global + per-family) ---
  const readAiForm = (prefix) => {
    const providerEl = document.getElementById(`${prefix}-provider`);
    const provider = providerEl?.value || 'gemini';
    return {
      provider,
      name: document.getElementById(`${prefix}-name`)?.value?.trim() || '',
      url: document.getElementById(`${prefix}-url`)?.value?.trim() || '',
      type: document.getElementById(`${prefix}-type`)?.value || 'openai',
      model: document.getElementById(`${prefix}-model`)?.value?.trim() || '',
      apiKey: document.getElementById(`${prefix}-key`)?.value?.trim() || '',
    };
  };

  const showAiResult = (prefix, msg) => {
    const box = document.getElementById(`${prefix}-result`);
    if (box) {
      box.textContent = msg;
      box.hidden = false;
    }
  };

  const toggleCustomFields = (prefix) => {
    const provider = document.getElementById(`${prefix}-provider`)?.value;
    const isCustom = provider === 'custom';
    ['name-wrap', 'url-wrap', 'type-wrap'].forEach((suffix) => {
      const el = document.getElementById(`${prefix}-${suffix}`);
      if (el) el.hidden = !isCustom;
    });
  };

  const bindAiEditor = (prefix, scope) => {
    document.getElementById(`${prefix}-provider`)?.addEventListener('change', () => toggleCustomFields(prefix));
    toggleCustomFields(prefix);

    document.getElementById(`${prefix}-key-toggle`)?.addEventListener('click', () => {
      const inp = document.getElementById(`${prefix}-key`);
      if (inp) inp.type = inp.type === 'password' ? 'text' : 'password';
    });

    const currentFid = () =>
      document.getElementById('ai-family-select')?.value || cachedAdminData?.selectedFid || '';

    document.getElementById(`${prefix}-save`)?.addEventListener('click', async () => {
      const form = readAiForm(prefix);
      try {
        await saveAiConfig({ scope, fid: scope === 'family' ? currentFid() : undefined, ...form });
        showToast('💾 تم الحفظ بنجاح');
        cachedAdminData = await fetchAdminDashboardData(currentFid());
        if (cachedAdminData) {
          cachedAdminData.activeTab = 'integrations';
          state.adminActiveTab = 'integrations';
        }
        render();
      } catch (err) {
        showToast(`❌ ${err?.message || err}`);
      }
    });

    document.getElementById(`${prefix}-test`)?.addEventListener('click', async () => {
      showAiResult(prefix, '⏳ جارٍ اختبار المزود...');
      try {
        const res = await testAiConfig(readAiForm(prefix));
        showAiResult(prefix, `✅ نجح الاتصال (${res.ms}ms): ${res.reply}`);
      } catch (err) {
        showAiResult(prefix, `❌ فشل الاختبار: ${err?.message || err}`);
      }
    });

    document.getElementById(`${prefix}-clear`)?.addEventListener('click', async () => {
      try {
        await clearAiConfig({ scope, fid: scope === 'family' ? currentFid() : undefined });
        showToast(scope === 'family' ? '↩️ تم إرجاع العائلة للمفتاح العام' : '🗑️ تم حذف المفتاح العام');
        cachedAdminData = await fetchAdminDashboardData(currentFid());
        if (cachedAdminData) {
          cachedAdminData.activeTab = 'integrations';
          state.adminActiveTab = 'integrations';
        }
        render();
      } catch (err) {
        showToast(`❌ ${err?.message || err}`);
      }
    });

    // Fetch the model catalog into a table (no dropdowns).
    document.getElementById(`${prefix}-models-btn`)?.addEventListener('click', async () => {
      const box = document.getElementById(`${prefix}-models`);
      if (!box) return;
      box.hidden = false;
      box.innerHTML = '<p class="mu">⏳ جارٍ جلب الموديلات من المزود...</p>';
      try {
        const rows = await listModelsForConfig(readAiForm(prefix));
        box.innerHTML = renderModelsTable(rows, prefix);
        showToast(`📋 تم جلب ${rows.length} موديل`);
      } catch (err) {
        box.innerHTML = `<p class="mu">❌ تعذّر جلب الموديلات: ${esc(String(err?.message || err))}</p>`;
      }
    });
  };

  const bindModelRows = (prefix) => {
    const box = document.getElementById(`${prefix}-models`);
    if (!box) return;

    box.addEventListener('click', async (e) => {
      const btn = e.target.closest('[data-action]');
      if (!btn || btn.getAttribute('data-prefix') !== prefix) return;
      const modelId = btn.getAttribute('data-model') || '';
      const action = btn.getAttribute('data-action');

      if (action === 'use-model') {
        const inp = document.getElementById(`${prefix}-model`);
        if (inp) inp.value = modelId;
        showToast(`⬅️ تم اختيار ${modelId}`);
        return;
      }

      if (action === 'test-model') {
        const row = btn.closest('[data-model-row]');
        const statusEl = row?.querySelector('.model-status');
        if (statusEl) {
          statusEl.textContent = '⏳';
          statusEl.className = 'chip model-status';
        }
        try {
          const res = await testModelForConfig(readAiForm(prefix), modelId);
          if (statusEl) {
            statusEl.textContent = `✅ ${res.ms}ms`;
            statusEl.className = 'badge-ok model-status';
          }
        } catch (err) {
          if (statusEl) {
            statusEl.textContent = '❌ لا يعمل';
            statusEl.className = 'badge-warn model-status';
          }
          showToast(`❌ ${modelId}: ${String(err?.message || err).slice(0, 80)}`);
        }
      }
    });

    box.addEventListener('click', async (e) => {
      const btn = e.target.closest(`#${prefix}-test-all`);
      if (!btn) return;
      const rows = [...box.querySelectorAll('[data-model-row]')];
      showToast(`⏳ اختبار ${rows.length} موديل — قد يستغرق دقيقة`);
      for (const row of rows) {
        const modelId = row.getAttribute('data-model-row');
        const statusEl = row.querySelector('.model-status');
        if (statusEl) {
          statusEl.textContent = '⏳';
          statusEl.className = 'chip model-status';
        }
        try {
          const res = await testModelForConfig(readAiForm(prefix), modelId);
          if (statusEl) {
            statusEl.textContent = `✅ ${res.ms}ms`;
            statusEl.className = 'badge-ok model-status';
          }
        } catch {
          if (statusEl) {
            statusEl.textContent = '❌ لا يعمل';
            statusEl.className = 'badge-warn model-status';
          }
        }
      }
      showToast('✅ انتهى اختبار الموديلات');
    });
  };

  bindAiEditor('ai-global', 'global');
  bindAiEditor('ai-family', 'family');
  bindModelRows('ai-global');
  bindModelRows('ai-family');

  document.getElementById('ai-family-select')?.addEventListener('change', async (e) => {
    state.adminActiveTab = 'integrations';
    cachedAdminData = await fetchAdminDashboardData(e.target.value);
    if (cachedAdminData) cachedAdminData.activeTab = 'integrations';
    render();
  });

  // --- Family management (members, PINs, forced update) ---
  const openFamilyManager = async (fid, memberId = null) => {
    state.adminManageFid = fid;
    state.adminActiveTab = 'families';
    cachedAdminData = await fetchAdminDashboardData(fid);
    if (cachedAdminData) {
      cachedAdminData.activeTab = 'families';
      cachedAdminData.manageFid = fid;
    }
    if (memberId) state.adminManageMember = memberId;
    render();
  };

  const refreshManager = async () => {
    const fid = state.adminManageFid;
    if (!fid) return;
    cachedAdminData = await fetchAdminDashboardData(fid);
    if (cachedAdminData) {
      cachedAdminData.activeTab = 'families';
      cachedAdminData.manageFid = fid;
    }
    render();
  };

  document.querySelectorAll('[data-action="manage-family"]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      await openFamilyManager(btn.getAttribute('data-fid'));
    });
  });

  document.querySelectorAll('[data-action="manage-back"]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      state.adminManageFid = null;
      cachedAdminData = await fetchAdminDashboardData();
      render();
    });
  });

  document.querySelectorAll('[data-action="toggle-member-access"]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const fid = btn.getAttribute('data-fid');
      const memberId = btn.getAttribute('data-member-id');
      const isOff = btn.getAttribute('data-off') === 'true';
      try {
        await setMemberAccess(fid, memberId, !isOff);
        showToast(isOff ? '▶️ تم تمكين العضو' : '⏸️ تم إيقاف وصول العضو');
      } catch (err) {
        showToast(`❌ ${err?.message || err}`);
      }
      await refreshManager();
    });
  });

  document.querySelectorAll('[data-action="set-member-pin"]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const fid = btn.getAttribute('data-fid');
      const name = btn.getAttribute('data-name');
      const pin = await askForPin(`أدخل الرقم السري الجديد للعضو «${name}» (4 خانات فأكثر):`);
      if (!pin) return;
      try {
        await setMemberPin(fid, name, pin);
        showToast('🔑 تم تعيين الرقم السري — يُفعَّل عند أول دخول للعضو');
      } catch (err) {
        showToast(`❌ ${err?.message || err}`);
      }
      await refreshManager();
    });
  });

  document.getElementById('add-family-member-btn')?.addEventListener('click', async () => {
    const fid = document.getElementById('add-family-member-btn')?.getAttribute('data-fid');
    const name = document.getElementById('new-member-name')?.value?.trim() || '';
    const role = document.getElementById('new-member-role')?.value || 'member';
    const pin = document.getElementById('new-member-pin')?.value?.trim() || '';
    if (!name || !pin) {
      showToast('⚠️ أدخل اسم العضو والرقم السري');
      return;
    }
    try {
      const res = await addFamilyMemberByStaff({ fid, name, role, pin });
      showToast(`✅ تمت إضافة ${name} — البريد: ${res.email}`);
    } catch (err) {
      showToast(`❌ ${err?.message || err}`);
    }
    await refreshManager();
  });

  document.querySelectorAll('[data-action="member-role"]').forEach((sel) => {
    sel.addEventListener('change', async () => {
      const fid = sel.getAttribute('data-fid');
      const memberId = sel.getAttribute('data-member-id');
      try {
        await setMemberRole(fid, memberId, sel.value);
        showToast('✅ تم تحديث الصلاحية');
      } catch (err) {
        showToast(`❌ ${err?.message || err}`);
      }
      await refreshManager();
    });
  });

  document.querySelectorAll('[data-action="force-update"]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const fid = btn.getAttribute('data-fid');
      try {
        await forceFamilyUpdate(fid);
        showToast('🔄 سيُطلب من تطبيق العائلة التحديث عند أول فتح');
      } catch (err) {
        showToast(`❌ ${err?.message || err}`);
      }
    });
  });

}

/**
 * Add multiple candidate shopping items only when not already active in the cart.
 */
async function addBatchIfMissing(entries, alreadyMsg) {
  const activeNames = new Set(
    Object.values(state.localSnapshot?.items || {})
      .filter((i) => i && !i._deleted)
      .map((i) => String(i.n || '').trim().toLowerCase())
  );
  const toAdd = (entries || []).filter(
    (entry) => entry?.n && !activeNames.has(String(entry.n).trim().toLowerCase())
  );
  if (toAdd.length === 0) {
    showToast(alreadyMsg || '✅ كل العناصر موجودة بالفعل في السلة');
    return 0;
  }
  for (const entry of toAdd) {
    await addNewShoppingItem({
      n: entry.n,
      c: entry.c || 'super',
      q: entry.q || '1',
      p: Number(entry.p) || 0,
      u: Boolean(entry.u),
    });
  }
  await refreshSnapshot();
  showToast(`✅ تمت إضافة ${toAdd.length} عنصر للسلة`);
  render();
  return toAdd.length;
}

/**
 * Increment or decrement the leading numeric quantity of an active cart item.
 */
async function stepCartItemQty(itemId, delta) {
  const item = state.localSnapshot?.items?.[itemId];
  if (!item || item._deleted) return;
  const rawQ = String(item.q || '1').trim();
  const match = rawQ.match(/^(\d+(?:\.\d+)?)\s*(.*)$/);
  const curNum = match ? Number(match[1]) || 1 : 1;
  if (curNum <= 1 && delta < 0) {
    showToast('ℹ️ أقل كمية هي 1 (لحذف الغرض استخدم زر 🗑️)');
    return;
  }
  const unit = match && match[2] ? ` ${match[2]}` : '';
  const nextNum = Math.max(1, Math.round((curNum + delta) * 10) / 10);
  await persistEntity('items', itemId, {
    ...item,
    q: `${nextNum}${unit}`,
  });
  await refreshSnapshot();
  render();
}

/**
 * Bind interactive UI handlers for the integrated Stitch screens (Hub, Store/In-Store, Rewards, Maintenance).
 */
function bindStitchEvents() {
  const root = document.getElementById('view-root') || document;

  root.querySelectorAll('[data-goto-tab]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const targetTab = btn.dataset.gotoTab;
      if (!targetTab) return;
      state.tab = targetTab;
      render();
    });
  });

  document.getElementById('hub-cycle-meal-btn')?.addEventListener('click', () => {
    state.mealIndex = ((Number(state.mealIndex) || 0) + 1) % SUGGESTED_FAMILY_MEALS.length;
    render();
  });

  document.getElementById('hub-add-meal-items-btn')?.addEventListener('click', async () => {
    const mealIdx = Math.abs(Number(state.mealIndex) || 0) % SUGGESTED_FAMILY_MEALS.length;
    const meal = SUGGESTED_FAMILY_MEALS[mealIdx];
    await addBatchIfMissing(meal?.ingredients || [], '✅ كل مقادير هذه الوجبة موجودة بالسلة');
  });

  document.getElementById('add-pantry-essentials-btn')?.addEventListener('click', async () => {
    await addBatchIfMissing(
      [
        { n: 'حليب كامل الدسم', c: 'super', q: '2 عبوة', p: 7, u: true },
        { n: 'خبز طازج', c: 'bakery', q: '4 أكياس', p: 3 },
        { n: 'زيت زيتون بكر', c: 'super', q: '1 لتر', p: 24 },
      ],
      '✅ أساسيات المؤونة موجودة بالفعل في السلة'
    );
  });

  document.getElementById('store-voice-btn')?.addEventListener('click', () => {
    const SpeechRec = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRec) {
      showToast('🎤 البحث الصوتي غير مدعوم في هذا المتصفح، استخدم مربع البحث اليدوي');
      document.getElementById('store-search-inp')?.focus();
      return;
    }
    try {
      const rec = new SpeechRec();
      rec.lang = 'ar-SA';
      rec.interimResults = false;
      rec.maxAlternatives = 1;
      showToast('🎤 تحدّث الآن باسم الغرض...');
      rec.onresult = (evt) => {
        const transcript = evt?.results?.[0]?.[0]?.transcript?.trim() || '';
        const inp = document.getElementById('store-search-inp');
        if (inp && transcript) {
          inp.value = transcript;
          applyStoreSearchFilterInDom(transcript);
          showToast(`🔎 تم البحث عن: ${transcript}`);
        }
      };
      rec.onerror = () => showToast('⚠️ تعذر التقاط الصوت، حاول مرة أخرى');
      rec.start();
    } catch {
      showToast('⚠️ تعذر تشغيل الميكروفون');
    }
  });

  root.querySelectorAll('[data-cart-step-inc]').forEach((btn) => {
    btn.addEventListener('click', () => stepCartItemQty(btn.dataset.cartStepInc, 1));
  });
  root.querySelectorAll('[data-cart-step-dec]').forEach((btn) => {
    btn.addEventListener('click', () => stepCartItemQty(btn.dataset.cartStepDec, -1));
  });

  document.getElementById('instore-contrast-btn')?.addEventListener('click', () => {
    state.instoreHighContrast = !state.instoreHighContrast;
    render();
  });

  document.getElementById('finish-shopping-trip-btn')?.addEventListener('click', async () => {
    const activeItems = Object.values(state.localSnapshot?.items || {}).filter(
      (i) => i && !i._deleted
    );
    const doneItems = activeItems.filter((i) => i.dn);
    const paidTotal = doneItems.reduce((sum, i) => sum + (Number(i.p) || 0), 0);
    await recordActivityLog('فاتورة تسوق', `${paidTotal} د.ل`);
    const lines = [
      `🛒 ملخص رحلة التسوق — ${state.localSnapshot?.meta?.name || 'عائلتي'}`,
      `✅ العناصر المنجزة: ${doneItems.length} / ${activeItems.length}`,
      `💰 الإجمالي المدفوع: ${paidTotal} د.ل`,
      ...doneItems
        .slice(0, 15)
        .map((i) => `• ${i.n}${i.q ? ` (${i.q})` : ''}${Number(i.p) ? ` — ${i.p} د.ل` : ''}`),
    ];
    try {
      navigator.clipboard?.writeText?.(lines.join('\n'))?.catch?.(() => {});
    } catch {
      // Clipboard API may be unavailable in restricted contexts.
    }
    await refreshSnapshot();
    showToast(`✅ تم حفظ فاتورة التسوق (${paidTotal} د.ل)`);
    render();
  });

  root.querySelectorAll('[data-redeem-reward]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const reward = DEFAULT_FAMILY_REWARDS.find((r) => r.id === btn.dataset.redeemReward);
      if (!reward) return;
      await ensureMembersSeeded();
      await refreshSnapshot();
      const members = getEffectiveMembersList(state.localSnapshot || {});
      const member =
        members.find(
          (m) => m.id === state.activeMemberId || (state.uid && m.uid === state.uid)
        ) ||
        members.find((m) => m.role === 'child' || m.role === 'kid') ||
        members[0];
      if (!member) return;
      const curPoints = Number(member.points) || 0;
      if (curPoints < reward.cost) {
        const missing = reward.cost - curPoints;
        showToast(`⭐ يلزم ${missing} نجمة إضافية لـ ${member.name} لفتح «${reward.title}»`);
        return;
      }
      const updated = { ...member, points: curPoints - reward.cost };
      await persistEntity('members', member.id, updated);
      await recordActivityLog(
        'استبدال مكافأة',
        `${member.name}: ${reward.title} (-${reward.cost} ⭐)`
      );
      await refreshSnapshot();
      render();
      showUndoSnackbar(`🎉 تم استبدال «${reward.title}» لـ ${member.name}`, async () => {
        await persistEntity('members', member.id, { ...updated, points: curPoints });
        await refreshSnapshot();
        render();
      });
    });
  });

  root.querySelectorAll('[data-maint-filter]').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.maintFilter = btn.dataset.maintFilter || 'all';
      render();
    });
  });

  root.querySelectorAll('[data-maint-add-item]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const n = btn.dataset.maintAddItem;
      if (!n) return;
      await addNewShoppingItem({
        n,
        c: btn.dataset.maintCat || 'appliances',
        q: btn.dataset.maintQty || '1',
        p: Number(btn.dataset.maintPrice) || 0,
        u: true,
      });
      await refreshSnapshot();
      showToast(`🔧 تمت إضافة «${n}» للسلة`);
      render();
    });
  });

  root.querySelectorAll('[data-maint-done]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const id = btn.dataset.maintDone;
      if (!id) return;
      const nextDone = !state.maintStatus?.[id];
      state.maintStatus = { ...(state.maintStatus || {}), [id]: nextDone };
      if (nextDone) {
        const maintItem = DEFAULT_MAINTENANCE_ITEMS.find((m) => m.id === id);
        await recordActivityLog('صيانة دورية', maintItem?.title || id);
        await refreshSnapshot();
        showToast(`✅ تم تسجيل إنجاز «${maintItem?.title || 'الصيانة'}»`);
      } else {
        showToast('↩️ تم إعادة فتح تذكير الصيانة');
      }
      render();
    });
  });

  document.getElementById('add-all-maint-items-btn')?.addEventListener('click', async () => {
    const bundle = DEFAULT_MAINTENANCE_ITEMS.slice(0, 3).map((it) => ({
      n: it.supplyName,
      c: it.supplyCategory,
      q: it.supplyQty,
      p: it.supplyPrice,
      u: true,
    }));
    await addBatchIfMissing(bundle, '✅ كل مستلزمات الصيانة موجودة بالفعل في السلة');
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
        const versionEl = document.getElementById('sw-version');
        if (versionEl) versionEl.textContent = `v${APP_VERSION}`;
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

      // Check for SW updates every hour (in addition to browser's own checks).
      // The bump-version script guarantees a fresh CACHE_VERSION on every release,
      // so this poll reliably picks up new releases without manual cache busting.
      setInterval(() => {
        reg.update().catch(() => {});
      }, 60 * 60 * 1000);
    })
    .catch(() => {
      // Service worker unavailable in restricted contexts
    });

  const hadController = Boolean(navigator.serviceWorker.controller);
  let refreshing = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    const swEl = document.getElementById('sw-status');
    if (swEl) {
      swEl.textContent = 'مفعّل وجاهز دون نت';
    }
    if (hadController && !refreshing) {
      refreshing = true;
      window.location.reload();
    }
  });

  document.getElementById('sw-reload')?.addEventListener('click', () => {
    const waiting = state.swRegistration?.waiting;
    if (waiting) {
      // Ask the waiting SW to take over immediately.
      waiting.postMessage({ type: 'SKIP_WAITING' });
      // Safety net: if the waiting worker never claims (edge case), reload anyway
      // after a short delay so the user is never stuck on a stale banner.
      setTimeout(() => window.location.reload(), 2500);
    } else {
      window.location.reload();
    }
  });
}

async function init() {
  state.roomId = DEFAULT_ROOM_ID;
  state.isDeveloperPortal = detectDeveloperPortalMode();
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

  document.getElementById('logout-btn')?.addEventListener('click', async () => {
    state.session.loggedIn = false;
    state.session.isDeveloper = false;
    state.loginMode = 'login';
    state.pendingVerification = null;
    await saveSessionState();
    render();
  });

  try {
    const savedRoomId = await localStore.getPref('activeRoomId', null);
    if (typeof savedRoomId === 'string' && savedRoomId.trim()) {
      state.roomId = savedRoomId.trim();
    }
    const savedSession = await localStore.getPref('activeSession', null);
    if (savedSession && typeof savedSession === 'object') {
      state.session = {
        loggedIn: Boolean(savedSession.loggedIn),
        memberId: savedSession.memberId || 'mem_father',
        isDeveloper: Boolean(savedSession.isDeveloper),
        fid: savedSession.fid || '',
        familyName: savedSession.familyName || '',
        memberName: savedSession.memberName || '',
        role: savedSession.role || 'member',
        uid: savedSession.uid || '',
      };
      if (typeof savedSession.roomId === 'string' && savedSession.roomId.trim()) {
        state.roomId = savedSession.roomId.trim();
      }
    }
    if (state.session?.loggedIn && !state.session.isDeveloper && !state.isDeveloperPortal) {
      const allowed = await verifySessionStillAllowed(state.session);
      if (!allowed) {
        state.session = { loggedIn: false, memberId: 'mem_father', fid: '' };
        await localStore.setPref('activeSession', { loggedIn: false });
      }
    }

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
        currentRole: ['developer', 'admin', 'mother', 'member', 'child'].includes(
          savedTheme.currentRole
        )
          ? savedTheme.currentRole
          : 'admin',
        memberName:
          typeof savedTheme.memberName === 'string' && savedTheme.memberName.trim()
            ? savedTheme.memberName.trim()
            : 'الأب',
        collapsedCats: Array.isArray(savedTheme.collapsedCats) ? savedTheme.collapsedCats : [],
        aisleOrder: Array.isArray(savedTheme.aisleOrder) ? savedTheme.aisleOrder : [],
        weeklyTemplate: Array.isArray(savedTheme.weeklyTemplate) ? savedTheme.weeklyTemplate : [],
        customCatalog: Array.isArray(savedTheme.customCatalog) ? savedTheme.customCatalog : [],
        familyRegistry:
          Array.isArray(savedTheme.familyRegistry) && savedTheme.familyRegistry.length > 0
            ? savedTheme.familyRegistry
            : [state.roomId],
        familyNamesByRoom:
          savedTheme.familyNamesByRoom && typeof savedTheme.familyNamesByRoom === 'object'
            ? savedTheme.familyNamesByRoom
            : {},
        personalCatOrder:
          savedTheme.personalCatOrder && typeof savedTheme.personalCatOrder === 'object'
            ? savedTheme.personalCatOrder
            : {},
        personalPrefsByMember:
          savedTheme.personalPrefsByMember && typeof savedTheme.personalPrefsByMember === 'object'
            ? savedTheme.personalPrefsByMember
            : {},
      };
    }
    if (state.isDeveloperPortal) {
      const staffSession = await localStore.getPref('activeStaffSession', null);
      // The dev portal shares one Firebase Auth session with the family portal.
      // A family member may still be signed in while a stale local staff session
      // exists — in that case cloud reads are denied by the rules (the auth uid
      // is not staff). Only trust the staff session when it matches the LIVE
      // Firebase Auth user; otherwise require a fresh staff login.
      const liveUid = await getActiveAuthUid();
      const staffMatchesLive = Boolean(
        staffSession && staffSession.loggedIn && staffSession.isDeveloper &&
        staffSession.uid && liveUid && staffSession.uid === liveUid
      );
      if (staffMatchesLive) {
        state.session = staffSession;
        try {
          cachedAdminData = await fetchAdminDashboardData();
        } catch {
          // offline or emulator loading
        }
      } else {
        state.session = { loggedIn: false };
        // Drop the stale staff marker so the login screen is shown.
        try {
          await localStore.setPref('activeStaffSession', null);
        } catch {
          // ignore storage issues
        }
        // Complete a Google sign-in that was initiated via signInWithRedirect.
        // This runs once after the redirect back from Google.
        try {
          const redirectSession = await finalizeStaffGoogleSignIn();
          if (redirectSession && redirectSession.loggedIn) {
            state.session = redirectSession;
            try {
              cachedAdminData = await fetchAdminDashboardData();
            } catch {
              // offline or emulator loading
            }
          }
        } catch {
          // no pending redirect result — ignore
        }
      }
    } else if (!state.isDeveloperPortal && state.session.isDeveloper) {
      state.session.loggedIn = false;
    }
    if (state.session.loggedIn) {
      applyMemberPersonalTheme(state.session.memberId);
    }
    const pinRec = await localStore.getPref('pinLock', null);
    pinLockEnabled = Boolean(pinRec?.enabled);
    state.aiUsageCount = await getDailyAiUsage(state.session.memberId || 'local', localStore);
  } catch {
    // Keep default theme when storage is restricted
  }

  await refreshSnapshot();
  // Restore the owner-managed AI configuration for the signed-in family.
  if (state.session?.loggedIn && !state.isDeveloperPortal) {
    try {
      await loadEffectiveAiConfig(state.session.fid || state.roomId);
    } catch {
      // keep local mode
    }
    void checkForcedUpdate(state.session.fid || state.roomId);
  }
  handleLaunchIntents();
  registerServiceWorker();
  render();
}

init();
