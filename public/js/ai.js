export const DAILY_AI_LIMIT = 30;

export const AI_PROVIDER_PRESETS = Object.freeze([
  ['OpenAI', 'openai', 'https://api.openai.com/v1', 'gpt-4o-mini'],
  ['Anthropic', 'anthropic', 'https://api.anthropic.com/v1', 'claude-sonnet-5-5'],
  [
    'Google Gemini',
    'gemini',
    'https://generativelanguage.googleapis.com/v1beta',
    'gemini-2.5-flash',
  ],
  ['OpenRouter', 'openai', 'https://openrouter.ai/api/v1', 'openai/gpt-4o-mini'],
  ['Groq', 'openai', 'https://api.groq.com/openai/v1', 'llama-3.3-70b-versatile'],
  ['DeepSeek', 'openai', 'https://api.deepseek.com', 'deepseek-chat'],
]);

const AI_SESSION_KEY = 'fl_v2_ai_session';
let runtimeAiConfig = null;

export function createDefaultAiConfig() {
  const ps = AI_PROVIDER_PRESETS.map(([name, type, url, model], idx) => ({
    id: `prov_${idx + 1}`,
    name,
    type,
    url,
    model,
    key: '',
    models: [],
  }));
  return {
    on: 'prov_3',
    ed: 'prov_3',
    ps,
  };
}

function saveToSessionStorage(config) {
  try {
    if (globalThis.sessionStorage) {
      globalThis.sessionStorage.setItem(AI_SESSION_KEY, JSON.stringify(config));
    }
  } catch {
    // Ignore storage restrictions in private modes
  }
}

function loadFromSessionStorage() {
  try {
    if (globalThis.sessionStorage) {
      const raw = globalThis.sessionStorage.getItem(AI_SESSION_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && Array.isArray(parsed.ps) && parsed.ps.length > 0) {
          return parsed;
        }
      }
    }
  } catch {
    // Ignore malformed session storage
  }
  return null;
}

export function setRuntimeAiConfig(config) {
  runtimeAiConfig = config ? structuredClone(config) : null;
  if (runtimeAiConfig) {
    saveToSessionStorage(runtimeAiConfig);
  }
}

export function getRuntimeAiConfig() {
  if (!runtimeAiConfig) {
    runtimeAiConfig = loadFromSessionStorage();
  }
  return runtimeAiConfig;
}

export function getOrInitAiConfig() {
  const existing = getRuntimeAiConfig();
  if (existing) return existing;
  const fresh = createDefaultAiConfig();
  runtimeAiConfig = fresh;
  return runtimeAiConfig;
}

export function clearRuntimeAiConfig() {
  runtimeAiConfig = null;
  try {
    if (globalThis.sessionStorage) {
      globalThis.sessionStorage.removeItem(AI_SESSION_KEY);
    }
  } catch {
    // Ignore
  }
}

export function getActiveAiProvider(cfg = getOrInitAiConfig()) {
  return cfg.ps.find((p) => p.id === cfg.on) || cfg.ps[0] || null;
}

export function getEditedAiProvider(cfg = getOrInitAiConfig()) {
  return cfg.ps.find((p) => p.id === cfg.ed) || getActiveAiProvider(cfg);
}

export function isAiProviderReady(prov) {
  if (!prov || !prov.url || !prov.model) return false;
  const isLocal = /localhost|127\.0\.0\.1/i.test(prov.url);
  return Boolean(String(prov.key || '').trim() || isLocal);
}

export function buildProviderHeaders(prov) {
  const headers = { 'Content-Type': 'application/json' };
  const apiKey = String(prov?.key || '').trim();
  if (!apiKey) return headers;

  if (prov?.type === 'anthropic') {
    headers['x-api-key'] = apiKey;
    headers['anthropic-version'] = '2023-06-01';
    headers['anthropic-dangerous-direct-browser-access'] = 'true';
  } else if (prov?.type === 'gemini') {
    headers['x-goog-api-key'] = apiKey;
  } else {
    headers.Authorization = `Bearer ${apiKey}`;
  }
  return headers;
}

export function extractProviderText(prov, data) {
  if (!data || typeof data !== 'object') return '';
  if (prov?.type === 'anthropic') {
    return (Array.isArray(data.content) ? data.content : [])
      .map((part) => part?.text || '')
      .join('');
  }
  if (prov?.type === 'gemini') {
    const parts = data.candidates?.[0]?.content?.parts || [];
    return (Array.isArray(parts) ? parts : []).map((part) => part?.text || '').join('');
  }
  return String(data.choices?.[0]?.message?.content || '');
}

export async function callAiProvider(
  prov,
  systemPrompt,
  messages,
  { maxTokens = 1400, timeoutMs = 45000, fetchImpl = globalThis.fetch } = {}
) {
  if (typeof fetchImpl !== 'function') {
    throw new Error('fetch غير متوفر في هذه البيئة');
  }
  const baseUrl = String(prov?.url || '').replace(/\/+$/, '');
  if (!baseUrl || !prov?.model) {
    throw new Error('أكمل رابط API واسم الموديل أولاً');
  }

  let endpoint = '';
  let body = null;
  const cleanMsgs = (Array.isArray(messages) ? messages : []).map((m) => ({
    role: m.role === 'assistant' ? 'assistant' : 'user',
    content: String(m.content || ''),
  }));

  if (prov.type === 'anthropic') {
    endpoint = `${baseUrl}/messages`;
    body = {
      model: prov.model,
      max_tokens: maxTokens,
      system: systemPrompt,
      messages: cleanMsgs,
    };
  } else if (prov.type === 'gemini') {
    endpoint = `${baseUrl}/models/${encodeURIComponent(prov.model)}:generateContent`;
    body = {
      systemInstruction: { parts: [{ text: systemPrompt }] },
      contents: cleanMsgs.map((m) => ({
        role: m.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: m.content }],
      })),
      generationConfig: { temperature: 0.3, maxOutputTokens: maxTokens },
    };
  } else {
    endpoint = `${baseUrl}/chat/completions`;
    body = {
      model: prov.model,
      max_tokens: maxTokens,
      temperature: 0.3,
      messages: [{ role: 'system', content: systemPrompt }, ...cleanMsgs],
    };
  }

  const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;

  try {
    const res = await fetchImpl(endpoint, {
      method: 'POST',
      headers: buildProviderHeaders(prov),
      body: JSON.stringify(body),
      signal: controller ? controller.signal : undefined,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const msg = data?.error?.message || data?.error || data?.message || 'خطأ غير معروف';
      throw new Error(
        `HTTP ${res.status} — ${typeof msg === 'string' ? msg : JSON.stringify(msg)}`
      );
    }
    return extractProviderText(prov, data);
  } catch (err) {
    if (err?.name === 'AbortError') {
      throw new Error('انتهت مهلة الاتصال بمزود الذكاء الاصطناعي');
    }
    throw err;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export function getTodayYmd(nowMs = Date.now()) {
  const d = new Date(nowMs);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}${m}${day}`;
}

export async function getDailyAiUsage(uid, store, nowMs = Date.now()) {
  const key = `${uid || 'local'}_${getTodayYmd(nowMs)}`;
  const usageMap = (await store?.getPref?.('aiUsageMap', {})) || {};
  return Math.max(0, Number(usageMap[key]) || 0);
}

export async function incrementDailyAiUsage(
  uid,
  store,
  limit = DAILY_AI_LIMIT,
  nowMs = Date.now()
) {
  const key = `${uid || 'local'}_${getTodayYmd(nowMs)}`;
  const usageMap = (await store?.getPref?.('aiUsageMap', {})) || {};
  const current = Math.max(0, Number(usageMap[key]) || 0);
  if (current >= limit) {
    return { ok: false, used: current, limit };
  }
  const nextCount = current + 1;
  const nextMap = { ...usageMap, [key]: nextCount };
  if (store?.setPref) {
    await store.setPref('aiUsageMap', nextMap);
  }
  return { ok: true, used: nextCount, limit };
}
