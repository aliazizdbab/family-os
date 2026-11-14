import { esc } from './dialogs.js';

export function sortCategoriesByAisle(categoriesMap = {}, aisleOrder = []) {
  const activeCats = Object.entries(categoriesMap)
    .map(([id, cat]) => ({ ...cat, id }))
    .filter((c) => !c.deleted);

  const orderIndex = new Map(
    (Array.isArray(aisleOrder) ? aisleOrder : []).map((id, idx) => [id, idx])
  );

  return activeCats.sort((a, b) => {
    const ai = orderIndex.has(a.id) ? orderIndex.get(a.id) : 1000 + (Number(a.order) || 0);
    const bi = orderIndex.has(b.id) ? orderIndex.get(b.id) : 1000 + (Number(b.order) || 0);
    if (ai !== bi) return ai - bi;
    return String(a.id).localeCompare(String(b.id));
  });
}

export function renderStoreModeView(appState) {
  const snap = appState.localSnapshot || {};
  const cats = sortCategoriesByAisle(snap.cats || {}, appState.prefs.aisleOrder || []);
  const allItems = Object.entries(snap.items || {})
    .map(([id, it]) => ({ ...it, id }))
    .filter((it) => !it.deleted);

  const remaining = allItems.filter((i) => !i.dn && !i.deferred);
  const deferred = allItems.filter((i) => !i.dn && i.deferred);
  const doneItems = allItems.filter((i) => i.dn);

  const paidTotal = doneItems.reduce((sum, i) => sum + (Number(i.p) || 0), 0);
  const estTotal = allItems.reduce((sum, i) => sum + (Number(i.p) || 0), 0);
  const budgetMonthly = Number(snap.budget?.monthly) || 0;
  const overBudget = budgetMonthly > 0 && paidTotal > budgetMonthly;
  const nearBudget = budgetMonthly > 0 && !overBudget && paidTotal >= budgetMonthly * 0.85;

  const sectionsHtml = cats
    .map((cat, idx) => {
      const catItems = remaining.filter((i) => i.c === cat.id);
      if (catItems.length === 0) return '';
      return `
        <section class="card" data-store-cat="${esc(cat.id)}">
          <div class="ch">
            <span>${esc(cat.i)} ${esc(cat.n)} (${catItems.length})</span>
            <span class="row">
              <button type="button" class="btn g" data-aisle-move="${esc(cat.id)}:-1" ${idx === 0 ? 'disabled' : ''} aria-label="تحريك الممر لأعلى">↑</button>
              <button type="button" class="btn g" data-aisle-move="${esc(cat.id)}:1" ${idx === cats.length - 1 ? 'disabled' : ''} aria-label="تحريك الممر لأسفل">↓</button>
            </span>
          </div>
          ${catItems
            .map(
              (item) => `
                <div class="list-item" data-store-item="${esc(item.id)}">
                  <button type="button" class="btn" data-store-check="${esc(item.id)}">
                    ✅ التقطت: ${esc(item.n)} ${item.q ? `(${esc(item.q)})` : ''}
                  </button>
                  <div class="row">
                    <span class="mu">${Number(item.p) ? `${Number(item.p)} د.ل` : '—'}</span>
                    <button type="button" class="btn g" data-store-defer="${esc(item.id)}">⏳ لا يوجد في المتجر</button>
                  </div>
                </div>`
            )
            .join('')}
        </section>`;
    })
    .join('');

  const deferredHtml = deferred.length
    ? `
      <section class="card">
        <div class="ch"><span>⏳ غير متوفر في المتجر حالياً (${deferred.length})</span></div>
        ${deferred
          .map(
            (item) => `
              <div class="list-item">
                <span>${esc(item.n)} ${item.q ? `(${esc(item.q)})` : ''}</span>
                <button type="button" class="btn g" data-store-undefer="${esc(item.id)}">↩️ إعادة للقائمة</button>
              </div>`
          )
          .join('')}
      </section>`
    : '';

  return `
    <section class="sec stack">
      <div class="row">
        <h2>🏪 وضع السوبرماركت (يد واحدة)</h2>
        <span class="${overBudget ? 'badge-warn' : nearBudget ? 'badge-warn' : 'badge-ok'}">
          في العربة: ${paidTotal} د.ل ${budgetMonthly ? `/ ${budgetMonthly} د.ل` : ''}
        </span>
      </div>
      <p class="mu">الأقسام مرتّبة حسب ممرات المتجر. اضغط على الغرض لوضعه في العربة، أو «لا يوجد في المتجر» لتأجيله.</p>
      <div class="chips">
        <span class="chip">🛒 المتبقي بالممرات: ${remaining.length}</span>
        <span class="chip">✅ في العربة: ${doneItems.length}</span>
        <span class="chip">⏳ مؤجّل: ${deferred.length}</span>
        <span class="chip">💰 الإجمالي المتوقع: ${estTotal} د.ل</span>
      </div>
    </section>
    ${sectionsHtml || '<section class="sec"><p class="mu">🎉 كل الأغراض المتاحة في العربة!</p></section>'}
    ${deferredHtml}
  `;
}
