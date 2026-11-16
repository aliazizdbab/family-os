import { esc } from './dialogs.js';
import { computeBudgetSummary, getActiveItemsList, getSortedActiveCategories } from './list.js';
import { getEffectiveMembersList } from './settings.js';
import { SCHEMA_VERSION } from '../schema.js';

export const SUGGESTED_FAMILY_MEALS = Object.freeze([
  {
    id: 'meal_couscous',
    title: 'كسكسي بالخضار الطازجة',
    duration: '45 دقيقة',
    chef: 'أم سارة',
    ingredients: [
      { n: 'لحم غنم طازج', c: 'butcher', q: '1 كجم', p: 45 },
      { n: 'طماطم', c: 'produce', q: '1 كجم', p: 3 },
      { n: 'بصل وبطاطس وجزر', c: 'produce', q: '2 كجم', p: 7 },
    ],
  },
  {
    id: 'meal_marga',
    title: 'مرقة دجاج بالأرز البسمتي والسلطة',
    duration: '35 دقيقة',
    chef: 'العائلة',
    ingredients: [
      { n: 'صدور دجاج', c: 'butcher', q: '1.5 كجم', p: 28 },
      { n: 'أرز بسمتي', c: 'super', q: '2 كجم', p: 12 },
      { n: 'خيار وطماطم', c: 'produce', q: '1.5 كجم', p: 6 },
    ],
  },
  {
    id: 'meal_pasta',
    title: 'مكرونة مبكبكة بصلصة الطماطم',
    duration: '30 دقيقة',
    chef: 'الأب',
    ingredients: [
      { n: 'معكرونة', c: 'super', q: '2 كيس', p: 6 },
      { n: 'صلصة طماطم', c: 'super', q: '2 علبة', p: 7 },
      { n: 'لحم بقري مفروم', c: 'butcher', q: '500 جم', p: 22 },
    ],
  },
]);

const DEFAULT_URGENT_ESSENTIALS = Object.freeze([
  { n: 'حليب كامل الدسم', c: 'super', q: '2 عبوة', p: 7 },
  { n: 'خبز طازج', c: 'bakery', q: '4 أكياس', p: 3 },
  { n: 'زيت زيتون بكر', c: 'super', q: '1 لتر', p: 24 },
]);

export function renderFamilyHubSection(appState) {
  const snap = appState.localSnapshot || {};
  const categories = getSortedActiveCategories(snap.cats || {});
  const allItems = getActiveItemsList(snap.items || {});
  const members = getEffectiveMembersList(snap);
  const summary = computeBudgetSummary(allItems, snap.budget);

  const catsCount = categories.length;
  const itemsCount = allItems.length;
  const membersCount = members.length;
  const budget = snap?.budget?.monthly ?? 250;
  const pendingCount = Number(appState.syncStatus?.pendingCount) || 0;

  // Group spending into 3 Stitch summary buckets
  const grocerySpend =
    (summary.perCatTotals.super || 0) +
    (summary.perCatTotals.produce || 0) +
    (summary.perCatTotals.bakery || 0) +
    (summary.perCatTotals.butcher || 0) +
    (summary.perCatTotals.herbs || 0);
  const maintSpend = (summary.perCatTotals.car || 0) + (summary.perCatTotals.appliances || 0);
  const otherSpend = Math.max(0, summary.estTotal - grocerySpend - maintSpend);

  // Urgent items currently in cart or fallback essentials
  const urgentItems = allItems.filter((it) => it.u && !it.dn);
  const urgentCards =
    urgentItems.length > 0
      ? urgentItems.slice(0, 6).map((it) => ({
          n: it.n,
          c: it.c || 'super',
          q: it.q || '1',
          p: Number(it.p) || 0,
          inCart: true,
        }))
      : DEFAULT_URGENT_ESSENTIALS.map((it) => ({ ...it, inCart: false }));

  // Weekly Star Leaders
  const rankLabels = ['المركز الأول 🥇', 'المركز الثاني 🥈', 'المركز الثالث 🥉'];
  const leaders = [...members]
    .sort((a, b) => (Number(b.points) || 0) - (Number(a.points) || 0))
    .slice(0, 3);

  // Suggested Meal
  const mealIdx = Math.abs(Number(appState.mealIndex) || 0) % SUGGESTED_FAMILY_MEALS.length;
  const meal = SUGGESTED_FAMILY_MEALS[mealIdx];
  const activeNames = new Set(allItems.map((i) => String(i.n || '').trim().toLowerCase()));
  const allMealReady = meal.ingredients.every((ing) =>
    activeNames.has(ing.n.trim().toLowerCase())
  );

  return `
    <section class="sec stack hub-greeting-card" id="family-hub-card">
      <div class="row">
        <div>
          <h2>🏡 نبض المنزل — ${esc(snap.meta?.name || 'عائلتي')}</h2>
          <p class="mu">نسبة إنجاز المنزل ${summary.completionPct}% · ${summary.doneCount} من ${summary.totalCount} غرض منجز</p>
        </div>
        <span class="badge-ok">الإصدار v${SCHEMA_VERSION}</span>
      </div>
      <div class="chips">
        <span class="chip">🗂️ الأقسام: ${catsCount}</span>
        <span class="chip">🛒 الأغراض المحلية: ${itemsCount}</span>
        <span class="chip">👥 الأعضاء: ${membersCount}</span>
        <span class="chip">💰 الميزانية: ${budget} د.ل</span>
        <span class="chip">📤 بالانتظار: ${pendingCount}</span>
      </div>
    </section>

    <section class="sec stack" id="hub-budget-card">
      <div class="row">
        <h3>💳 الميزانية الشهرية</h3>
        <span class="${summary.status === 'over' ? 'badge-warn' : 'badge-ok'}">
          المتبقي ${summary.remainingBudget} د.ل
        </span>
      </div>
      <div class="row">
        <strong class="stitch-num">${summary.estTotal} / ${summary.budgetMonthly} د.ل</strong>
        <span class="mu">${summary.budgetPct}% مستهلك</span>
      </div>
      <progress class="stitch-progress" value="${Math.min(100, Math.max(0, Number(summary.budgetPct) || 0))}" max="100" aria-hidden="true"></progress>
      <div class="hub-budget-grid">
        <div class="hub-budget-tile">
          <small class="mu">بقالة ومطبخ</small>
          <div><strong class="stitch-num">${grocerySpend} د.ل</strong></div>
        </div>
        <div class="hub-budget-tile">
          <small class="mu">السيارة والصيانة</small>
          <div><strong class="stitch-num">${maintSpend} د.ل</strong></div>
        </div>
        <div class="hub-budget-tile">
          <small class="mu">أخرى وصيدلية</small>
          <div><strong class="stitch-num">${otherSpend} د.ل</strong></div>
        </div>
      </div>
    </section>

    <section class="sec stack" id="hub-urgent-strip">
      <div class="row">
        <h3>🔥 نواقص عاجلة</h3>
        <button type="button" class="btn g" data-goto-tab="store">تصفّح المتجر</button>
      </div>
      <div class="hub-urgent-scroll">
        ${urgentCards
          .map(
            (card) => `
          <div class="hub-urgent-card">
            <strong>${esc(card.n)}</strong>
            <span class="mu">📦 ${esc(card.q)} ${card.p ? `· ${card.p} د.ل` : ''}</span>
            ${
              card.inCart
                ? '<span class="badge-warn">🔥 مطلوب حالياً</span>'
                : `<button type="button" class="btn" data-freq-item="${esc(card.n)}" data-freq-cat="${esc(card.c)}" data-freq-price="${Number(card.p) || 0}" data-freq-qty="${esc(card.q)}">➕ للسلة</button>`
            }
          </div>`
          )
          .join('')}
      </div>
    </section>

    <section class="sec stack" id="hub-stars-card">
      <div class="row">
        <h3>⭐ نجوم الأسبوع</h3>
        <button type="button" class="btn g" data-goto-tab="tasks">عرض المهام والمكافآت</button>
      </div>
      <div class="stack">
        ${leaders
          .map(
            (m, i) => `
          <div class="hub-leader-row">
            <span>${esc(m.icon || '👤')} <strong>${esc(m.name)}</strong> <small class="badge-ok">${rankLabels[i] || 'نجم'}</small></span>
            <strong class="stitch-num">⭐ ${Number(m.points) || 0}</strong>
          </div>`
          )
          .join('')}
      </div>
    </section>

    <section class="sec stack hub-meal-card" id="hub-meal-card">
      <div class="row">
        <div>
          <small class="badge-warn">🍲 وجبة اليوم المقترحة</small>
          <h3>${esc(meal.title)}</h3>
        </div>
        <button type="button" id="hub-cycle-meal-btn" class="btn g">🔄 وجبة أخرى</button>
      </div>
      <div class="chips">
        <span class="chip">⏱️ ${esc(meal.duration)}</span>
        <span class="chip">👩‍🍳 ${esc(meal.chef)}</span>
        <span class="${allMealReady ? 'badge-ok' : 'badge-warn'}">
          ${allMealReady ? '✅ المقادير في السلة' : `🛒 ${meal.ingredients.length} مقادير مقترحة`}
        </span>
      </div>
      <button type="button" id="hub-add-meal-items-btn" class="btn full">
        🛒 إضافة مقادير «${esc(meal.title)}» للسلة
      </button>
    </section>
  `;
}
