/**
 * Cloud AI configuration resolver.
 *
 * Families no longer choose models or paste API keys: the platform owner /
 * developer sets a global provider+key, and may override it per family.
 * Resolution order: family override → global config → nothing.
 */

import { createDefaultAiConfig, setRuntimeAiConfig } from './ai.js';
import { getFirebaseServices } from './auth-v3.js';

/** Provider id → index in AI_PROVIDER_PRESETS (see ai.js). */
export const AI_PROVIDER_INDEX = Object.freeze({
  openai: 0,
  anthropic: 1,
  gemini: 2,
  openrouter: 3,
  groq: 4,
  deepseek: 5,
});

export const AI_PROVIDER_LABELS = Object.freeze({
  gemini: 'Google Gemini',
  openai: 'OpenAI',
  anthropic: 'Anthropic Claude',
  openrouter: 'OpenRouter',
  groq: 'Groq',
  deepseek: 'DeepSeek',
  custom: 'مزود مخصص',
});

function buildRuntimeConfig(record) {
  const cfg = createDefaultAiConfig();

  // Custom / self-hosted provider (any OpenAI-compatible or Gemini-style API).
  if (record.provider === 'custom') {
    const custom = {
      id: 'prov_custom',
      name: record.name || 'مزود مخصص',
      type: record.type === 'gemini' ? 'gemini' : 'openai',
      url: String(record.url || '').replace(/\/+$/, ''),
      model: record.model || '',
      key: String(record.apiKey || ''),
      models: [],
    };
    cfg.ps.push(custom);
    cfg.on = 'prov_custom';
    cfg.ed = 'prov_custom';
    return cfg;
  }

  const idx = AI_PROVIDER_INDEX[record.provider] ?? AI_PROVIDER_INDEX.gemini;
  const prov = cfg.ps[idx] || cfg.ps[AI_PROVIDER_INDEX.gemini];
  prov.key = String(record.apiKey || '');
  if (record.model) prov.model = String(record.model);
  if (record.url) prov.url = String(record.url).replace(/\/+$/, '');
  cfg.on = prov.id;
  cfg.ed = prov.id;
  return cfg;
}

/**
 * Load the effective AI configuration for a family and install it as the
 * runtime config used by the assistant. Returns the config or null.
 */
export async function loadEffectiveAiConfig(fid) {
  try {
    const { db, dbMod } = await getFirebaseServices();
    let record = null;

    if (fid) {
      try {
        const snap = await dbMod.get(dbMod.ref(db, `v3/aiConfig/families/${fid}`));
        if (snap.exists()) {
          const v = snap.val() || {};
          if (v.enabled !== false && v.apiKey) record = v;
        }
      } catch {
        // no per-family override
      }
    }

    if (!record) {
      try {
        const snap = await dbMod.get(dbMod.ref(db, 'v3/aiConfig/global'));
        if (snap.exists()) {
          const v = snap.val() || {};
          if (v.apiKey) record = v;
        }
      } catch {
        // no global config
      }
    }

    if (!record) return null;
    const cfg = buildRuntimeConfig(record);
    setRuntimeAiConfig(cfg);
    return cfg;
  } catch (err) {
    console.warn('[ai-config] load failed:', err);
    return null;
  }
}

/** Read both global and per-family AI records (admin portal). */
export async function fetchAiSettings(fid) {
  const { db, dbMod } = await getFirebaseServices();
  let global = null;
  let family = null;
  try {
    const snap = await dbMod.get(dbMod.ref(db, 'v3/aiConfig/global'));
    if (snap.exists()) global = snap.val();
  } catch (err) {
    console.warn('[ai-config] read global failed:', err);
  }
  if (fid) {
    try {
      const snap = await dbMod.get(dbMod.ref(db, `v3/aiConfig/families/${fid}`));
      if (snap.exists()) family = snap.val();
    } catch (err) {
      console.warn('[ai-config] read family failed:', err);
    }
  }
  return { global, family };
}
