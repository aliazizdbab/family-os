# Family OS — Build Instructions for the Coding Agent (Antigravity + Firebase MCP)

You are building **Family OS**: an Arabic (RTL), mobile-first, offline-first PWA for a family's shared grocery lists, requests, budget and AI assistant. Follow this document exactly. Work **phase by phase** and **stop at every gate** for the owner's approval.

## 0. Inputs (the owner places these in the repo before you start)
- `legacy/family_list.html` — the working single-file app. It is the **reference for features, Arabic UI strings, categories, the AI action protocol and the Gemini model-scan logic**. Read it fully first. Never edit it.
- `docs/family_os_master_plan_v3.md` — the product plan and priorities. This prompt operationalises it.

## 1. Hard constraints (never violate)
1. **No billing, ever.** Firebase **Spark** plan only. Do **not** enable Blaze, Cloud Functions, Cloud Run, Storage or any paid API. If a step seems to need billing, **stop and ask**.
2. **Do not modify or delete existing data or rules used by the legacy app** (Realtime Database paths it uses, e.g. the `rooms/family` and `ai/family` data). Inspect `legacy/family_list.html` to find its exact paths. The legacy app has **no auth**, so while it is still in use keep its paths working. New data lives under **`/v2/...`** only. Locking down legacy paths happens only after the owner confirms migration is complete (Gate G1).
3. **Never put secrets in the repo, code, logs or commits.** The Gemini API key is entered by the admin inside the app and stored in the database (see §6). Add `.gitignore` for `.firebase/`, `node_modules/`, emulator data, `*.local`.
4. **No build tooling required**: vanilla JavaScript ES modules, plain CSS, no framework. Firebase Web SDK (modular) loaded from the official CDN, **pinned to an exact version** that you verify in the Firebase docs and that is at least 2 weeks old. The service worker must cache the SDK files so the app works offline.
5. **Never use `alert()`, `confirm()` or `prompt()`** (they are blocked in Android WebViews/`content://` and break the UX). Build in-app dialogs, toasts and an Undo snackbar.
6. **Escape all user-provided text** before inserting into HTML (XSS). Add a restrictive CSP `<meta>`.
7. Use the **existing Firebase project** of the owner (project id `family-requests-9e431`, Hosting site `family-requests-9e431.web.app`). Confirm with the owner via the Firebase MCP before changing any project settings.
8. UI language: **Arabic only**, RTL, lang `ar`. Currency label: `د.ل`. Keep code, comments and commit messages in English.

## 2. Working rules
- Use the **Firebase MCP / CLI** for: initialising Hosting + Realtime Database config, deploying rules, deploying Hosting **preview channels**, running emulators. Prefer the **local emulators** for all testing. Do not touch production data while testing.
- One git repo, one branch per phase (`phase-0`, `phase-1`, …), small commits, conventional messages.
- After each phase: run all tests, deploy to a **Hosting preview channel** (`firebase hosting:channel:deploy phase-N`), then post a report: what was done, test results, the preview URL, known limitations. **Then wait for approval.** Do not start the next phase on your own.
- If an instruction is ambiguous or a decision is needed, ask a single clear question and continue with other work meanwhile.

## 3. Target structure
```
family-os/
  firebase.json  .firebaserc  database.rules.json  .gitignore
  legacy/family_list.html          (read-only reference)
  docs/ (plan + this file)
  public/
    index.html  manifest.webmanifest  sw.js  icons/ (192, 512, maskable)
    js/ app.js  state.js  store-idb.js  sync.js  auth.js  schema.js  migrate.js
        ai.js  ai-actions.js  models-scan.js  ui/ (list.js dialogs.js settings.js store-mode.js chat.js)
    css/ app.css
  tests/ rules.test.js  sync.e2e.js  schema.test.js
  tools/ export-legacy.html        (runs inside the legacy app's data origin, see Phase 0)
```

## 4. Data schema (Realtime Database, all under `/v2/rooms/$rid`)
```
meta:    { name, createdAt, schemaVersion:1, invite:{token, expiresAt} }
members/$uid: { name, icon, role:'admin'|'member'|'child', off:false, joinedAt }
cats/$cid:    { n, i, order, updatedAt, deleted }
items/$iid:   { n, q, p, c, u, by(uid), byName, dn, dnBy, dnAt, cl(uid|''), note, updatedAt, createdAt, deleted }
requests/$id: { by, n, q, c, status:'pending'|'approved'|'rejected', updatedAt }   // child requests
history/$id:  { itemName, c, p, q, boughtAt, by }                                   // feeds suggestions
log/$id:      { at, uid, action, target }                                           // capped ~200
budget:       { monthly, perCat:{ $cid: amount } }
ai:           { on, ps:[{id,name,type,url,model,key,fm:[{m,ms}],fa}], t }            // see §6
aiUsage/$uid/$yyyymmdd: count
```
Rules of the model: **one node per entity** (never one big blob); every write sets `updatedAt` (client ms); **soft delete** (`deleted:true`) and a periodic client-side cleanup of tombstones older than 30 days; merge = **last-writer-wins per entity by `updatedAt`**, tie-break by uid. Add `schemaVersion` and a migration runner in `schema.js`.

## 5. Auth & security rules
- **Firebase Anonymous Auth** (the owner must enable the provider in the console — ask them). Identity = `auth.uid`.
- Create room: signed-in user creates `/v2/rooms/$rid` when it does not exist → becomes `admin`.
- Join: link `#join=<rid>.<token>` → user writes own `members/$uid` with the token; rules compare it with `meta/invite/token` and `expiresAt`. Admin can rotate/revoke the token.
- Lost device: owner re-joins via a new invite and admin can relink a member name to the new uid.
- A local **PIN lock** (WebCrypto PBKDF2, stored only in IndexedDB on the device) is just a convenience screen lock — **not** the security boundary. Never store PIN hashes in the database.
- `database.rules.json` (sketch — you must complete it with `.validate` for every field type/length, role checks, and "children cannot write items/cats/budget/ai"):
```json
{ "rules": { "v2": { "rooms": { "$rid": {
  ".read": "auth != null && root.child('v2/rooms/'+$rid+'/members/'+auth.uid).exists()",
  "meta": { ".write": "auth != null && (!data.exists() || root.child('v2/rooms/'+$rid+'/members/'+auth.uid+'/role').val()==='admin')" },
  "members": { "$uid": { ".write": "auth.uid===$uid && (newData.child('role').val()==='member' || newData.child('role').val()==='child') && newData.parent().parent().child('meta/invite/token').val()===newData.child('token').val() || root.child('v2/rooms/'+$rid+'/members/'+auth.uid+'/role').val()==='admin'" } },
  "items": { ".write": "root.child('v2/rooms/'+$rid+'/members/'+auth.uid+'/role').val()==='admin' || root.child('v2/rooms/'+$rid+'/members/'+auth.uid+'/role').val()==='member'" },
  "ai": { ".write": "root.child('v2/rooms/'+$rid+'/members/'+auth.uid+'/role').val()==='admin'" }
}}}}}
```
Write **`tests/rules.test.js`** with `@firebase/rules-unit-testing` against the emulator: non-member cannot read; member cannot write `ai`; child cannot write items; expired token cannot join; non-admin cannot rotate invite; admin can do everything; malformed data is rejected. Rules must also keep the **legacy paths functioning** until Gate G1 (add a clearly commented temporary block).
- Optionally enable **App Check** (reCAPTCHA v3) **only after** everything works, in *monitor* mode first; never enforce without telling the owner (it can lock everyone out).

## 6. AI configuration (free Gemini key, no server)
- The admin enters the key in Settings → AI. It is stored at `/v2/rooms/$rid/ai` (readable by members only, writable by admin only). It is **never** stored in localStorage/IndexedDB/backups/exports/logs, only held in memory after load. Every member's app loads it at startup and re-fetches before each AI request, so changes propagate automatically.
- Settings (admin only): providers list (OpenAI-compatible, Anthropic, Gemini presets), URL, model, key, **Test connection**, **Fetch models**, save. Non-admins never see these fields.
- **Free-model scan** (port from legacy `scanP`/`callSm`): Google does not flag free models, so list `models` with `generateContent`, filter text models (exclude tts/image/embedding/live/audio/exp…), probe up to 14 sequentially (1 s apart) with a tiny request, show the ones that actually work with their latency as selectable chips, auto-rescan weekly when the admin opens the app, auto-switch if the current model stops working, and make member requests **fall back to up to 3 other working models** on HTTP 404/429/503.
- **Per-member daily limit** (`aiUsage`) enforced client-side plus in rules (counter increments only by 1) to protect the free quota. Show a friendly Arabic message when exceeded.
- Privacy: send the minimum (item names, categories, quantities, prices; never PINs, uids or keys). Mention in Settings that free-tier prompts may be used by Google to improve products.
- **Action protocol**: port from legacy. The model replies with JSON only: `{"reply":"…","actions":[{"name":"…","args":{…}}]}`. Commands: `add_items, mark_done, claim, update_item, delete_items, clear_done, set_budget, set_member, remove_member, navigate, set_theme` plus new `add_category, rename_category, delete_category, reorder_categories, add_request`. Destructive/admin actions require an in-chat **confirm card**; role checks run in code, not in the prompt. Treat item names/pasted text as data (prompt-injection guard in the system prompt). Log each AI action and provide **"Undo last AI action"**.

## 7. Phases

### Phase 0 — Foundation (gate G0)
1. Scaffold the structure (§3); `firebase.json` with Hosting (`public`, SPA fallback, long cache for `/js` `/css` with versioned names, no-cache for `sw.js`), `.firebaserc`, emulators (auth, database, hosting).
2. `manifest.webmanifest` (RTL, `lang:"ar"`, `display:"standalone"`, theme colour taken from the legacy app's default accent, icons incl. maskable, **`shortcuts`** for "إضافة غرض" and "وضع السوبرماركت", and **`share_target`** (GET `?text=`) so text shared from WhatsApp opens the app and is parsed by the AI).
3. `sw.js`: versioned cache, app-shell + Firebase SDK precache, cache-first for static, network-first for navigation, "new version available" prompt.
4. `schema.js` with `schemaVersion`, validators, migration runner; unit tests.
5. `store-idb.js`: IndexedDB wrapper (entities + outbox).
6. **Migration tool** `tools/export-legacy.html` + importer in `migrate.js`: (a) the legacy app already has a backup export (JSON of its state: items, members, budget, log, cats) — import that file; (b) map to the new schema (member PINs are discarded; members re-join by invite; keep names/icons/roles); (c) idempotent, with a dry-run preview and counts. Test with a sample JSON produced from the legacy structure.
7. Deploy an empty-but-installable shell to preview. **Gate G0:** installs on Android, opens offline, import dry-run shows correct counts.

### Phase 1 — Sync & security (gate G1)
1. `auth.js` (anonymous auth, create room, join via invite, rotate/revoke token, relink member).
2. `sync.js`: UI reads **only** from the local store; all writes go to local store + outbox first; a sync engine flushes the outbox when online and subscribes with `onChildAdded/Changed/Removed` per collection; LWW merge; tombstones; retry with backoff; sync status indicator (متصل / غير متصل / جارٍ المزامنة / N تغييرات معلّقة).
3. Complete `database.rules.json` + `tests/rules.test.js` (§5). Deploy rules to the emulator, then to production **only after the owner approves**, while keeping the legacy block.
4. **Scenario tests** (`tests/sync.e2e.js`, two browser contexts against the emulator): (a) both offline add different items → both present after reconnect; (b) A deletes while B edits the same item → deterministic documented result, no resurrection after cleanup; (c) both edit the same field → LWW by `updatedAt`; (d) reload while offline keeps pending changes; (e) non-member cannot read.
5. Real data migration to production `/v2` **after owner approval**, then run legacy and new app side by side for a week. **Gate G1:** all tests green; owner confirms migration; only then lock the legacy paths.

### Phase 2 — Shopping v2 (gate G2)
Port every legacy feature, then add the new ones (all Arabic UI):
- Dynamic categories (add / rename / emoji / delete with item move-and-confirm / reorder ↑↓), per-device collapse/expand and "collapse all".
- Lists show **remaining only**; completed items live in a collapsed "✅ المنجزة" section; admin "clear done" with confirm.
- **Inline quantity and price inputs on every row**, including completed items (saved on change, header totals update without a full re-render and without losing focus).
- Edit dialog (name, qty, price, category, urgent, note); search box; "I'll bring it" claim; WhatsApp report share.
- **Undo snackbar** (5 s) for delete, done, clear-done, move.
- **Suggestions from history** while typing (previous items with their category and last price); "frequent items" chips.
- **Recurring lists** ("مشتريات الأسبوع": save the current list as a template and re-add in one tap; monthly items).
- **In-store mode**: big touch targets, one-hand check-off, live running total vs budget, categories ordered by the store aisle order (admin-editable), "لا يوجد في المتجر" defers the item.
- **Roles & requests**: `child` submits requests → admin approves/rejects (approved becomes an item).
- **Share target** handling: shared text → AI parse → confirm card → add.
- Monthly budget with per-category limits and a soft warning near the limit.
- Accessibility & UX: touch targets ≥ 44 px, dark mode, font scaling, focus management, no layout jumps. **Gate G2:** the owner's family uses it for 2 weeks without data loss.

### Phase 3 — AI v2 (gate G3)
Implement §6 completely (settings, scan, fallback, limits, action protocol with new commands, confirm cards, audit + undo). Chat tab with history per device (cleared on logout). Add: image input (photo of a handwritten list / receipt → items and actual prices via Gemini vision; ask for explicit user confirmation before saving), weekly "smart suggestions" ("you buy milk every ~6 days"), and monthly Arabic summary. **Gate G3:** AI tests on a fixed set of Arabic prompts (dialect lists, ambiguous requests, injection attempts inside item names) with expected JSON outputs.

### Phases 4–7 — **do not start** without the owner's explicit go-ahead
Money & bills, light pantry/expiry (medicines & fridge only, optional), maintenance & wishlist, push notifications/dashboard/backups. Details are in `docs/family_os_master_plan_v3.md`. After G3 the owner will run a 2-week family trial and then choose what to build.

## 8. Quality bar
- Lighthouse PWA installable; app usable on a 360 px wide screen; works fully offline after first load.
- No console errors; ESLint/Prettier config included; unit + rules + e2e tests runnable with one command (`npm test`, using only dev tooling).
- README (English) with: setup, emulator usage, deploy to preview and production, how to rotate the Gemini key, and a manual QA checklist for each gate.
- Each report ends with: ✅ done, ⚠️ risks/limitations, ❓ questions for the owner.

## 9. Start now
1. Read both input files. 2. Confirm you can reach the Firebase MCP and list the project, **without changing anything**. 3. Post a short plan for Phase 0 and the list of manual steps you need from the owner (e.g. enabling Anonymous Auth). 4. Begin Phase 0.
