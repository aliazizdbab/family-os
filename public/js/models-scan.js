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
