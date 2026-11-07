# Data handling (proposal — not legal advice)

This describes what the software does. It does not by itself establish compliance with UK GDPR, the Fundraising Regulator's Code or any agency policy. The agency and its advisers must agree the launch decisions listed at the end.

## What is stored (connected mode)

| Data | Where | Who can read |
|---|---|---|
| Account email, password hash, confirmation state | Supabase Auth (`auth.users`) | Supabase; managers see emails of members of their own agency |
| Display name | `profiles` | The person; managers of their agency |
| Agency, membership, role, active flag | `agencies`, `memberships` | Members (own row); managers (agency) |
| Invitations: email, role, **SHA-256 of token**, expiry, used/revoked | `invitations` | Managers of that agency. Raw tokens are shown once to the inviting manager and never stored or logged |
| Practice transcripts (typed or transcribed text), corrections | `turns`, `turn_corrections` | The rep who practised; managers of the agency |
| Feedback (validated JSON), model ID, prompt version | `evaluations` | Same as transcripts |
| Error reports, manager review notes | `feedback_reports`, `manager_reviews` | Reporter (own reports); managers |
| Minutes reserved/used, provider attempt metadata (operation, model, request ID, token/second/character counts, cost estimate) | `usage_*`, `provider_attempts` | Managers of the agency. No transcript text, no audio, no credentials |
| Audit events (action, actor, target ID, minimal metadata) | `audit_events` | Managers. No transcript text or invitation secrets (tested) |
| Deletion requests | `deletion_requests` | The requester; managers |
| Scenarios written by managers; per-rep scenario assignments | `scenario_versions`, `scenario_assignments` | Members of the agency (scenarios); managers and the rep concerned (assignments). Agency training content, not personal data beyond who is assigned what |
| Say rules (must-say, never-say, objection answers) | Campaign pack JSON in `campaign_versions` | Members of the agency (published); managers (drafts) |

**Not stored by this app:** raw audio (uploaded audio is held in memory for the transcription request only), payment details (the app cannot take donations — fact F4), real donor or resident data (all residents are fictional).

Demo mode stores only fictional data in the browser's localStorage, never on a server. Its sign-in is simulated: fictional accounts, no passwords checked or stored.

## Shared with providers (when enabled)

- **Deepgram** (speech-to-text): the rep's recorded turn audio. (Text-to-speech): the resident's generated line.
- **Anthropic** (resident and evaluator): the fictional scenario, approved campaign facts, rubric and the session transcript.

This app does not control how providers retain or use this data. **Before launch, verify and record** each provider's current data-retention/training settings for the account used (including any zero-retention or opt-out options), data location, sub-processors and contract terms. The statement shown to reps ("raw audio is not retained by this app by default") deliberately says nothing about providers.

## Retention and deletion (proposed defaults)

- Transcripts, corrections, evaluations, reports and review notes are deleted **30 days** after the session ended (`agencies.retention_days`, 1–365; configurable per agency). Deletion runs in the maintenance job and cascades consistently.
- Aggregate usage (ledger, provider attempts) is kept for billing/cost audit without transcript text.
- A rep can request deletion at `/settings`. Proposed policy: honoured at the next maintenance run (transcripts and reports removed; "my account" also deactivates membership). Deleting the Supabase Auth user itself is a manual admin step (document who does it).
- Supabase backups/point-in-time recovery may retain deleted data for their own retention window — agree and disclose this.

## Who sees what (shown to reps)

`/settings` and the pre-practice screen tell reps: practice is simulated; their agency's managers can review saved transcripts and feedback; other reps cannot; raw audio is not retained by this app by default; feedback is coaching, not a compliance certificate or employment decision.

## Assessment boundaries

The evaluator assesses transcript **content** only. It must not infer personality, emotion, honesty, accent/dialect quality, protected characteristics or employment suitability, and the MVP makes no voice/prosody claims. Concerns are coaching flags for human review.

## Remaining launch decisions (owner + agency)

1. Lawful basis and privacy notice for processing reps' practice data; whether a DPIA is needed.
2. Agency data-processing agreement; who is controller/processor.
3. Provider settings verified and recorded (see above); provider-side spend limits configured.
4. Final retention period, backup retention, deletion-request turnaround and who actions auth-account deletion.
5. Manager access policy: who may read transcripts; how feedback may (not) be used in performance management.
6. Approved real campaign content replacing the fictional pack, signed off by the charity/agency against the Fundraising Regulator's Code.
7. Incident response contact and breach process.
8. Hosting region and security review before any real data is accepted.
