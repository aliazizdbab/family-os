import { esc } from './dialogs.js';
import { DEFAULT_ACCENT, DEFAULT_FAMILY_MEMBERS } from '../schema.js';
import { buildInviteUrl } from '../auth.js';
import { getEditedAiProvider, getOrInitAiConfig, isAiProviderReady } from '../ai.js';
import { getSortedActiveCategories, getActiveItemsList, computeBudgetSummary } from './list.js';

export const ROLE_LABELS = Object.freeze({
  developer: '👨‍💻 المستوى 1: المبرمج (دعم شامل)',
  admin: '👑 المستوى 2: الأب (مدير العائلة)',
  mother: '🤱 المستوى 3: الأم (الطلبات والمهام)',
  child: '🧒 المستوى 4: الأبناء',
  member: '🧑 عضو عائلة',
});

export function getRoleShortLabel(role) {
  if (role === 'developer') return '👨‍💻 المبرمج';
  if (role === 'admin') return '👑 الأب';
  if (role === 'mother') return '🤱 الأم';
  if (role === 'child') return '🧒 الأبناء';
  return '🧑 عضو';
}

export function getEffectiveMembersList(snap) {
  const entries = Object.entries(snap?.members || {})
    .map(([id, m]) => ({ ...m, id }))
    .filter((m) => !m.deleted && !m.off);
  if (entries.length > 0) return entries;
  return DEFAULT_FAMILY_MEMBERS.map((m) => ({ ...m }));
}

/**
 * Build an Arabic onboarding & confirmation email explaining how to add family members and roles.
 */
export function buildOnboardingEmailContent({
  familyName = 'عائلتي',
  roomId = '',
  adminName = 'الأب',
  adminPin = '1234',
  email = '',
  verificationCode = '',
  inviteUrl = '',
} = {}) {
  const subject = `تأكيد تسجيل «${familyName}» في Family OS ودليل إضافة أفراد الأسرة`;
  const lines = [
    `مرحباً بك في تطبيق مقاضي العائلة (Family OS) 🏡`,
    ``,
    `تم إنشاء مساحة عائلية معزولة باسم: ${familyName}`,
    `• البريد المسجّل: ${email}`,
    `• رمز تأكيد البريد الإلكتروني: ${verificationCode}`,
    ``,
    `🔐 بيانات تسجيل الدخول الخاصة بمؤسس العائلة:`,
    `- اسم / كود العائلة: ${roomId}`,
    `- اسم المستخدم: ${adminName}`,
    `- الرقم السري: ${adminPin}`,
    ``,
    `👨‍👩‍👧‍👦 كيفية إضافة باقي أفراد الأسرة وصلاحياتهم (4 مستويات):`,
    `1. افتح التطبيق وسجّل الدخول بحساب مدير العائلة (${adminName}).`,
    `2. انتقل إلى تبويب «⚙️ الإعدادات» ثم قسم «إدارة أفراد العائلة والصلاحيات والأرقام السرية».`,
    `3. أضف كل فرد (الاسم + الرمز + الصلاحية + الرقم السري للدخول).`,
    ``,
    `🛡️ دليل الصلاحيات داخل العائلة:`,
    `• 👑 مدير العائلة (الأب - admin): إدارة الميزانية الشهرية، الأقسام، إضافة وحذف الأفراد وتعيين أرقامهم السرية، إعدادات الذكاء الاصطناعي، وتوليد روابط الدعوة.`,
    `• 🤱 الأم (إدارة الطلبات والمهام - mother): إضافة وتعديل المقاضي والأقسام، اعتماد طلبات الأبناء، وإدارة المهام المنزلية والمكافآت.`,
    `• 🧑 عضو عائلة (member): إضافة المقاضي، استخدام وضع المتجر السريع، وإنجاز المهام.`,
    `• 🧒 الأبناء (child): إرسال طلبات المقاضي للموافقة، إنجاز المهام المنزلية لكسب النجوم (⭐)، واستبدال المكافآت من متجر المكافآت العائلية.`,
  ];
  if (inviteUrl) {
    lines.push(``, `🔗 رابط الدعوة المباشر لانضمام أفراد الأسرة:`, inviteUrl);
  }
  lines.push(``, `نتمنى لعائلتكم تنظيماً ممتعاً ومريحاً ✨`);

  return {
    subject,
    body: lines.join('\n'),
  };
}

function renderRegisterFamilyCard(appState) {
  const draft = appState.pendingVerification || {};
  return `
    <section class="sec stack login-card" id="register-family-sec">
      <div class="row">
        <h2>🏡 تسجيل عائلة جديدة وتأكيد البريد الإلكتروني</h2>
        <span class="badge-ok">بيانات معزولة</span>
      </div>
      <p class="mu">أنشئ مساحة خاصة لعائلتك، وأدخل بريدك الإلكتروني لتأكيد التسجيل واستلام رسالة تشرح خطوات إضافة باقي أفراد الأسرة وصلاحياتهم.</p>

      <label class="field-box">
        <span class="field-lbl">🏠 اسم العائلة</span>
        <input id="reg-family-name" class="input" value="${esc(draft.familyName || '')}" placeholder="مثلاً: عائلة الأحمد" />
      </label>

      <label class="field-box">
        <span class="field-lbl">🆔 كود العائلة المميز (اختياري بالإنجليزية)</span>
        <input id="reg-family-code" class="input" dir="ltr" value="${esc(draft.roomId || '')}" placeholder="مثلاً: family-ahmad (يُولّد تلقائياً إن تُرك فارغاً)" />
      </label>

      <div class="g2">
        <label class="field-box">
          <span class="field-lbl">👤 اسم المستخدم المؤسس (مدير العائلة)</span>
          <input id="reg-admin-name" class="input" value="${esc(draft.adminName || 'الأب')}" placeholder="مثلاً: الأب" />
        </label>
        <label class="field-box">
          <span class="field-lbl">🔑 الرقم السري للمستخدم المؤسس</span>
          <input id="reg-admin-pin" class="input" type="password" inputmode="numeric" maxlength="16" dir="ltr" value="${esc(draft.adminPin || '1234')}" placeholder="4 أرقام فأكثر" />
        </label>
      </div>

      <label class="field-box">
        <span class="field-lbl">📧 البريد الإلكتروني لتأكيد التسجيل وإرسال دليل العائلة</span>
        <input id="reg-family-email" class="input" type="email" dir="ltr" value="${esc(draft.email || '')}" placeholder="family@example.com" />
      </label>

      <button type="button" id="register-family-submit-btn" class="btn full">📧 تسجيل العائلة وإرسال رسالة التأكيد</button>
      <button type="button" id="back-to-login-btn" class="btn g full">↩️ العودة لتسجيل الدخول</button>
    </section>
  `;
}

function renderEmailVerificationCard(appState) {
  const pending = appState.pendingVerification || {};
  const mailtoHref = `mailto:${encodeURIComponent(pending.email || '')}?subject=${encodeURIComponent(pending.emailSubject || '')}&body=${encodeURIComponent(pending.emailBody || '')}`;

  return `
    <section class="sec stack login-card" id="email-verification-card">
      <div class="row">
        <h2>✉️ تأكيد تسجيل العائلة عبر البريد الإلكتروني</h2>
        <span class="badge-warn">بانتظار التأكيد</span>
      </div>
      <div class="list-item stack">
        <strong>📨 تم إرسال رسالة التأكيد ودليل الصلاحيات إلى: <code dir="ltr">${esc(pending.email || '')}</code></strong>
        <small class="mu">تتضمن الرسالة رمز التأكيد وطريقة إضافة أفراد الأسرة ومستويات الصلاحيات الأربع.</small>
      </div>

      <label class="field-box">
        <span class="field-lbl">🔢 رمز تأكيد البريد الإلكتروني (من الرسالة المرسلة)</span>
        <input
          id="verify-email-code-inp"
          class="input"
          dir="ltr"
          maxlength="16"
          value="${esc(pending.verificationCode || '')}"
          placeholder="أدخل رمز التأكيد المكون من 6 أرقام"
        />
      </label>

      <button type="button" id="confirm-email-code-btn" class="btn full">✅ تأكيد التسجيل والدخول للعائلة</button>

      <div class="stack">
        <strong>📄 نص الرسالة المُرسلة إلى بريدك الإلكتروني (دليل إضافة الأسرة وصلاحياتهم):</strong>
        <pre id="onboarding-email-preview" class="chat-pre">${esc(pending.emailBody || '')}</pre>
      </div>

      <div class="g2">
        <a id="send-onboarding-mailto-btn" class="btn g" href="${esc(mailtoHref)}">📧 فتح في تطبيق البريد</a>
        <button type="button" id="copy-onboarding-email-btn" class="btn g">📋 نسخ الرسالة والدليل</button>
      </div>
      <button type="button" id="back-to-login-btn" class="btn g full">↩️ العودة لتسجيل الدخول</button>
    </section>
  `;
}

export function renderLoginScreenView(appState) {
  if (appState.loginMode === 'register') {
    return renderRegisterFamilyCard(appState);
  }
  if (appState.loginMode === 'verify' && appState.pendingVerification) {
    return renderEmailVerificationCard(appState);
  }

  const snap = appState.localSnapshot || {};
  const members = getEffectiveMembersList(snap);
  const selectedId = appState.loginSelectedMemberId || members[0]?.id || 'mem_father';
  const selectedMember = members.find((m) => m.id === selectedId) || members[0];
  const registry =
    Array.isArray(appState.prefs.familyRegistry) && appState.prefs.familyRegistry.length > 0
      ? appState.prefs.familyRegistry
      : [appState.roomId];
  const famName = snap.meta?.name || 'عائلتي';

  return `
    <section class="sec stack login-card" id="login-screen">
      <div class="row">
        <h2>🔐 تسجيل دخول العائلة</h2>
        <span class="badge-ok">بيانات معزولة</span>
      </div>
      <p class="mu">أدخل اسم أو كود العائلة، واسم المستخدم، والرقم السري للدخول إلى مساحة عائلتك الخاصة (${esc(famName)}).</p>

      <div class="sec stack">
        <label class="field-box">
          <span class="field-lbl">🏠 اسم أو كود العائلة (${esc(famName)})</span>
          <div class="row">
            <input id="login-family-code" class="input grow" dir="ltr" value="${esc(appState.roomId)}" placeholder="اسم أو كود العائلة (مثلاً: family-v2-local)" />
            <button type="button" id="switch-family-code-btn" class="btn g">🔄 تحميل العائلة</button>
          </div>
        </label>
        ${
          registry.length > 1
            ? `<div class="chips">
                <span class="mu">عائلات مسجّلة:</span>
                ${registry
                  .map(
                    (f) =>
                      `<button type="button" class="btn ${f === appState.roomId ? '' : 'g'}" data-pick-family="${esc(f)}" dir="ltr">${esc(f)}</button>`
                  )
                  .join('')}
              </div>`
            : ''
        }
      </div>

      <div class="stack">
        <label class="field-box">
          <span class="field-lbl">👤 اسم المستخدم</span>
          <input
            id="login-username-inp"
            class="input"
            value="${esc(selectedMember?.name || 'الأب')}"
            placeholder="اكتب اسم المستخدم (مثلاً: الأب)"
          />
        </label>
        <div class="chips" aria-label="اختيار سريع لأفراد العائلة">
          ${members
            .map(
              (m) => `
            <button
              type="button"
              class="btn ${m.id === selectedMember?.id ? '' : 'g'}"
              data-login-member="${esc(m.id)}"
            >${esc(m.icon || '👤')} ${esc(m.name)}</button>`
            )
            .join('')}
        </div>
      </div>

      <label class="field-box">
        <span class="field-lbl">🔑 الرقم السري للمستخدم</span>
        <input
          id="login-pin-inp"
          class="input"
          type="password"
          inputmode="numeric"
          maxlength="16"
          dir="ltr"
          value="${esc(selectedMember?.accessCode || '1234')}"
          placeholder="أدخل الرقم السري للمستخدم"
        />
      </label>

      <button type="button" id="login-submit-btn" class="btn full">🔓 دخول للبرنامج</button>

      <div class="sec stack">
        <p class="mu">ليس لعائلتك حساب بعد؟ سجّل عائلة جديدة وأكّد بريدك الإلكتروني لاستلام دليل إضافة أفراد الأسرة.</p>
        <button type="button" id="toggle-register-family-btn" class="btn g full">➕ تسجيل عائلة جديدة</button>
      </div>
    </section>
  `;
}

export function renderDeveloperLoginScreenView() {
  return `
    <section class="sec stack login-card" id="dev-login-screen">
      <div class="row">
        <h2>👨‍💻 بوابة المبرمج والدعم الفني الشامل</h2>
        <span class="badge-warn">رابط مستقل للمبرمج</span>
      </div>
      <p class="mu">هذه البوابة مخصصة حصرياً للمبرمج والدعم الفني (المستوى 1) ومنفصلة تماماً عن واجهة دخول العائلات، لمعاينة العائلات المعزولة ومراجعة النشاطات وتعديل الأرقام السرية.</p>

      <label class="field-box">
        <span class="field-lbl">👤 معرف المبرمج</span>
        <input
          id="login-dev-user"
          class="input"
          dir="ltr"
          value="developer"
          placeholder="developer"
        />
      </label>

      <label class="field-box">
        <span class="field-lbl">🔑 الرقم السري للمبرمج</span>
        <input
          id="login-dev-pin"
          class="input"
          type="password"
          inputmode="numeric"
          maxlength="16"
          dir="ltr"
          value="9999"
          placeholder="الرمز السري للمبرمج (9999)"
        />
      </label>

      <button type="button" id="login-dev-btn" class="btn full">👨‍💻 دخول بوابة المبرمج</button>
      <a href="/" class="btn g full">🏠 الانتقال لواجهة تطبيق العائلة</a>
    </section>
  `;
}

export function renderCategoriesAndBudgetCard(appState) {
  const snap = appState.localSnapshot;
  const cats = getSortedActiveCategories(snap?.cats);
  const allItems = getActiveItemsList(snap?.items);
  const summary = computeBudgetSummary(allItems, snap?.budget);
  const perCatMap = snap?.budget?.perCat || {};

  return `
    <section class="sec stack" id="role-budget-sec">
      <div class="row">
        <h3>💰 الميزانية الشهرية والأقسام المشتركة للعائلة</h3>
        <span class="chip">المقدر: ${summary.estTotal} د.ل · المدفوع: ${summary.paidTotal} د.ل</span>
      </div>
      <label class="field-box">
        <span class="field-lbl">💳 الميزانية الشهرية الإجمالية (د.ل)</span>
        <div class="row">
          <input id="monthly-budget-inp" class="input grow" type="number" min="0" step="10" value="${esc(summary.budgetMonthly)}" />
          <button type="button" id="save-budget-btn" class="btn">💾 حفظ الميزانية</button>
        </div>
      </label>
    </section>

    <section class="sec stack" id="cats-manager-sec">
      <div class="row">
        <h3>🗂️ إدارة الأقسام وميزانياتها (${cats.length})</h3>
        <button type="button" id="add-cat-btn" class="btn">➕ قسم جديد</button>
      </div>
      <p class="mu">الأقسام مشتركة بين أفراد العائلة، ويمكن للمسؤول والأم والمبرمج إضافتها وتعديلها، بينما يحتفظ كل فرد بترتيبه الخاص.</p>
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
            <label class="field-box">
              <span class="field-lbl">سقف ميزانية القسم (د.ل، 0 = بدون سقف)</span>
              <input
                class="input"
                type="number"
                min="0"
                step="5"
                data-cat-limit="${esc(cat.id)}"
                value="${esc(Number(perCatMap[cat.id]) || 0)}"
                aria-label="سقف ميزانية ${esc(cat.n)}"
              />
            </label>
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
        <h3>🔐 الغرفة والمصادقة والدعوات</h3>
        <span class="badge-ok" dir="ltr">${esc(appState.roomId)}</span>
      </div>
      <div class="list-item">
        <span>معرّف المصادقة المجهولة (Auth UID)</span>
        <code dir="ltr" id="auth-uid-code">${esc(uid)}</code>
      </div>
      <div class="g2">
        <label class="field-box">
          <span class="field-lbl">🏠 اسم العائلة</span>
          <input id="room-name-inp" class="input" placeholder="اسم الغرفة (مثلاً: عائلتي)" value="${esc(meta.name || 'عائلتي')}" />
        </label>
        <label class="field-box">
          <span class="field-lbl">👤 اسم المسؤول</span>
          <input id="admin-name-inp" class="input" placeholder="اسمك" value="${esc(appState.prefs.memberName || 'الأب')}" />
        </label>
      </div>
      <div class="g2">
        <button type="button" id="create-room-btn" class="btn">🏠 إنشاء / تفعيل غرفة v2</button>
        <button type="button" id="start-sync-btn" class="btn g">🔄 تفعيل المزامنة الحية</button>
      </div>
      <p class="mu">الضغط على «إنشاء / تفعيل غرفة v2» يربط العائلة بالسحابة ويفعّل المزامنة الحية تلقائياً.</p>
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
        <h3>☁️ إعدادات الربط المشتركة (Firebase)</h3>
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
      <label for="fb-rtdb-url" class="field-box">
        <span class="field-lbl">🔗 رابط قاعدة البيانات المشترك (Realtime Database URL)</span>
        <input
          id="fb-rtdb-url"
          class="input"
          dir="ltr"
          value="${esc(prefs.rtdbUrl || 'https://family-requests-9e431-default-rtdb.firebaseio.com')}"
        />
      </label>
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
      <h2>🎨 تخصيص المظهر الشخصي</h2>
      <p class="mu">كل فرد يختار ألوانه وخطه بحرية على حسابه. اللون الافتراضي: <code>${DEFAULT_ACCENT}</code>.</p>
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
      <label for="font-range" class="field-box">
        <span class="field-lbl">🔤 حجم الخط: ${prefs.fontSize}px</span>
        <input type="range" id="font-range" class="input" min="14" max="20" value="${prefs.fontSize}">
      </label>
    </section>

    <section class="sec stack">
      <div class="row">
        <h3>🔒 قفل الشاشة المحلي للجهاز (PIN — PBKDF2)</h3>
        <span class="${pinLockEnabled ? 'badge-ok' : 'badge-warn'}">${pinLockEnabled ? 'مفعّل محلياً' : 'غير مفعّل'}</span>
      </div>
      <p class="mu">يُشتق الرمز عبر WebCrypto PBKDF2 ويُحفظ محلياً في IndexedDB على هذا الجهاز فقط.</p>
      <input id="local-pin-inp" class="input" type="password" inputmode="numeric" maxlength="8" placeholder="رمز PIN من 4 إلى 8 أرقام" autocomplete="off" />
      <div class="g2">
        <button type="button" id="save-pin-btn" class="btn">💾 حفظ رمز القفل المحلي</button>
        <button type="button" id="clear-pin-btn" class="btn g">🔓 إلغاء القفل المحلي</button>
      </div>
    </section>`;
}

function renderPersonalCategoryOrderCard(appState) {
  const memberId = appState.session?.memberId || 'mem_father';
  const personalOrder = appState.prefs.personalCatOrder?.[memberId] || [];
  const cats = getSortedActiveCategories(appState.localSnapshot?.cats || {}, personalOrder);

  return `
    <section class="sec stack" id="personal-cat-order-sec">
      <div class="row">
        <h3>🗂️ ترتيب الأقسام الخاص بحسابي (${esc(appState.prefs.memberName || 'الأب')})</h3>
        <button type="button" id="reset-personal-cat-btn" class="btn g">↩️ الافتراضي</button>
      </div>
      <p class="mu">رتّب الأقسام حسب أولوياتك الشخصية دون التأثير على ترتيب بقية أفراد العائلة.</p>
      <div class="stack">
        ${cats
          .map(
            (cat, idx) => `
          <div class="list-item">
            <span>${esc(cat.i)} ${esc(cat.n)}</span>
            <span class="row">
              <button type="button" class="btn g" data-personal-cat-move="${esc(cat.id)}:-1" ${idx === 0 ? 'disabled' : ''} aria-label="رفع ${esc(cat.n)}">↑</button>
              <button type="button" class="btn g" data-personal-cat-move="${esc(cat.id)}:1" ${idx === cats.length - 1 ? 'disabled' : ''} aria-label="خفض ${esc(cat.n)}">↓</button>
            </span>
          </div>`
          )
          .join('')}
      </div>
    </section>`;
}

function renderFamilyMembersManagerCard(appState) {
  const members = getEffectiveMembersList(appState.localSnapshot);

  return `
    <section class="sec stack" id="members-manager-sec">
      <div class="row">
        <h3>👨‍👩‍👧‍👦 إدارة أفراد العائلة والصلاحيات والأرقام السرية</h3>
        <span class="badge-ok">${members.length} أفراد</span>
      </div>
      <p class="mu">أضف أفراد العائلة، وحدد مستوى صلاحية كل فرد ورقمه السري للدخول إلى البرنامج.</p>

      <div class="g2">
        <label class="field-box">
          <span class="field-lbl">👤 الاسم</span>
          <input id="new-member-name" class="input" placeholder="مثلاً: عمر" />
        </label>
        <label class="field-box">
          <span class="field-lbl">😀 الرمز</span>
          <input id="new-member-icon" class="input" value="🧑" maxlength="8" />
        </label>
      </div>
      <div class="g2">
        <label class="field-box">
          <span class="field-lbl">🛡️ الصلاحية</span>
          <select id="new-member-role" class="select">
            <option value="child">🧒 المستوى 4: الأبناء</option>
            <option value="mother">🤱 المستوى 3: الأم</option>
            <option value="admin">👑 المستوى 2: الأب</option>
          </select>
        </label>
        <label class="field-box">
          <span class="field-lbl">🔑 الرقم السري</span>
          <input id="new-member-pin" class="input" dir="ltr" value="0000" maxlength="16" />
        </label>
      </div>
      <button type="button" id="add-member-btn" class="btn full">➕ إضافة فرد جديد للعائلة</button>

      <div class="stack">
        ${members
          .map(
            (m) => `
          <div class="list-item stack" data-member-row="${esc(m.id)}">
            <div class="row">
              <strong>${esc(m.icon || '👤')} ${esc(m.name)}</strong>
              <div class="row">
                <span class="badge-ok">⭐ ${Number(m.points) || 0}</span>
                <button type="button" class="btn r" data-member-delete="${esc(m.id)}" aria-label="حذف ${esc(m.name)}">🗑️</button>
              </div>
            </div>
            <div class="g2">
              <label class="field-box">
                <span class="field-lbl">المستوى</span>
                <select class="select" data-member-role="${esc(m.id)}" aria-label="صلاحية ${esc(m.name)}">
                  <option value="admin" ${m.role === 'admin' ? 'selected' : ''}>👑 الأب (مدير)</option>
                  <option value="mother" ${m.role === 'mother' ? 'selected' : ''}>🤱 الأم (طلبات ومهام)</option>
                  <option value="child" ${m.role === 'child' ? 'selected' : ''}>🧒 الأبناء</option>
                  <option value="member" ${m.role === 'member' ? 'selected' : ''}>🧑 عضو</option>
                </select>
              </label>
              <label class="field-box">
                <span class="field-lbl">الرقم السري (PIN)</span>
                <input class="input" dir="ltr" data-member-pin="${esc(m.id)}" value="${esc(m.accessCode || '0000')}" maxlength="16" aria-label="الرقم السري لـ ${esc(m.name)}" />
              </label>
            </div>
          </div>`
          )
          .join('')}
      </div>
    </section>`;
}

function renderDeveloperSupportPortalCard(appState) {
  const snap = appState.localSnapshot || {};
  const members = getEffectiveMembersList(snap);
  const registry = Array.isArray(appState.prefs.familyRegistry)
    ? appState.prefs.familyRegistry
    : [appState.roomId];
  const logs = Object.values(snap.log || {})
    .sort((a, b) => (Number(b.at) || 0) - (Number(a.at) || 0))
    .slice(0, 12);
  const regEmail =
    snap.meta?.email ||
    Object.values(snap.members || {}).find((m) => m?.email)?.email ||
    (Array.isArray(appState.prefs?.familyDirectory)
      ? appState.prefs.familyDirectory.find((f) => f?.ownerEmail)?.ownerEmail
      : null) ||
    'noor@example.com';
  const emailVerified = Boolean(snap.meta?.emailVerified || snap.meta?.email || regEmail !== 'غير مسجّل');

  return `
    <section class="sec stack" id="dev-portal-sec">
      <div class="row">
        <h3>🛠️ بوابة المبرمج والدعم الفني الشامل</h3>
        <span class="badge-warn">المستوى 1</span>
      </div>
      <p class="mu">صلاحيات كاملة للتنقل بين جميع العائلات المعزولة، مراجعة النشاطات، ورؤية أو تعديل أرقام الدخول السرية للدعم الفني.</p>

      <div class="list-item">
        <span>📧 بريد تسجيل العائلة: <code dir="ltr">${esc(regEmail)}</code></span>
        <span class="${emailVerified ? 'badge-ok' : 'badge-warn'}">${emailVerified ? '✅ مؤكد' : '⏳ غير مؤكد'}</span>
      </div>

      <div class="row">
        <input id="dev-new-family-inp" class="input grow" dir="ltr" placeholder="إنشاء كود عائلة جديدة (مثلاً: family-ahmad)" />
        <button type="button" id="dev-add-family-btn" class="btn">➕ إضافة عائلة</button>
      </div>

      <div class="stack">
        <strong>🗂️ فهرس العائلات (${registry.length}):</strong>
        <div class="chips">
          ${registry
            .map(
              (fam) => `
            <button
              type="button"
              class="btn ${fam === appState.roomId ? '' : 'g'}"
              data-dev-switch-family="${esc(fam)}"
              dir="ltr"
            >${fam === appState.roomId ? '✓ ' : '📂 '}${esc(fam)}</button>`
            )
            .join('')}
        </div>
      </div>

      <div class="card">
        <div class="ch"><span>🔑 جدول حسابات وأرقام العائلة الحالية (${esc(appState.roomId)})</span></div>
        ${members
          .map(
            (m) => `
          <div class="list-item">
            <span>${esc(m.icon || '👤')} <strong>${esc(m.name)}</strong> (${esc(getRoleShortLabel(m.role))})</span>
            <code dir="ltr">PIN: ${esc(m.accessCode || '0000')}</code>
          </div>`
          )
          .join('')}
      </div>

      <div class="card">
        <div class="ch"><span>📜 آخر نشاطات العائلة (${logs.length})</span></div>
        ${
          logs.length
            ? logs
                .map(
                  (l) => `
              <div class="list-item">
                <span><strong>${esc(l.actorName || 'مستخدم')}</strong>: ${esc(l.action || '')} ${esc(l.target || '')}</span>
                <small class="mu">${esc(l.legacyTime || new Date(l.at || Date.now()).toLocaleTimeString('ar'))}</small>
              </div>`
                )
                .join('')
            : '<div class="list-item"><span class="mu">لا توجد نشاطات مسجّلة بعد في هذه العائلة.</span></div>'
        }
      </div>
    </section>`;
}

export function renderAiSettingsCard(appState) {
  const cfg = getOrInitAiConfig();
  const edited = getEditedAiProvider(cfg);
  const ready = isAiProviderReady(edited);
  const models = Array.isArray(edited?.models) ? edited.models : [];

  return `
    <section class="sec stack" id="ai-settings-sec">
      <div class="row">
        <h3>🤖 إعدادات مزوّد الذكاء الاصطناعي ومفاتيح API</h3>
        <span class="${ready ? 'badge-ok' : 'badge-warn'}">${ready ? 'مفتاح جاهز للجلسة' : 'يعمل بالوضع المحلي'}</span>
      </div>
      <p class="mu">المفتاح يُحفظ في ذاكرة الجلسة المؤقتة للمتصفح فقط ولا يُرفع إلى المستودع أو قاعدة البيانات.</p>

      <div class="chips">
        ${cfg.ps
          .map(
            (p) => `
          <button
            type="button"
            class="btn ${p.id === edited?.id ? '' : 'g'}"
            data-ai-prov-select="${esc(p.id)}"
          >${esc(p.name)}${p.id === cfg.on ? ' ✓' : ''}</button>`
          )
          .join('')}
      </div>

      <div class="g2">
        <label class="field-box">
          <span class="field-lbl">🏷️ اسم المزوّد</span>
          <input id="ai-prov-name" class="input" value="${esc(edited?.name || '')}" />
        </label>
        <label class="field-box">
          <span class="field-lbl">⚙️ النوع</span>
          <select id="ai-prov-type" class="select">
            <option value="gemini" ${edited?.type === 'gemini' ? 'selected' : ''}>Google Gemini</option>
            <option value="openai" ${edited?.type === 'openai' ? 'selected' : ''}>OpenAI Compatible</option>
            <option value="anthropic" ${edited?.type === 'anthropic' ? 'selected' : ''}>Anthropic Claude</option>
          </select>
        </label>
      </div>

      <label class="field-box">
        <span class="field-lbl">🔗 رابط API Base URL</span>
        <input id="ai-prov-url" class="input" dir="ltr" value="${esc(edited?.url || '')}" />
      </label>

      <div class="g2">
        <label class="field-box">
          <span class="field-lbl">🧠 الموديل</span>
          <input id="ai-prov-model" class="input" dir="ltr" list="ai-models-datalist" value="${esc(edited?.model || '')}" />
        </label>
        <label class="field-box">
          <span class="field-lbl">🔑 مفتاح API (اختياري)</span>
          <input
            id="ai-prov-key"
            class="input"
            type="password"
            dir="ltr"
            autocomplete="off"
            value="${esc(edited?.key || '')}"
            placeholder="AIza... أو sk-..."
          />
        </label>
      </div>
      <datalist id="ai-models-datalist">
        ${models.map((m) => `<option value="${esc(m)}">`).join('')}
      </datalist>

      <div class="g2">
        <button type="button" id="ai-save-prov-btn" class="btn">💾 حفظ وتفعيل المزوّد</button>
        <button type="button" id="ai-test-prov-btn" class="btn g">🔌 اختبار الاتصال</button>
      </div>
      <button type="button" id="ai-scan-models-btn" class="btn g full">🔍 فحص موديلات Gemini المجانية</button>
      <pre id="ai-test-result" class="chat-pre mu">${esc(appState?.aiTestOutput || '')}</pre>
    </section>`;
}

export function renderUnifiedSettingsView(appState, colors, pinLockEnabled = false) {
  const role = appState.prefs.currentRole || 'admin';
  const isDev = role === 'developer';
  const isAdminOrDev = role === 'developer' || role === 'admin';
  const canManageBudgetAndCats = ['developer', 'admin', 'mother'].includes(role);

  return `
    <section class="sec stack" id="settings-header-sec">
      <div class="row">
        <h2>⚙️ الإعدادات المركزية والصلاحيات</h2>
        <span class="badge-ok">${esc(ROLE_LABELS[role] || ROLE_LABELS.member)}</span>
      </div>
      <p class="mu">كل إعدادات الحساب، العائلة، الأعضاء، الميزانية، والربط السحابي منظّمة في مكان واحد حسب مستوى صلاحيتك.</p>
    </section>

    ${isDev ? renderDeveloperSupportPortalCard(appState) : ''}
    ${renderPersonalCategoryOrderCard(appState)}
    ${renderThemeSettingsCard(appState.prefs, colors, pinLockEnabled)}
    ${isAdminOrDev ? renderFamilyMembersManagerCard(appState) : ''}
    ${canManageBudgetAndCats ? renderCategoriesAndBudgetCard(appState) : ''}
    ${isAdminOrDev ? renderAiSettingsCard(appState) : ''}
    ${
      isAdminOrDev
        ? `${renderRoomAndAuthCard(appState)}
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
           ${renderFirebaseDiagnosticsCard(appState.firebaseStatus, appState.prefs)}`
        : ''
    }
  `;
}
