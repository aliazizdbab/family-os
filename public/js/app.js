import {
  DEFAULT_ACCENT,
  DEFAULT_FAMILY_MEMBERS,
  SCHEMA_VERSION,
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
  getEffectiveMembersList,
  getRoleShortLabel,
  renderLoginScreenView,
  renderUnifiedSettingsView,
} from './ui/settings.js';
import {
  buildMergedStoreCatalog,
  renderStoreModeView,
  sortCategoriesByAisle,
} from './ui/store-mode.js';
import { renderTasksView } from './ui/tasks.js';
import { renderChatView } from './ui/chat.js';
import {
  DAILY_AI_LIMIT,
  callAiProvider,
  getActiveAiProvider,
  getDailyAiUsage,
  getEditedAiProvider,
  getOrInitAiConfig,
  incrementDailyAiUsage,
  isAiProviderReady,
  setRuntimeAiConfig,
} from './ai.js';
import {
  CONFIRM_REQUIRED_AI_ACTIONS,
  buildAiSystemPrompt,
  describePendingAiAction,
  parseAiEnvelope,
  runLocalSmartAssistant,
} from './ai-actions.js';
import { scanProviderModels } from './models-scan.js';

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
  if (metaTheme) metaTheme.content = state.prefs.accent || DEFAULT_ACCENT;
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
  if (famBadge) famBadge.textContent = `🏠 ${state.roomId}`;
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

async function registerFamilyCode(famCode) {
  const clean = String(famCode || '').trim();
  if (!clean) return;
  const existing = Array.isArray(state.prefs.familyRegistry) ? state.prefs.familyRegistry : [];
  if (!existing.includes(clean)) {
    state.prefs.familyRegistry = [...existing, clean];
    await localStore.setPref('theme', state.prefs);
  }
}

async function switchFamilyRoom(newRoomId) {
  const clean = String(newRoomId || '').trim() || DEFAULT_ROOM_ID;
  if (activeSyncEngine) {
    activeSyncEngine.stop();
    activeSyncEngine = null;
  }
  state.roomId = clean;
  state.lastPlan = null;
  await registerFamilyCode(clean);
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
  const snap = state.localSnapshot;
  const catsCount = getSortedActiveCategories(snap?.cats).length;
  const itemsCount = getActiveItemsList(snap?.items).length;
  const membersCount = getEffectiveMembersList(snap).length;
  const budget = snap?.budget?.monthly ?? 250;

  return `
    <section class="sec stack">
      <div class="row">
        <h2>🛒 السلة — رفيق الطلبات وإنجاز المهام</h2>
        <span class="badge-ok">الإصدار v${SCHEMA_VERSION}</span>
      </div>
      <div class="chips">
        <span class="chip">🗂️ الأقسام: ${catsCount}</span>
        <span class="chip">🛒 الأغراض المحلية: ${itemsCount}</span>
        <span class="chip">👥 الأعضاء: ${membersCount}</span>
        <span class="chip">💰 الميزانية: ${budget} د.ل</span>
        <span class="chip">📤 بالانتظار: ${state.syncStatus.pendingCount}</span>
      </div>
    </section>

    ${renderShoppingListView(state)}
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

  if (!state.session.loggedIn) {
    root.innerHTML = renderLoginScreenView(state);
    bindViewEvents();
    return;
  }

  if (state.tab === 'home') root.innerHTML = renderHomeTab();
  else if (state.tab === 'store') root.innerHTML = renderStoreModeView(state);
  else if (state.tab === 'tasks') root.innerHTML = renderTasksView(state);
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
    if (['home', 'store', 'tasks', 'ai', 'import', 'prefs'].includes(args.tab)) {
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
  document.getElementById('ai-goto-settings-btn')?.addEventListener('click', () => {
    state.tab = 'prefs';
    render();
  });

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

  document.querySelectorAll('[data-ai-prov-select]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const cfg = getOrInitAiConfig();
      cfg.ed = btn.getAttribute('data-ai-prov-select') || cfg.on;
      setRuntimeAiConfig(cfg);
      render();
    });
  });

  const readAiForm = () => ({
    name: document.getElementById('ai-prov-name')?.value?.trim() || 'مزود',
    type: document.getElementById('ai-prov-type')?.value || 'gemini',
    url: document.getElementById('ai-prov-url')?.value?.trim().replace(/\/+$/, '') || '',
    model: document.getElementById('ai-prov-model')?.value?.trim() || '',
    key: document.getElementById('ai-prov-key')?.value?.trim() || '',
  });

  document.getElementById('ai-save-prov-btn')?.addEventListener('click', () => {
    const cfg = getOrInitAiConfig();
    const prov = getEditedAiProvider(cfg);
    if (!prov) return;
    Object.assign(prov, readAiForm());
    cfg.on = prov.id;
    cfg.ed = prov.id;
    setRuntimeAiConfig(cfg);
    state.aiTestOutput = `✅ تم حفظ وتفعيل «${prov.name}» للجلسة الحالية.`;
    showToast(`🤖 تم تفعيل ${prov.name}`);
    render();
  });

  document.getElementById('ai-test-prov-btn')?.addEventListener('click', async () => {
    const formProv = readAiForm();
    state.aiTestOutput = '⏳ جارٍ اختبار الاتصال...';
    render();
    const startedAt = Date.now();
    try {
      const reply = await callAiProvider(
        formProv,
        'Reply with the single word OK.',
        [{ role: 'user', content: 'ping' }],
        { maxTokens: 20, timeoutMs: 12000 }
      );
      state.aiTestOutput = `✅ نجح الاتصال (${Date.now() - startedAt}ms): ${reply.trim().slice(0, 60)}`;
    } catch (err) {
      state.aiTestOutput = `❌ فشل الاختبار: ${err?.message || 'خطأ غير معروف'}`;
    }
    render();
  });

  document.getElementById('ai-scan-models-btn')?.addEventListener('click', async () => {
    const cfg = getOrInitAiConfig();
    const prov = getEditedAiProvider(cfg);
    const formProv = { ...prov, ...readAiForm() };
    state.aiTestOutput = '⏳ جارٍ فحص وجلب الموديلات المتاحة...';
    render();
    try {
      const scanned = await scanProviderModels(formProv, { probeWorking: true });
      if (prov) {
        prov.models = scanned.models;
        if (scanned.recommendedModel) prov.model = scanned.recommendedModel;
        setRuntimeAiConfig(cfg);
      }
      state.aiTestOutput =
        scanned.models.length > 0
          ? `✅ عُثر على ${scanned.models.length} موديل (الموصى به: ${scanned.recommendedModel})`
          : '⚠️ لم يتم العثور على موديلات مطابقة.';
    } catch (err) {
      state.aiTestOutput = `❌ تعذّر الفحص: ${err?.message || 'خطأ غير معروف'}`;
    }
    render();
  });
}

function bindViewEvents() {
  // --- Login & Multi-Family Isolation Events ---
  document.getElementById('switch-family-code-btn')?.addEventListener('click', async () => {
    const code = document.getElementById('login-family-code')?.value?.trim();
    if (!code) {
      showToast('⚠️ أدخل كود العائلة أولاً');
      return;
    }
    await switchFamilyRoom(code);
    showToast(`🏠 تم تحميل بيانات عائلة: ${code}`);
    render();
  });

  document.querySelectorAll('[data-pick-family]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const code = btn.getAttribute('data-pick-family');
      if (!code) return;
      await switchFamilyRoom(code);
      render();
    });
  });

  document.querySelectorAll('[data-login-member]').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.loginSelectedMemberId = btn.getAttribute('data-login-member') || 'mem_father';
      render();
    });
  });

  document.getElementById('login-submit-btn')?.addEventListener('click', async () => {
    const famInput = document.getElementById('login-family-code')?.value?.trim();
    if (famInput && famInput !== state.roomId) {
      await switchFamilyRoom(famInput);
    } else {
      await registerFamilyCode(state.roomId);
    }
    const members = getEffectiveMembersList(state.localSnapshot);
    const chosen = members.find((m) => m.id === state.loginSelectedMemberId) || members[0];
    if (!chosen) return;
    const enteredPin = document.getElementById('login-pin-inp')?.value?.trim() || '';
    const expectedPin = String(chosen.accessCode || '0000').trim();
    if (enteredPin !== expectedPin) {
      showToast('❌ الرقم السري غير صحيح لهذا الحساب');
      return;
    }
    state.session = {
      loggedIn: true,
      memberId: chosen.id,
      isDeveloper: chosen.role === 'developer',
    };
    state.prefs.currentRole = chosen.role || 'member';
    state.prefs.memberName = chosen.name || 'عضو';
    applyMemberPersonalTheme(chosen.id);
    await localStore.setPref('theme', state.prefs);
    await saveSessionState();
    await recordActivityLog('تسجيل دخول', chosen.name);
    state.tab = 'home';
    showToast(`🔓 أهلاً بك ${chosen.name}`);
    render();
  });

  document.getElementById('login-dev-btn')?.addEventListener('click', async () => {
    const devPin = document.getElementById('login-dev-pin')?.value?.trim() || '';
    if (devPin !== '9999') {
      showToast('❌ الرمز السري للمبرمج غير صحيح');
      return;
    }
    await registerFamilyCode(state.roomId);
    state.session = {
      loggedIn: true,
      memberId: 'dev_support',
      isDeveloper: true,
    };
    state.prefs.currentRole = 'developer';
    state.prefs.memberName = 'المبرمج (الدعم الفني)';
    applyMemberPersonalTheme('dev_support');
    await localStore.setPref('theme', state.prefs);
    await saveSessionState();
    await recordActivityLog('دخول دعم فني', 'بوابة المبرمج');
    state.tab = 'prefs';
    showToast('👨‍💻 تم الدخول إلى بوابة المبرمج الشاملة');
    render();
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

  bindAiEvents();
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

  document.getElementById('logout-btn')?.addEventListener('click', async () => {
    state.session.loggedIn = false;
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
      };
      if (typeof savedSession.roomId === 'string' && savedSession.roomId.trim()) {
        state.roomId = savedSession.roomId.trim();
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
  handleLaunchIntents();
  registerServiceWorker();
  render();
}

init();
