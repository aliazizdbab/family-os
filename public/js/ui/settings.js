import { esc } from './dialogs.js';
import { DEFAULT_ACCENT } from '../schema.js';
import { buildInviteUrl } from '../auth.js';
import { getSortedActiveCategories, getActiveItemsList, computeBudgetSummary } from './list.js';

export function renderCategoriesAndBudgetCard(appState) {
  const snap = appState.localSnapshot;
  const cats = getSortedActiveCategories(snap?.cats);
  const allItems = getActiveItemsList(snap?.items);
  const summary = computeBudgetSummary(allItems, snap?.budget);
  const perCatMap = snap?.budget?.perCat || {};
  const role = appState.prefs.currentRole || 'admin';
  const memberName = appState.prefs.memberName || 'الأب';

  return `
    <section class="sec stack" id="role-budget-sec">
      <div class="row">
        <h3>👤 الدور الحالي والميزانية الشهرية</h3>
        <span class="badge-ok">${role === 'admin' ? '👑 مسؤول' : role === 'child' ? '🧒 طفل' : '🧑 عضو'}</span>
      </div>
      <div class="g2">
        <input id="member-name-inp" class="input" placeholder="اسم العضو الحالي" value="${esc(memberName)}" />
        <select id="role-select" class="select" aria-label="اختيار الدور">
          <option value="admin" ${role === 'admin' ? 'selected' : ''}>👑 مسؤول (Admin)</option>
          <option value="member" ${role === 'member' ? 'selected' : ''}>🧑 عضو عائلة (Member)</option>
          <option value="child" ${role === 'child' ? 'selected' : ''}>🧒 طفل — طلبات فقط (Child)</option>
        </select>
      </div>
      <button type="button" id="save-role-btn" class="btn g">💾 حفظ الدور والاسم</button>

      <div class="row">
        <label for="monthly-budget-inp" class="mu">💰 الميزانية الشهرية الإجمالية (د.ل)</label>
        <span class="chip">المقدر: ${summary.estTotal} د.ل · المدفوع: ${summary.paidTotal} د.ل</span>
      </div>
      <div class="row">
        <input id="monthly-budget-inp" class="input grow" type="number" min="0" step="10" value="${esc(summary.budgetMonthly)}" />
        <button type="button" id="save-budget-btn" class="btn">💾 حفظ الميزانية</button>
      </div>
    </section>

    <section class="sec stack" id="cats-manager-sec">
      <div class="row">
        <h3>🗂️ إدارة الأقسام وميزانياتها (${cats.length})</h3>
        <button type="button" id="add-cat-btn" class="btn">➕ قسم جديد</button>
      </div>
      <p class="mu">يمكنك إعادة الترتيب، تعديل الاسم والرمز، تحديد سقف ميزانية لكل قسم، أو حذف قسم مع نقل أغراضه.</p>
      <div class="stack">
        ${cats
          .map(
            (cat, idx) => `
          <div class="list-item stack" data-cat-manage="${esc(cat.id)}">
            <div class="row">
              <strong>${esc(cat.i)} ${esc(cat.n)}</strong>
              <div class="row">
                <button type="button" class="btn g" data-cat-move="${esc(cat.id)}:-1" ${idx === 0 ? 'disabled' : ''} aria-label="تحريك ${esc(cat.n)} لأعلى">↑</button>
                <button type="button" class="btn g" data-cat-move="${esc(cat.id)}:1" ${idx === cats.length - 1 ? 'disabled' : ''} aria-label="تحريك ${esc(cat.n)} لأسفل">↓</button>
                <button type="button" class="btn g" data-cat-edit="${esc(cat.id)}" aria-label="تعديل ${esc(cat.n)}">✏️</button>
                <button type="button" class="btn r" data-cat-delete="${esc(cat.id)}" aria-label="حذف ${esc(cat.n)}">🗑️</button>
              </div>
            </div>
            <div class="row">
              <span class="mu">سقف ميزانية القسم (د.ل، 0 = بدون سقف):</span>
              <input
                class="input"
                type="number"
                min="0"
                step="5"
                data-cat-limit="${esc(cat.id)}"
                value="${esc(Number(perCatMap[cat.id]) || 0)}"
                aria-label="سقف ميزانية ${esc(cat.n)}"
              />
            </div>
          </div>`
          )
          .join('')}
      </div>
    </section>`;
}

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
