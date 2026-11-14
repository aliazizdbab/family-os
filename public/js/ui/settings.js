import { esc } from './dialogs.js';
import { DEFAULT_ACCENT } from '../schema.js';

export function renderFirebaseDiagnosticsCard(firebaseStatus, prefs) {
  const statusBadge = !firebaseStatus.checked
    ? '<span class="badge-warn" id="fb-probe-badge">بانتظار الفحص</span>'
    : firebaseStatus.rtdbReachable && firebaseStatus.sdkLoaded
      ? '<span class="badge-ok" id="fb-probe-badge">متصل وجاهز</span>'
      : '<span class="badge-warn" id="fb-probe-badge">تنبيه اتصال</span>';

  return `
    <section class="sec stack">
      <div class="row">
        <h3>☁️ حالة الربط مع Firebase</h3>
        ${statusBadge}
      </div>
      <p class="mu" id="fb-probe-msg">${esc(firebaseStatus.message)}</p>
      <div class="list-item">
        <span>المشروع المعتمد (Project ID)</span>
        <code dir="ltr">family-requests-9e431</code>
      </div>
      <div class="list-item">
        <span>مسار الجيل الثاني (v2 Path)</span>
        <code dir="ltr">/v2/rooms/$rid</code>
      </div>
      <div class="list-item">
        <span>حماية بيانات النسخة القديمة (Legacy)</span>
        <span class="badge-ok">محفوظة (/rooms/family)</span>
      </div>
      <label for="fb-rtdb-url" class="mu">رابط قاعدة البيانات (Realtime Database URL)</label>
      <input
        id="fb-rtdb-url"
        class="input"
        dir="ltr"
        value="${esc(prefs.rtdbUrl || 'https://family-requests-9e431-default-rtdb.firebaseio.com')}"
      />
      <div class="g2">
        <button type="button" id="probe-firebase-btn" class="btn">🔌 فحص اتصال Firebase الآن</button>
        <button type="button" id="toggle-emulator-btn" class="btn g">
          ${prefs.useEmulator ? '🧪 وضع المحاكي: مفعّل' : '☁️ الوضع السحابي: مفعّل'}
        </button>
      </div>
    </section>`;
}

export function renderThemeSettingsCard(prefs, colors) {
  return `
    <section class="sec stack">
      <h2>🎨 تخصيص المظهر المحلي</h2>
      <p class="mu">اللون الافتراضي مأخوذ من التطبيق القديم (<code>${DEFAULT_ACCENT}</code>) ويُحفظ محلياً في IndexedDB.</p>
      <div class="chips">
        ${colors
          .map(
            (c) =>
              `<button type="button" class="btn" data-color="${c}" aria-label="اختيار لون ${c}">${c === prefs.accent ? '✓' : '●'}</button>`
          )
          .join('')}
      </div>
      <div class="row">
        <span>🌙 الوضع الداكن</span>
        <button type="button" id="toggle-dark" class="btn g">${prefs.dark ? 'مفعّل' : 'متوقف'}</button>
      </div>
      <label for="font-range" class="mu">حجم الخط: ${prefs.fontSize}px</label>
      <input type="range" id="font-range" class="input" min="14" max="20" value="${prefs.fontSize}">
    </section>`;
}
