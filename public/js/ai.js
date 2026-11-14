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

let runtimeAiConfig = null;

export function setRuntimeAiConfig(config) {
  runtimeAiConfig = config ? structuredClone(config) : null;
}

export function getRuntimeAiConfig() {
  return runtimeAiConfig;
}

export function clearRuntimeAiConfig() {
  runtimeAiConfig = null;
}
