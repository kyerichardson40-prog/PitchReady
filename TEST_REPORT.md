# Test report — 6 November 2026 (after the move to Next.js and the manager controls)

Environment: Linux sandbox, Node v22.23.4, Next.js 16.4.5 (Turbopack), React 19.2.8, TypeScript 6.0.3, PostgreSQL 16.15 (local, no Docker), Playwright 1.63.0 with headless Chromium. Packages installed from the npm registry with `npm ci` against the committed `package-lock.json`. Still no access to Supabase, Anthropic or Deepgram.

## Commands actually run (final full run, in CI order, after deleting `node_modules/`, `.next*/` and `reports/`, then `npm ci`)

| Command | Result |
|---|---|
| `npm run typecheck` — `tsconfig.json` (app, pages, **React client**, server, lib, proxy) and `tsconfig.node.json` (NodeNext: server, lib, scripts, tests) | **Pass** |
| `npm test` | **48 / 48 pass** (incl. 8 live-AI tests with a stubbed Claude and 6 manager-control tests) |
| `npm run check:bundle` (production `next build`, connected) | **Pass** — build has no warnings, including Next's own route-type validation. 18 client files / 816 KiB in `.next/static` scanned, 15 server-only markers absent (no real secrets were present to scan for). Size grew from 365 KiB because the Next/React runtime is now included. |
| `node scripts/calibrate.ts --strict` (demo rules) | **Pass** — 21 evaluations / 20 fixtures, 0 schema failures, 0 expectation mismatches |
| `npm run test:db` | **47 / 47 pass** (HTTP tests go through Next; incl. 8 manager-control DB tests and 2 HTTP tests) |
| `npm run test:e2e` | **27 / 27 pass** (demo loop, connected UI, 4 production-server, 6 standalone-demo incl. 2 with a stubbed claude.ai `sample`, Back navigation and the in-app note, 4 manager-control tests) |

The React/TSX client is now type-checked under `strict` (`@types/react` 19.2.18, `@types/react-dom` 19.2.7). It had no type errors.

Baseline before the move: the same suites were run on the original code right after `npm install` (34 / 37 / 13 pass, bundle and calibration pass), so the lockfile versions match what the prototype was built against.

Found and fixed during the move:
- Focus management treated React StrictMode's double effect run on mount as a navigation, so after a reload focus jumped into the page and the skip link was no longer first in tab order (caught by the e2e keyboard test).
- `loadDotEnv` in `server/config.ts` made Next trace the whole project into the server output, which on a serverless host could ship `.env`. It moved to `server/dotenv.ts`, which only CLI scripts import.
- `ErrorBox` used an inline `style` attribute that the production CSP blocks in server-rendered markup. It now uses classes.

## What the suites cover

**Unit:** evidence validator (exact-substring quotes, five keys once each, evidence required for scores, rep evidence for criticisms, fact IDs, revision, rejects freeform/extra keys/out-of-range). Demo evaluator on the three pack starter transcripts. Demo engine for all five scenarios, firm-refusal ending, duplicate turn/end, stale sequence, 60 s drill deadline, allowance block, rep/manager visibility, corrections, publishing. Adapters with **stubbed fetch**: Anthropic request shape (`output_config.format`, headers, rep text never in system prompt, repair turns, no unsupported schema constraints), refusal/truncation/bad JSON/HTTP/timeout classification, Deepgram STT/TTS request and response parsing, unknown usage not faked as zero. Config gating (live AI, demo-in-production, mock-in-production, `NEXT_PUBLIC_` secrets). Metrics (not-observed ≠ 0, small samples, rubric versions not combined). SQL/TS drill content parity. Calibration fixtures.

**DB / integration (real Postgres + migrations + Supabase shim):**
- Isolation: manager A gets nothing from agency B via RPC or direct `SELECT` on 10 tables; cannot review, correct, deactivate, re-evaluate or revoke B's records by guessing IDs; cannot use B's parent session.
- Rep A1 cannot read rep A2's transcript; direct writes to memberships/usage/evaluations/ledger/campaign are denied; rep cannot call service, manager or bootstrap functions; anon has no access; managers cannot change their own membership; member emails are visible only to own-agency managers.
- Idempotent start/turn/end; one in-flight turn; stale sequence rejected; deadline enforced from the server clock and not reset by re-activation; **concurrent starts cannot over-reserve** (two parallel starts, one fits → exactly one succeeds, DB constraint holds); maintenance recovers expired reservations; provider failure refunds minutes but keeps the uncertain cost record; spend guard (global and agency budgets) refuses calls; duplicate operation IDs are not re-issued.
- Invalid evidence → `unavailable`, never completed; duplicate saves don't add a second success; correction → revision 2 + new job, original turn and revision-1 feedback kept; turns/evaluations/reviews/published versions immutable; new pack/rubric version leaves old sessions on v1 and other agency untouched.
- Invitations: wrong email, reuse, expiry, revocation, unconfirmed email, invalid token rejected; seat limit; no token material in audit.
- Deactivation blocks continuing a session and reading old records, and closes the open session; retention removes session/turns/jobs, keeps ledger rows, no transcript text in audit; deletion request honoured.
- HTTP (real route handlers): unauthenticated → 401, cross-origin mutations → 403, full typed + audio (mock STT) turn loop to validated mock feedback, re-evaluate doesn't duplicate, unsupported MIME 415, >10 MiB 413, cross-agency 404s, rep blocked from manager APIs, invitation link → check → accept once (raw token not stored), correction → re-evaluation, publish, resident timeout → failed + 180 s refund + uncertain attempt kept, maintenance rejects missing/wrong secret, error bodies contain only `code/message/requestId`; demo refuses production and non-localhost binding; connected without config fails closed (503 + setup page).
- Evaluation recovery: invalid first output → exactly one repair → validated; evaluator outage → pending job → maintenance completes it.

**Manager controls (D25, D26), added 6 Nov 2026 evening:**
- Unit: must-say checklist by cue words with exact-excerpt quotes; never-say phrases matched case-insensitively with the exact words quoted; validator rejects a missing, duplicate or unknown checklist item, "said" without rep evidence, "not said" with evidence, and a no-drill retry on a different scenario; packs without say rules parse with empty defaults; engine create/edit/assign/archive scenarios, assignment-restricted starts, demo feedback validates for agency-written scenarios, rep directory/profile figures, simulated sign-in refuses deactivated people.
- DB (real Postgres): agency-written scenario keys and versions; other agencies can't see, edit, assign or start them (including calling the helper with another agency's id); versions immutable; archive hides, blocks starting and clears assignments; restore; the database rejects invalid fields; assigned reps see and start only their scenarios, drills unaffected, clearing removes the restriction; cross-agency and role rules on every new function; reps read only their own assignments and nobody writes the table directly; the stored checklist is re-checked (missing checklist, "said" without a quote, invented quote → unavailable).
- HTTP (Next): create scenario (and Zod rejection), assign, rep sees only it and gets `403 scenario_not_available` for others, practises it to validated mock feedback with the checklist, archive; rep database statistics and profile; another agency's rep → 404; rep → 403 on manager routes.
- E2E (Chromium, demo): starts on the role picker and protected pages return to it; deactivated rep can't be chosen; 375 px without horizontal scroll; manager writes a scenario, assigns only it to Priya, Priya sees just that one and practises it; manager adds a never-say phrase and publishes, Sam's feedback flags it and shows the checklist; rep database search, profile, deactivation.
- Fixed during the run: one connected-UI e2e step used a fixed 500 ms sleep and timed out under full-suite load (passed alone, warm and cold). It now waits for the turn to finish.

**Production server (`next start`, Chromium):** nonce CSP on pages (`'strict-dynamic'`, no `unsafe-*`, fresh nonce per request, nonce present on Next's scripts), no CSP violations or page errors on `/practice`, `/login`, `/manager`; `X-Frame-Options`, `nosniff`, no `X-Powered-By`; strict `default-src 'none'` CSP on API responses; unconfigured connected mode → 503 + setup guidance; unknown page and API routes → 404; demo mode refuses to start. Also checked by hand: `next build` and `next start` run directly (bypassing `npm` scripts) refuse demo mode.

**E2E (Chromium, `next dev`):** demo loop for **each of the five scenarios** (typed turns → end → evidence-linked "Demo feedback" → 60 s drill), firm refusal flagged and resolved by the manager, error report, history, reset, rep blocked from manager page, pending seed evaluation, **375 px layout without horizontal scroll**, skip link is first in tab order, campaign publish keeps old sessions on v1. Connected UI: signed-out redirect to sign-in, **MediaRecorder recording with Chromium's fake microphone → upload → mock transcription → resident reply → feedback**, microphone permission denied → typed fallback, manager overview/invite/review.

## Mocks vs live

| Area | Status |
|---|---|
| Anthropic resident + evaluator | **Not run live.** Adapter code follows the structured-outputs docs fetched 2026-11-06 and is tested only with stubbed `fetch`. Model IDs unverified. |
| Deepgram STT/TTS | **Not run live.** Tested with stubbed `fetch` against documented endpoints/response paths. Accepted container formats per browser unverified. |
| Supabase Auth (sign-up, confirmation link, password sign-in, refresh, sign-out) | **Not run.** All connected tests use the test auth stub. |
| Supabase PostgREST exposure of `app_api`, real `auth.uid()`/roles | **Not run.** SQL is tested on plain Postgres with a shim that mimics Supabase's role and function definitions. |
| Calibration | Run with **demo rules only**. Agreement is partly circular: the same author wrote the rules and the fixtures. It is not evidence about model quality. Live calibration: `npm run calibrate -- --evaluator anthropic --i-accept-provider-cost`. |
| Costs | No real prices used; rate card values in tests are synthetic. |

## Pending real-device / provider checks

1. iPhone Safari (current iOS): mic permission prompt after tap, `audio/mp4` recording via `MediaRecorder.isTypeSupported`, upload, Deepgram acceptance of that container, resident audio playback and the "Tap to hear" path, backgrounding mid-recording, echo with speaker playback.
2. Android Chrome: same, with WebM/Opus.
3. Real Supabase project: migrations apply, `app_api` exposed, RLS through PostgREST with real JWTs, email confirmation link handling on `/login`, refresh-token rotation.
4. Live Anthropic: structured outputs accepted for chosen models, latency within the 20 s (resident) / 45 s (evaluator) timeouts, reported usage reconciles with the rate card, prompt-injection fixtures behave.
5. Live Deepgram: chosen STT/TTS models, `dg-char-count` header presence, latency.
6. Manager calibration: review the 20 fixtures and real practice sessions with Kye and a pilot manager.
7. Hosting: request-body and duration limits for audio uploads and evaluation, scheduler for maintenance, HTTPS cookie flags.
8. Screen reader pass (VoiceOver/TalkBack). Automated tests covered keyboard focus order only.

## Known issues / limitations

- Native apps (D27): projects generated and synced with Capacitor 8.6; `Info.plist`, `AndroidManifest.xml` and the backup rules parse; the identity script was tested (set, check, restore). **Neither app has been compiled or run.** iOS needs macOS; the Android SDK and Maven hosts are blocked in this workspace, and the GitHub Android workflow has not been run.
- Standalone demo Live AI (D24), checked by the owner on 6 Nov 2026 on iPhone in the Claude app: **on** for the owner's account ("Live AI is on", switch shown); **off** for a second, free account in the Claude app with code execution enabled (`not-offered-0s`: the viewer is present but declines `sample` for that account, so the scripted demo runs). Full live practice on the owner's account, same day: "Interested but busy", 5 rep turns, Claude ended the conversation (`resident_ended`, 108 s used); evaluation completed and passed evidence validation, shown as "AI feedback · Claude via claude.ai (preview)" about 2 minutes after the practice started. Whether the repair attempt was needed was not recorded. One run only: quality, consistency and timing across scenarios are not established. Automated tests use a stub of the capability. Real Claude answers, their latency and how often the evaluator needs its repair attempt have not been checked; the page also needs the owner to declare the capability.

- `npm audit`: Zod 3.25.76 has a high-severity advisory (GHSA-mrhx-c7xc-m3w5); the fix is Zod 4, a breaking upgrade (DECISIONS D22).
- Demo, DB/HTTP and connected-UI suites run on `next dev`, because demo/mock/test-DB modes are refused in production. Only the production checks listed above run on `next start` (D19).
- Pages render client-side after mount, as before the move (D20). The development CSP is looser than production (D21).
- Plain `npx next dev` binds all interfaces. The localhost-only demo rule is enforced by `npm run dev` / `npm start` (`scripts/serve.ts`).
- In-memory rate limits (D16).
- Demo feedback rules are simplistic and can misjudge phrasing (intended as a labelled demo).
- `my_context` returns the newest scenario version per key. Content edits to scenarios beyond the seeded versions have no UI (out of MVP scope).
