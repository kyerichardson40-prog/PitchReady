# Decisions and departures from the build pack

Each is reversible unless stated.

**D1 — Next.js 16 App Router (moved 6 Nov 2026; originally a stand-in server).** The first build had no npm registry access, so it used a small Node server that mounted `app/api/**/route.ts` and a hand-rolled client router. With registry access the app now runs on Next.js 16.4.5 (Turbopack), React 19.2.8, TypeScript 6.0.3:
- `app/api/**/route.ts` are unchanged and mounted by Next. `server/dev-server.ts`, `scripts/build-client.ts` (esbuild) and `scripts/link-local-deps.sh` are gone.
- Each page is a thin `app/<route>/page.tsx` server component that renders the existing component from `src/client/pages/` (those modules are `'use client'`). `src/client/router.tsx` is now an adapter over `next/link` / `next/navigation` (`Link`, `useNavigate`, `useLocation`), so page code changed little.
- `app/layout.tsx` reads the server config at request time and passes only `{ mode, setupError }` to the client shell (`src/client/shell.tsx`), replacing the inline `window.__PITCHREADY__` script.
- Security headers moved to `next.config.ts`; the CSP moved to `proxy.ts` (see D21).
- Not done: `@supabase/supabase-js` is still not used (D3 stands).

**D2 — Lockfile committed (resolved 6 Nov 2026).** `package-lock.json` comes from a real `npm install` and CI runs `npm ci`. Exact versions are still pinned in `package.json`.

**D3 — Supabase via REST, not supabase-js.** `server/db.ts` calls PostgREST RPCs (`/rest/v1/rpc/<fn>` with `Content-Profile: app_api`) and `server/auth.ts` calls GoTrue (`/auth/v1/...`) with `fetch`. Swapping in supabase-js later is mechanical. Key names follow current Supabase docs: publishable key → `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, secret key → `SUPABASE_SECRET_KEY` (legacy JWT keys accepted). The browser never contacts Supabase directly, so no Supabase key is bundled.

**D4 — All writes through `app_api` database functions.** Atomicity (allowance reservation, single settlement, single-use invitations, one in-flight turn) is easiest to guarantee and test in SQL. User-callable functions take identity from `auth.uid()`; a few are service-only. `app_api` must be added to Supabase's exposed schemas; `app_private` must not be.

**D5 — Local tests use plain PostgreSQL + a Supabase shim** (`tests/db/supabase-shim.sql`: roles, `auth.users`, `auth.uid()`), a test-only psql DB adapter and a test-only auth stub (cookie = user UUID). Both are refused when `NODE_ENV=production`. This tests our SQL and RLS for real, but not Supabase's own services.

**D6 — One agency per user** (unique index). Simplifies agency resolution; revisit if a person works for two agencies.

**D7 — Email + password auth.** Pack lists sign-in, expired link, confirmation guidance and sign-out. Password sign-in with mandatory email confirmation was simplest with the REST API. Confirmation links return tokens in the URL fragment; `/login` hands them to the server, which verifies them before setting httpOnly cookies. Magic links/PKCE are a later option.

**D8 — Provider outage policy.** If the resident model fails or times out mid-session, the session is marked `failed` and its allowance refunded in full. The cost record is kept, and uncertain attempts are never re-issued. STT failure leaves the session running (re-record or type). TTS failure shows text only. Evaluator failure leaves a durable pending job.

**D9 — Mock providers.** `AI_PROVIDER=mock` reuses the demo rules for CI/tests, stores `evaluator_kind = 'mock'` and shows "Mock feedback (test provider — not AI)". Refused in production. Failure injection via `MOCK_PROVIDER_FAIL`.

**D10 — Live AI gate.** `LIVE_AI_ENABLED=true` has no effect unless keys, both model IDs, a rate card with prices for those exact models, matching currency and both budgets are set. No prices or model IDs are shipped.

**D11 — Retry drills.** The ten objection drills are fixtures for 60-second retries only (not extra navigation). Each drill maps to a base scenario. SQL keeps a copy of drill openers; a unit test checks it matches `lib/content`.

**D12 — Endpoint naming.** Publishing is `POST /api/manager/campaign/publish` (one approved campaign per agency, so no `:id`). Others follow the pack. Corrections: `POST /api/manager/sessions/:id/corrections`. Maintenance: `POST /api/maintenance`.

**D13 — Deletion requests** are honoured automatically by the maintenance job (proposed policy; easy to switch to manager approval). Supabase Auth user deletion is manual.

**D14 — Concern review status** lives in append-only `manager_reviews`. A review with resolution `resolved` clears that session's open flags; the AI result is never edited.

**D15 — Demo feedback rules** are transparent keyword heuristics (`lib/demo/patterns.ts`). They exist to make the demo loop real and testable, not to approximate a model. Calibration found a weakness (garbled turns were scored), which I fixed by ignoring `[inaudible]` markers and filler sounds.

**D16 — Rate limits are in-memory per instance.** Adequate for a single-instance pilot. Use a shared store if horizontally scaled.

**D17 — Tailwind not used.** Plain CSS custom properties (`src/client/styles.css`): fewer moving parts and no build plugin needed offline.

**D18 — Pricing values** (£149 pilot / £199 subscription) are not in code. Allowances come from `PILOT_INCLUDED_SECONDS` / CLI flags. Billing is manual.

**D19 — Tests run against `next dev`; one suite runs `next start`.** Demo mode, mock providers and the psql test adapter are refused when `NODE_ENV=production`, and `next build`/`next start` always set it. So the demo, DB/HTTP and connected-UI suites start `next dev` through `scripts/serve.ts`, one build dir and throwaway tsconfig per server (`.next-test-<port>/`, `.next-test-tsconfig/`) so several run side by side. `tests/e2e/production.test.ts` covers the production server: nonce CSP with no violations, headers, fail-closed connected mode, 404s, demo refusal. Gap: the full practice loop is not exercised on a production build.

**D20 — Page content renders on the client after mount.** Pages read browser-only state (demo localStorage, speech synthesis, clocks) and per-user data fetched client-side, so server-rendering them would produce hydration mismatches without showing anything useful. The shell server-renders the layout chrome and any setup error, then renders the page after mount. Same behaviour as before the move. Server-rendering pages (and fetching data in server components) is a later option.

**D21 — CSP via per-request nonce in `proxy.ts`.** Next's inline scripts need a nonce, and a nonce requires dynamic rendering, so the root layout opts in with `connection()`. Production: `script-src 'self' 'nonce-…' 'strict-dynamic'`, `style-src 'self' 'nonce-…'`, no `unsafe-*`. Development only adds `'unsafe-eval'` (React dev tooling) and swaps the style nonce for `'unsafe-inline'` (Next's dev overlay/HMR inject un-nonced styles). API responses get `default-src 'none'` from `next.config.ts`, and `proxy.ts` skips `/api/*` so upload bodies are not buffered. Consequence: inline `style` attributes are blocked in server-rendered markup. They are fine in components rendered after mount (React sets them from JavaScript), but anything in the server-rendered path must use classes (as `ErrorBox` now does).

**D22 — Zod 3 advisory not yet addressed.** `npm audit` reports GHSA-mrhx-c7xc-m3w5 (memory exhaustion validating oversized constrained collections) for all Zod < 4.6.6. The fix is Zod 4, a breaking upgrade, so it is a separate step. Mitigation today: JSON bodies are capped at 64 KiB before parsing (`readJson`), and array sizes in the schemas are bounded.


**D23 — Standalone demo file for manager interviews.** `npm run build:static-demo` writes `dist/pitchready-demo.html`: one self-contained page, demo mode only, using the same pages, demo repository, scripted resident and "Demo feedback" rules as `npm run dev`. It has no server, API, accounts or keys, and holds only the fictional seed, so the reasons for refusing demo-mode production *servers* (D1, a demo bypass on a deployed backend) do not apply. `next/link` and `next/navigation` are swapped for in-memory stand-ins, because the hosting frame only allows plain `#name` hashes. Consequences: reloading returns to the Practise screen (data persists in localStorage); `window.confirm` is ignored by the hosting frame, so reset, publish and deactivate proceed without a prompt in this build only. Covered by `tests/e2e/static-demo.test.ts`. Not a substitute for the connected pilot: no transcription, no AI.

**D24 — Live AI in the standalone demo, through claude.ai.** Inside claude.ai the standalone demo can ask Claude through the artifact `sample` capability, on the viewer's own Claude account. Each viewer is asked for consent on first use; nothing is billed to an API key. The resident uses the quick tier (one call per rep turn) and feedback uses the default tier in the background ("Claude is writing your feedback…"). Same versioned prompts, JSON schemas, data layout and evidence validation as the server adapter, with one repair attempt; invalid output → "Feedback unavailable", never shown as feedback. Fallbacks: a failed resident call uses the scripted line and says so; a failed evaluation stays pending with a "Run AI feedback now" button; refused consent or no access switches Live AI off for the view. A "Live AI" switch in the demo banner goes back to scripted mode. Only the standalone build includes the prompts (`src/static-demo/live-ai.ts`); the connected app's client bundle is unchanged (`check:bundle`). Limits: model choice, cost and data handling are claude.ai's, not the pilot's, so this does not measure cost per minute (§9) or replace the connected Anthropic path; there is still no speech input. The page must declare `capabilities: {sample: {}}`, which is the owner's decision.

**D25 — Manager controls: say rules, agency scenarios, assignments, rep database (demo and pilot app).** Requested by the owner on 6 Nov 2026 and built in both modes:
- Say rules extend the campaign pack (`must_say` with cue words, `never_say`, `objection_answers`; facts and forbidden claims as before) and are versioned with it. Feedback contract 1.1 adds a must-say checklist and a `banned_phrase` concern. AI and demo rules both produce them; the validator and the database re-check the quotes. The rule-based demo matches cue words and exact phrases; the AI judges meaning. Evaluator prompt `evaluator-v2` adds these instructions and asks for feedback addressed to the rep as "you". It was never released, so v1 → v2 was edited in place, including the SQL defaults in migration 300; nothing has been deployed.
- Scenarios: managers create, edit (new version) and archive scenarios; keys are slugs made from the title. Per-rep assignment; none = every active scenario. Built-in drills remain the 60-second retries; for agency-written scenarios the retry is another go at the same scenario. Migration `20261106000500_manager_controls.sql`.
- Rep database: Team page directory (search, status, scenarios, sessions, last practice, average observed score on the current rubric, open flags) and a profile per rep (statistics, per-dimension breakdown, assignment editor, history, deactivate). Computed by shared builders for both modes.
- Not done: no per-scenario rubric, no scheduling or due dates for assignments, and no bulk import of reps. Reps still join only by invitation.

**D26 — Demo starts at a role picker with a simulated sign-in.** The demo opens on "I'm a sales rep / I'm a manager", then a sign-in screen listing fictional accounts of that role; any password works and nothing is checked or stored. Sign out returns to the picker; "Reset demo data" signs out. This replaces the "View as" switcher. Deactivated people can't sign in. Connected mode keeps real Supabase sign-in, unchanged.

**D27 — Native iOS/Android apps via Capacitor (owner's choice, 6 Nov 2026).** The build pack defers native apps; the owner chose App Store / Google Play. Capacitor 8.6 shells (`ios/` with Swift Package Manager, `android/`) wrap the web app:
- **Default build:** the bundled offline demo (the standalone demo, D23). Its in-memory router now records screens in the browser history, so Android's Back button steps back. Live AI isn't available in the app, and the banner says so.
- **`PITCHREADY_APP_URL` build:** opens the hosted connected pilot. This is the only build fit for store review, so it depends on the pilot being deployed.
- Identity in `app-identity.json`, applied to the native projects by `scripts/set-app-identity.ts` (`cap sync` never updates it). The default `com.example.pitchready` must be replaced before the first upload, and the name is not cleared.
- Microphone purpose text (iOS) and audio permissions (Android) added. Android app-data backup and device transfer are off. Original icon and splash in `assets/`. Pages use `viewport-fit=cover` with safe-area padding.
- `.github/workflows/android.yml` builds a test APK and a Play bundle (signed if upload-key secrets are set) on GitHub's runners.
- Not done or verified: no compile of either app (no macOS; the Android SDK and Maven hosts are blocked in the build workspace), no device run, no store submission. Apple 5.1.1(v) needs in-app account deletion, and deleting the Supabase Auth user is still manual (D13). See `docs/APP_STORES.md`.

## D28 — Maintenance runs inside the server
The hosted pilot is one Railway service. Rather than a second cron service or an external scheduler, the server starts a timer from `instrumentation.ts` (connected mode only, never during `next build`) and runs the same work as `POST /api/maintenance` every 10 minutes, first run one minute after start. Runs never overlap within a process; across several instances the database functions are lock-protected and idempotent. `MAINTENANCE_INTERVAL_MINUTES=0` turns it off (tests do), and the route stays available for an external cron.

## D29 — Visual identity
Painted front doors of a British street: teal, postbox red, cobalt and mustard on a cool pavement grey, navy ink, brass door numbers, and Bricolage Grotesque (OFL, self-hosted in `public/fonts`, embedded in the standalone demo) for headings. The landing page has one looping doorstep animation; scenarios are numbered doors; feedback reuses the landing page's outlined card. All motion is CSS and stops under `prefers-reduced-motion`; no inline style attributes are server-rendered (production CSP). Manager tables turn into stacked cards below 760px.
