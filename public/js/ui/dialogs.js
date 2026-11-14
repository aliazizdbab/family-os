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

export function showToast(message, durationMs = 3200) {
  const el = document.getElementById('toast');
  if (!el) return;
  el.textContent = String(message ?? '');
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    el.hidden = true;
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
