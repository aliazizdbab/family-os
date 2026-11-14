import { esc } from './dialogs.js';
import { DEFAULT_ACCENT, DEFAULT_FAMILY_MEMBERS } from '../schema.js';
import { buildInviteUrl } from '../auth.js';
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

export function renderLoginScreenView(appState) {
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
        <h2>🔐 بوابة الدخول وفصل العائلات</h2>
        <span class="badge-ok">4 مستويات</span>
      </div>
      <p class="mu">كل عائلة مفهرسة ومعزولة بالكامل بكودها الخاص؛ بيانات العائلة وطلباتها ومهامها وأعضائها لا تختلط بأي عائلة أخرى.</p>

      <div class="sec stack">
        <label class="field-box">
          <span class="field-lbl">🏠 كود العائلة الحالي (${esc(famName)})</span>
          <div class="row">
            <input id="login-family-code" class="input grow" dir="ltr" value="${esc(appState.roomId)}" placeholder="مثلاً: family-v2-local" />
            <button type="button" id="switch-family-code-btn" class="btn g">🔄 اعتماد كود العائلة</button>
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
        <strong>👤 اختر حسابك من أفراد العائلة:</strong>
        <div class="profile-grid">
          ${members
            .map(
              (m) => `
            <button
              type="button"
              class="profile-card ${m.id === selectedMember?.id ? 'active' : ''}"
              data-login-member="${esc(m.id)}"
            >
              <span class="profile-ico">${esc(m.icon || '👤')}</span>
              <strong>${esc(m.name)}</strong>
              <small class="mu">${esc(getRoleShortLabel(m.role))}</small>
              <span class="badge-ok">⭐ ${Number(m.points) || 0} نقطة</span>
            </button>`
            )
            .join('')}
        </div>
      </div>

      <label class="field-box">
        <span class="field-lbl">🔑 الرقم السري للحساب المختار (${esc(selectedMember?.name || 'الأب')})</span>
        <input
          id="login-pin-inp"
          class="input"
          type="password"
          inputmode="numeric"
          maxlength="16"
          dir="ltr"
          value="${esc(selectedMember?.accessCode || '1234')}"
          placeholder="أدخل الرقم السري للحساب"
        />
      </label>
      <button type="button" id="login-submit-btn" class="btn full">🔓 دخول للبرنامج</button>

      <div class="sec stack">
        <div class="row">
          <strong>👨‍💻 بوابة المبرمج والدعم الفني (المستوى 1)</strong>
          <span class="badge-warn">صلاحيات شاملة لكل العائلات</span>
        </div>
        <p class="mu">لمعاينة جميع العائلات وفهرس المستخدمين، مراجعة النشاطات، ورؤية وتعديل الأرقام السرية للدعم الفني.</p>
        <div class="row">
          <input
            id="login-dev-pin"
            class="input grow"
            type="password"
            inputmode="numeric"
            maxlength="16"
            dir="ltr"
            value="9999"
            placeholder="الرمز السري للمبرمج (9999)"
          />
          <button type="button" id="login-dev-btn" class="btn g">👨‍💻 دخول المبرمج</button>
        </div>
      </div>
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

  return `
    <section class="sec stack" id="dev-portal-sec">
      <div class="row">
        <h3>🛠️ بوابة المبرمج والدعم الفني الشامل</h3>
        <span class="badge-warn">المستوى 1</span>
      </div>
      <p class="mu">صلاحيات كاملة للتنقل بين جميع العائلات المعزولة، مراجعة النشاطات، ورؤية أو تعديل أرقام الدخول السرية للدعم الفني.</p>

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
