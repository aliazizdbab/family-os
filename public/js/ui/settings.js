import { esc } from './dialogs.js';
import { DEFAULT_ACCENT } from '../schema.js';
import { buildInviteUrl } from '../auth.js';

export function renderRoomAndAuthCard(appState) {
  const snap = appState.localSnapshot;
  const meta = snap?.meta || {};
  const invite = meta.invite;
  const hasActiveInvite = invite && invite.token && invite.expiresAt > Date.now();
  const inviteUrl = hasActiveInvite ? buildInviteUrl(appState.roomId, invite.token) : '';
  const uid = appState.firebaseStatus.uid || 'غير مسجّل بعد';

  return `
    <section class="sec stack">
      <div class="row">
        <h3>🔐 الغرفة والمصادقة والدعوات (Phase 1)</h3>
        <span class="badge-ok" dir="ltr">${esc(appState.roomId)}</span>
      </div>
      <div class="list-item">
        <span>معرّف المصادقة المجهولة (Auth UID)</span>
        <code dir="ltr" id="auth-uid-code">${esc(uid)}</code>
      </div>
      <div class="g2">
        <input id="room-name-inp" class="input" placeholder="اسم الغرفة (مثلاً: عائلتي)" value="${esc(meta.name || 'عائلتي')}" />
        <input id="admin-name-inp" class="input" placeholder="اسمك" value="الأب" />
      </div>
      <div class="g2">
        <button type="button" id="create-room-btn" class="btn">🏠 إنشاء / تفعيل غرفة v2</button>
        <button type="button" id="start-sync-btn" class="btn g">🔄 تفعيل المزامنة الحية</button>
      </div>
      ${
        hasActiveInvite
          ? `
            <div class="stack">
              <label for="invite-url-inp" class="mu">🔗 رابط دعوة العائلة (#join=rid.token)</label>
              <input id="invite-url-inp" class="input" dir="ltr" readonly value="${esc(inviteUrl)}" />
              <div class="g2">
                <button type="button" id="rotate-invite-btn" class="btn g">♻️ تدوير رابط الدعوة</button>
                <button type="button" id="revoke-invite-btn" class="btn g">🚫 إلغاء الدعوة</button>
              </div>
            </div>`
          : `
            <div class="row">
              <span class="mu">لا توجد دعوة نشطة حالياً</span>
              <button type="button" id="rotate-invite-btn" class="btn g">➕ توليد رابط دعوة</button>
            </div>`
      }
    </section>`;
}

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

export function renderThemeSettingsCard(prefs, colors, pinLockEnabled = false) {
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
    </section>

    <section class="sec stack">
      <div class="row">
        <h3>🔒 قفل الشاشة المحلي (PIN — PBKDF2)</h3>
        <span class="${pinLockEnabled ? 'badge-ok' : 'badge-warn'}">${pinLockEnabled ? 'مفعّل محلياً' : 'غير مفعّل'}</span>
      </div>
      <p class="mu">يُشتق الرمز عبر WebCrypto PBKDF2 (100,000 دورة) ويُحفظ في IndexedDB على هذا الجهاز فقط — لا يُرسل أبداً إلى السحابة.</p>
      <input id="local-pin-inp" class="input" type="password" inputmode="numeric" maxlength="8" placeholder="رمز PIN من 4 إلى 8 أرقام" autocomplete="off" />
      <div class="g2">
        <button type="button" id="save-pin-btn" class="btn">💾 حفظ رمز القفل المحلي</button>
        <button type="button" id="clear-pin-btn" class="btn g">🔓 إلغاء القفل المحلي</button>
      </div>
    </section>`;
}
