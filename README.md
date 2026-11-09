# PitchReady (working name — not cleared for commercial use)

Spoken practice and evidence-linked coaching for UK door-to-door fundraising teams. A rep practises a short simulated doorstep conversation (≤ 3 minutes), gets feedback on five rubric areas where every score points at quoted transcript words, and retries the weakest part in a 60-second drill. Managers see participation, a sample-size-aware skill breakdown, flagged sessions and remaining allowance.

**Status:** pilot deployment on Railway + Supabase (connected mode). Earlier status note: Runs locally in two explicit modes. It has not been deployed, connected to a real Supabase project, or called against live Anthropic/Deepgram APIs — see `TEST_REPORT.md`.

All campaign content is the **fictional** "Neighbourhood Meal Project" from the build pack. No real charity, donation or payment process exists.

## Quick start — demo mode (no accounts, no keys)

Requirements: Node.js ≥ 22.18 (scripts and tests run TypeScript directly).

```bash
npm ci                      # installs exactly what package-lock.json pins
npm run dev                 # Next.js dev server on http://127.0.0.1:3000
```

Open http://127.0.0.1:3000. Choose **I'm a sales rep** or **I'm a manager**, then sign in as one of the fictional people (simulated: any password). "Sign out" returns to the choice; the yellow bar resets the data. Managers can set what reps must and must never say (Rules & campaign), write and assign scenarios (Scenarios, and each rep's profile in Team) and browse the rep database (Team). Everything is stored in your browser's localStorage; nothing is sent to a server. Feedback is labelled **"Demo feedback"** — transparent keyword rules, not AI. The resident is scripted. Optional "device voice" reads resident lines with the browser's speech synthesis; demo mode never transcribes audio.

Demo mode binds to localhost only and refuses to run as a production build or server (`next build` / `next start`). The localhost check lives in `npm run dev` / `npm start` (`scripts/serve.ts`); plain `npx next dev` would listen on all interfaces, so use the npm scripts.

**Standalone demo for showing managers:** `npm run build:static-demo` writes `dist/pitchready-demo.html`, a single file that runs the same demo with no install or server (open it in a browser or host it as a static page). Typed turns only. Published as a claude.ai artifact that declares the `sample` capability, it offers **Live AI**: Claude plays the resident and writes evidence-linked feedback, on each viewer's own Claude account (D24). Elsewhere it runs the scripted demo. See DECISIONS.md D23–D24.

**Phone apps (App Store / Google Play):** iOS and Android projects are in `ios/` and `android/` (Capacitor). `npm run app:sync` prepares them; build and publish steps, store rules and what's still missing are in `docs/APP_STORES.md` (D27).

Next.js collects anonymous telemetry by default. Turn it off with `npx next telemetry disable` or `NEXT_TELEMETRY_DISABLED=1` (the tests and CI set it).

## Commands

| Command | What it does |
|---|---|
| `npm run dev` | `next dev` on `HOST`/`PORT` (default 127.0.0.1:3000; mode from `.env` / `APP_MODE`) |
| `npm run build` | `next build` — production build; needs `APP_MODE=connected` |
| `npm start` | `next start` — production server for a build |
| `npm run typecheck` | `tsc --noEmit` twice: `tsconfig.json` (Next/bundler: app, pages, React client, server, lib) and `tsconfig.node.json` (NodeNext: code Node runs directly — server, lib, scripts, tests) |
| `npm test` | Unit tests (`node:test`): validator, demo engine, adapters (stubbed fetch), config, metrics, calibration |
| `npm run test:db` | Real PostgreSQL 16 + migrations + Supabase auth shim: RLS/isolation, integrity, HTTP integration, evaluation recovery |
| `npm run test:e2e` | Playwright/Chromium: demo loop for all five scenarios, connected UI with fake microphone, production server (CSP, headers, fail-closed) |
| `npm run check:bundle` | Production `next build` (connected); browser output (`.next/static`) must not contain secrets or server-only code |
| `npm run calibrate` | 20 calibration fixtures → `reports/calibration-*.json` (`--evaluator anthropic --i-accept-provider-cost` for live) |
| `npm run db:local` | Start a throwaway local Postgres on port 54329 for `test:db` (needs PostgreSQL 16 binaries + `psql`) |
| `npm run bootstrap:agency` | One-time server CLI to create an agency + first manager |
| `npm run maintenance` | Call the authenticated maintenance route once |

## Connected mode setup

Connected mode = real Supabase Auth + Postgres with RLS, server-only providers, enforced usage limits. **No role switcher or demo login.** Missing configuration fails closed: the app shows setup guidance and APIs return `503 not_configured`; it never falls back to demo.

1. **Supabase project** (or local `supabase start`).
   - Apply migrations in `supabase/migrations/` in order (`supabase db push` or `psql -f`). They need `auth.users`/`auth.uid()` (Supabase provides them) and create `pgcrypto` in `extensions`.
   - **Expose the `app_api` schema** to the Data API (Dashboard → API settings → Exposed schemas, or `[api] schemas` in `supabase/config.toml`). Do **not** expose `app_private`.
   - Auth: enable email + password, keep email confirmation ON, set Site URL / redirect URL to `APP_BASE_URL/login`.
2. **.env** (copy `.env.example`):
   - `APP_MODE=connected`, `APP_BASE_URL` (the public https origin in production)
   - `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` (sb_publishable_…), `SUPABASE_SECRET_KEY` (sb_secret_…; legacy JWT `service_role` keys also accepted). The browser never talks to Supabase directly; all three are read server-side only.
   - `MAINTENANCE_SECRET` (32+ random chars).
3. **Bootstrap the first agency** (owner DB connection, server-side only). The manager signs up at `/login` first, then:
   ```bash
   DATABASE_URL=postgres://postgres:…@db…:5432/postgres \
   npm run bootstrap:agency -- --agency-name "Example Agency" --manager-email owner@example.org --manager-name "Kye"
   ```
   This seeds the fictional pack, five scenarios, generic rubric and a usage period (`PILOT_INCLUDED_SECONDS`, default 9000 s = 150 min). Replace the pack at `/manager/campaign`.
4. **Invite reps** at `/manager/reps`. The link is shown once for the manager to copy and send personally; PitchReady sends no email. The rep signs up with the invited email, confirms it, then opens the link.
5. **AI providers** (practice is disabled until all are set — `503 ai_not_configured`):
   - `ANTHROPIC_API_KEY`, `ANTHROPIC_ROLEPLAY_MODEL`, `ANTHROPIC_EVALUATION_MODEL` — exact model IDs from Anthropic's model docs.
   - `DEEPGRAM_API_KEY`, `DEEPGRAM_STT_MODEL`, `DEEPGRAM_TTS_MODEL` — optional; without them reps type their turns.
   - `PROVIDER_RATE_CARD_PATH` → copy `config/rate-card.example.json`, fill prices from the providers' current pricing pages (none are shipped). The server refuses to start live AI if a configured model has no price.
   - `AI_GLOBAL_BUDGET_MINOR_UNITS`, `AI_AGENCY_BUDGET_MINOR_UNITS`, `AI_BUDGET_CURRENCY` (must match the rate card).
   - `LIVE_AI_ENABLED=true`. Also set provider-side spend limits in the Anthropic and Deepgram consoles where available — local budgets are estimates.
6. **Contact form emails** (optional): set `RESEND_API_KEY` (from resend.com) and `CONTACT_NOTIFY_EMAIL` (your inbox) to get an email for each contact-form message; replying answers the sender. `CONTACT_FROM_EMAIL` defaults to Resend's test sender, which only delivers to the address the Resend account was made with — verify a domain in Resend to use another. Messages are always saved in `contact_messages` either way.
7. **Emails and pilots** (optional): with `RESEND_API_KEY` set, invitations are emailed and managers get flagged-session alerts and a weekly summary; emails to people other than the Resend account owner need a verified domain in `CONTACT_FROM_EMAIL`. Anyone can start a free pilot at `/start` unless `SELF_SERVE_PILOTS=false` (`SELF_SERVE_PILOT_SECONDS`, default 3600; `SELF_SERVE_PILOT_DAYS`, default 14). Password-reset emails are sent by Supabase: `APP_BASE_URL/login` must be in Supabase → Authentication → URL Configuration → Redirect URLs.
7a. **Terms version:** `lib/content/legal.ts` holds the published terms version; new accounts record it at sign-up. Change it whenever the Terms page changes. Managers can download their team's data from **Team → Download your team's data**.
8. **Maintenance runs by itself.** The server runs it every 10 minutes (`instrumentation.ts` → `server/scheduler.ts`; `MAINTENANCE_INTERVAL_MINUTES`, `0` = off). It expires sessions, releases reservations, retries pending evaluations, honours deletion requests and applies retention. It can also be triggered: `POST /api/maintenance` with `Authorization: Bearer $MAINTENANCE_SECRET` (or `npm run maintenance`).

Local Supabase test data: `node scripts/seed-local.ts` (refuses non-local hosts; prints random one-time passwords).

## Deployment / runtime prerequisites (not done)

- It is a Next.js 16 App Router app (DECISIONS.md D1). Build with `APP_MODE=connected npm run build` and run `npm start` (or `next start`) behind HTTPS with `HOST=0.0.0.0`. `APP_MODE=connected` must be set at build time and at run time. Route handlers need the Node.js runtime (they use `node:crypto` and `node:fs`), not Edge.
- Security headers come from `next.config.ts`; pages get a per-request nonce CSP from `proxy.ts`, which makes every page dynamically rendered. `proxy.ts` skips `/api/*`, so audio uploads are not buffered by Next's proxy body limit.
- Audio upload: the app allows 10 MiB / 30 s per turn. Many serverless platforms cap request bodies and durations lower — check your host and lower `LIMITS.audioMaxBytes` if needed. Evaluation awaits up to ~45 s per model call; the maintenance worker recovers anything unfinished.
- Rate limiting is in-memory per instance; use a shared store for multi-instance hosting.
- Not done: domain, TLS, hosting, provider data-retention settings, Supabase backups/PITR, real device testing. See `DATA_HANDLING.md`.

## Repository map

```
app/api/…/route.ts        API endpoints (Next.js route handlers)
app/…/page.tsx            pages: thin wrappers around src/client/pages; app/layout.tsx passes mode/setup state
proxy.ts, next.config.ts  CSP nonce; security headers; demo-in-production refusal
scripts/serve.ts          `npm run dev` / `npm start` launcher (localhost-only demo, mode checks)
server/                   config, auth (Supabase REST), db (PostgREST/psql), providers, services, dev server
lib/domain/               shared types, Zod schemas, evidence validator, limits, session rules, metrics
lib/content/              fictional campaign, scenarios, drills, rubric (single source)
lib/ai/                   versioned prompt templates + JSON schemas for structured outputs
lib/demo/                 deterministic demo resident/evaluator/engine (labelled)
src/client/               React UI (shell, pages, components, demo + API repositories, recorder)
supabase/migrations/      schema, RLS, app_api functions
fixtures/calibration/     20 fictional calibration transcripts
tests/{unit,db,e2e}/      automated checks
```

Documents: `ARCHITECTURE.md`, `DATA_HANDLING.md`, `DECISIONS.md`, `TEST_REPORT.md`.
