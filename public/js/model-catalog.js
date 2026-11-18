/**
 * Reference model catalog: display names, list prices (USD per 1M tokens) and
 * free-tier heuristics. Prices are indicative list prices for guidance only —
 * the provider is always the source of truth.
 */

/** [regex on model id, input USD/1M, output USD/1M, label] */
const PRICE_RULES = [
  // Google Gemini
  [/^gemini-2\.5-pro/i, 1.25, 10.0, 'Gemini 2.5 Pro'],
  [/^gemini-2\.5-flash-lite/i, 0.1, 0.4, 'Gemini 2.5 Flash Lite'],
  [/^gemini-2\.5-flash/i, 0.3, 2.5, 'Gemini 2.5 Flash'],
  [/^gemini-2\.0-flash-lite/i, 0.075, 0.3, 'Gemini 2.0 Flash Lite'],
  [/^gemini-2\.0-flash/i, 0.1, 0.4, 'Gemini 2.0 Flash'],
  [/^gemini-1\.5-pro/i, 1.25, 5.0, 'Gemini 1.5 Pro'],
  [/^gemini-1\.5-flash/i, 0.075, 0.3, 'Gemini 1.5 Flash'],
  // OpenAI
  [/^gpt-4o-mini/i, 0.15, 0.6, 'GPT-4o mini'],
  [/^gpt-4o(?!-mini)/i, 2.5, 10.0, 'GPT-4o'],
  [/^gpt-4\.1-mini/i, 0.4, 1.6, 'GPT-4.1 mini'],
  [/^gpt-4\.1/i, 2.0, 8.0, 'GPT-4.1'],
  [/^o4-mini/i, 1.1, 4.4, 'o4-mini'],
  [/^o3-mini/i, 1.1, 4.4, 'o3-mini'],
  // Anthropic
  [/claude.*opus/i, 15.0, 75.0, 'Claude Opus'],
  [/claude.*sonnet/i, 3.0, 15.0, 'Claude Sonnet'],
  [/claude.*haiku/i, 0.8, 4.0, 'Claude Haiku'],
  // DeepSeek
  [/^deepseek-chat/i, 0.27, 1.1, 'DeepSeek Chat'],
  [/^deepseek-reasoner/i, 0.55, 2.19, 'DeepSeek Reasoner'],
  // Groq / Llama
  [/^llama-3\.3-70b/i, 0.59, 0.79, 'Llama 3.3 70B'],
  [/^llama-3\.1-8b/i, 0.05, 0.08, 'Llama 3.1 8B'],
  [/^llama/i, 0.2, 0.2, 'Llama'],
  [/^mixtral/i, 0.24, 0.24, 'Mixtral'],
  [/^gemma/i, 0.1, 0.1, 'Gemma'],
  [/^qwen/i, 0.2, 0.6, 'Qwen'],
];

export function modelPriceInfo(modelId) {
  const id = String(modelId || '');
  for (const [re, input, output, label] of PRICE_RULES) {
    if (re.test(id)) return { input, output, label };
  }
  return null;
}

/** Heuristic: is this model free to use with the given provider? */
export function isFreeModel(providerId, modelId, baseUrl = '') {
  const id = String(modelId || '').toLowerCase();
  const url = String(baseUrl || '').toLowerCase();
  if (id.includes(':free') || id.startsWith('free')) return true;
  if (providerId === 'groq') return true;
  if (url.includes('localhost') || url.includes('127.0.0.1') || url.includes('ollama')) return true;
  if (providerId === 'gemini' && /flash-lite|2\.0-flash|1\.5-flash/.test(id)) return true;
  return false;
}

export function formatUsd(value) {
  if (value === null || value === undefined) return '—';
  if (value === 0) return '0';
  return `$${value < 1 ? value.toFixed(3).replace(/0+$/, '').replace(/\.$/, '') : value.toFixed(2)}`;
}

/** Build a display row for the models table. */
export function describeModel({ providerId, modelId, baseUrl, meta = {} }) {
  const price = modelPriceInfo(modelId);
  const free = isFreeModel(providerId, modelId, baseUrl);
  return {
    id: modelId,
    label: meta.displayName || price?.label || modelId,
    input: price ? price.input : null,
    output: price ? price.output : null,
    free,
    context: meta.inputTokenLimit || null,
  };
}
