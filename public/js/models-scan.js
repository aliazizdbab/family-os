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
