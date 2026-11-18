import { buildProviderHeaders, callAiProvider } from './ai.js';

const EXCLUDED_MODEL_PATTERNS =
  /(?:tts|image|imagen|embedding|embed|live|audio|whisper|veo|aqa|vision-only|exp)/i;

export function filterCandidateGeminiModels(modelsList = []) {
  return (Array.isArray(modelsList) ? modelsList : [])
    .filter((entry) => {
      if (!entry || typeof entry !== 'object') return false;
      const methods = Array.isArray(entry.supportedGenerationMethods)
        ? entry.supportedGenerationMethods
        : [];
      if (methods.length > 0 && !methods.includes('generateContent')) return false;
      const id = String(entry.name || entry.id || '').replace(/^models\//, '');
      if (!id || EXCLUDED_MODEL_PATTERNS.test(id)) return false;
      return true;
    })
    .map((entry) => String(entry.name || entry.id || '').replace(/^models\//, ''))
    .slice(0, 14);
}

export async function scanProviderModels(
  provider,
  { fetchImpl = globalThis.fetch, probeWorking = false } = {}
) {
  if (typeof fetchImpl !== 'function') {
    throw new Error('fetch غير متوفر');
  }
  const baseUrl = String(provider?.url || '').replace(/\/+$/, '');
  if (!baseUrl) {
    throw new Error('أدخل رابط API أولاً');
  }

  const res = await fetchImpl(`${baseUrl}/models`, {
    method: 'GET',
    headers: buildProviderHeaders(provider),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const errMsg = data?.error?.message || data?.error || data?.message || 'فشل جلب الموديلات';
    throw new Error(
      `HTTP ${res.status} — ${typeof errMsg === 'string' ? errMsg : JSON.stringify(errMsg)}`
    );
  }

  const rawList = Array.isArray(data?.models)
    ? data.models
    : Array.isArray(data?.data)
      ? data.data
      : [];

  const models =
    provider?.type === 'gemini'
      ? filterCandidateGeminiModels(rawList)
      : rawList
          .map((entry) => String(entry?.id || entry?.name || entry || '').replace(/^models\//, ''))
          .filter(Boolean)
          .slice(0, 20);

  let recommendedModel = models[0] || provider?.model || '';
  let probedOk = false;

  if (probeWorking && models.length > 0) {
    for (const candidate of models.slice(0, 3)) {
      try {
        await callAiProvider(
          { ...provider, model: candidate },
          'Reply with OK only.',
          [{ role: 'user', content: 'ping' }],
          { maxTokens: 16, timeoutMs: 8000, fetchImpl }
        );
        recommendedModel = candidate;
        probedOk = true;
        break;
      } catch {
        // Try next candidate
      }
    }
  }

  return {
    models,
    recommendedModel,
    probedOk,
  };
}

/**
 * Full model catalog for the admin portal: returns rich entries
 * ({ id, displayName, inputTokenLimit }) instead of bare ids, and keeps a much
 * larger slice so the table is actually complete.
 */
export async function scanModelCatalog(
  provider,
  { fetchImpl = globalThis.fetch, limit = 800 } = {}
) {
  if (typeof fetchImpl !== 'function') throw new Error('fetch غير متوفر');
  const baseUrl = String(provider?.url || '').replace(/\/+$/, '');
  if (!baseUrl) throw new Error('أدخل رابط API أولاً');

  const res = await fetchImpl(`${baseUrl}/models`, {
    method: 'GET',
    headers: buildProviderHeaders(provider),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const errMsg = data?.error?.message || data?.error || data?.message || 'فشل جلب الموديلات';
    throw new Error(
      `HTTP ${res.status} — ${typeof errMsg === 'string' ? errMsg : JSON.stringify(errMsg)}`
    );
  }

  const rawList = Array.isArray(data?.models)
    ? data.models
    : Array.isArray(data?.data)
      ? data.data
      : [];

  const isGemini = provider?.type === 'gemini';
  const rows = [];

  for (const entry of rawList) {
    if (!entry) continue;
    if (isGemini) {
      const methods = Array.isArray(entry.supportedGenerationMethods)
        ? entry.supportedGenerationMethods
        : [];
      if (methods.length > 0 && !methods.includes('generateContent')) continue;
      const id = String(entry.name || entry.id || '').replace(/^models\//, '');
      if (!id || EXCLUDED_MODEL_PATTERNS.test(id)) continue;
      rows.push({
        id,
        displayName: entry.displayName || '',
        inputTokenLimit: entry.inputTokenLimit || null,
      });
    } else {
      const id = String(entry?.id || entry?.name || entry || '').replace(/^models\//, '');
      if (!id || EXCLUDED_MODEL_PATTERNS.test(id)) continue;
      rows.push({
        id,
        displayName: entry?.display_name || entry?.displayName || entry?.name || '',
        inputTokenLimit: entry?.context_window || entry?.context_length || null,
      });
    }
    if (rows.length >= limit) break;
  }

  return rows;
}

export async function probeModel(provider, modelId, { fetchImpl = globalThis.fetch } = {}) {
  const startedAt = Date.now();
  await callAiProvider(
    { ...provider, model: modelId },
    'Reply with OK only.',
    [{ role: 'user', content: 'ping' }],
    { maxTokens: 12, timeoutMs: 12000, fetchImpl }
  );
  return { ok: true, ms: Date.now() - startedAt };
}
