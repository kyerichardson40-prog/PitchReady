# Architecture

## Modes

| | Demo | Connected |
|---|---|---|
| Data | Browser localStorage, fictional seed, reset control | Supabase Postgres |
| Identity | Role picker + simulated sign-in (fictional people, any password) | Supabase Auth (email + password, confirmed email) |
| Resident / feedback | Scripted resident, "Demo feedback" rules | Anthropic (or labelled mock in tests) |
| Voice | Typed turns; optional device speech synthesis | Deepgram STT/TTS when configured; typed fallback always |
| Server API | Disabled (`404 demo_mode`) | Enabled; fails closed (`503`) if misconfigured |
| Binding / build | localhost only; refused with `NODE_ENV=production` | Any host behind HTTPS |

The demo engine (`lib/demo/engine.ts`) mirrors connected rules (limits, idempotency, sequence checks, firm-refusal handling, reservations) so the demo behaves like the product, but it is **not** a security boundary.

## Tenancy and authorisation

- Every tenant-owned row has `agency_id`. Cross-table references use **composite `(id, agency_id)` foreign keys** (sessions → campaign/scenario/rubric versions, parent session, usage period, membership), so a row in agency A cannot reference agency B's data even if an ID is guessed.
- A user belongs to at most one agency (MVP; unique index on `memberships.user_id`).
- **Reads**: clients hold `SELECT` only; RLS policies decide rows. Helper functions (`app_private.is_member/is_manager/can_read_session`) are `SECURITY DEFINER`, `search_path = ''`, in a schema that is **not** exposed, and avoid recursive policies. Inactive memberships or suspended agencies read nothing.
- **Writes**: only through `app_api` functions. Signed-in functions derive identity from `auth.uid()` (JWT verified by PostgREST) and re-check active membership and role — model output and request bodies never supply tenant or user IDs.
- **Service-only functions** (granted to `service_role` only): resident turn commit, evaluation save/claim/defer, provider spend begin/finish, session failure, invitation inspection, maintenance.
- **Bootstrap** (`app_private.bootstrap_agency`) has no grants; only the database owner can run it via the CLI. There is no public agency creation.
- Manager rules: same-agency only; cannot change their own membership; roles are only set by invitation acceptance; deactivation immediately closes open sessions (`membership_revoked`) and removes read access.
- Rep rules: own sessions/reports only; cannot read other reps' transcripts, write evaluations, ledger rows, roles, approval state or manager notes (tested by direct SQL and by RPC).

The Next.js server uses the **user-scoped client** (user JWT → role `authenticated`) for everything except the service-only operations above. Mutating routes also require a same-origin `Origin`/`Sec-Fetch-Site` (CSRF), cookies are `HttpOnly; SameSite=Lax; Secure` on https, inputs are Zod-validated, and errors are `{code, message, requestId}` with no raw provider/database text.

## Session lifecycle

```
start_session ─► created ─(opener + optional TTS ready)─► activate_session ─► active
active ─► turns … ─► ended  (rep_ended | resident_ended | time_limit | turn_limit | membership_revoked)
created/active ─► failed    (provider_failure: allowance refunded)
created/active ─► abandoned (never activated, or expired with no rep turns: refunded)
evaluation_status (separate column): none → pending → running → completed | unavailable
```

- The server clock starts in `activate_session` (when the opening line is ready). Deadline = start + 180 s (60 s drills); max rep turns 12 (5). Re-activation cannot reset it; browser timers are display-only.
- One open session per rep (unique partial index). One in-flight turn per session (`turn_lock`), expected sequence must match (`stale_sequence`), every turn has an idempotency key unique per session.
- Turn flow: `begin_turn` (audio only: reserve slot) → STT → `commit_rep_turn` → firm-refusal/turn-limit rules in the application → resident model → `commit_resident_turn` (service) → optional TTS. A repeated request ID resumes from stored state instead of re-calling providers.
- **Firm refusal** is deterministic: refusal opener → exactly one rep turn → end. Continued pitching is flagged by evaluation, not argued by the resident.

## Usage policy (customer minutes)

- At start, the full maximum (180/60 s) is reserved under a row lock on the current `usage_periods` row; a DB check (`consumed + reserved ≤ allowance`) makes over-reservation impossible even under concurrency.
- Settlement happens once (`close_session` holds the row lock and only acts on open sessions): usable sessions are charged capped server elapsed time; the remainder is released. Provider failures and empty abandoned sessions are refunded in full.
- Ledger rows have unique `operation_id`s (`reserve:`, `settle:`, `release:`/`refund:`). The ledger has no FK to sessions so aggregate usage survives transcript retention.
- Maintenance closes sessions past deadline + 120 s grace and never-activated sessions after 2 min, so reservations cannot get stuck.

## Provider spend

- `begin_provider_attempt` persists the attempt and reserves a **conservative estimate** (rate card × bounded size) **before** each call, under an advisory lock, checking a global monthly budget and the agency's period budget. `finish_provider_attempt` reconciles with reported usage; unknown usage keeps the estimate (never fabricated as zero).
- Attempt states: `in_flight → succeeded | failed | uncertain`. A timeout after sending is `uncertain`; the same operation ID is never re-issued (`operation_already_attempted`).
- Customer minutes and provider money are separate: refunding minutes does not delete cost records.
- Local budgets are estimates; strict monetary caps depend on provider-side billing controls.

## Evaluation (durable)

1. Ending a session (or a manager correction) inserts an `evaluation_jobs` row in the same transaction.
2. The request handler then makes one bounded, **awaited** attempt (no unawaited background promises). Anything unfinished stays `pending` for the authenticated maintenance worker (`/api/maintenance`), which leases jobs (`FOR UPDATE SKIP LOCKED`, 90 s lease, ≤ 3 attempts).
3. Evaluator output is validated in TypeScript (exact five keys, scores 1–5/null, bounded text, evidence turn IDs exist, quotes are exact substrings of the frozen transcript revision, criticisms cite rep turns, blank transcripts → all not observed). One repair attempt with the validation errors; still invalid → stored as `unavailable` (never shown as success).
4. The database re-checks evidence quotes in `save_evaluation` and enforces one successful evaluation per transcript revision (partial unique index).
5. Blank/garbled transcripts get a deterministic insufficient-evidence result without a model call.

Prompts (`lib/ai/prompts.ts`) are versioned; transcript and campaign data go in the user message as labelled structured data, never concatenated into system instructions. The prompt version and actual model ID are stored with every evaluation.

## Manager controls (DECISIONS D25)

- **Say rules** live in the versioned campaign pack: `must_say` (id `M<n>`, text, example cue words), `never_say` phrases, `forbidden_claims`, `approved_facts` and `objection_answers`. They take effect when the pack is published; each session keeps its frozen pack version.
- **Feedback contract 1.1** adds `required_statements`: exactly one entry per must-say id, `said` only with an exact quote from a rep turn, otherwise no evidence. A never-say phrase becomes a `banned_phrase` concern quoting the words used. The TypeScript validator and the database (`evidence_problems`) both check this against the frozen transcript and the session's own pack.
- **Scenarios** are agency data: any slug key, versioned (`scenario_versions`, immutable rows), with an `archived` flag (a new version). Reps can't start archived scenarios; old sessions keep theirs and show the title they used.
- **Assignments** (`scenario_assignments`): per rep. A rep with none sees every active scenario. `start_session` refuses an unassigned or archived scenario (`scenario_not_available`). Drills suggested by feedback are not restricted. Reps read only their own assignments; writes go only through `set_scenario_assignments` (manager, same agency, reps only).
- `app_private.latest_scenarios` and `rep_scenario_allowed` are SECURITY INVOKER, so RLS limits a caller to their own agency even if they pass another agency's id (tested).
- **Rep database**: `server/manager-data.ts` composes the roster, session summaries and assignments, read through RLS as the manager, with the shared builders in `lib/domain/metrics.ts`. The demo uses the same builders, so both show the same numbers.

## Versioning, corrections, immutability

- Campaign versions, rubric versions and scenario versions are referenced by each session; published versions are frozen by trigger. Publishing creates a new version; old sessions keep theirs. The manager dashboard never combines rubric versions.
- Turns are immutable. A manager correction appends `turn_corrections` (revision N+1) and a new evaluation job; earlier evaluations remain and the UI shows which revision each used.
- Turns, corrections, evaluations, reviews, rubric and scenario versions block UPDATE/DELETE by trigger (retention deletion sets a transaction-local flag).

## Code layout

`lib/` is shared by browser and server (no secrets). `server/` is never imported by `src/client/` (checked by `npm run check:bundle`, which scans the production `.next/static` output).

Next.js 16 App Router:
- `app/api/**/route.ts`: route handlers (Node.js runtime).
- `app/<route>/page.tsx`: thin server components that render `'use client'` page components from `src/client/pages/`.
- `app/layout.tsx`: reads server config per request and passes only `{ mode, setupError }` to `src/client/shell.tsx`, which picks the demo or API repository, applies the signed-in guard and renders page content after mount (DECISIONS D20).
- `proxy.ts`: per-request CSP nonce for pages. `next.config.ts`: security headers, strict CSP for `/api/*`, refuses demo mode in production builds and servers (D21).
- `scripts/serve.ts`: launcher for `npm run dev` / `npm start`; demo mode is localhost-only.
