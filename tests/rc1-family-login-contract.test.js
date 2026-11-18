/**
 * Static contract test for RC1 (Phase 1 fix).
 *
 * The family portal in app.js MUST authenticate through Firebase by calling
 * `loginFamilyMember` from auth-v3.js. Today it authenticates purely locally
 * (resolveRoomInput + switchFamilyRoom), so registered families never appear on
 * other devices and every copy runs as an island (see
 * docs/FEATURE_REQUEST_CROSS_FAMILY_SYNC.md, RC1).
 *
 * This is a *source contract* test: it greps app.js for the required import and
 * the call site. It goes RED until the family portal is wired to the real auth
 * flow, and stays GREEN afterwards, guarding against regression.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const appJs = readFileSync(join(here, '..', 'public', 'js', 'app.js'), 'utf8');

test('RC1 fix: app.js imports loginFamilyMember from auth-v3.js', () => {
  const importBlock = appJs.match(/import\s*\{[^}]*\}\s*from\s*'\.\/auth-v3\.js'/s);
  assert.ok(importBlock, 'app.js must have an import block from ./auth-v3.js');
  assert.match(
    importBlock[0],
    /loginFamilyMember/,
    'auth-v3.js import block must include loginFamilyMember'
  );
});

test('RC1 fix: handleFamilyLogin calls loginFamilyMember with family+member+password', () => {
  // handleFamilyLogin is defined as: const handleFamilyLogin = async () => { ... };
  const fn = appJs.match(/const handleFamilyLogin = async \(\) => {[\s\S]*?\n  };/);
  assert.ok(fn, 'handleFamilyLogin must exist in app.js');
  const body = fn[0];
  assert.match(
    body,
    /await\s+loginFamilyMember\s*\(/,
    'handleFamilyLogin must call await loginFamilyMember(...)'
  );
  assert.match(
    body,
    /familyName:/,
    'handleFamilyLogin must pass familyName to loginFamilyMember'
  );
  assert.match(
    body,
    /memberName:/,
    'handleFamilyLogin must pass memberName to loginFamilyMember'
  );
  assert.match(
    body,
    /password:/,
    'handleFamilyLogin must pass password to loginFamilyMember'
  );
});

test('RC1 fix: handleFamilyLogin honours the ok:false result (no silent local fallback)', () => {
  const fn = appJs.match(/const handleFamilyLogin = async \(\) => {[\s\S]*?\n  };/);
  assert.ok(fn, 'handleFamilyLogin must exist in app.js');
  const body = fn[0];
  assert.match(
    body,
    /if\s*\(\s*!res\.ok\s*\)/,
    'handleFamilyLogin must branch on res.ok === false and surface the error'
  );
});

test('RC1 fix: on successful login, state.roomId is set from the returned fid (not a free-text input)', () => {
  const fn = appJs.match(/const handleFamilyLogin = async \(\) => {[\s\S]*?\n  };/);
  assert.ok(fn, 'handleFamilyLogin must exist in app.js');
  const body = fn[0];
  // The room must be derived from the authenticated family id, not from raw user text.
  assert.match(
    body,
    /state\.roomId\s*=\s*authenticatedRoomId/,
    'state.roomId must be assigned from the authenticated fid after Firebase login'
  );
  assert.match(
    body,
    /authenticatedRoomId\s*=\s*res\.session\.fid/,
    'authenticatedRoomId must be derived from res.session.fid'
  );
});
