# Family OS (v1.0.0)

Arabic (RTL), mobile-first, offline-first PWA for shared family grocery lists, requests, store catalog, household tasks with reward points, and AI assistance, backed by Firebase Spark (Realtime Database + Anonymous Auth + Hosting).

🌐 **Live Production URL:** https://family-requests-9e431.web.app  
📖 **Comprehensive Arabic Manual & Architecture Guide:** [FAMILY_OS_MANUAL.md](file:///c:/Users/Ali/remote/family-os/FAMILY_OS_MANUAL.md)

## Current Status: Production Released (v1.0.0)
- **All 4 Phases Complete & Verified:**
  - **Phase 0:** PWA shell, RTL Tajawal typography, offline-first IndexedDB engine, Service Worker cache (`v1.0.0`), and sanitized legacy backup import/export.
  - **Phase 1:** Multi-tenancy family isolation (`/v2/rooms/$rid`), anonymous auth, invite link generator/parser (`#join=...`), and hardened cloud security rules.
  - **Phase 2:** 5-button touch UI (`🛒 السلة`, `🏪 المتجر`, `📋 المهام`, `📥 استيراد`, `⚙️ الإعدادات`), labeled inline inputs, 71-item auto-learning family store, 4-tier roles (Developer, Father, Mother, Children), and household tasks with reward points and leaderboard.
  - **Phase 3:** Interactive AI Assistant tab (`🤖 المساعد`), keyless offline Arabic assistant, action execution with confirmation dialogs, Web Speech voice dictation, and Gemini free-model scanner.
  - **Phase 4:** Full v2 family backup export (JSON), RTDB emulator security rules verification (7/7 passing), full test suite (22/22 passing), and production deployment on Firebase Hosting.

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
npm run format
npm run format:check
```

## Firebase Emulators & Production Deploy
- Run security rules test against the live RTDB emulator:
  ```bash
  npx firebase-tools emulators:exec --only database --project family-requests-9e431 "node --test tests/rules.test.js"
  ```
- Deploy hosting and database rules to production:
  ```bash
  npx firebase-tools deploy --only database,hosting --project family-requests-9e431
  ```
