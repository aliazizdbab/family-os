export function esc(val) {
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

let toastTimer = null;
let undoHandler = null;

export function showToast(message, durationMs = 3200) {
  const el = document.getElementById('toast');
  if (!el) return;
  undoHandler = null;
  el.textContent = String(message ?? '');
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    el.hidden = true;
  }, durationMs);
}

export function showUndoSnackbar(message, onUndo, durationMs = 5000) {
  const el = document.getElementById('toast');
  if (!el) return;
  undoHandler = onUndo;
  el.innerHTML = `
    <span class="row">
      <span>${esc(message)}</span>
      <button type="button" id="undo-snackbar-btn" class="btn g">↩️ تراجع</button>
    </span>`;
  el.hidden = false;
  el.querySelector('#undo-snackbar-btn')?.addEventListener('click', async () => {
    clearTimeout(toastTimer);
    el.hidden = true;
    const fn = undoHandler;
    undoHandler = null;
    if (typeof fn === 'function') {
      await fn();
    }
  });
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    el.hidden = true;
    undoHandler = null;
  }, durationMs);
}

export function showConfirmDialog(message, { confirmText = 'تأكيد', cancelText = 'إلغاء' } = {}) {
  return new Promise((resolve) => {
    const root = document.getElementById('dialog-root');
    if (!root) {
      resolve(false);
      return;
    }
    const ov = document.createElement('div');
    ov.className = 'dialog-ov';
    ov.innerHTML = `
      <div class="dialog-box stack" role="dialog" aria-modal="true">
        <p>${esc(message)}</p>
        <div class="row">
          <button type="button" class="btn g" data-dlg="no">${esc(cancelText)}</button>
          <button type="button" class="btn" data-dlg="yes">${esc(confirmText)}</button>
        </div>
      </div>`;
    const close = (result) => {
      ov.remove();
      resolve(result);
    };
    ov.querySelector('[data-dlg="no"]').addEventListener('click', () => close(false));
    ov.querySelector('[data-dlg="yes"]').addEventListener('click', () => close(true));
    root.appendChild(ov);
  });
}

export function showEditItemDialog(item, categoriesList) {
  return new Promise((resolve) => {
    const root = document.getElementById('dialog-root');
    if (!root) {
      resolve(null);
      return;
    }
    const ov = document.createElement('div');
    ov.className = 'dialog-ov';
    ov.innerHTML = `
      <div class="dialog-box stack" role="dialog" aria-modal="true">
        <h3>✏️ تعديل الغرض</h3>
        <input id="dlg-item-n" class="input" value="${esc(item.n)}" placeholder="اسم الغرض" />
        <div class="g2">
          <input id="dlg-item-q" class="input" value="${esc(item.q || '')}" placeholder="الكمية" />
          <input id="dlg-item-p" class="input" type="number" min="0" step="any" value="${Number(item.p) || ''}" placeholder="السعر د.ل" />
        </div>
        <select id="dlg-item-c" class="select">
          ${categoriesList
            .map(
              (c) =>
                `<option value="${esc(c.id)}" ${c.id === item.c ? 'selected' : ''}>${esc(c.i)} ${esc(c.n)}</option>`
            )
            .join('')}
        </select>
        <input id="dlg-item-note" class="input" value="${esc(item.note || '')}" placeholder="ملاحظة (اختياري)" />
        <label class="row">
          <span>🔥 ضروري</span>
          <input type="checkbox" id="dlg-item-u" ${item.u ? 'checked' : ''} />
        </label>
        <div class="row">
          <button type="button" class="btn g" data-dlg="cancel">إلغاء</button>
          <button type="button" class="btn" data-dlg="save">حفظ التعديل</button>
        </div>
      </div>`;

    const close = (val) => {
      ov.remove();
      resolve(val);
    };

    ov.querySelector('[data-dlg="cancel"]').addEventListener('click', () => close(null));
    ov.querySelector('[data-dlg="save"]').addEventListener('click', () => {
      const n = ov.querySelector('#dlg-item-n').value.trim();
      if (!n) return;
      close({
        n,
        q: ov.querySelector('#dlg-item-q').value.trim(),
        p: Math.max(0, Number(ov.querySelector('#dlg-item-p').value) || 0),
        c: ov.querySelector('#dlg-item-c').value,
        note: ov.querySelector('#dlg-item-note').value.trim(),
        u: Boolean(ov.querySelector('#dlg-item-u').checked),
      });
    });
    root.appendChild(ov);
    ov.querySelector('#dlg-item-n')?.focus();
  });
}

export function showCategoryDialog(existingCat = null) {
  return new Promise((resolve) => {
    const root = document.getElementById('dialog-root');
    if (!root) {
      resolve(null);
      return;
    }
    const ov = document.createElement('div');
    ov.className = 'dialog-ov';
    ov.innerHTML = `
      <div class="dialog-box stack" role="dialog" aria-modal="true">
        <h3>${existingCat ? '✏️ تعديل القسم' : '➕ قسم جديد'}</h3>
        <div class="g2">
          <input id="dlg-cat-i" class="input" value="${esc(existingCat ? existingCat.i : '🛒')}" maxlength="8" placeholder="رمز (إيموجي)" />
          <input id="dlg-cat-n" class="input" value="${esc(existingCat ? existingCat.n : '')}" maxlength="40" placeholder="اسم القسم" />
        </div>
        <div class="row">
          <button type="button" class="btn g" data-dlg="cancel">إلغاء</button>
          <button type="button" class="btn" data-dlg="save">حفظ</button>
        </div>
      </div>`;

    const close = (val) => {
      ov.remove();
      resolve(val);
    };

    ov.querySelector('[data-dlg="cancel"]').addEventListener('click', () => close(null));
    ov.querySelector('[data-dlg="save"]').addEventListener('click', () => {
      const n = ov.querySelector('#dlg-cat-n').value.trim();
      const i = ov.querySelector('#dlg-cat-i').value.trim() || '🛒';
      if (!n) return;
      close({ n, i });
    });
    root.appendChild(ov);
    ov.querySelector('#dlg-cat-n')?.focus();
  });
}
