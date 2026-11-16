import { esc } from './dialogs.js';

export const DEFAULT_STORE_CATALOG = Object.freeze([
  // 🏪 السوبرماركت (super)
  { n: 'حليب', c: 'super', q: '2 علبة', p: 8 },
  { n: 'أرز بسمتي', c: 'super', q: '5 كجم', p: 25 },
  { n: 'زيت طبخ', c: 'super', q: '1.5 لتر', p: 14 },
  { n: 'زيت زيتون', c: 'super', q: '1 لتر', p: 35 },
  { n: 'سكر', c: 'super', q: '2 كجم', p: 8 },
  { n: 'دقيق', c: 'super', q: '2 كجم', p: 6 },
  { n: 'معكرونة', c: 'super', q: '3 أكياس', p: 9 },
  { n: 'صلصة طماطم', c: 'super', q: '2 علبة', p: 7 },
  { n: 'شاي أحمر', c: 'super', q: 'علبة', p: 10 },
  { n: 'قهوة عربية', c: 'super', q: '500 جم', p: 30 },
  { n: 'تونة', c: 'super', q: '3 علب', p: 15 },
  { n: 'ماء شرب', c: 'super', q: 'صندوق', p: 6 },
  { n: 'مناديل ورقية ومناشف مطبخ', c: 'super', q: 'صندوق', p: 12 },
  { n: 'أكياس قمامة', c: 'super', q: '2 لفة', p: 8 },
  { n: 'ورق ألمنيوم ونايلون تغليف', c: 'super', q: 'طقم', p: 14 },

  // 🥬 الخضّار (produce)
  { n: 'طماطم', c: 'produce', q: '2 كجم', p: 6 },
  { n: 'بطاطس', c: 'produce', q: '3 كجم', p: 9 },
  { n: 'بصل', c: 'produce', q: '2 كجم', p: 6 },
  { n: 'خيار', c: 'produce', q: '1 كجم', p: 4 },
  { n: 'ليمون', c: 'produce', q: '1 كجم', p: 5 },
  { n: 'جزر', c: 'produce', q: '1 كجم', p: 4 },
  { n: 'تفاح', c: 'produce', q: '2 كجم', p: 14 },
  { n: 'موز', c: 'produce', q: '2 كجم', p: 12 },
  { n: 'ورقيات (نعناع وبقدونس)', c: 'produce', q: '3 حزم', p: 3 },

  // 🥖 المخبز (bakery)
  { n: 'خبز طازج', c: 'bakery', q: '4 أكياس', p: 3 },
  { n: 'خبز توست', c: 'bakery', q: 'كيس', p: 5 },
  { n: 'بيض', c: 'bakery', q: 'طبق 30 بيضة', p: 15 },
  { n: 'جبنة بيضاء', c: 'bakery', q: '500 جم', p: 12 },
  { n: 'زبدة', c: 'bakery', q: 'قالب', p: 10 },

  // 🥩 القصّاب (butcher)
  { n: 'لحم غنم طازج', c: 'butcher', q: '2 كجم', p: 90 },
  { n: 'لحم بقري مفروم', c: 'butcher', q: '1 كجم', p: 42 },
  { n: 'صدور دجاج', c: 'butcher', q: '2 كجم', p: 38 },
  { n: 'دجاج كامل', c: 'butcher', q: '2 حبة', p: 32 },
  { n: 'سمك طازج', c: 'butcher', q: '2 كجم', p: 45 },

  // 🧺 المغسلة (laundry)
  { n: 'مسحوق غسيل أوتوماتيك', c: 'laundry', q: '3 كجم', p: 28 },
  { n: 'منعم ومعطر ملابس', c: 'laundry', q: '2 لتر', p: 16 },
  { n: 'مزيل بقع الملابس', c: 'laundry', q: 'علبة', p: 14 },
  { n: 'سائل غسيل العبايات', c: 'laundry', q: '1 لتر', p: 15 },
  { n: 'مشابك وسلة غسيل', c: 'laundry', q: 'طقم', p: 12 },
  { n: 'غسيل وكي سجاد/بطاطين في المغسلة', c: 'laundry', q: 'خدمة', p: 35 },

  // 🔌 صيانة الأجهزة والأثاث والمنزل (appliances)
  { n: 'ملمع ومنظف الأثاث والأخشاب', c: 'appliances', q: 'عبوة', p: 12 },
  { n: 'تنظيف وغسيل فلاتر المكيفات', c: 'appliances', q: 'مهمة دورية', p: 0 },
  { n: 'بطاريات ريموت AA / AAA', c: 'appliances', q: 'علبة', p: 8 },
  { n: 'لمبات إضاءة LED', c: 'appliances', q: '3 حبات', p: 15 },
  { n: 'تشحيم مفصلات الأبواب والنوافذ', c: 'appliances', q: 'مهمة صيانة', p: 10 },
  { n: 'فحص وصيانة فلتر مياه الشرب وتغيير الشمعات', c: 'appliances', q: 'صيانة دورية', p: 25 },
  { n: 'سائل جلي ومنظف أرضيات ومطهر', c: 'appliances', q: 'طقم تنظيف', p: 22 },
  { n: 'شريط عازل وعدة مفكات منزلية', c: 'appliances', q: 'أدوات', p: 20 },
  { n: 'فحص توصيلات الكهرباء والمقابس', c: 'appliances', q: 'مهمة صيانة', p: 0 },
  { n: 'تزييت ومعايرة أبواب الخزائن والأدراج', c: 'appliances', q: 'مهمة صيانة', p: 5 },

  // 🔧 السيارة وقطع الغيار والصيانة الدورية (car)
  { n: 'تغيير زيت محرك السيارة', c: 'car', q: '4 لتر', p: 85 },
  { n: 'فلتر زيت المحرك', c: 'car', q: 'قطعة غيار', p: 20 },
  { n: 'فلتر هواء المحرك', c: 'car', q: 'قطعة غيار', p: 30 },
  { n: 'فلتر مكيف السيارة', c: 'car', q: 'قطعة غيار', p: 25 },
  { n: 'ماء راديتر وتبريد', c: 'car', q: 'جالون', p: 25 },
  { n: 'شفرات مسّاحات الزجاج + سائل المسّاحات', c: 'car', q: 'طقم', p: 30 },
  { n: 'فحص فحمات الفرامل (السفايف)', c: 'car', q: 'صيانة دورية', p: 60 },
  { n: 'فحص ضغط الإطارات والبطارية', c: 'car', q: 'مهمة دورية', p: 10 },
  { n: 'غسيل وتنظيف السيارة الداخلي والخارجي', c: 'car', q: 'خدمة', p: 20 },
  { n: 'فحص سير المحرك (القشاط)', c: 'car', q: 'صيانة دورية', p: 45 },

  // 🌿 العطّار (herbs)
  { n: 'بهارات مشكلة وفلفل أسود', c: 'herbs', q: '200 جم', p: 12 },
  { n: 'كمون وكزبرة مطحونة', c: 'herbs', q: '200 جم', p: 10 },
  { n: 'زعتر وزنجبيل وقرفة', c: 'herbs', q: 'طقم', p: 15 },
  { n: 'مكسرات وزبيب ولوز', c: 'herbs', q: '500 جم', p: 25 },
  { n: 'عسل طبيعي وحبة البركة', c: 'herbs', q: 'عبوة', p: 40 },

  // 💊 الصيدلية (pharmacy)
  { n: 'مسكن ألم وخافض حرارة', c: 'pharmacy', q: 'علبة', p: 8 },
  { n: 'لصقات جروح ومعقم طبي', c: 'pharmacy', q: 'طقم إسعافات', p: 12 },
  { n: 'فيتامينات ومكملات غذائية', c: 'pharmacy', q: 'علبة', p: 25 },
  { n: 'معجون وفرشاة أسنان', c: 'pharmacy', q: 'طقم', p: 12 },
  { n: 'شامبو وصابون استحمام', c: 'pharmacy', q: 'طقم', p: 18 },
  { n: 'ميزان حرارة رقمي وأدوية زكام', c: 'pharmacy', q: 'طقم', p: 20 },
]);

export const AI_STORE_SUGGESTIONS = Object.freeze([
  {
    n: 'ملمع جلد وحماية لوحة القيادة للسيارة',
    c: 'car',
    q: 'عبوة',
    p: 18,
    reason: 'عناية دورية بداخلية السيارة',
  },
  {
    n: 'صيانة دورية لمضخة وخزان المياه المنزلي',
    c: 'appliances',
    q: 'مهمة دورية',
    p: 30,
    reason: 'وقاية للأجهزة المنزلية وتأمين المياه',
  },
  {
    n: 'مناديل إزالة البقع الطارئة ومعقم يدين',
    c: 'pharmacy',
    q: '2 عبوة',
    p: 10,
    reason: 'نواقص ضرورية للحقيبة والسيارة',
  },
  {
    n: 'مزيل ترسبات وتكلس الغسالة الأوتوماتيك',
    c: 'laundry',
    q: 'عبوة',
    p: 16,
    reason: 'إطالة عمر الغسالة والحفاظ على نظافة الملابس',
  },
  {
    n: 'خميرة فورية وفانيليا ومستلزمات مخبوزات',
    c: 'super',
    q: 'طقم',
    p: 12,
    reason: 'نواقص مطبخ متكررة',
  },
  {
    n: 'مقشر وشحوم صيانة للأبواب الخشبية',
    c: 'appliances',
    q: 'طقم',
    p: 15,
    reason: 'حماية الأثاث والأبواب من الرطوبة',
  },
]);

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

export function buildMergedStoreCatalog(appState) {
  const byKey = new Map();
  const normalizeKey = (name, cat) =>
    `${String(cat || 'super').trim()}::${String(name || '')
      .trim()
      .toLowerCase()}`;

  for (const entry of DEFAULT_STORE_CATALOG) {
    const key = normalizeKey(entry.n, entry.c);
    byKey.set(key, { ...entry, autoLearned: false });
  }

  const customList = Array.isArray(appState?.prefs?.customCatalog)
    ? appState.prefs.customCatalog
    : [];
  for (const entry of customList) {
    if (!entry || !entry.n) continue;
    const key = normalizeKey(entry.n, entry.c);
    if (!byKey.has(key)) {
      byKey.set(key, {
        n: String(entry.n).trim(),
        c: entry.c || 'super',
        q: entry.q || '1',
        p: Number(entry.p) || 0,
        autoLearned: Boolean(entry.autoLearned),
      });
    }
  }

  const snap = appState?.localSnapshot || {};
  for (const h of Object.values(snap.history || {})) {
    if (!h || !h.itemName) continue;
    const catId = h.c || 'super';
    const key = normalizeKey(h.itemName, catId);
    if (!byKey.has(key)) {
      byKey.set(key, {
        n: String(h.itemName).trim(),
        c: catId,
        q: h.q || '1',
        p: Number(h.p) || 0,
        autoLearned: true,
      });
    }
  }

  for (const it of Object.values(snap.items || {})) {
    if (!it || it.deleted || !it.n) continue;
    const catId = it.c || 'super';
    const key = normalizeKey(it.n, catId);
    if (!byKey.has(key)) {
      byKey.set(key, {
        n: String(it.n).trim(),
        c: catId,
        q: it.q || '1',
        p: Number(it.p) || 0,
        autoLearned: true,
      });
    }
  }

  return Array.from(byKey.values());
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
  const tripPct =
    allItems.length > 0 ? Math.round((doneItems.length / allItems.length) * 100) : 0;

  const catalog = buildMergedStoreCatalog(appState);
  const catFilter = appState.storeCatFilter || 'all';
  const remainingByName = new Map(
    remaining.map((i) => [
      String(i.n || '')
        .trim()
        .toLowerCase(),
      i,
    ])
  );

  const existingKeys = new Set(
    catalog.map((item) => `${String(item.c).trim()}::${String(item.n).trim().toLowerCase()}`)
  );
  const aiCandidates = AI_STORE_SUGGESTIONS.filter(
    (s) => !existingKeys.has(`${s.c}::${s.n.trim().toLowerCase()}`)
  );
  const displayAi = aiCandidates.length > 0 ? aiCandidates : AI_STORE_SUGGESTIONS;

  const aiCardHtml = appState.showAiStoreSuggestions
    ? `
      <section class="card" id="ai-store-suggestions-card">
        <div class="ch">
          <span>🤖 مقترحات ذكية لنواقص المنزل وصيانة السيارة والأثاث</span>
        </div>
        <div class="catalog-grid">
          ${displayAi
            .map(
              (s) => `
              <div class="list-item stack">
                <div class="row">
                  <div class="grow">
                    <strong>${esc(s.n)}</strong>
                    <p class="mu">${esc(s.reason)} · 📦 ${esc(s.q)} · 💰 ${Number(s.p) || 0} د.ل</p>
                  </div>
                  <button
                    type="button"
                    class="btn"
                    data-ai-catalog-add="${esc(s.n)}"
                    data-ai-cat="${esc(s.c)}"
                    data-ai-q="${esc(s.q)}"
                    data-ai-p="${Number(s.p) || 0}"
                  >➕ أضف للمتجر والسلة</button>
                </div>
              </div>`
            )
            .join('')}
        </div>
      </section>`
    : '';

  const filteredCats = catFilter === 'all' ? cats : cats.filter((c) => c.id === catFilter);

  const catalogSectionsHtml = filteredCats
    .map((cat) => {
      const catCatalog = catalog.filter((entry) => entry.c === cat.id);
      if (catCatalog.length === 0) return '';
      return `
        <section class="card" data-catalog-sec="${esc(cat.id)}">
          <div class="ch">
            <span>${esc(cat.i)} ${esc(cat.n)} (${catCatalog.length})</span>
          </div>
          <div class="store-product-grid">
            ${catCatalog
              .map((entry) => {
                const normName = String(entry.n).trim().toLowerCase();
                const inCart = remainingByName.get(normName);
                return `
                  <article class="store-product-card" data-catalog-row="${esc(normName)}" data-catalog-name="${esc(normName)}">
                    <div class="stack">
                      <div class="row">
                        <span class="chip">${esc(cat.i)}</span>
                        ${inCart ? '<span class="badge-ok">✅ في السلة</span>' : ''}
                        ${entry.autoLearned ? '<span class="badge-ok">🆕 مضاف تلقائياً</span>' : ''}
                      </div>
                      <strong>${esc(entry.n)}</strong>
                      <small class="mu">📦 ${esc(entry.q || '1')}</small>
                      <strong class="stitch-num">${Number(entry.p) || 0} د.ل</strong>
                    </div>
                    ${
                      inCart
                        ? `<div class="qty-stepper">
                            <button type="button" class="btn" data-cart-step-inc="${esc(inCart.id)}" aria-label="زيادة كمية ${esc(entry.n)}">+</button>
                            <strong class="stitch-num">${esc(inCart.q || '1')}</strong>
                            <button type="button" class="btn g" data-cart-step-dec="${esc(inCart.id)}" aria-label="إنقاص كمية ${esc(entry.n)}">-</button>
                          </div>`
                        : `<button
                            type="button"
                            class="btn full"
                            data-catalog-add="${esc(entry.n)}"
                            data-catalog-cat="${esc(entry.c)}"
                            data-catalog-q="${esc(entry.q || '')}"
                            data-catalog-p="${Number(entry.p) || 0}"
                          >➕ أضف للسلة</button>`
                    }
                  </article>`;
              })
              .join('')}
          </div>
        </section>`;
    })
    .join('');

  const quickShoppingSectionsHtml = cats
    .map((cat, idx) => {
      const catItems = remaining.filter((i) => i.c === cat.id);
      if (catItems.length === 0) return '';
      return `
        <section class="card" data-store-cat="${esc(cat.id)}">
          <div class="ch">
            <span><span class="badge-ok">ممر ${idx + 1}</span> ${esc(cat.i)} ${esc(cat.n)} (${catItems.length})</span>
            <span class="row">
              <button type="button" class="btn g" data-aisle-move="${esc(cat.id)}:-1" ${idx === 0 ? 'disabled' : ''} aria-label="تحريك الممر لأعلى">↑</button>
              <button type="button" class="btn g" data-aisle-move="${esc(cat.id)}:1" ${idx === cats.length - 1 ? 'disabled' : ''} aria-label="تحريك الممر لأسفل">↓</button>
            </span>
          </div>
          ${catItems
            .map(
              (item) => `
                <div class="instore-item-card" data-store-item="${esc(item.id)}">
                  <div class="row">
                    <div class="grow">
                      <strong>${esc(item.n)}</strong>
                      <div class="chips">
                        ${item.q ? `<span class="chip">📦 ${esc(item.q)}</span>` : ''}
                        <span class="chip">💰 ${Number(item.p) ? `${Number(item.p)} د.ل` : 'غير مسعّر'}</span>
                      </div>
                    </div>
                    <button type="button" class="btn" data-store-check="${esc(item.id)}">
                      ✅ التقطت
                    </button>
                  </div>
                  <div class="row">
                    <button type="button" class="btn g full" data-store-defer="${esc(item.id)}">⏳ لا يوجد في المتجر</button>
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
                <button type="button" class="btn g" data-store-undefer="${esc(item.id)}">↩️ إعادة للسلة</button>
              </div>`
          )
          .join('')}
      </section>`
    : '';

  const floatingCartBarHtml = `
    <div class="floating-cart-bar" id="store-floating-cart-bar">
      <div>
        <strong>🛒 السلة الحالية: ${remaining.length} أصناف</strong>
        <div class="header-sub">الإجمالي التقريبي: ${estTotal} د.ل</div>
      </div>
      <button type="button" class="btn" data-goto-tab="home">✅ طلب الاعتماد / عرض السلة</button>
    </div>`;

  return `
    <section class="sec stack" id="store-catalog-header">
      <div class="row">
        <h2>🏪 متجر ومخزن العائلة (${catalog.length} صنف)</h2>
        <span class="badge-ok">متجدد تلقائياً</span>
      </div>
      <p class="mu">تصفّح جميع احتياجات المنزل، المقاضي، قطع غيار وصيانة السيارة، صيانة الأثاث والأجهزة، وأضفها مباشرة إلى «🛒 السلة».</p>
      <div class="row">
        <label class="field-box grow">
          <span class="field-lbl">🔍 ابحث في أصناف ومهام المتجر</span>
          <input id="store-search-inp" class="input" value="${esc(appState.storeSearchQuery || '')}" placeholder="مثلاً: زيت محرك، أثاث، حليب، غسيل..." />
        </label>
        <button type="button" id="store-voice-btn" class="btn g" aria-label="بحث صوتي في المتجر">🎙️</button>
      </div>
      <div class="pantry-alert-card stack" id="smart-pantry-alert">
        <div class="row">
          <strong>⚠️ تنبيه ذكي: نواقص المخزن الأساسية</strong>
          <span class="badge-warn">3 أصناف</span>
        </div>
        <p class="mu">حليب كامل الدسم، خبز طازج، زيت زيتون بكر — أضفها كلها للسلة بضغطة واحدة.</p>
        <button type="button" id="add-pantry-essentials-btn" class="btn full">🛒 إضافة كل النواقص الموصى بها للسلة</button>
      </div>
      <div class="chips">
        <button type="button" class="btn ${catFilter === 'all' ? '' : 'g'}" data-store-cat-filter="all">📦 الكل (${catalog.length})</button>
        ${cats
          .map((cat) => {
            const count = catalog.filter((e) => e.c === cat.id).length;
            return `<button type="button" class="btn ${catFilter === cat.id ? '' : 'g'}" data-store-cat-filter="${esc(cat.id)}">${esc(cat.i)} ${esc(cat.n)} (${count})</button>`;
          })
          .join('')}
      </div>
      <div class="g2">
        <button type="button" id="add-catalog-item-btn" class="btn">➕ إضافة صنف دائم للمتجر</button>
        <button type="button" id="ai-suggest-store-btn" class="btn g">🤖 اقتراح نواقص ومهام بالذكاء الاصطناعي</button>
      </div>
    </section>

    ${aiCardHtml}
    ${catalogSectionsHtml}
    ${floatingCartBarHtml}

    <section class="instore-dark-panel ${appState.instoreHighContrast ? 'high-contrast' : ''}" id="quick-store-companion">
      <div class="stack">
        <div class="row">
          <div>
            <h3>🛒 وضع التسوق السريع بالمتجر (${remaining.length} في السلة)</h3>
            <p class="mu">تم جمع ${doneItems.length} من ${allItems.length} صنفاً (${tripPct}%)</p>
          </div>
          <button type="button" id="instore-contrast-btn" class="btn g">
            ${appState.instoreHighContrast ? '☀️ تباين قياسي' : '⚡ تباين عالٍ'}
          </button>
        </div>
        <progress class="stitch-progress instore-progress" value="${Math.min(100, Math.max(0, Number(tripPct) || 0))}" max="100" aria-hidden="true"></progress>
        <div class="chips">
          <span class="chip">🛒 المتبقي: ${remaining.length}</span>
          <span class="chip">✅ المنجز: ${doneItems.length}</span>
          <span class="chip">⏳ مؤجّل: ${deferred.length}</span>
          <span class="${overBudget ? 'badge-warn' : nearBudget ? 'badge-warn' : 'badge-ok'}">
            في العربة: ${paidTotal} د.ل ${budgetMonthly ? `/ ${budgetMonthly} د.ل` : ''}
          </span>
        </div>
        ${quickShoppingSectionsHtml || '<p class="mu">سلة التسوق السريع فارغة حالياً — اختر من أصناف المتجر أعلاه بضغطة واحدة.</p>'}
        ${deferredHtml}
        <div class="instore-checkout-bar" id="instore-checkout-bar">
          <div class="row">
            <span>المجموع الفعلي بالسلة: <strong class="stitch-num">${paidTotal} د.ل</strong></span>
            <span>المتبقي من الميزانية: <strong class="stitch-num">${Math.max(0, budgetMonthly - paidTotal)} د.ل</strong></span>
          </div>
          <button type="button" id="finish-shopping-trip-btn" class="btn full">✅ إنهاء التسوق وحفظ الفاتورة</button>
        </div>
      </div>
    </section>
  `;
}
