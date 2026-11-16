import { esc } from './dialogs.js';

export const DEFAULT_MAINTENANCE_ITEMS = Object.freeze([
  {
    id: 'oil_change',
    scope: 'car',
    title: 'تغيير زيت محرك السيارة والفلتر',
    badge: 'متبقي 850 كم (82%)',
    due: 'موصى به قبل نهاية الشهر الحالي · زيت 5W-30',
    supplyName: 'تغيير زيت محرك السيارة',
    supplyCategory: 'car',
    supplyQty: '4 لتر + فلتر',
    supplyPrice: 28,
  },
  {
    id: 'ac_filters',
    scope: 'home',
    title: 'تنظيف فلاتر المكيفات ❄️',
    badge: 'مستحق خلال 3 أيام',
    due: 'غرفة الجلوس وغرف النوم · يقلل استهلاك الكهرباء 12%',
    supplyName: 'بخاخ تنظيف فلاتر المكيف',
    supplyCategory: 'appliances',
    supplyQty: 'عبوة',
    supplyPrice: 15,
  },
  {
    id: 'water_filter',
    scope: 'home',
    title: 'تغيير شمعة فلتر المياه 💧',
    badge: 'متبقي 18 يوماً',
    due: 'المرحلة الأولى والثانية (قطنية وكربونية) · نقاء 92%',
    supplyName: 'طقم شمعات فلتر مياه',
    supplyCategory: 'appliances',
    supplyQty: 'طقم 3 شمعات',
    supplyPrice: 35,
  },
  {
    id: 'pump_elec',
    scope: 'home',
    title: 'فحص مضخة المياه والكهرباء 🔌',
    badge: 'فحص وقائي شهري',
    due: 'التأكد من قواطع الأمان وضغط مضخة الخزان العلوي',
    supplyName: 'فحص توصيلات الكهرباء والمقابس',
    supplyCategory: 'appliances',
    supplyQty: 'صيانة دورية',
    supplyPrice: 0,
  },
]);

export function renderMaintenanceView(appState) {
  const filter = appState.maintFilter || 'all';
  const maintStatus = appState.maintStatus || {};
  const bundleTotal = DEFAULT_MAINTENANCE_ITEMS.slice(0, 3).reduce(
    (s, it) => s + (Number(it.supplyPrice) || 0),
    0
  );

  const carItem = DEFAULT_MAINTENANCE_ITEMS.find((i) => i.id === 'oil_change');
  const carDone = Boolean(maintStatus.oil_change);
  const homeItems = DEFAULT_MAINTENANCE_ITEMS.filter((i) => i.scope === 'home');

  const showCar = filter === 'all' || filter === 'car';
  const showHome = filter === 'all' || filter === 'home';

  const carCardHtml = showCar
    ? `
      <section class="sec stack vehicle-health-card" id="maint-car-card">
        <div class="row">
          <div>
            <h3>🚗 السيارة العائلية — متابعة الفحص الدوري</h3>
            <small class="mu">العداد: 48,250 كم · حالة عامة ممتازة</small>
          </div>
          <span class="badge-ok">94% جاهزية</span>
        </div>

        <div class="stack">
          <div class="row">
            <strong>🛢️ تغيير زيت المحرك والفلتر</strong>
            <span class="${carDone ? 'badge-ok' : 'badge-warn'}">${carDone ? '✅ تم الفحص' : esc(carItem.badge)}</span>
          </div>
          <progress class="stitch-progress" value="${carDone ? 100 : 82}" max="100" aria-hidden="true"></progress>
          <small class="mu">${esc(carItem.due)}</small>
        </div>

        <div class="maint-metrics-grid">
          <div class="maint-metric-tile">
            <small class="mu">ضغط الإطارات</small>
            <div><strong>32 PSI ✅</strong></div>
          </div>
          <div class="maint-metric-tile">
            <small class="mu">البطارية</small>
            <div><strong>12.6 V ⚡</strong></div>
          </div>
          <div class="maint-metric-tile">
            <small class="mu">فحمات الفرامل</small>
            <div><strong>35% 👍</strong></div>
          </div>
        </div>

        <div class="g2">
          <button
            type="button"
            class="btn"
            data-maint-add-item="${esc(carItem.supplyName)}"
            data-maint-cat="${esc(carItem.supplyCategory)}"
            data-maint-qty="${esc(carItem.supplyQty)}"
            data-maint-price="${Number(carItem.supplyPrice) || 0}"
          >🛒 إضافة زيت وفلتر السيارة للسلة (${carItem.supplyPrice} د.ل)</button>
          <button type="button" class="btn g" data-maint-done="oil_change">
            ${carDone ? '↩️ إعادة التذكير' : '✅ تسجيل فحص'}
          </button>
        </div>
      </section>`
    : '';

  const homeSecHtml = showHome
    ? `
      <section class="card" id="maint-appliances-sec">
        <div class="ch">
          <span>🏠 الصيانة الدورية لأجهزة المنزل (${homeItems.length})</span>
        </div>
        ${homeItems
          .map((item) => {
            const done = Boolean(maintStatus[item.id]);
            return `
              <div class="list-item stack" data-maint-row="${esc(item.id)}">
                <div class="row">
                  <strong class="${done ? 'done-text' : ''}">${esc(item.title)}</strong>
                  <span class="${done ? 'badge-ok' : 'badge-warn'}">
                    ${done ? '✅ منجز' : esc(item.badge)}
                  </span>
                </div>
                <small class="mu">${esc(item.due)}</small>
                <div class="g2">
                  <button
                    type="button"
                    class="btn"
                    data-maint-add-item="${esc(item.supplyName)}"
                    data-maint-cat="${esc(item.supplyCategory)}"
                    data-maint-qty="${esc(item.supplyQty)}"
                    data-maint-price="${Number(item.supplyPrice) || 0}"
                  >🛒 أضف للسلة ${item.supplyPrice ? `(${item.supplyPrice} د.ل)` : ''}</button>
                  <button type="button" class="btn g" data-maint-done="${esc(item.id)}">
                    ${done ? '↩️ فتح التذكير' : '✅ تسجيل إنجاز'}
                  </button>
                </div>
              </div>`;
          })
          .join('')}
      </section>`
    : '';

  return `
    <section class="sec stack" id="maint-header-sec">
      <div class="row">
        <h2>🔧 صيانة المنزل والسيارة</h2>
        <span class="badge-ok">كل الأنظمة مراقَبة</span>
      </div>
      <p class="mu">متابعة عداد السيارة وتنبيهات أجهزة المنزل مع إضافة مستلزمات الصيانة للسلة بضغطة واحدة.</p>
      <div class="maint-seg-bar">
        <button type="button" class="btn ${filter === 'all' ? '' : 'g'}" data-maint-filter="all">📋 الكل</button>
        <button type="button" class="btn ${filter === 'car' ? '' : 'g'}" data-maint-filter="car">🚗 السيارة</button>
        <button type="button" class="btn ${filter === 'home' ? '' : 'g'}" data-maint-filter="home">🏠 المنزل</button>
      </div>
    </section>

    ${carCardHtml}
    ${homeSecHtml}

    <section class="sec stack maint-bundle-card" id="maint-bundle-card">
      <div class="row">
        <strong>💡 توفير ميزانية الصيانة الذكي</strong>
        <span class="badge-ok">${bundleTotal} د.ل</span>
      </div>
      <p class="mu">أضف كافة مستلزمات الصيانة المستحقة (زيت وفلتر السيارة + بخاخ المكيف + شمعات الفلتر) دفعة واحدة لسلة العائلة.</p>
      <button type="button" id="add-all-maint-items-btn" class="btn full">
        🛒 إضافة جميع مستلزمات الصيانة للسلة — ${bundleTotal} د.ل
      </button>
    </section>
  `;
}
