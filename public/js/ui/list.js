import { esc } from './dialogs.js';

const DEFAULT_FREQUENT_ITEMS = Object.freeze([
  { itemName: 'حليب', c: 'super', p: 8, q: '2', count: 5 },
  { itemName: 'خبز', c: 'bakery', p: 3, q: '4', count: 5 },
  { itemName: 'بيض', c: 'super', p: 15, q: 'طبق', count: 4 },
  { itemName: 'طماطم', c: 'produce', p: 6, q: '2 كجم', count: 3 },
  { itemName: 'أرز', c: 'super', p: 25, q: '5 كجم', count: 3 },
]);

export function renderSampleItemRow(item) {
  return `
    <div class="list-item">
      <span class="${item.dn ? 'done-text' : ''}">${esc(item.n)} ${item.q ? `(${esc(item.q)})` : ''}</span>
      <span class="mu">${item.p ? `${item.p} د.ل` : '—'}</span>
    </div>`;
}

export function getSortedActiveCategories(catsMap = {}) {
  return Object.entries(catsMap || {})
    .map(([id, cat]) => ({ ...cat, id }))
    .filter((c) => !c.deleted)
    .sort((a, b) => (Number(a.order) || 0) - (Number(b.order) || 0));
}

export function getActiveItemsList(itemsMap = {}) {
  return Object.entries(itemsMap || {})
    .map(([id, it]) => ({ ...it, id }))
    .filter((it) => !it.deleted);
}

export function computeBudgetSummary(itemsList = [], budgetObj = { monthly: 250, perCat: {} }) {
  const active = Array.isArray(itemsList) ? itemsList.filter((i) => !i.deleted) : [];
  const estTotal = active.reduce((sum, i) => sum + (Number(i.p) || 0), 0);
  const paidTotal = active.filter((i) => i.dn).reduce((sum, i) => sum + (Number(i.p) || 0), 0);
  const doneCount = active.filter((i) => i.dn).length;
  const totalCount = active.length;
  const completionPct = totalCount > 0 ? Math.round((doneCount / totalCount) * 100) : 0;

  const budgetMonthly = Math.max(0, Number(budgetObj?.monthly) || 0);
  const remainingBudget = budgetMonthly - estTotal;
  const budgetRatio = budgetMonthly > 0 ? estTotal / budgetMonthly : 0;

  let status = 'ok';
  if (budgetMonthly > 0 && estTotal > budgetMonthly) {
    status = 'over';
  } else if (budgetMonthly > 0 && budgetRatio >= 0.85) {
    status = 'near';
  }

  const perCatTotals = {};
  for (const item of active) {
    perCatTotals[item.c] = (perCatTotals[item.c] || 0) + (Number(item.p) || 0);
  }

  const perCatWarnings = {};
  const perCatLimits = budgetObj?.perCat || {};
  for (const [cid, limitVal] of Object.entries(perCatLimits)) {
    const limit = Number(limitVal) || 0;
    if (limit <= 0) continue;
    const spent = perCatTotals[cid] || 0;
    if (spent > limit) {
      perCatWarnings[cid] = { status: 'over', spent, limit };
    } else if (spent >= limit * 0.85) {
      perCatWarnings[cid] = { status: 'near', spent, limit };
    } else {
      perCatWarnings[cid] = { status: 'ok', spent, limit };
    }
  }

  return {
    estTotal,
    paidTotal,
    doneCount,
    totalCount,
    completionPct,
    budgetMonthly,
    remainingBudget,
    budgetPct: Math.min(100, Math.round(budgetRatio * 100)),
    status,
    perCatTotals,
    perCatWarnings,
  };
}

export function extractHistorySuggestions(historyMap = {}, itemsMap = {}) {
  const byName = new Map();

  for (const h of Object.values(historyMap || {})) {
    if (!h || !h.itemName) continue;
    const key = String(h.itemName).trim();
    if (!key) continue;
    const prev = byName.get(key) || { itemName: key, c: h.c || 'super', p: 0, q: '', count: 0 };
    prev.count += 1;
    if (Number(h.p) > 0) prev.p = Number(h.p);
    if (h.q) prev.q = h.q;
    if (h.c) prev.c = h.c;
    byName.set(key, prev);
  }

  for (const it of Object.values(itemsMap || {})) {
    if (!it || it.deleted || !it.n) continue;
    const key = String(it.n).trim();
    if (!key) continue;
    const prev = byName.get(key) || { itemName: key, c: it.c || 'super', p: 0, q: '', count: 0 };
    prev.count += 1;
    if (Number(it.p) > 0) prev.p = Number(it.p);
    if (it.q) prev.q = it.q;
    if (it.c) prev.c = it.c;
    byName.set(key, prev);
  }

  for (const def of DEFAULT_FREQUENT_ITEMS) {
    if (!byName.has(def.itemName)) {
      byName.set(def.itemName, { ...def });
    }
  }

  return Array.from(byName.values()).sort((a, b) => b.count - a.count);
}

export function parseSharedTextCandidates(sharedText, defaultCatId = 'super') {
  const raw = String(sharedText || '').trim();
  if (!raw) return [];
  const parts = raw
    .split(/[\r\n،,;•\-]+/)
    .map((s) => s.replace(/^[0-9٠-٩]+[.)\s-]+/, '').trim())
    .filter((s) => s.length >= 2 && s.length <= 60);

  return parts.slice(0, 20).map((name) => ({
    n: name,
    q: '',
    p: 0,
    c: defaultCatId,
  }));
}

export function buildWhatsAppReport(arg1 = [], itemsListArg = [], summaryArg = null) {
  const isOptionsObj = arg1 && !Array.isArray(arg1) && typeof arg1 === 'object';
  const roomName = isOptionsObj ? arg1.roomName || 'العائلة' : 'العائلة';
  const categoriesList = isOptionsObj ? arg1.categoriesList || [] : arg1;
  const itemsList = isOptionsObj ? arg1.itemsList || [] : itemsListArg;
  const summary = isOptionsObj ? arg1.summary || null : summaryArg;

  const lines = [`🛒 *قائمة مقاضي ${roomName}*`];
  for (const cat of categoriesList) {
    const catItems = itemsList.filter((i) => !i.deleted && i.c === cat.id);
    if (catItems.length === 0) continue;
    lines.push(`\n${cat.i} *${cat.n}*`);
    for (const i of catItems) {
      const check = i.dn ? '✅ ' : '⬜ ';
      const qty = i.q ? ` (${i.q})` : '';
      const price = Number(i.p) > 0 ? ` - ${Number(i.p)} د.ل` : '';
      lines.push(`${check}${i.n}${qty}${price}`);
    }
  }
  if (summary) {
    lines.push(`\n💰 الإجمالي: ${summary.estTotal} د.ل · المدفوع: ${summary.paidTotal} د.ل`);
  }
  return lines.join('\n');
}

function renderItemRowHtml(item, cat, currentMemberName, isAdminOrOwner) {
  const id = esc(item.id);
  const claimedByMe = item.cl && item.cl === currentMemberName;
  return `
    <div class="list-item stack" data-item-row="${id}" data-item-name="${esc(String(item.n || '').toLowerCase())}">
      <div class="row">
        <button type="button" class="btn ${item.dn ? '' : 'g'}" data-item-toggle="${id}" aria-label="تبديل إنجاز ${esc(item.n)}">
          ${item.dn ? '✓ منجز' : '⬜'}
        </button>
        <div class="grow">
          <strong class="${item.dn ? 'done-text' : ''}">${esc(item.n)}</strong>
          ${item.u && !item.dn ? '<span class="badge-warn">🔥 ضروري</span>' : ''}
          ${item.deferred && !item.dn ? '<span class="badge-warn">⏳ مؤجّل</span>' : ''}
          ${item.note ? `<span class="chip">📌 ${esc(item.note)}</span>` : ''}
        </div>
        <div class="row">
          ${
            !item.dn
              ? `<button type="button" class="btn g" data-item-claim="${id}">
                  ${claimedByMe ? 'إلغاء ✋' : '✋ سأحضره'}
                </button>`
              : ''
          }
          <button type="button" class="btn g" data-item-edit="${id}" aria-label="تعديل ${esc(item.n)}">✏️</button>
          ${
            isAdminOrOwner
              ? `<button type="button" class="btn r" data-item-delete="${id}" aria-label="حذف ${esc(item.n)}">🗑️</button>`
              : ''
          }
        </div>
      </div>
      <div class="g2">
        <label class="field-box">
          <span class="field-lbl">📦 الكمية / العدد</span>
          <input
            class="input"
            data-inline-q="${id}"
            value="${esc(item.q || '')}"
            placeholder="مثلاً: 2 أو 1 كجم"
            aria-label="كمية ${esc(item.n)}"
          />
        </label>
        <label class="field-box">
          <span class="field-lbl">💰 السعر التقديري (د.ل)</span>
          <input
            class="input"
            type="number"
            inputmode="decimal"
            min="0"
            step="any"
            data-inline-p="${id}"
            value="${Number(item.p) || ''}"
            placeholder="مثلاً: 8"
            aria-label="سعر ${esc(item.n)}"
          />
        </label>
      </div>
      <div class="chips">
        <span class="chip">📝 ${esc(item.byName || item.by || 'العائلة')}</span>
        ${
          item.dn
            ? `<span class="chip">${esc(cat?.i || '')} ${esc(cat?.n || '')}</span><span class="chip">✅ ${esc(item.dnBy || 'تم')}</span>`
            : item.cl
              ? `<span class="chip">✋ سيحضره: ${esc(item.cl)}</span>`
              : ''
        }
      </div>
    </div>`;
}

export function renderShoppingListView(appState) {
  const snap = appState.localSnapshot || {};
  const categories = getSortedActiveCategories(snap.cats || {});
  const allItems = getActiveItemsList(snap.items || {});
  const budgetSummary = computeBudgetSummary(allItems, snap.budget);
  const suggestions = extractHistorySuggestions(snap.history, snap.items);
  const collapsedCats = Array.isArray(appState.prefs.collapsedCats)
    ? appState.prefs.collapsedCats
    : [];

  const filter = appState.listFilter || 'todo';
  const currentRole = appState.prefs.currentRole || 'admin';
  const currentMemberName = appState.prefs.memberName || 'الأب';
  const isAdmin = currentRole === 'admin';
  const isChild = currentRole === 'child';

  const remainingItems = allItems.filter((i) => !i.dn);
  const doneItems = allItems.filter((i) => i.dn);

  const visibleCats = categories.filter((c) =>
    allItems.some(
      (i) => i.c === c.id && (filter === 'done' ? i.dn : filter === 'urg' ? i.u && !i.dn : !i.dn)
    )
  );
  const allCollapsed =
    visibleCats.length > 0 && visibleCats.every((c) => collapsedCats.includes(c.id));

  // Pending child requests
  const pendingRequests = Object.entries(snap.requests || {})
    .map(([id, r]) => ({ ...r, id }))
    .filter((r) => r.status === 'pending');

  const requestsHtml = pendingRequests.length
    ? `
      <section class="card">
        <div class="ch">
          <span>🙋 طلبات الأبناء المعلّقة (${pendingRequests.length})</span>
        </div>
        ${pendingRequests
          .map(
            (r) => `
              <div class="list-item">
                <span><strong>${esc(r.n)}</strong> ${r.q ? `(${esc(r.q)})` : ''}</span>
                ${
                  !isChild
                    ? `<span class="row">
                        <button type="button" class="btn" data-req-approve="${esc(r.id)}">✅ موافقة</button>
                        <button type="button" class="btn r" data-req-reject="${esc(r.id)}">✕ رفض</button>
                      </span>`
                    : '<span class="badge-warn">قيد المراجعة</span>'
                }
              </div>`
          )
          .join('')}
      </section>`
    : '';

  const addPanelHtml = isChild
    ? `
      <section class="sec stack">
        <h3>🙋 إرسال طلب جديد للعائلة (وضع الأبناء)</h3>
        <div class="g2">
          <input id="req-item-n" class="input" placeholder="ماذا تحتاج؟ (مثلاً: عصير)" />
          <input id="req-item-q" class="input" placeholder="الكمية" />
        </div>
        <div class="g2">
          <select id="req-item-c" class="select">
            ${categories.map((c) => `<option value="${esc(c.id)}">${esc(c.i)} ${esc(c.n)}</option>`).join('')}
          </select>
          <button type="button" id="submit-request-btn" class="btn">📨 إرسال الطلب للمسؤول</button>
        </div>
      </section>`
    : `
      <section class="sec stack">
        <div class="row">
          <h3>➕ إضافة غرض للسلة</h3>
          <span class="mu">يُحفظ أي غرض جديد تلقائياً في المتجر</span>
        </div>
        <div class="g2">
          <label class="field-box">
            <span class="field-lbl">🛒 اسم الغرض أو المهمة</span>
            <input id="add-item-n" class="input" list="history-suggestions" placeholder="مثلاً: حليب أو فلتر زيت" autocomplete="off" />
          </label>
          <label class="field-box">
            <span class="field-lbl">📦 الكمية / العدد</span>
            <input id="add-item-q" class="input" placeholder="مثلاً: 2 علبة" />
          </label>
        </div>
        <datalist id="history-suggestions">
          ${suggestions
            .slice(0, 25)
            .map(
              (s) =>
                `<option value="${esc(s.itemName)}">${esc(s.q || '')} ${s.p ? `(${s.p} د.ل)` : ''}</option>`
            )
            .join('')}
        </datalist>
        <div class="g2">
          <label class="field-box">
            <span class="field-lbl">🗂️ القسم</span>
            <select id="add-item-c" class="select">
              ${categories.map((c) => `<option value="${esc(c.id)}">${esc(c.i)} ${esc(c.n)}</option>`).join('')}
            </select>
          </label>
          <label class="field-box">
            <span class="field-lbl">💰 السعر التقديري (د.ل)</span>
            <input id="add-item-p" class="input" type="number" min="0" step="any" placeholder="مثلاً: 8" />
          </label>
        </div>
        <div class="g2">
          <input id="add-item-note" class="input" placeholder="ملاحظة (اختياري)" />
          <label class="row">
            <span>🔥 ضروري</span>
            <input type="checkbox" id="add-item-u" />
          </label>
        </div>
        <button type="button" id="add-item-btn" class="btn full">➕ إضافة للقائمة</button>
        <div class="chips">
          <span class="mu">⚡ الأغراض المتكررة:</span>
          ${suggestions
            .slice(0, 6)
            .map(
              (s) =>
                `<button type="button" class="btn g" data-freq-item="${esc(s.itemName)}" data-freq-cat="${esc(s.c)}" data-freq-price="${Number(s.p) || 0}" data-freq-qty="${esc(s.q || '')}">+ ${esc(s.itemName)}</button>`
            )
            .join('')}
        </div>
        <div class="g2">
          <button type="button" id="save-weekly-tpl-btn" class="btn g">💾 حفظ كـ «مشتريات الأسبوع»</button>
          <button type="button" id="apply-weekly-tpl-btn" class="btn g">🔁 إضافة «مشتريات الأسبوع»</button>
        </div>
      </section>`;

  const categoriesHtml = categories
    .map((cat, idx) => {
      const catAll = allItems.filter((i) => i.c === cat.id);
      const catFiltered = catAll.filter((i) =>
        filter === 'done' ? i.dn : filter === 'urg' ? i.u && !i.dn : !i.dn
      );
      if (catFiltered.length === 0) return '';

      const isCollapsed = collapsedCats.includes(cat.id);
      const catDoneCount = catAll.filter((i) => i.dn).length;
      const catWarn = budgetSummary.perCatWarnings[cat.id];
      const catWarnHtml = catWarn
        ? `<span class="${catWarn.status === 'over' ? 'badge-warn' : catWarn.status === 'near' ? 'badge-warn' : 'badge-ok'}">
            ${catWarn.spent}/${catWarn.limit} د.ل
          </span>`
        : '';

      return `
        <section class="card" data-cat-card="${esc(cat.id)}">
          <div class="ch">
            <button type="button" class="btn g" data-cat-toggle="${esc(cat.id)}">
              ${isCollapsed ? '◀' : '▼'} ${esc(cat.i)} ${esc(cat.n)} (${catDoneCount}/${catAll.length})
            </button>
            <div class="row">
              ${catWarnHtml}
              ${
                isAdmin && filter !== 'done'
                  ? `<button type="button" class="btn g" data-cat-move="${esc(cat.id)}:-1" ${idx === 0 ? 'disabled' : ''} aria-label="تحريك القسم لأعلى">↑</button>
                     <button type="button" class="btn g" data-cat-move="${esc(cat.id)}:1" ${idx === categories.length - 1 ? 'disabled' : ''} aria-label="تحريك القسم لأسفل">↓</button>`
                  : ''
              }
            </div>
          </div>
          ${
            isCollapsed
              ? ''
              : catFiltered
                  .map((item) =>
                    renderItemRowHtml(
                      item,
                      cat,
                      currentMemberName,
                      isAdmin || item.byName === currentMemberName
                    )
                  )
                  .join('')
          }
        </section>`;
    })
    .join('');

  const catLookup = new Map(categories.map((c) => [c.id, c]));
  const doneSectionHtml =
    doneItems.length > 0 && filter !== 'done'
      ? `
        <section class="card" id="completed-items-card">
          <div class="ch">
            <button type="button" id="toggle-done-sec-btn" class="btn g">
              ✅ المنجزة (${doneItems.length}) ${appState.showDone ? '▲' : '▼'}
            </button>
            ${
              isAdmin && appState.showDone
                ? `<button type="button" id="clear-done-btn" class="btn r">🧹 مسح كل المنجزة</button>`
                : ''
            }
          </div>
          ${
            appState.showDone
              ? doneItems
                  .map((item) =>
                    renderItemRowHtml(item, catLookup.get(item.c), currentMemberName, isAdmin)
                  )
                  .join('')
              : ''
          }
        </section>`
      : '';

  return `
    <section class="sec stack">
      <div class="chips">
        <button type="button" class="btn ${filter === 'todo' ? '' : 'g'}" data-list-filter="todo">🛒 المتبقي (${remainingItems.length})</button>
        <button type="button" class="btn ${filter === 'urg' ? '' : 'g'}" data-list-filter="urg">🔥 ضروري</button>
        <button type="button" class="btn ${filter === 'done' ? '' : 'g'}" data-list-filter="done">✅ المنجز (${doneItems.length})</button>
        <button type="button" class="btn g" id="collapse-all-cats-btn">${allCollapsed ? '⏬ فتح الكل' : '⏫ طي الكل'}</button>
      </div>
      <input id="search-items-inp" class="input" value="${esc(appState.searchQuery || '')}" placeholder="🔍 ابحث في القائمة..." />
    </section>

    ${addPanelHtml}
    ${requestsHtml}
    ${
      categoriesHtml ||
      (remainingItems.length === 0 && filter !== 'done'
        ? '<section class="sec"><p class="mu">لا توجد أغراض متبقية 🎉</p></section>'
        : '')
    }
    ${doneSectionHtml}

    <button type="button" id="share-wa-btn" class="btn full">📲 مشاركة التقرير على واتساب</button>
  `;
}
