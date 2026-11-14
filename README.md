# Family OS (v2)

Arabic (RTL), mobile-first, offline-first PWA for shared family grocery lists, requests, budget, and AI assistance, backed by Firebase Spark (Realtime Database + Anonymous Auth + Hosting).

## Current Status
- **Phase 0 (Local Foundation & Firebase Config — complete, awaiting Google OAuth login for Gate G0 preview deploy):**
  - Read-only reference preserved at `legacy/family_list.html`.
  - Git (`2.56.0.windows.4`) and Java (`OpenJDK 25.0.3`) configured in User `PATH`; Git repository initialized on branch `phase-0`.
  - Antigravity Firebase MCP configured at `%USERPROFILE%\.gemini\antigravity\mcp_config.json`.
  - Firebase project & rules files ready: `.firebaserc` (`family-requests-9e431`), `firebase.json` (Hosting + Database + Emulators), `database.rules.json` (preserves legacy `/rooms/$legacyRoom` & `/ai/$legacyRoom` + full `/v2/rooms/$rid` validation).
  - PWA shell (`public/index.html`, `public/manifest.webmanifest`, `public/sw.js`, `public/icons/*`, `public/css/app.css`).
  - Pinned Firebase Web SDK target: `13.1.0` (cached in `sw.js` for offline use).
  - Full §3 module scaffold: `public/js/app.js`, `public/js/state.js`, `public/js/schema.js`, `public/js/store-idb.js`, `public/js/migrate.js`, `public/js/auth.js`, `public/js/sync.js`, `public/js/ai.js`, `public/js/ai-actions.js`, `public/js/models-scan.js`, and `public/js/ui/{dialogs,list,settings,store-mode,chat}.js`.
  - Legacy export helper: `tools/export-legacy.html` + `tools/export-legacy.js`.
  - Automated tests & checks: `tests/schema.test.js`, `tests/store.test.js`, `tests/rules.test.js`, `tests/sync.e2e.js`, `tests/pwa.e2e.test.js`, plus ESLint and Prettier.
- **Pending Owner Action for Cloud Deploy:**
  1. Complete Google OAuth sign-in in browser for `npx -y firebase-tools@latest login`.
  2. Enable **Anonymous Auth** in Firebase Console (`Authentication -> Sign-in method -> Anonymous`).
  3. Restart Antigravity if you want the newly configured `firebase` MCP server loaded into the IDE session.

## Local Setup & Testing
Prerequisites: Node.js `>= 20` (tested on `v26.13.1`) and Google Chrome / Edge for E2E tests.

Run ESLint + all unit and E2E tests:
```bash
npm test
```

Additional scripts:
```bash
npm run test:unit
npm run test:e2e
npm run lint
npm run format:check
```

Serve the PWA shell locally on port `5000`:
```bash
npm run serve
```

## Firebase Emulators & Deploy (Once Firebase CLI/MCP is connected)
- Emulators require Java JDK (Android Studio JBR is detected at `C:\Program Files\Android\Android Studio\jbr\bin\java.exe` if added to `PATH`/`JAVA_HOME`).
- Preview channel deploy (Phase 0 Gate G0):
  ```bash
  npx -y firebase-tools@latest hosting:channel:deploy phase-0
  ```
- Production deploy (only after Gate approval):
  ```bash
  npx -y firebase-tools@latest deploy --only hosting
  ```

## Rotating the Gemini API Key (Admin Only)
1. Generate a new key in Google AI Studio and restrict/monitor quota.
2. Open **Settings -> AI** in the app (admin account only), update the key, run **Test connection**, and save.
3. Revoke the old key in Google AI Studio.
4. Note: API keys are stored solely in `/v2/rooms/$rid/ai` (admin-writable, member-readable) and kept only in memory on client devices — never in `localStorage`, IndexedDB, exports, or backups.

## Gate G0 Manual QA Checklist
- [ ] Open preview/local URL on Android Chrome at `360px` width — no horizontal overflow, touch targets >= 44 px, zero console errors.
- [ ] Install PWA to Home Screen; verify shortcuts ("إضافة غرض", "وضع السوبرماركت").
- [ ] Switch device offline, launch installed PWA — app shell opens cleanly and reports offline status.
- [ ] Test legacy `family-backup.json` dry-run import in the "استيراد" tab — verify counts (`items`, `cats`, `members`, `budget`), confirm PIN hashes are discarded, and verify second run is idempotent (`0` additions).
