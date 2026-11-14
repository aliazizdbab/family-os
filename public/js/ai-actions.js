export const SUPPORTED_AI_ACTIONS = Object.freeze([
  'add_items',
  'mark_done',
  'claim',
  'update_item',
  'delete_items',
  'clear_done',
  'set_budget',
  'set_member',
  'remove_member',
  'navigate',
  'set_theme',
  'add_category',
  'rename_category',
  'delete_category',
  'reorder_categories',
  'add_request',
]);

export const CONFIRM_REQUIRED_AI_ACTIONS = Object.freeze([
  'delete_items',
  'clear_done',
  'set_member',
  'remove_member',
  'delete_category',
]);

export function parseAiEnvelope(rawText) {
  const text = String(rawText ?? '').trim();
  const match = text.match(/\{[\s\S]*\}/);
  if (match) {
    try {
      const parsed = JSON.parse(match[0]);
      if (parsed && typeof parsed === 'object') {
        return {
          reply: String(parsed.reply ?? ''),
          actions: Array.isArray(parsed.actions) ? parsed.actions : [],
        };
      }
    } catch {
      // Fallback below
    }
  }
  return {
    reply: text.replace(/```[a-z]*/gi, '').trim(),
    actions: [],
  };
}
