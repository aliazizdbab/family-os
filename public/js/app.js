import {
  DEFAULT_ACCENT,
  SCHEMA_VERSION,
  createBudget,
  createCategory,
  createEmptyRoomState,
  createHistoryEntry,
  createItem,
  createRequest,
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
  renderCategoriesAndBudgetCard,
  renderFirebaseDiagnosticsCard,
  renderRoomAndAuthCard,
  renderThemeSettingsCard,
} from './ui/settings.js';
import { renderStoreModeView, sortCategoriesByAisle } from './ui/store-mode.js';

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
  const membersCount = Object.keys(snap?.members || {}).length;
  const budget = snap?.budget?.monthly ?? 250;

  return `
    <section class="sec stack">
      <div class="row">
        <h2>🛒 قائمة مقاضي العائلة (Phase 2)</h2>
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
  return `
    ${renderCategoriesAndBudgetCard(state)}
    ${renderThemeSettingsCard(state.prefs, COLORS, pinLockEnabled)}
  `;
}

function render() {
  applyTheme();
  updateNetworkStatus();
  updateHeaderTotals();
  document.querySelectorAll('.nav button').forEach((btn) => {
    btn.classList.toggle('on', btn.dataset.tab === state.tab);
  });

  const root = document.getElementById('view-root');
  if (!root) return;

  if (state.tab === 'home') root.innerHTML = renderHomeTab();
  else if (state.tab === 'store') root.innerHTML = renderStoreModeView(state);
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
  bindViewEvents();
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
  return item;
}

function bindViewEvents() {
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

  // --- Phase 2: Store Mode Events ---
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

  // --- Phase 2: Categories & Budget & Role Manager Events ---
  document.getElementById('save-role-btn')?.addEventListener('click', async () => {
    const memberName = document.getElementById('member-name-inp')?.value?.trim() || 'الأب';
    const role = document.getElementById('role-select')?.value || 'admin';
    state.prefs.memberName = memberName;
    state.prefs.currentRole = role;
    await localStore.setPref('theme', state.prefs);
    showToast(`👤 تم التبديل إلى: ${memberName} (${role})`);
    render();
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
    for (const col of ['cats', 'members', 'items', 'requests', 'history', 'log']) {
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
        currentRole: ['admin', 'member', 'child'].includes(savedTheme.currentRole)
          ? savedTheme.currentRole
          : 'admin',
        memberName:
          typeof savedTheme.memberName === 'string' && savedTheme.memberName.trim()
            ? savedTheme.memberName.trim()
            : 'الأب',
        collapsedCats: Array.isArray(savedTheme.collapsedCats) ? savedTheme.collapsedCats : [],
        aisleOrder: Array.isArray(savedTheme.aisleOrder) ? savedTheme.aisleOrder : [],
        weeklyTemplate: Array.isArray(savedTheme.weeklyTemplate) ? savedTheme.weeklyTemplate : [],
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
