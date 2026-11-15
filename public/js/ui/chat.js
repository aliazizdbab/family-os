import { esc } from './dialogs.js';
import {
  DAILY_AI_LIMIT,
  getActiveAiProvider,
  getOrInitAiConfig,
  isAiProviderReady,
} from '../ai.js';

export function renderChatView(appState) {
  const cfg = getOrInitAiConfig();
  const activeProv = getActiveAiProvider(cfg);
  const cloudReady = isAiProviderReady(activeProv);
  const canConfigureAi = ['developer', 'admin'].includes(appState?.prefs?.currentRole || 'admin');
  const usedToday = Number(appState?.aiUsageCount) || 0;
  const messages = Array.isArray(appState?.chatMessages) ? appState.chatMessages : [];

  const statusHtml = cloudReady
    ? `<span class="badge-ok">☁️ ${esc(activeProv.name)} (${esc(activeProv.model)})</span>`
    : '<span class="badge-ok">⚡ المساعد المحلي الذكي مفعّل</span>';

  const setupHintHtml = cloudReady
    ? ''
    : canConfigureAi
      ? `<p class="mu">يعمل المساعد فوراً بدون مفتاح API (إضافة ذكية، حذف بتأكيد، مهام، ميزانية، واقتراح وجبات). ولربط Gemini المجاني أو OpenAI، اضغط على الإعدادات أدناه:</p>
         <button type="button" id="ai-goto-settings-btn" class="btn g">⚙️ ضبط مزود الذكاء الاصطناعي ومفاتيح API</button>`
      : '<p class="mu">يعمل المساعد المحلي الذكي الآن لخدمتك في المقاضي والمهام والميزانية.</p>';

  const messagesHtml = messages.length
    ? messages
        .map((m, msgIdx) => {
          if (m.role === 'user') {
            return `<div class="chat-msg user"><strong>👤 أنت:</strong><div>${esc(m.text)}</div></div>`;
          }
          const resultsHtml = (Array.isArray(m.results) ? m.results : [])
            .map((r) => `<div class="mu">✔ ${esc(r)}</div>`)
            .join('');
          const pendingHtml = (Array.isArray(m.pending) ? m.pending : [])
            .map((p, pendIdx) => {
              if (p.resolved) {
                return `<div class="mu">${p.approved ? '✅ نُفّذ' : '✕ أُلغي'}: ${esc(p.label)}</div>`;
              }
              return `
                <div class="chat-confirm-box stack">
                  <div class="mu"><strong>⚠️ تأكيد مطلوب:</strong> ${esc(p.label)}</div>
                  <div class="row">
                    <button type="button" class="btn" data-ai-confirm="${msgIdx}:${pendIdx}">✅ تأكيد التنفيذ</button>
                    <button type="button" class="btn g" data-ai-cancel="${msgIdx}:${pendIdx}">✕ إلغاء</button>
                  </div>
                </div>`;
            })
            .join('');

          return `
            <div class="chat-msg bot stack">
              <strong>🤖 المساعد:</strong>
              <pre class="chat-pre">${esc(m.text)}</pre>
              ${resultsHtml}
              ${pendingHtml}
            </div>`;
        })
        .join('')
    : '<p class="mu">جرّب كتابة: «أضف حليب وخبز»، «أضف مهمة ترتيب الغرفة»، أو «ماذا نطبخ اليوم؟»</p>';

  return `
    <section class="sec stack" id="ai-header-sec">
      <div class="row">
        <h2>🤖 مساعد Family OS الذكي</h2>
        ${statusHtml}
      </div>
      <div class="chips">
        <span class="chip">📊 الاستخدام اليومي: ${usedToday}/${DAILY_AI_LIMIT}</span>
        <span class="chip">🛡️ حذف وتعديل الأعضاء بتأكيدك فقط</span>
      </div>
      ${setupHintHtml}
    </section>

    <section class="sec stack" id="ai-quick-prompts">
      <strong>⚡ أوامر سريعة:</strong>
      <div class="chips">
        <button type="button" class="btn g" data-ai-prompt="أضف حليب وخبز وطماطم">🛒 أضف حليب وخبز وطماطم</button>
        <button type="button" class="btn g" data-ai-prompt="ماذا نطبخ اليوم؟">🍲 ماذا نطبخ اليوم؟</button>
        <button type="button" class="btn g" data-ai-prompt="حلل الميزانية والمصاريف">📊 حلل الميزانية</button>
        <button type="button" class="btn g" data-ai-prompt="أضف مهمة ترتيب غرفة المعيشة">📋 أضف مهمة منزلية</button>
      </div>
    </section>

    <section class="sec stack">
      <div id="ai-chat-box" class="chat-stream">
        ${messagesHtml}
        ${appState?.aiBusy ? '<div class="chat-msg bot">⏳ جارٍ التفكير وتنفيذ الأوامر...</div>' : ''}
      </div>

      <div class="row">
        <input
          id="ai-chat-inp"
          class="input grow"
          placeholder="اكتب طلبك أو الصق قائمة مشتريات..."
          autocomplete="off"
        />
        <button type="button" id="ai-voice-btn" class="btn g" aria-label="إملاء صوتي">🎙️</button>
        <button type="button" id="ai-send-btn" class="btn" ${appState?.aiBusy ? 'disabled' : ''}>📨 إرسال</button>
      </div>
      <button type="button" id="ai-clear-chat-btn" class="btn g full">🧹 مسح سجل المحادثة</button>
    </section>
  `;
}

export const renderChatPlaceholder = renderChatView;
