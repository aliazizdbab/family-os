/**
 * Developer & Staff Admin Portal View & Management Controller
 *
 * Full management dashboard for Owner (aliazizdbab@gmail.com), Developers, and Support Staff.
 * Covers: Families Management, Pending Approvals, RBAC User Controls, Credential Resets,
 * Feature Flags, Integrations (Firebase & AI APIs), Audit Logs, and Diagnostics.
 */

import {
  FAMILY_FEATURES,
  FAMILY_ROLE_LABELS,
  STAFF_ROLE_LABELS,
  defaultFeatureFlags,
} from '../identity.js';

function esc(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function renderDeveloperLoginView(_staffState) {
  return `
    <section class="sec stack login-card dev-login-box" id="dev-login-screen">
      <div class="login-header">
        <div class="app-brand-badge">
          <span class="brand-icon">🛡️</span>
          <div class="brand-text">
            <h2>Family OS — بوابة الإدارة والمبرمجين</h2>
            <small class="mu">لوحة التحكم المركزية والدعم الفني</small>
          </div>
        </div>
        <span class="badge-warn">دخول محمي ومقيد</span>
      </div>

      <p class="mu">
        تطبيق مستقل لإدارة المنصة والدعم الفني. الدخول محصور بالمالك وأعضاء فريق الدعم المدعوين
        بالبريد من داخل لوحة التحكم.
      </p>

      <div class="stack dev-login-options">
        <button type="button" id="admin-google-login-btn" class="btn full primary-btn google-btn">
          <span class="google-icon">🌐</span>
          <span>تسجيل الدخول بحساب Google (المالك)</span>
        </button>

        <div class="login-divider">
          <span>أو الدخول ببيانات الموظف</span>
        </div>

        <form id="admin-email-login-form" class="stack" novalidate>
          <label class="field-box">
            <span class="field-lbl">👤 بريد عضو فريق الدعم</span>
            <input
              id="login-dev-user"
              class="input"
              dir="ltr"
              type="email"
              value=""
              placeholder="name@example.com"
              autocomplete="username"
            />
          </label>

          <label class="field-box">
            <span class="field-lbl">🔑 كلمة المرور</span>
            <div class="password-wrapper">
              <input
                id="login-dev-pin"
                class="input grow"
                type="password"
                maxlength="64"
                dir="ltr"
                value=""
                placeholder="كلمة المرور"
                autocomplete="current-password"
              />
              <button
                type="button"
                id="toggle-admin-pwd-btn"
                class="btn g pwd-toggle-btn"
                title="إظهار/إخفاء"
              >👁️</button>
            </div>
          </label>

          <div id="admin-login-error" class="banner danger-banner" hidden aria-live="polite"></div>

          <button type="button" id="login-dev-btn" class="btn primary-btn full">
            👨‍💻 دخول بوابة المبرمج
          </button>
        </form>
      </div>

      <div class="login-footer">
        <a href="/" class="btn g full">🏠 العودة إلى تطبيق العائلات</a>
      </div>
    </section>
  `;
}

export function renderAdminDashboard(adminData) {
  const staff = adminData.staffSession || {};
  const activeTab = adminData.activeTab || 'families';
  const families = adminData.families || [];
  const pendingCount = families.filter((f) => f.status === 'pending').length;

  return `
    <div class="admin-dashboard stack">
      <!-- Admin Top Bar -->
      <header class="admin-topbar row">
        <div class="admin-user-info row">
          <span class="admin-avatar">👨‍💻</span>
          <div>
            <strong>${esc(staff.staffName || 'المبرمج')}</strong>
            <span class="chip role-chip">${esc(STAFF_ROLE_LABELS[staff.staffRole] || staff.staffRole || 'مبرمج')}</span>
            <small class="mu" dir="ltr">(${esc(staff.email || '')})</small>
          </div>
        </div>
        <div class="row">
          <span id="admin-fb-status" class="status-pill ok-pill">متصل بـ Firebase</span>
          <button type="button" id="admin-logout-btn" class="btn g session-btn">🚪 تسجيل خروج</button>
        </div>
      </header>

      <!-- Admin Navigation Tabs -->
      <nav class="admin-nav-tabs row" role="tablist">
        <button type="button" class="btn ${activeTab === 'families' ? 'primary-btn' : 'g'}" data-admin-tab="families">
          🏢 العائلات ${pendingCount > 0 ? `<span class="badge-pending">${pendingCount} معلق</span>` : ''}
        </button>
        <button type="button" class="btn ${activeTab === 'users' ? 'primary-btn' : 'g'}" data-admin-tab="users">
          👥 المستخدمين والصلاحيات
        </button>
        <button type="button" class="btn ${activeTab === 'staff' ? 'primary-btn' : 'g'}" data-admin-tab="staff">
          👨‍💻 فريق الدعم
        </button>
        <button type="button" class="btn ${activeTab === 'features' ? 'primary-btn' : 'g'}" data-admin-tab="features">
          ⚙️ إعدادات وتفضيلات العائلات
        </button>
        <button type="button" class="btn ${activeTab === 'integrations' ? 'primary-btn' : 'g'}" data-admin-tab="integrations">
          🔗 التكاملات والذكاء الاصطناعي
        </button>
        <button type="button" class="btn ${activeTab === 'audit' ? 'primary-btn' : 'g'}" data-admin-tab="audit">
          📜 سجل العمليات الإدارية
        </button>
        <button type="button" class="btn ${activeTab === 'diagnostics' ? 'primary-btn' : 'g'}" data-admin-tab="diagnostics">
          🩺 التشخيص والدعم
        </button>
      </nav>

      <!-- Main Content Based on Selected Tab -->
      <div id="admin-tab-content" class="stack">
        ${renderCurrentTabContent(activeTab, adminData)}
      </div>
    </div>
  `;
}

function renderFamilyManager(data) {
  const detail = data.familyDetail;
  const fam = (data.families || []).find((f) => f.fid === data.manageFid);
  if (!detail || !fam) {
    return '<p class="mu">تعذّر تحميل بيانات العائلة.</p>';
  }
  const roleLabels = { admin: 'مدير', mother: 'أم', member: 'عضو', child: 'ابن/ابنة' };

  return `
    <div class="sec stack">
      <div class="row">
        <div>
          <h3>⚙️ إدارة عائلة: ${esc(fam.name)}</h3>
          <small class="mu" dir="ltr">${esc(fam.fid)}</small>
        </div>
        <button type="button" class="btn g" data-action="manage-back">↩️ رجوع للقائمة</button>
      </div>

      <div class="row">
        <span class="status-badge status-${esc(fam.status)}">
          ${fam.status === 'active' ? 'نشطة' : fam.status === 'pending' ? 'معلّقة' : 'موقوفة'}
        </span>
        <button type="button" class="btn primary-btn" data-action="force-update" data-fid="${esc(fam.fid)}">🔄 إجبار التطبيق على التحديث</button>
        ${
          data.canManage
            ? fam.status === 'active'
              ? `<button type="button" class="btn g" data-action="suspend-family" data-fid="${esc(fam.fid)}">⏸️ إيقاف العائلة</button>`
              : `<button type="button" class="btn g" data-action="activate-family" data-fid="${esc(fam.fid)}">▶️ تنشيط العائلة</button>`
            : '<span class="chip">👁️ عرض فقط</span>'
        }
      </div>
    </div>

    <div class="sec stack">
      <h4>👥 الأعضاء (${detail.members.length})</h4>
      <p class="mu">يمكنك إيقاف وصول أي عضو، أو تعيين رقم سري جديد له. تغيير الرقم السري يُنشئ اعتماداً جديداً يُفعَّل عند أول دخول.</p>
      <div class="table-responsive cards-on-mobile">
        <table class="admin-table members-table">
          <thead>
            <tr>
              <th>الاسم</th>
              <th>الصلاحية</th>
              <th>الحالة</th>
              <th>البريد/المعرّف</th>
              <th>الرقم السري</th>
              <th>الإجراءات</th>
            </tr>
          </thead>
          <tbody>
            ${detail.members
              .map(
                (m) => `
              <tr data-member-id="${esc(m.id)}">
                <td data-label="الاسم"><strong>${esc(m.icon)} ${esc(m.name)}</strong></td>
                <td data-label="الصلاحية">
                  <select class="input member-role-select" data-action="member-role" data-fid="${esc(fam.fid)}" data-member-id="${esc(m.id)}">
                    ${['admin', 'mother', 'member', 'child']
                      .map((r) => `<option value="${r}"${m.role === r ? ' selected' : ''}>${roleLabels[r]}</option>`)
                      .join('')}
                  </select>
                </td>
                <td data-label="الحالة">
                  ${m.off ? '<span class="status-badge status-suspended">موقوف</span>' : '<span class="status-badge status-active">نشط</span>'}
                </td>
                <td data-label="البريد"><code dir="ltr" class="member-email">${esc(m.email || '—')}</code></td>
                <td data-label="الرقم السري"><code dir="ltr">${m.pin ? esc(m.pin) : '—'}</code></td>
                <td data-label="إجراءات">
                  <div class="row">
                    <button type="button" class="btn g" data-action="toggle-member-access" data-fid="${esc(fam.fid)}" data-member-id="${esc(m.id)}" data-off="${m.off ? 'true' : 'false'}">
                      ${m.off ? '▶️ تمكين' : '⏸️ إيقاف'}
                    </button>
                    <button type="button" class="btn g" data-action="set-member-pin" data-fid="${esc(fam.fid)}" data-name="${esc(m.name)}">🔑 رقم سري</button>
                  </div>
                </td>
              </tr>
            `
              )
              .join('')}
          </tbody>
        </table>
      </div>
    </div>

    <div class="sec stack">
      <h4>➕ إضافة عضو للعائلة</h4>
      <p class="mu">يُنشأ العضو مع رقم سري، ويستطيع الدخول فوراً من تطبيق العائلة باسم العائلة واسمه والرقم السري.</p>
      <div class="ai-form-grid">
        <label class="field-box">
          <span class="field-lbl">اسم العضو</span>
          <input id="new-member-name" class="input" placeholder="مثال: أحمد" maxlength="40" />
        </label>
        <label class="field-box">
          <span class="field-lbl">الصلاحية</span>
          <select id="new-member-role" class="input">
            <option value="member">عضو</option>
            <option value="mother">أم</option>
            <option value="child">ابن/ابنة</option>
            <option value="admin">مدير</option>
          </select>
        </label>
        <label class="field-box">
          <span class="field-lbl">الرقم السري</span>
          <input id="new-member-pin" class="input" dir="ltr" placeholder="مثال: 4821" maxlength="32" />
        </label>
        <button type="button" id="add-family-member-btn" class="btn primary-btn" data-fid="${esc(fam.fid)}">➕ إضافة العضو</button>
      </div>
    </div>
  `;
}

function renderCurrentTabContent(tab, data) {
  switch (tab) {
    case 'families':
      return renderFamiliesTab(data);
    case 'users':
      return renderUsersTab(data);
    case 'staff':
      return renderStaffTab(data);
    case 'features':
      return renderFeaturesTab(data);
    case 'integrations':
      return renderIntegrationsTab(data);
    case 'audit':
      return renderAuditTab(data);
    case 'diagnostics':
      return renderDiagnosticsTab(data);
    default:
      return renderFamiliesTab(data);
  }
}

function renderFamiliesTab(data) {
  if (data.manageFid && data.familyDetail) {
    return renderFamilyManager(data);
  }
  const families = data.families || [];
  const pending = families.filter((f) => f.status === 'pending');
  const active = families.filter((f) => f.status === 'active');
  const suspended = families.filter((f) => f.status === 'suspended');

  return `
    <div class="stack">
      <!-- Summary Metrics -->
      <div class="admin-metrics-grid">
        <div class="metric-card">
          <span class="metric-num">${families.length}</span>
          <span class="metric-lbl">إجمالي العائلات</span>
        </div>
        <div class="metric-card highlight-metric">
          <span class="metric-num">${pending.length}</span>
          <span class="metric-lbl">طلبات جديدة معلقة</span>
        </div>
        <div class="metric-card">
          <span class="metric-num">${active.length}</span>
          <span class="metric-lbl">عائلات نشطة</span>
        </div>
        <div class="metric-card">
          <span class="metric-num">${suspended.length}</span>
          <span class="metric-lbl">عائلات موقوفة</span>
        </div>
      </div>

      <!-- Action Bar -->
      <div class="row">
        <h3>قائمة العائلات وإدارتها</h3>
      </div>

      <!-- Pending Registrations Section -->
      ${
        pending.length > 0
          ? `
        <div class="sec stack pending-approval-box">
          <div class="row">
            <h4>⏳ طلبات تسجيل العائلات المعلقة (${pending.length})</h4>
            <span class="badge-warn">تحتاج موافقة الإدارة</span>
          </div>
          <div class="stack">
            ${pending
              .map(
                (fam) => `
              <div class="list-item row" data-fam-id="${esc(fam.fid)}">
                <div class="grow">
                  <strong>🏠 ${esc(fam.name)}</strong>
                  <div>
                    <small class="mu">البريد: <span dir="ltr">${esc(fam.ownerEmail || 'غير محدد')}</span></small>
                    ${fam.ownerPhone ? ` · <small class="mu">الهاتف: <span dir="ltr">${esc(fam.ownerPhone)}</span></small>` : ''}
                  </div>
                  <small class="mu">تاريخ الطلب: ${new Date(fam.createdAt || Date.now()).toLocaleString('ar')}</small>
                </div>
                <div class="row">
                  ${
                    data.canManage
                      ? `
                  <button type="button" class="btn primary-btn" data-action="approve-family" data-fid="${esc(fam.fid)}" data-name="${esc(fam.name)}">
                    ✅ تفعيل وقبول
                  </button>
                  <button type="button" class="btn r" data-action="reject-family" data-fid="${esc(fam.fid)}" data-name="${esc(fam.name)}">
                    ❌ رفض وحذف
                  </button>
                  `
                      : '<span class="chip">👁️ عرض فقط</span>'
                  }
                </div>
              </div>
            `
              )
              .join('')}
          </div>
        </div>
      `
          : ''
      }

      <!-- All Families Table -->
      <div class="sec stack">
        <h4>📋 جميع العائلات المسجلة في المنصة</h4>
        ${
          families.length === 0
            ? '<p class="mu">لا توجد عائلات مسجلة حالياً.</p>'
            : `
          <div class="table-responsive">
            <table class="admin-table">
              <thead>
                <tr>
                  <th>اسم العائلة</th>
                  <th>معرّف النظام (FID)</th>
                  <th>الحالة</th>
                  <th>تاريخ الإنشاء</th>
                  <th>الإجراءات الإدارية</th>
                </tr>
              </thead>
              <tbody>
                ${families
                  .map(
                    (fam) => `
                  <tr>
                    <td><strong>🏠 ${esc(fam.name)}</strong></td>
                    <td><code dir="ltr">${esc(fam.fid)}</code></td>
                    <td>
                      <span class="status-badge status-${fam.status}">
                        ${fam.status === 'active' ? 'نشط' : fam.status === 'pending' ? 'معلق' : 'موقوف'}
                      </span>
                    </td>
                    <td><small>${new Date(fam.createdAt || Date.now()).toLocaleDateString('ar')}</small></td>
                    <td>
                      <div class="row">
                        ${
                          fam.isLocal
                            ? `<span class="badge-warn" title="هذه العائلة موجودة على هذا الجهاز فقط ولم تُسجَّل في السحابة بعد، لذا لا يمكن إيقافها أو حذفها من هنا.">📱 محلية فقط</span>`
                            : !data.canManage
                              ? `<span class="chip" title="صلاحيتك للعرض فقط">👁️ عرض فقط</span>`
                              : `
                        <button type="button" class="btn g" data-action="manage-family" data-fid="${esc(fam.fid)}">⚙️ إدارة</button>
                        ${
                          fam.status === 'active'
                            ? `<button type="button" class="btn g" data-action="suspend-family" data-fid="${esc(fam.fid)}">⏸️ إيقاف</button>`
                            : `<button type="button" class="btn g" data-action="activate-family" data-fid="${esc(fam.fid)}">▶️ تنشيط</button>`
                        }
                        <button type="button" class="btn r" data-action="delete-family" data-fid="${esc(fam.fid)}" data-name="${esc(fam.name)}">🗑️</button>
                        `
                        }
                      </div>
                    </td>
                  </tr>
                `
                  )
                  .join('')}
              </tbody>
            </table>
          </div>
        `
        }
      </div>
    </div>
  `;
}

function renderUsersTab(data) {
  const families = data.families || [];
  const selectedFid = data.selectedFid || families[0]?.fid || '';
  const selectedFamily = families.find((f) => f.fid === selectedFid);
  const members = data.familyMembers || [];

  return `
    <div class="sec stack">
      <div class="row">
        <h3>👥 إدارة أفراد العائلات والمستخدمين والصلاحيات</h3>
        <label class="row">
          <span>اختر العائلة:</span>
          <select id="admin-users-fam-select" class="input">
            ${families.map((f) => `<option value="${esc(f.fid)}" ${f.fid === selectedFid ? 'selected' : ''}>${esc(f.name)} (${esc(f.fid)})</option>`).join('')}
          </select>
        </label>
      </div>

      ${
        !selectedFamily
          ? '<p class="mu">اختر عائلة لعرض أفرادها وإدارتهم.</p>'
          : `
        <div class="stack">
          <div class="row">
            <h4>أفراد عائلة (${esc(selectedFamily.name)})</h4>
            <button type="button" id="admin-add-member-btn" class="btn primary-btn" data-fid="${esc(selectedFid)}">
              ➕ إضافة فرد جديد للعائلة
            </button>
          </div>

          <div class="stack">
            ${
              members.length === 0
                ? '<p class="mu">لم يتم تسجيل أفراد بعد في هذه العائلة.</p>'
                : members
                    .map(
                      (m) => `
                <div class="list-item row" data-member-id="${esc(m.id)}">
                  <div class="grow">
                    <strong>${esc(m.icon || '👤')} ${esc(m.name)}</strong>
                    <span class="chip">${esc(FAMILY_ROLE_LABELS[m.role] || m.role)}</span>
                    ${m.off ? '<span class="badge-warn">معطّل</span>' : '<span class="badge-ok">نشط</span>'}
                    <div>
                      <small class="mu">معرف العضو: <code dir="ltr">${esc(m.id)}</code></small>
                      ${m.email ? ` · <small class="mu">البريد: <span dir="ltr">${esc(m.email)}</span></small>` : ''}
                    </div>
                  </div>
                  <div class="row">
                    <button type="button" class="btn g" data-action="reset-member-cred" data-fid="${esc(selectedFid)}" data-member-id="${esc(m.id)}" data-name="${esc(m.name)}">
                      🔄 إعادة تعيين الاعتماد
                    </button>
                    <button type="button" class="btn g" data-action="toggle-member-active" data-fid="${esc(selectedFid)}" data-member-id="${esc(m.id)}" data-off="${Boolean(m.off)}">
                      ${m.off ? 'تفعيل الحساب' : 'تعطيل الحساب'}
                    </button>
                    <button type="button" class="btn r" data-action="delete-member" data-fid="${esc(selectedFid)}" data-member-id="${esc(m.id)}">
                      🗑️
                    </button>
                  </div>
                </div>
              `
                    )
                    .join('')
            }
          </div>
        </div>
      `
      }
    </div>
  `;
}

function renderStaffTab(data) {
  const staff = data.staffList || [];
  const invites = data.staffInvites || [];
  const session = data.staffSession || {};
  const isOwner = session.staffRole === 'owner' || session.email === 'aliazizdbab@gmail.com';
  const activeCount = staff.filter((s) => !s.disabled).length;
  const disabledCount = staff.filter((s) => s.disabled).length;

  return `
    <div class="stack">
      <div class="admin-metrics-grid">
        <div class="metric-card">
          <span class="metric-num">${staff.length}</span>
          <span class="metric-lbl">أعضاء الفريق</span>
        </div>
        <div class="metric-card">
          <span class="metric-num">${activeCount}</span>
          <span class="metric-lbl">حسابات مفعّلة</span>
        </div>
        <div class="metric-card">
          <span class="metric-num">${disabledCount}</span>
          <span class="metric-lbl">حسابات معطّلة</span>
        </div>
        <div class="metric-card highlight-metric">
          <span class="metric-num">${invites.length}</span>
          <span class="metric-lbl">دعوات بانتظار الانضمام</span>
        </div>
      </div>

      <div class="sec stack">
        <div class="row">
          <h4>➕ إضافة عضو إلى فريق الدعم</h4>
          <span class="badge-warn">للمالك فقط</span>
        </div>
        <p class="mu">
          أدخل بريد الموظف وحدد صلاحيته. يفتح الموظف تطبيق «لوحة التحكم» ويسجّل الدخول
          بحساب Google بنفس البريد (أو ببريد وكلمة مرور أنشأهما له المالك)، فيُنشأ حسابه
          تلقائياً بالصلاحية المحددة هنا وتُستهلك الدعوة.
        </p>
        ${
          isOwner
            ? `
        <div class="staff-invite-form">
          <label class="field-box">
            <span class="field-lbl">بريد الموظف</span>
            <input id="staff-invite-email" class="input" dir="ltr" type="email" placeholder="name@example.com" />
          </label>
          <label class="field-box">
            <span class="field-lbl">الاسم الظاهر</span>
            <input id="staff-invite-name" class="input" placeholder="مثال: مهندس الدعم" maxlength="60" />
          </label>
          <label class="field-box">
            <span class="field-lbl">الصلاحية</span>
            <select id="staff-invite-role" class="input">
              <option value="support">دعم فني</option>
              <option value="developer">مبرمج</option>
              <option value="owner">مالك</option>
            </select>
          </label>
          <button type="button" id="staff-invite-btn" class="btn primary-btn">📨 إرسال الدعوة</button>
        </div>
        `
            : '<p class="mu">إدارة الفريق متاحة للمالك فقط.</p>'
        }
      </div>

      <div class="sec stack">
        <h4>👨‍💻 أعضاء الفريق الحاليون</h4>
        ${
          staff.length === 0
            ? '<p class="mu">لا يوجد أعضاء بعد.</p>'
            : `
          <div class="table-responsive">
            <table class="admin-table">
              <thead>
                <tr>
                  <th>الاسم</th>
                  <th>البريد</th>
                  <th>الصلاحية</th>
                  <th>الحالة</th>
                  <th>الإجراءات</th>
                </tr>
              </thead>
              <tbody>
                ${staff
                  .map(
                    (s) => `
                  <tr>
                    <td><strong>${esc(s.name || 'بدون اسم')}</strong></td>
                    <td><code dir="ltr">${esc(s.email)}</code></td>
                    <td><span class="chip role-chip-${esc(s.role)}">${esc(STAFF_ROLE_LABELS[s.role] || s.role)}</span></td>
                    <td>
                      ${
                        s.disabled
                          ? '<span class="status-badge status-suspended">معطّل</span>'
                          : '<span class="status-badge status-active">نشط</span>'
                      }
                    </td>
                    <td>
                      <div class="row">
                        ${
                          isOwner
                            ? `
                        <button type="button" class="btn g" data-action="toggle-staff" data-uid="${esc(s.uid)}" data-disabled="${s.disabled ? 'true' : 'false'}">
                          ${s.disabled ? '▶️ تفعيل' : '⏸️ تعطيل'}
                        </button>
                        <button type="button" class="btn r" data-action="remove-staff" data-uid="${esc(s.uid)}" data-email="${esc(s.email)}">🗑️</button>
                        `
                            : '<span class="mu">—</span>'
                        }
                      </div>
                    </td>
                  </tr>
                `
                  )
                  .join('')}
              </tbody>
            </table>
          </div>
        `
        }
      </div>

      <div class="sec stack">
        <h4>📨 دعوات لم تُستخدم بعد</h4>
        ${
          invites.length === 0
            ? '<p class="mu">لا توجد دعوات معلّقة.</p>'
            : invites
                .map(
                  (inv) => `
          <div class="list-item row">
            <div class="grow">
              <strong dir="ltr">${esc(inv.email)}</strong>
              <div>
                <span class="chip role-chip-${esc(inv.role)}">${esc(STAFF_ROLE_LABELS[inv.role] || inv.role)}</span>
                ${inv.name ? `<small class="mu"> · ${esc(inv.name)}</small>` : ''}
              </div>
            </div>
            ${
              isOwner
                ? `<button type="button" class="btn r" data-action="revoke-invite" data-email="${esc(inv.email)}">إلغاء الدعوة</button>`
                : ''
            }
          </div>
        `
                )
                .join('')
        }
      </div>
    </div>
  `;
}

function renderFeaturesTab(data) {
  const families = data.families || [];
  const selectedFid = data.selectedFid || families[0]?.fid || '';
  const selectedFamily = families.find((f) => f.fid === selectedFid);
  const features = selectedFamily?.features || defaultFeatureFlags();

  return `
    <div class="sec stack">
      <div class="row">
        <h3>⚙️ التحكم بميزات وأقسام العائلة</h3>
        <label class="row">
          <span>اختر العائلة:</span>
          <select id="admin-features-fam-select" class="input">
            ${families.map((f) => `<option value="${esc(f.fid)}" ${f.fid === selectedFid ? 'selected' : ''}>${esc(f.name)}</option>`).join('')}
          </select>
        </label>
      </div>

      ${
        !selectedFamily
          ? '<p class="mu">اختر عائلة لضبط ميزاتها.</p>'
          : `
        <div class="stack">
          <p class="mu">يمكنك تفعيل أو إيقاف أي ميزة لعائلة (${esc(selectedFamily.name)}) بحسب اشتراكها أو طلبها:</p>

          <div class="stack features-toggle-list">
            ${FAMILY_FEATURES.map(
              (feat) => `
              <label class="list-item row">
                <div>
                  <strong>${esc(feat.label)}</strong>
                  <div class="mu"><small>معرف الميزة: <code>${esc(feat.id)}</code></small></div>
                </div>
                <input
                  type="checkbox"
                  class="toggle-checkbox"
                  data-feature-toggle="${esc(feat.id)}"
                  data-fid="${esc(selectedFid)}"
                  ${features[feat.id] !== false ? 'checked' : ''}
                />
              </label>
            `
            ).join('')}
          </div>

          <button type="button" id="admin-save-features-btn" class="btn primary-btn" data-fid="${esc(selectedFid)}">
            💾 حفظ تفضيلات الميزات للعائلة
          </button>
        </div>
      `
      }
    </div>
  `;
}

function renderAiEditor({ prefix, record, title, description, saveLabel, clearLabel }) {
  const rec = record || null;
  const provider = rec?.provider || 'gemini';
  const isCustom = provider === 'custom';
  const providers = [
    ['gemini', 'Google Gemini'],
    ['openai', 'OpenAI'],
    ['anthropic', 'Anthropic Claude'],
    ['groq', 'Groq'],
    ['deepseek', 'DeepSeek'],
    ['openrouter', 'OpenRouter'],
    ['custom', '➕ مزود مخصص (رابط خاص)'],
  ];
  const options = providers
    .map(([v, label]) => `<option value="${v}" ${provider === v ? 'selected' : ''}>${label}</option>`)
    .join('');

  return `
    <div class="sec stack">
      <div class="row">
        <h3>${title}</h3>
        <span class="status-badge ${rec ? 'status-active' : 'status-pending'}">${rec ? 'مُهيّأ' : 'غير مُهيّأ'}</span>
      </div>
      <p class="mu">${description}</p>

      <div class="ai-form-grid">
        <label class="field-box">
          <span class="field-lbl">المزوّد</span>
          <select id="${prefix}-provider" class="input">${options}</select>
        </label>

        <label class="field-box" id="${prefix}-name-wrap" ${isCustom ? '' : 'hidden'}>
          <span class="field-lbl">اسم المزود المخصص</span>
          <input id="${prefix}-name" class="input" value="${esc(rec?.name || '')}" placeholder="مثال: سيرفر الشركة" maxlength="40" />
        </label>

        <label class="field-box" id="${prefix}-url-wrap" ${isCustom ? '' : 'hidden'}>
          <span class="field-lbl">رابط API (Base URL)</span>
          <input id="${prefix}-url" class="input" dir="ltr" value="${esc(rec?.url || '')}" placeholder="https://api.example.com/v1" />
        </label>

        <label class="field-box" id="${prefix}-type-wrap" ${isCustom ? '' : 'hidden'}>
          <span class="field-lbl">نوع الواجهة</span>
          <select id="${prefix}-type" class="input">
            <option value="openai" ${rec?.type !== 'gemini' ? 'selected' : ''}>متوافق OpenAI</option>
            <option value="gemini" ${rec?.type === 'gemini' ? 'selected' : ''}>متوافق Gemini</option>
          </select>
        </label>

        <label class="field-box">
          <span class="field-lbl">الموديل</span>
          <div class="row model-row">
            <input id="${prefix}-model" class="input grow" dir="ltr" value="${esc(rec?.model || '')}" placeholder="gemini-2.5-flash" />
            <button type="button" id="${prefix}-models-btn" class="btn g">🔎 جلب الموديلات</button>
          </div>
        </label>

        <label class="field-box">
          <span class="field-lbl">مفتاح API</span>
          <div class="password-wrapper">
            <input id="${prefix}-key" class="input grow" dir="ltr" type="password" value="${esc(rec?.apiKey || '')}" placeholder="AIza..." />
            <button type="button" id="${prefix}-key-toggle" class="btn g pwd-toggle-btn">👁️</button>
          </div>
        </label>
      </div>

      <div class="row">
        <button type="button" id="${prefix}-save" class="btn primary-btn">${saveLabel}</button>
        <button type="button" id="${prefix}-test" class="btn g">🧪 اختبار</button>
        ${rec ? `<button type="button" id="${prefix}-clear" class="btn r">${clearLabel}</button>` : ''}
      </div>

      <div id="${prefix}-models" class="stack" hidden></div>
      <div id="${prefix}-result" class="sec" hidden></div>
    </div>
  `;
}

/** Models table (no dropdowns): price, free flag, live status, and a use button. */
export function renderModelsTable(rows, prefix) {
  if (!Array.isArray(rows) || rows.length === 0) {
    return '<p class="mu">لم يتم العثور على موديلات لهذا المزود.</p>';
  }
  return `
    <div class="row">
      <h4>📋 الموديلات المتاحة (${rows.length})</h4>
      <button type="button" id="${prefix}-test-all" class="btn g">⚡ اختبار كل الموديلات</button>
    </div>
    <p class="mu">الأسعار مرجعية لكل مليون توكن (دخل/خرج) بالدولار. اختبار «الكل» يرسل طلباً صغيراً لكل موديل ويستغرق وقتاً.</p>
    <div class="table-responsive">
      <table class="admin-table models-table">
        <thead>
          <tr>
            <th>الموديل</th>
            <th>السعر (1M)</th>
            <th>مجاني</th>
            <th>الحالة</th>
            <th>استخدام</th>
          </tr>
        </thead>
        <tbody>
          ${rows
            .map(
              (r) => `
            <tr data-model-row="${esc(r.id)}">
              <td data-label="">
                <strong dir="ltr">${esc(r.id)}</strong>
                ${r.label && r.label !== r.id ? `<div><small class="mu">${esc(r.label)}</small></div>` : ''}
                ${r.context ? `<div><small class="mu">سياق: ${Number(r.context).toLocaleString('en-US')} توكن</small></div>` : ''}
              </td>
              <td data-label="السعر (1M)" dir="ltr">
                ${
                  r.input === null && r.output === null
                    ? '—'
                    : `${r.input === null ? '—' : '$' + r.input} / ${r.output === null ? '—' : '$' + r.output}`
                }
              </td>
              <td data-label="مجاني">${r.free ? '<span class="badge-ok">مجاني</span>' : '<span class="chip">مدفوع</span>'}</td>
              <td data-label="الحالة"><span class="chip model-status">—</span></td>
              <td data-label="إجراء">
                <button type="button" class="btn g" data-action="use-model" data-model="${esc(r.id)}" data-prefix="${esc(prefix)}">⬅️ استخدم</button>
                <button type="button" class="btn g" data-action="test-model" data-model="${esc(r.id)}" data-prefix="${esc(prefix)}">🧪</button>
              </td>
            </tr>
          `
            )
            .join('')}
        </tbody>
      </table>
    </div>
  `;
}

function renderIntegrationsTab(data) {
  const families = data.families || [];
  const selectedFid = data.selectedFid || families[0]?.fid || '';

  return `
    <div class="stack">
      <div class="sec stack">
        <div class="row">
          <h3>🔥 حالة البنية السحابية</h3>
          <span class="badge-ok">Firebase v13 Modular</span>
        </div>
        <div class="admin-metrics-grid">
          <div class="metric-card">
            <strong>المشروع:</strong>
            <code dir="ltr">family-requests-9e431</code>
          </div>
          <div class="metric-card">
            <strong>الاستضافة:</strong>
            <a href="https://family-requests-9e431.web.app" target="_blank" dir="ltr">family-requests-9e431.web.app</a>
          </div>
          <div class="metric-card">
            <strong>Realtime Database:</strong>
            <span class="status-badge status-active">متصل — قواعد v3</span>
          </div>
        </div>
        <button type="button" id="admin-test-firebase-btn" class="btn g">⚡ اختبار الاتصال بـ Firebase</button>
      </div>

      ${renderAiEditor({
        prefix: 'ai-global',
        record: data.aiGlobal,
        title: '🤖 مفتاح الذكاء الاصطناعي العام (لكل العائلات)',
        description:
          'يُستخدم لكل عائلة لا تملك تخصيصاً خاصاً. لا تظهر إعدادات الذكاء الاصطناعي لأي عائلة — الإدارة هنا فقط.',
        saveLabel: '💾 حفظ المفتاح العام',
        clearLabel: '🗑️ حذف المفتاح العام',
      })}

      <div class="sec stack">
        <div class="row">
          <h3>🏠 تخصيص مفتاح لعائلة محددة</h3>
          <span class="status-badge ${data.aiFamily ? 'status-active' : 'status-pending'}">${data.aiFamily ? 'تخصيص مفعّل' : 'يستخدم العام'}</span>
        </div>
        <p class="mu">التخصيص يتجاوز المفتاح العام لهذه العائلة فقط.</p>
        <label class="field-box">
          <span class="field-lbl">اختر العائلة</span>
          <select id="ai-family-select" class="input">
            ${families
              .map(
                (fam) =>
                  `<option value="${esc(fam.fid)}" ${fam.fid === selectedFid ? 'selected' : ''}>${esc(fam.name)} (${esc(fam.fid)})</option>`
              )
              .join('')}
          </select>
        </label>
      </div>

      ${renderAiEditor({
        prefix: 'ai-family',
        record: data.aiFamily,
        title: '🏠 مفتاح العائلة المخصّص',
        description: 'يتجاوز المفتاح العام لهذه العائلة فقط (مفيد عند ارتفاع الاستهلاك أو تفضيل مزوّد مختلف).',
        saveLabel: '💾 حفظ تخصيص العائلة',
        clearLabel: '↩️ إرجاعها للمفتاح العام',
      })}
    </div>
  `;
}

function renderAuditTab(data) {
  const auditLogs = data.auditLogs || [];

  return `
    <div class="sec stack">
      <div class="row">
        <h3>📜 سجل العمليات الإدارية والنشاطات (Audit Logs)</h3>
        <button type="button" id="admin-refresh-audit-btn" class="btn g">🔄 تحديث السجل</button>
      </div>
      <p class="mu">يسجل جميع العمليات الحساسة (إنشاء عائلات، تفعيل حسابات، تغيير كلمات مرور، تعديل صلاحيات) مع هوية المنفّذ وتوقيته.</p>

      <div class="stack">
        ${
          auditLogs.length === 0
            ? '<p class="mu">لا توجد عمليات مسجلة حديثاً في سجل التدقيق.</p>'
            : auditLogs
                .map(
                  (log) => `
              <div class="list-item row">
                <div class="grow">
                  <strong>${esc(log.action)}</strong>
                  <div>
                    <small class="mu">المنفّذ: <span dir="ltr">${esc(log.actorName || log.actorUid)}</span> (${esc(log.actorType)})</small>
                    ${log.target ? ` · <small class="mu">الهدف: ${esc(log.target)}</small>` : ''}
                  </div>
                </div>
                <small class="mu">${new Date(log.at || Date.now()).toLocaleString('ar')}</small>
              </div>
            `
                )
                .join('')
        }
      </div>
    </div>
  `;
}

function renderDiagnosticsTab(_data) {
  return `
    <div class="sec stack">
      <h3>🩺 أدوات التشخيص والدعم الفني المتقدم</h3>
      <p class="mu">أدوات مخصصة لحل مشاكل المزامنة وفحص سلامة التخزين المحلي والنسخ الاحتياطي.</p>

      <div class="row">
        <button type="button" id="admin-diag-export-btn" class="btn g">
          📦 تصدير تقرير التشخيص الشامل (JSON)
        </button>
        <button type="button" id="admin-diag-clear-cache-btn" class="btn r">
          🧹 تنظيف الكاش المحلي وتحديث الخدمة
        </button>
      </div>

      <div id="admin-diag-output" class="sec stack" hidden>
        <h4>نتائج الفحص:</h4>
        <pre id="admin-diag-code" class="code-box" dir="ltr"></pre>
      </div>
    </div>
  `;
}
