import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { generateInviteToken, parseJoinHash } from '../public/js/auth.js';
import {
  CONFIRM_REQUIRED_AI_ACTIONS,
  SUPPORTED_AI_ACTIONS,
  parseAiEnvelope,
} from '../public/js/ai-actions.js';
import { filterCandidateGeminiModels } from '../public/js/models-scan.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');

test('firebase.json, .firebaserc, and database.rules.json are valid and preserve legacy paths', () => {
  const firebaserc = JSON.parse(fs.readFileSync(path.join(projectRoot, '.firebaserc'), 'utf8'));
  assert.equal(firebaserc.projects?.default, 'family-requests-9e431');

  const firebaseJson = JSON.parse(fs.readFileSync(path.join(projectRoot, 'firebase.json'), 'utf8'));
  assert.equal(firebaseJson.hosting?.public, 'public');
  assert.equal(firebaseJson.database?.rules, 'database.rules.json');
  assert.equal(firebaseJson.emulators?.auth?.port, 9099);
  assert.equal(firebaseJson.emulators?.database?.port, 9000);
  assert.equal(firebaseJson.emulators?.hosting?.port, 5000);

  const swHeader = firebaseJson.hosting.headers.find((h) => h.source === '/sw.js');
  assert.ok(swHeader, 'sw.js cache-control header must exist');
  assert.match(swHeader.headers[0].value, /no-cache/);

  const rulesDoc = JSON.parse(
    fs.readFileSync(path.join(projectRoot, 'database.rules.json'), 'utf8')
  );
  const rules = rulesDoc.rules;

  // Legacy paths preserved until Gate G1
  assert.equal(rules.rooms?.$legacyRoom?.['.read'], true);
  assert.equal(rules.rooms?.$legacyRoom?.['.write'], true);
  assert.equal(rules.ai?.$legacyRoom?.['.read'], true);
  assert.equal(rules.ai?.$legacyRoom?.['.write'], true);

  // v2 room rules and role checks
  const roomRules = rules.v2?.rooms?.$rid;
  assert.ok(roomRules, '/v2/rooms/$rid rules must exist');
  assert.match(roomRules['.read'], /auth != null/);
  assert.match(roomRules['.read'], /members/);

  // Children cannot write items, cats, budget, or ai
  assert.match(roomRules.items?.$iid?.['.write'], /role.*admin.*role.*member/);
  assert.doesNotMatch(roomRules.items?.$iid?.['.write'], /'child'/);
  assert.match(roomRules.cats?.$cid?.['.write'], /role.*admin.*role.*member/);
  assert.doesNotMatch(roomRules.cats?.$cid?.['.write'], /'child'/);
  assert.match(roomRules.budget?.['.write'], /role.*=== 'admin'/);
  assert.match(roomRules.ai?.['.write'], /role.*=== 'admin'/);

  // Members rule forbids storing PIN salt/hash and validates invite token expiry
  assert.match(roomRules.members?.$uid?.['.validate'], /!newData\.hasChild\('salt'\)/);
  assert.match(roomRules.members?.$uid?.['.validate'], /!newData\.hasChild\('hash'\)/);
  assert.match(roomRules.members?.$uid?.['.write'], /meta\/invite\/expiresAt.*> now/);

  // Daily AI usage counter increments only by 1
  assert.match(
    roomRules.aiUsage?.$uid?.$yyyymmdd?.['.validate'],
    /newData\.val\(\) === data\.val\(\) \+ 1/
  );
});

test('auth invite helpers generate and parse #join=<rid>.<token> links', () => {
  const invite = generateInviteToken(3600_000, 1_700_000_000_000);
  assert.equal(invite.token.length, 32);
  assert.equal(invite.expiresAt, 1_700_003_600_000);

  const parsed = parseJoinHash(`#join=family-room.${invite.token}`);
  assert.deepEqual(parsed, { roomId: 'family-room', token: invite.token });
  assert.equal(parseJoinHash('#join=invalid'), null);
});

test('AI action envelope parser and Gemini free-model filter work as specified', () => {
  assert.ok(SUPPORTED_AI_ACTIONS.includes('add_items'));
  assert.ok(SUPPORTED_AI_ACTIONS.includes('add_request'));
  assert.ok(CONFIRM_REQUIRED_AI_ACTIONS.includes('delete_items'));

  const parsed = parseAiEnvelope(
    '```json\n{"reply":"تمت الإضافة","actions":[{"name":"add_items","args":{"items":[{"n":"حليب"}]}}]}\n```'
  );
  assert.equal(parsed.reply, 'تمت الإضافة');
  assert.equal(parsed.actions.length, 1);
  assert.equal(parsed.actions[0].name, 'add_items');

  const models = filterCandidateGeminiModels([
    { name: 'models/gemini-2.5-flash', supportedGenerationMethods: ['generateContent'] },
    { name: 'models/gemini-2.5-pro-tts', supportedGenerationMethods: ['generateContent'] },
    { name: 'models/text-embedding-004', supportedGenerationMethods: ['embedContent'] },
    { name: 'models/gemini-2.0-flash-exp', supportedGenerationMethods: ['generateContent'] },
  ]);
  assert.deepEqual(models, ['gemini-2.5-flash']);
});
