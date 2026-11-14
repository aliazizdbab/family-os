import { esc } from './dialogs.js';

export function renderSampleItemRow(item) {
  return `
    <div class="list-item">
      <span class="${item.dn ? 'done-text' : ''}">${esc(item.n)} ${item.q ? `(${esc(item.q)})` : ''}</span>
      <span class="mu">${item.p ? `${item.p} د.ل` : '—'}</span>
    </div>`;
}
