function esc(val) {
  return String(val ?? '').replace(
    /[&<>"']/g,
    (ch) =>
      ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;',
      })[ch]
  );
}

function toArray(val) {
  if (Array.isArray(val)) return val.filter(Boolean);
  if (val && typeof val === 'object') return Object.values(val).filter(Boolean);
  return [];
}

function sanitizeLegacyState(raw) {
  const members = toArray(raw?.members).map((m) => ({
    id: String(m.id || ''),
    name: String(m.name || ''),
    icon: String(m.icon || '🏠'),
    admin: Boolean(m.admin),
    off: Boolean(m.off),
    // salt and hash intentionally omitted
  }));

  const items = toArray(raw?.items).map((i) => ({
    id: String(i.id || ''),
    n: String(i.n || ''),
    q: String(i.q || ''),
    p: Math.max(0, Number(i.p) || 0),
    c: String(i.c || 'super'),
    u: Boolean(i.u),
    by: String(i.by || ''),
    dn: i.dn ? 1 : 0,
    dnBy: String(i.dnBy || ''),
    dnAt: String(i.dnAt || ''),
    cl: String(i.cl || ''),
  }));

  const cats = toArray(raw?.cats).map((c) => ({
    id: String(c.id || ''),
    i: String(c.i || '🛒'),
    n: String(c.n || ''),
  }));

  const log = toArray(raw?.log).map((l) => ({
    w: String(l.w || ''),
    a: String(l.a || ''),
    n: String(l.n || ''),
    t: String(l.t || ''),
  }));

  return {
    items,
    members,
    cats,
    log,
    budget: Math.max(0, Number(raw?.budget) || 0),
    t: Number(raw?.t) || Date.now(),
  };
}

let currentExport = null;

function showToast(msg) {
  const el = document.getElementById('toast');
  if (el) el.textContent = msg;
}

function showPreview(clean) {
  currentExport = clean;
  const preview = document.getElementById('preview');
  const dlBtn = document.getElementById('btn-dl');
  const doneCount = clean.items.filter((i) => i.dn).length;
  preview.hidden = false;
  dlBtn.hidden = false;
  preview.innerHTML = `
    <strong>ملخص البيانات المنظّفة:</strong><br>
    الأغراض: ${clean.items.length} (منجز: ${doneCount} · متبقي: ${clean.items.length - doneCount})<br>
    الأقسام: ${clean.cats.length} · الأعضاء: ${clean.members.length} (تم تجريد رموز PIN)<br>
    الميزانية: ${esc(clean.budget)} د.ل · السجل: ${clean.log.length}
  `;
}

document.getElementById('btn-local')?.addEventListener('click', () => {
  try {
    const rawText = window.localStorage.getItem('fl_shared');
    if (!rawText) {
      showToast('لم يتم العثور على fl_shared في هذا الأصل (Origin)');
      return;
    }
    const clean = sanitizeLegacyState(JSON.parse(rawText));
    showPreview(clean);
    showToast('✅ تمت القراءة وتنظيف البيانات من المتصفح');
  } catch (err) {
    showToast('❌ تعذّرت قراءة localStorage: ' + err.message);
  }
});

document.getElementById('btn-rtdb')?.addEventListener('click', async () => {
  const baseUrl = document.getElementById('rtdb-url').value.trim().replace(/\/+$/, '');
  const room = document.getElementById('rtdb-room').value.trim() || 'family';
  if (!baseUrl) {
    showToast('أدخل رابط Firebase RTDB');
    return;
  }
  showToast('⏳ جارٍ القراءة من /rooms فقط...');
  try {
    const res = await fetch(`${baseUrl}/rooms/${encodeURIComponent(room)}.json?t=${Date.now()}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    if (!data) throw new Error('الغرفة فارغة');
    const clean = sanitizeLegacyState(data);
    showPreview(clean);
    showToast('✅ تم الجلب من Firebase وتنظيف البيانات');
  } catch (err) {
    showToast('❌ فشل الجلب: ' + err.message);
  }
});

document.getElementById('file-in')?.addEventListener('change', async (e) => {
  const file = e.target.files?.[0];
  if (!file) return;
  try {
    const clean = sanitizeLegacyState(JSON.parse(await file.text()));
    showPreview(clean);
    showToast('✅ تم تحميل الملف وتنظيفه');
  } catch (err) {
    showToast('❌ ملف غير صالح: ' + err.message);
  }
});

document.getElementById('btn-dl')?.addEventListener('click', () => {
  if (!currentExport) return;
  const blob = new Blob([JSON.stringify(currentExport, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'legacy-export-v1.json';
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
});
