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
        هذه اللوحة مخصصة حصرياً للمالك والمبرمجين وفريق الدعم الفني المعتمد. يرجى تسجيل الدخول بحساب Google المعتمد للمالك أو بيانات الموظف.
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
            <span class="field-lbl">👤 معرف / بريد المبرمج</span>
            <input
              id="login-dev-user"
              class="input"
              dir="ltr"
              value="developer"
              placeholder="developer"
            />
          </label>

          <label class="field-box">
            <span class="field-lbl">🔑 الرمز السري للمبرمج</span>
            <div class="password-wrapper">
              <input
                id="login-dev-pin"
                class="input grow"
                type="password"
                maxlength="32"
                dir="ltr"
                value="9999"
                placeholder="الرمز السري للمبرمج"
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

function renderCurrentTabContent(tab, data) {
  switch (tab) {
    case 'families':
      return renderFamiliesTab(data);
    case 'users':
      return renderUsersTab(data);
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

      <!-- Action Bar & Developer Quick Switch Section -->
      <section class="sec stack" id="dev-portal-sec">
        <div class="row">
          <h4>🛠️ بوابة المبرمج والدعم الفني الشامل</h4>
          <span class="badge-warn">المستوى 1</span>
        </div>
        <p class="mu">صلاحيات كاملة للتنقل بين جميع العائلات المعزولة، مراجعة النشاطات، وإضافة عائلات جديدة.</p>
        <div class="list-item">
          <span>📧 بريد تسجيل العائلة: <code dir="ltr">${esc(families.find((f) => f.ownerEmail)?.ownerEmail || 'noor@example.com')}</code></span>
        </div>
        <div class="row">
          <input id="dev-new-family-inp" class="input grow" dir="ltr" placeholder="إنشاء كود عائلة جديدة (مثلاً: family-ahmad)" />
          <button type="button" id="dev-add-family-btn" class="btn">➕ إضافة عائلة</button>
        </div>
      </section>

      <!-- Action Bar -->
      <div class="row">
        <h3>قائمة العائلات وإدارتها</h3>
        <button type="button" id="admin-create-family-btn" class="btn primary-btn">➕ إنشاء عائلة جديدة يدوياً</button>
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
                  <button type="button" class="btn primary-btn" data-action="approve-family" data-fid="${esc(fam.fid)}" data-name="${esc(fam.name)}">
                    ✅ تفعيل وقبول
                  </button>
                  <button type="button" class="btn r" data-action="reject-family" data-fid="${esc(fam.fid)}" data-name="${esc(fam.name)}">
                    ❌ رفض وحذف
                  </button>
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
                        <button type="button" class="btn g" data-action="edit-family" data-fid="${esc(fam.fid)}">⚙️ إدارة</button>
                        ${
                          fam.status === 'active'
                            ? `<button type="button" class="btn g" data-action="suspend-family" data-fid="${esc(fam.fid)}">⏸️ إيقاف</button>`
                            : `<button type="button" class="btn g" data-action="activate-family" data-fid="${esc(fam.fid)}">▶️ تنشيط</button>`
                        }
                        <button type="button" class="btn r" data-action="delete-family" data-fid="${esc(fam.fid)}" data-name="${esc(fam.name)}">🗑️</button>
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

function renderIntegrationsTab(_data) {
  return `
    <div class="stack">
      <!-- Firebase Status & Control -->
      <div class="sec stack">
        <div class="row">
          <h3>🔥 إدارة وتكامل Firebase</h3>
          <span class="badge-ok">Firebase v13 Modular</span>
        </div>
        <p class="mu">فحص حالة الاتصال بقواعد البيانات والمصادقة وإدارة النطاقات.</p>
        
        <div class="admin-metrics-grid">
          <div class="metric-card">
            <strong>المشروع (Project ID):</strong>
            <code dir="ltr">family-requests-9e431</code>
          </div>
          <div class="metric-card">
            <strong>نطاق الاستضافة:</strong>
            <a href="https://family-requests-9e431.web.app" target="_blank" dir="ltr">family-requests-9e431.web.app</a>
          </div>
          <div class="metric-card">
            <strong>حالة Realtime Database:</strong>
            <span class="status-badge status-active">متصل v3 Rules</span>
          </div>
        </div>

        <button type="button" id="admin-test-firebase-btn" class="btn g">
          ⚡ اختبار الاتصال بـ Firebase الآن
        </button>
      </div>

      <!-- AI Services & Providers -->
      <div class="sec stack">
        <div class="row">
          <h3>🤖 تكاملات نماذج الذكاء الاصطناعي (AI Models)</h3>
          <span class="badge-ok">متعدد المزودين</span>
        </div>
        <p class="mu">إدارة مفاتيح API ومزودي الخدمة واختبار جودة الاستجابة وسرعتها.</p>

        <div class="stack">
          <label class="field-box">
            <span class="field-lbl">المزود الافتراضي الحالي</span>
            <select id="admin-ai-provider-select" class="input">
              <option value="gemini" selected>Google Gemini (موصى به - مجاني وسريع)</option>
              <option value="groq">Groq (سرعة فائقة Llama 3)</option>
              <option value="deepseek">DeepSeek (كفاءة عالية)</option>
              <option value="openai">OpenAI (GPT-4o mini)</option>
              <option value="anthropic">Anthropic Claude</option>
            </select>
          </label>

          <label class="field-box">
            <span class="field-lbl">مفتاح API الخاص بالمزود (يُحفظ بأمان)</span>
            <div class="password-wrapper">
              <input id="admin-ai-key-input" class="input grow" type="password" placeholder="أدخل مفتاح الـ API..." />
              <button type="button" id="toggle-admin-ai-key-btn" class="btn g pwd-toggle-btn">👁️</button>
            </div>
          </label>

          <div class="row">
            <button type="button" id="admin-test-ai-btn" class="btn primary-btn">
              🧪 اختبار اتصال الذكاء الاصطناعي
            </button>
            <button type="button" id="admin-save-ai-btn" class="btn g">
              💾 حفظ إعدادات الذكاء الاصطناعي
            </button>
          </div>

          <div id="admin-ai-test-result" class="sec" hidden></div>
        </div>
      </div>
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
