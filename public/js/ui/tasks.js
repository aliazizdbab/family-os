import { esc } from './dialogs.js';
import { getEffectiveMembersList, getRoleShortLabel } from './settings.js';

export const DEFAULT_HOUSEHOLD_TASKS = Object.freeze([
  { title: 'ترتيب الغرفة والسرير', icon: '🧹', recurrence: 'daily', points: 10 },
  { title: 'إخراج القمامة', icon: '🗑️', recurrence: 'daily', points: 10 },
  { title: 'المساعدة في السفرة والجلي', icon: '🍽️', recurrence: 'daily', points: 15 },
  { title: 'إنجاز الواجبات المدرسية', icon: '📚', recurrence: 'daily', points: 20 },
  { title: 'سقي النباتات والحديقة', icon: '🌱', recurrence: 'weekly', points: 15 },
  { title: 'غسيل وتنظيف السيارة', icon: '🚗', recurrence: 'weekly', points: 25 },
  { title: 'جمع الغسيل وترتيبه', icon: '🧺', recurrence: 'weekly', points: 15 },
  { title: 'تنظيف فلاتر المكيف', icon: '🔌', recurrence: 'monthly', points: 30 },
]);

export const DEFAULT_FAMILY_REWARDS = Object.freeze([
  {
    id: 'rw_gaming',
    title: 'ساعة ألعاب إضافية',
    icon: '🎮',
    cost: 50,
    desc: 'وقت مرح إضافي على البلايستيشن أو الآيباد في عطلة الأسبوع',
  },
  {
    id: 'rw_icecream',
    title: 'نزهة مثلجات عائلية',
    icon: '🍦',
    cost: 75,
    desc: 'اختيار نكهة الآيس كريم المفضلة في نزهة المساء',
  },
  {
    id: 'rw_dinner',
    title: 'اختيار عشاء الجمعة',
    icon: '🍕',
    cost: 100,
    desc: 'أنت الشيف الحاكم! اختر المطعم أو الوجبة المفضلة للأسرة',
  },
  {
    id: 'rw_park',
    title: 'رحلة إلى مدينة الألعاب',
    icon: '🎡',
    cost: 200,
    desc: 'تذكرة كاملة ليوم ترفيهي عائلي مليء بالمرح',
  },
]);

const RECURRENCE_LABELS = Object.freeze({
  once: 'مرة واحدة',
  daily: 'يومي',
  weekly: 'أسبوعي',
  monthly: 'شهري',
});

export function renderTasksView(appState) {
  const snap = appState.localSnapshot || {};
  const members = getEffectiveMembersList(snap);
  const currentRole = appState.prefs.currentRole || 'admin';
  const currentMemberId = appState.session?.memberId || 'mem_father';
  const currentMemberName = appState.prefs.memberName || 'الأب';
  const canManage = ['developer', 'admin', 'mother'].includes(currentRole);

  const rawTasks = Object.entries(snap.tasks || {})
    .map(([id, t]) => ({ ...t, id }))
    .filter((t) => !t.deleted);

  const filter = appState.taskFilter || 'all';
  const filteredTasks = rawTasks
    .filter((t) => {
      if (filter === 'mine') {
        return (
          t.assigneeId === 'all' ||
          t.assigneeId === currentMemberId ||
          t.assigneeName === currentMemberName
        );
      }
      if (filter === 'todo') return !t.done;
      if (filter === 'done') return Boolean(t.done);
      return true;
    })
    .sort((a, b) => Number(a.done) - Number(b.done) || (b.updatedAt || 0) - (a.updatedAt || 0));

  const sortedLeaderboard = [...members].sort(
    (a, b) => (Number(b.points) || 0) - (Number(a.points) || 0)
  );

  const todoCount = rawTasks.filter((t) => !t.done).length;
  const doneCount = rawTasks.filter((t) => t.done).length;

  const activeMember = members.find((m) => m.id === currentMemberId);
  const heroMember =
    activeMember ||
    members.find((m) => m.role === 'child') ||
    sortedLeaderboard[0] || { id: currentMemberId, name: currentMemberName, icon: '🦸‍♂️', points: 0 };
  const heroPoints = Number(heroMember.points) || 0;
  const heroLevel = Math.floor(heroPoints / 50) + 1;
  const levelProgressPct = Math.min(100, Math.round(((heroPoints % 50) / 50) * 100));

  const heroCardHtml = `
    <section class="sec stack hero-xp-card" id="tasks-hero-card">
      <div class="row">
        <div>
          <h3>${esc(heroMember.icon || '🦸‍♂️')} ${esc(heroMember.name)} · بطل المنزل</h3>
          <span class="badge-ok">المستوى ${heroLevel}: بطل المنزل 🦸‍♂️</span>
        </div>
        <div class="chip">
          <strong class="stitch-num">${heroPoints} ⭐ نجمة ذهبية</strong>
        </div>
      </div>
      <div class="row">
        <small class="mu">التقدم نحو المستوى ${heroLevel + 1}</small>
        <small class="mu">${heroPoints % 50} / 50 XP (${levelProgressPct}%)</small>
      </div>
      <progress class="stitch-progress xp-progress" value="${Math.min(100, Math.max(0, Number(levelProgressPct) || 0))}" max="100" aria-hidden="true"></progress>
    </section>`;

  const rewardsShopHtml = `
    <section class="sec stack" id="family-rewards-shop">
      <div class="row">
        <h3>🎁 متجر المكافآت العائلية</h3>
        <span class="badge-ok">رصيدك: ${heroPoints} ⭐</span>
      </div>
      <p class="mu">استبدل نجومك بمكافآت وتجارب عائلية حقيقية متفق عليها مع العائلة!</p>
      <div class="reward-grid">
        ${DEFAULT_FAMILY_REWARDS.map((r) => {
          const pct = Math.min(100, Math.round((heroPoints / r.cost) * 100));
          const unlocked = heroPoints >= r.cost;
          return `
            <article class="reward-card">
              <div class="stack">
                <div class="row">
                  <strong>${esc(r.icon)} ${esc(r.title)}</strong>
                  <span class="${unlocked ? 'badge-ok' : 'badge-warn'}">${r.cost} ⭐</span>
                </div>
                <small class="mu">${esc(r.desc)}</small>
                <progress class="stitch-progress" value="${Math.min(100, Math.max(0, Number(pct) || 0))}" max="100" aria-hidden="true"></progress>
              </div>
              <button type="button" class="btn full ${unlocked ? '' : 'g'}" data-redeem-reward="${esc(r.id)}">
                ${unlocked ? '🎁 استبدال الآن' : `🔒 متبقي ${Math.max(0, r.cost - heroPoints)} ⭐`}
              </button>
            </article>`;
        }).join('')}
      </div>
    </section>`;

  const prideBannerHtml = `
    <section class="pride-banner stack" id="tasks-pride-banner">
      <strong>❤️ رسالة فخر من الوالدين</strong>
      <p class="mu">عمل رائع يا أبطال! التزامكم بترتيب المنزل ومساعدة الأسرة يجعل بيتنا أكثر دفئاً وسعادة كل يوم.</p>
    </section>`;

  const leaderboardHtml = `
    <section class="sec stack" id="tasks-leaderboard-sec">
      <div class="row">
        <h3>🏆 لوحة نجوم ونقاط التحفيز للعائلة</h3>
        <span class="badge-ok">${members.length} أفراد</span>
      </div>
      <div class="chips">
        ${sortedLeaderboard
          .map(
            (m) => `
          <span class="chip">
            ${esc(m.icon || '👤')} <strong>${esc(m.name)}</strong> (${esc(getRoleShortLabel(m.role))}) · ⭐ ${Number(m.points) || 0} نقطة
          </span>`
          )
          .join('')}
      </div>
    </section>`;

  const addPanelHtml = canManage
    ? `
      <section class="sec stack" id="tasks-add-sec">
        <div class="row">
          <h3>➕ إسناد مهمة منزلية جديدة</h3>
          <span class="mu">مع نظام نقاط التحفيز للأبناء</span>
        </div>
        <label class="field-box">
          <span class="field-lbl">📋 عنوان المهمة</span>
          <input id="task-title-inp" class="input" placeholder="مثلاً: ترتيب الغرفة أو غسيل السيارة" />
        </label>
        <div class="g2">
          <label class="field-box">
            <span class="field-lbl">👤 المسؤول عن التنفيذ</span>
            <select id="task-assignee-sel" class="select">
              <option value="all">👨‍👩‍👧‍👦 الجميع</option>
              ${members
                .map(
                  (m) =>
                    `<option value="${esc(m.id)}">${esc(m.icon || '👤')} ${esc(m.name)}</option>`
                )
                .join('')}
            </select>
          </label>
          <label class="field-box">
            <span class="field-lbl">🔁 التكرار</span>
            <select id="task-recur-sel" class="select">
              <option value="once">مرة واحدة</option>
              <option value="daily">يومي</option>
              <option value="weekly">أسبوعي</option>
              <option value="monthly">شهري</option>
            </select>
          </label>
        </div>
        <div class="row">
          <label class="field-box grow">
            <span class="field-lbl">⭐ نقاط التحفيز عند الإنجاز</span>
            <input id="task-points-inp" class="input" type="number" min="0" step="5" value="10" />
          </label>
          <button type="button" id="add-task-btn" class="btn">➕ إضافة المهمة</button>
        </div>
        <div class="chips">
          <span class="mu">⚡ قوالب سريعة:</span>
          ${DEFAULT_HOUSEHOLD_TASKS.map(
            (tpl) => `
            <button
              type="button"
              class="btn g"
              data-task-tpl="${esc(tpl.title)}"
              data-task-tpl-recur="${esc(tpl.recurrence)}"
              data-task-tpl-pts="${Number(tpl.points) || 10}"
            >${esc(tpl.icon)} ${esc(tpl.title)} (+${tpl.points} ⭐)</button>`
          ).join('')}
        </div>
      </section>`
    : `
      <section class="sec">
        <p class="mu">🧒 اضغط على «✅ أنجزت المهمة» فور الانتهاء من مهمتك لتحصل على نقاط التحفيز ⭐ في رصيدك!</p>
      </section>`;

  const tasksListHtml = filteredTasks.length
    ? `
      <section class="card" id="tasks-list-card">
        <div class="ch">
          <span>📋 المهام المنزلية (${filteredTasks.length})</span>
        </div>
        ${filteredTasks
          .map(
            (t) => `
          <div class="list-item stack" data-task-row="${esc(t.id)}">
            <div class="row">
              <div class="grow">
                <strong class="${t.done ? 'done-text' : ''}">${esc(t.title)}</strong>
                <div class="chips">
                  <span class="chip">👤 ${esc(t.assigneeName || 'الجميع')}</span>
                  <span class="chip">🔁 ${esc(RECURRENCE_LABELS[t.recurrence] || 'مرة واحدة')}</span>
                  <span class="badge-ok">⭐ ${Number(t.points) || 0} نقطة</span>
                  ${t.done && t.doneBy ? `<span class="badge-ok">✅ أنجزها: ${esc(t.doneBy)}</span>` : ''}
                </div>
              </div>
              <div class="row">
                ${
                  !t.done
                    ? `<button type="button" class="btn" data-task-complete="${esc(t.id)}">✅ أنجزت المهمة</button>`
                    : t.recurrence !== 'once' && canManage
                      ? `<button type="button" class="btn g" data-task-reset="${esc(t.id)}">🔄 تجديد الدورة</button>`
                      : ''
                }
                ${
                  canManage
                    ? `<button type="button" class="btn r" data-task-delete="${esc(t.id)}" aria-label="حذف مهمة ${esc(t.title)}">🗑️</button>`
                    : ''
                }
              </div>
            </div>
          </div>`
          )
          .join('')}
      </section>`
    : `
      <section class="sec">
        <p class="mu">لا توجد مهام ضمن هذا الفلتر حالياً ✨</p>
      </section>`;

  return `
    ${heroCardHtml}
    <section class="sec stack" id="tasks-header-sec">
      <div class="row">
        <h2>📋 المهام المنزلية وتوزيع المسؤوليات</h2>
        <span class="badge-ok">متبقٍ ${todoCount} · منجز ${doneCount}</span>
      </div>
      <div class="chips">
        <button type="button" class="btn ${filter === 'all' ? '' : 'g'}" data-task-filter="all">📋 كل المهام (${rawTasks.length})</button>
        <button type="button" class="btn ${filter === 'mine' ? '' : 'g'}" data-task-filter="mine">🙋 مهامي</button>
        <button type="button" class="btn ${filter === 'todo' ? '' : 'g'}" data-task-filter="todo">⏳ قيد الإنجاز (${todoCount})</button>
        <button type="button" class="btn ${filter === 'done' ? '' : 'g'}" data-task-filter="done">✅ المنجزة (${doneCount})</button>
      </div>
    </section>

    ${leaderboardHtml}
    ${addPanelHtml}
    ${tasksListHtml}
    ${rewardsShopHtml}
    ${prideBannerHtml}
  `;
}
