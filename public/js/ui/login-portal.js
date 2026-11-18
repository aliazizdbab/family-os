/**
 * Family Portal Login View & Registration Modal
 *
 * Provides a modern, commercial-grade RTL login interface:
 * - Family Name + Member Name + Password (with show/hide eye toggle).
 * - Full backward-compatibility IDs for existing tests & offline operation.
 * - Multi-family registration with email confirmation and role onboarding instructions.
 * - Segregated link to Developer/Staff portal.
 */

import { getEffectiveMembersList } from './settings.js';

function esc(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function renderFamilyLoginView(appState) {
  if (appState.loginMode === 'register') {
    return renderRegisterFamilyView(appState);
  }
  if (appState.loginMode === 'verify' && appState.pendingVerification) {
    return renderEmailVerificationView(appState);
  }

  const snap = appState.localSnapshot || {};
  const members = getEffectiveMembersList(snap);
  const selectedId = appState.loginSelectedMemberId || members[0]?.id || 'mem_father';
  const selectedMember = members.find((m) => m.id === selectedId) || members[0];
  const famName = snap.meta?.name || appState.roomId || 'عائلتي';
  const defaultFamVal = appState.roomId || 'family-v2-local';

  return `
    <section class="sec stack login-card" id="login-screen">
      <div class="login-header">
        <div class="app-brand-badge">
          <span class="brand-icon">🏠</span>
          <div class="brand-text">
            <h2>Family OS</h2>
            <small class="mu">بوابة العائلة الذكية المتكاملة</small>
          </div>
        </div>
        <span class="badge-ok">مساحة خاصة وآمنة</span>
      </div>

      <p class="login-desc">أهلاً بك! سجّل الدخول باستخدام اسم عائلتك واسمك الشخصي للوصول إلى طلبات وميزانية ومهام أسرتك (${esc(famName)}).</p>

      <form id="family-login-form" class="stack" novalidate>
        <label class="field-box">
          <span class="field-lbl">🏠 اسم العائلة</span>
          <input
            id="login-family-code"
            class="input"
            type="text"
            required
            autocomplete="organization"
            placeholder="مثال: عائلة الأحمدي أو family-v2-local"
            value="${esc(defaultFamVal)}"
          />
        </label>

        <div class="stack">
          <label class="field-box">
            <span class="field-lbl">👤 اسم الفرد في العائلة</span>
            <input
              id="login-username-inp"
              class="input"
              type="text"
              required
              autocomplete="name"
              placeholder="مثال: الأب أو محمد أو سارة"
              value="${esc(selectedMember?.name || 'الأب')}"
            />
          </label>
          ${
            members.length > 0
              ? `
            <div class="chips" aria-label="اختيار سريع لأفراد العائلة">
              ${members
                .map(
                  (m) => `
                <button
                  type="button"
                  class="btn ${m.id === selectedMember?.id ? '' : 'g'}"
                  data-login-member="${esc(m.id)}"
                >${esc(m.icon || '👤')} ${esc(m.name)}</button>
              `
                )
                .join('')}
            </div>
          `
              : ''
          }
        </div>

        <label class="field-box">
          <span class="field-lbl">🔑 كلمة المرور / الرقم السري</span>
          <div class="password-wrapper">
            <input
              id="login-pin-inp"
              class="input grow"
              type="password"
              required
              autocomplete="current-password"
              placeholder="أدخل كلمة المرور"
              value="${esc(selectedMember?.accessCode || '1234')}"
            />
            <button
              type="button"
              id="toggle-pwd-visibility-btn"
              class="btn g pwd-toggle-btn"
              aria-label="إظهار أو إخفاء كلمة المرور"
              title="إظهار/إخفاء"
            >👁️</button>
          </div>
        </label>

        <div id="login-error-box" class="banner danger-banner" hidden aria-live="polite"></div>

        <button type="submit" id="login-submit-btn" class="btn full primary-btn">
          <span class="btn-text">🔓 دخول إلى مساحة العائلة</span>
          <span class="spinner" hidden>⏳</span>
        </button>
      </form>

      <div class="login-divider">
        <span>أو</span>
      </div>

      <div class="login-actions stack">
        <p class="mu">ليس لعائلتك حساب بعد؟ سجّل عائلة جديدة وأكّد بريدك الإلكتروني لاستلام دليل إضافة أفراد الأسرة.</p>
        <button type="button" id="toggle-register-family-btn" class="btn g full">
          ✨ تسجيل عائلة جديدة
        </button>
      </div>

      <div class="login-footer">
        <small class="mu">بوابة العائلات مستقلة تماماً. إدارة المنصة لها تطبيق منفصل يُثبَّت على جهاز فريق الدعم.</small>
      </div>
    </section>
  `;
}

export function renderRegisterFamilyView(appState) {
  const draft = appState.pendingVerification || {};

  return `
    <section class="sec stack login-card" id="register-family-sec">
      <div class="row">
        <h2>🏡 تسجيل عائلة جديدة في Family OS</h2>
        <span class="badge-ok">بيانات معزولة ومشفرة</span>
      </div>
      <p class="mu">أنشئ مساحة خاصة لعائلتك، وأدخل بريدك الإلكتروني لتأكيد التسجيل واستلام رسالة تشرح خطوات إضافة باقي أفراد الأسرة وصلاحياتهم بالتفصيل.</p>

      <form id="register-family-form" class="stack" novalidate>
        <label class="field-box">
          <span class="field-lbl">🏠 اسم العائلة</span>
          <input id="reg-family-name" class="input" required value="${esc(draft.familyName || '')}" placeholder="مثلاً: عائلة الأحمد" />
        </label>

        <label class="field-box">
          <span class="field-lbl">🆔 كود العائلة المميز (اختياري بالإنجليزية)</span>
          <input id="reg-family-code" class="input" dir="ltr" value="${esc(draft.roomId || '')}" placeholder="مثلاً: family-ahmad (يُولّد تلقائياً إن تُرك فارغاً)" />
        </label>

        <div class="g2">
          <label class="field-box">
            <span class="field-lbl">👤 اسم المستخدم المؤسس (مدير العائلة)</span>
            <input id="reg-admin-name" class="input" required value="${esc(draft.adminName || 'الأب')}" placeholder="مثلاً: الأب أو أحمد" />
          </label>
          <label class="field-box">
            <span class="field-lbl">🔑 كلمة مرور المسؤول المؤسس</span>
            <div class="password-wrapper">
              <input id="reg-admin-pin" class="input grow" type="password" required maxlength="32" dir="ltr" value="${esc(draft.adminPin || '1234')}" placeholder="6 خانات فأكثر" />
              <button type="button" id="toggle-reg-pwd-btn" class="btn g pwd-toggle-btn" title="إظهار/إخفاء">👁️</button>
            </div>
          </label>
        </div>

        <label class="field-box">
          <span class="field-lbl">📧 البريد الإلكتروني لتأكيد التسجيل وإرسال دليل العائلة</span>
          <input id="reg-family-email" class="input" type="email" required dir="ltr" value="${esc(draft.email || '')}" placeholder="family@example.com" />
          <small class="mu">ستصلك رسالة تحتوي على كود التأكيد وشرح كيفية إضافة باقي أفراد الأسرة وصلاحياتهم.</small>
        </label>

        <div id="reg-error-box" class="banner danger-banner" hidden aria-live="polite"></div>

        <div class="row">
          <button type="button" id="back-to-login-btn" class="btn g grow">↩️ العودة لتسجيل الدخول</button>
          <button type="submit" id="register-family-submit-btn" class="btn primary-btn grow">
            📧 تسجيل العائلة وإرسال رسالة التأكيد
          </button>
        </div>
      </form>
    </section>
  `;
}

export function renderEmailVerificationView(appState) {
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

      <button type="button" id="confirm-email-code-btn" class="btn full primary-btn">
        ✅ تأكيد التسجيل والدخول للعائلة
      </button>

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
