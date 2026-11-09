import { limitsOfSession, practiceMinutesOf } from '../../../lib/domain/limits.ts';
import { salesContextOf } from '../../../lib/domain/sales.ts';
import * as E from '../../../lib/demo/engine.ts';
import { getDrill } from '../../../lib/content/scenarios.ts';
import { demoResidentReply } from '../../../lib/demo/resident.ts';
import { isGarbled } from '../../../lib/demo/patterns.ts';
import { RepoError, type Repository, type AppContextData, type LiveAiControl, type LiveAiEngine, type TurnResult } from './types.ts';

const STORAGE_KEY = 'pitchready-demo-state';
const LIVE_PREF_KEY = 'pitchready-live-ai';
/** Errors after which live AI stays off for this page view (claude.ai `sample` codes). */
const PERMANENT = new Set(['not_granted', 'sampling_disabled', 'not_declared', 'capability_disabled', 'capability_removed']);

function liveErrorText(e: unknown): string {
  const code = (e as { code?: string } | null)?.code ?? '';
  if (code === 'not_granted') return 'Claude wasn’t allowed for this page, so the demo is using its scripted resident and rule-based feedback.';
  if (PERMANENT.has(code)) return 'Claude isn’t available here, so the demo is using its scripted resident and rule-based feedback.';
  if (code === 'rate_limited') return 'Claude is busy or a usage limit was reached. Wait a moment and try again.';
  if (code === 'session_expired') return 'Your claude.ai sign-in has expired. Sign in again, then try again.';
  return 'Claude didn’t return a usable answer. You can try again.';
}

/** Browser-local demo repository. Synthetic data only; resettable; never sent to a server. */
export class DemoRepository implements Repository {
  readonly mode = 'demo' as const;
  private memory: E.DemoState | null = null;
  /** Live resident + evaluator (standalone demo inside claude.ai only). */
  private live: LiveAiEngine | null;
  private liveOn: boolean;
  private liveError: string | null = null;
  private inFlight = new Set<string>();
  readonly liveAi?: LiveAiControl;
  readonly liveAiNote?: string;

  constructor(live: LiveAiEngine | null = null, liveAiNote?: string) {
    this.live = live;
    if (!live && liveAiNote) this.liveAiNote = liveAiNote;
    let pref: string | null = null;
    try { pref = localStorage.getItem(LIVE_PREF_KEY); } catch { /* storage unavailable */ }
    this.liveOn = !!live && pref !== 'off';
    if (live) {
      const repo = this;
      this.liveAi = {
        get enabled() { return repo.liveOn; },
        get lastError() { return repo.liveError; },
        setEnabled(v: boolean) {
          repo.liveOn = v; repo.liveError = null;
          try { localStorage.setItem(LIVE_PREF_KEY, v ? 'on' : 'off'); } catch { /* ignore */ }
        },
      };
    }
  }
  private useLive(): boolean { return !!this.live && this.liveOn; }
  private noteLiveFailure(e: unknown) {
    this.liveError = liveErrorText(e);
    if (PERMANENT.has((e as { code?: string } | null)?.code ?? '')) this.liveOn = false;
  }

  private load(): E.DemoState {
    if (this.memory) return this.memory;
    let s: E.DemoState | null = null;
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) s = JSON.parse(raw);
    } catch { /* storage unavailable: fall back to memory */ }
    if (!s || s.stateVersion !== E.DEMO_STATE_VERSION) s = E.createSeedState();
    E.recoverExpired(s);
    // A live evaluation interrupted by a reload is not running any more: offer it again.
    for (const x of s.sessions) if (x.evaluationStatus === 'running' && !this.inFlight.has(x.id)) x.evaluationStatus = 'pending';
    this.memory = s;
    return s;
  }
  private save(s: E.DemoState) {
    this.memory = s;
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(s)); } catch { /* ignore */ }
  }
  private run<T>(fn: (s: E.DemoState) => T): Promise<T> {
    const s = this.load();
    try {
      const out = fn(s);
      this.save(s);
      // structuredClone so React state never aliases mutable demo state
      return Promise.resolve(structuredClone(out));
    } catch (e) {
      this.save(s);
      if (e instanceof E.DemoError) return Promise.reject(new RepoError(e.code, e.message));
      return Promise.reject(e);
    }
  }

  getContext(): Promise<AppContextData> {
    return this.run((s) => {
      const me = E.currentUser(s);
      const pub = E.currentPublished(s);
      return {
        mode: 'demo', user: s.signedIn ? { id: me.id, name: me.name, email: me.email, role: me.role } : null, membershipActive: s.signedIn && me.active,
        agencyName: s.agency.name,
        campaign: {
          version: pub.version, name: pub.pack.name, fictional: pub.pack.fictional, organisation: pub.pack.organisation, facts: pub.pack.approved_facts,
          mustSay: pub.pack.must_say ?? [], neverSay: pub.pack.never_say ?? [], forbiddenClaims: pub.pack.forbidden_claims, objectionAnswers: pub.pack.objection_answers ?? [],
          salesContext: salesContextOf(pub.pack),
          practiceMinutes: practiceMinutesOf(pub.pack),
        },
        rubricVersion: pub.rubric.version,
        scenarios: me.role === 'rep' ? E.allowedScenarios(s, me.id) : s.scenarios.filter((x) => !x.archived),
        usage: { allowanceSeconds: s.usage.allowanceSeconds, consumedSeconds: s.usage.consumedSeconds, reservedSeconds: s.usage.reservedSeconds, periodEnd: s.usage.periodEnd },
        retentionDays: s.agency.retentionDays,
        emailNotifications: s.agency.emailNotifications ?? true,
        hasTeam: true,
        voice: { stt: false, tts: false, deviceVoice: typeof speechSynthesis !== 'undefined' },
        liveAi: this.useLive(),
        demoPeople: s.people.map((p) => ({ id: p.id, name: p.name, email: p.email, role: p.role, active: p.active })),
      } satisfies AppContextData;
    });
  }
  listMySessions() { return this.run((s) => s.sessions.filter((x) => x.repId === s.currentUserId).sort((a, b) => (b.startedAt ?? '').localeCompare(a.startedAt ?? ''))); }
  startSession(input: Parameters<Repository['startSession']>[0]) {
    return this.run((s) => ({ session: E.startSession(s, input), residentAudio: null, notices: [] }));
  }
  async submitTypedTurn(id: string, input: { text: string; expectedSequence: number; idempotencyKey: string }): Promise<TurnResult> {
    if (!this.useLive()) return this.run((s) => ({ session: E.submitTurn(s, id, input), residentAudio: null, notices: [] }));
    const opts = { scriptedReply: false, evaluateOnEnd: false };
    const first = await this.run((s) => E.submitTurn(s, id, input, new Date(), opts));
    const notices: string[] = [];
    if (first.status === 'active' && first.turns.at(-1)?.speaker === 'rep') {
      const c = await this.run((s) => {
        const { session, pack, transcript } = E.evaluationInputs(s, id);
        return { scenario: E.findScenario(this.load(), session.scenarioKey)!, drill: session.drillKey ? getDrill(session.drillKey) ?? null : null, campaign: pack, transcript, scenarioKey: session.scenarioKey, drillKey: session.drillKey,
          repliesLeft: limitsOfSession(session).maxRepTurns - transcript.filter((t) => t.speaker === 'rep').length };
      });
      let reply: { utterance: string; endConversation: boolean };
      let source: 'generated' | 'scripted' = 'generated';
      try {
        reply = await this.live!.residentReply({ scenario: c.scenario, drill: c.drill, campaign: c.campaign, transcript: c.transcript, repliesLeft: c.repliesLeft });
      } catch (e) {
        this.noteLiveFailure(e);
        reply = demoResidentReply({ scenarioKey: c.scenarioKey, drillKey: c.drillKey, transcript: c.transcript });
        source = 'scripted';
        notices.push(`Live AI didn’t reply, so this resident line is scripted. ${this.liveError ?? ''}`.trim());
      }
      await this.run((s) => { E.commitResidentTurn(s, id, reply, source, new Date(), false); });
    }
    const session = await this.run((s) => E.getSession(s, id));
    if (session.status !== 'active' && session.evaluationStatus === 'pending') this.startLiveEvaluation(id);
    return { session: await this.run((s) => E.getSession(s, id)), residentAudio: null, notices };
  }
  submitAudioTurn(): Promise<never> {
    return Promise.reject(new RepoError('voice_unavailable_demo', 'Voice transcription is not available in demo mode. Use the typed reply box.'));
  }
  async endSession(id: string, input: { idempotencyKey: string }) {
    if (!this.useLive()) return this.run((s) => E.endSession(s, id, input));
    await this.run((s) => E.endSession(s, id, input, new Date(), 'rep_ended', false));
    this.startLiveEvaluation(id);
    return this.run((s) => E.getSession(s, id));
  }

  /**
   * Starts a live evaluation in the background; the session shows "Feedback pending" meanwhile.
   * Same rules as the server: no usable rep speech → deterministic result without a model call;
   * invalid output after one repair → "unavailable"; a failed call → pending, to try again.
   */
  private startLiveEvaluation(sessionId: string) {
    if (!this.live || this.inFlight.has(sessionId)) return;
    const s = this.load();
    const { session, pack, rubric, transcript, transcriptRevision } = E.evaluationInputs(s, sessionId);
    if (session.status === 'active' || session.evaluationStatus === 'completed') return;
    if (!transcript.some((t) => t.speaker === 'rep' && !isGarbled(t.text))) { E.runEvaluation(s, session); this.save(s); return; }
    E.markEvaluationRunning(s, sessionId);
    this.save(s);
    this.inFlight.add(sessionId);
    const live = this.live;
    const meta = { transcriptRevision, evaluatorKind: 'anthropic' as const, model: live.label, promptVersion: live.promptVersion };
    void live.evaluate({ scenario: E.findScenario(this.load(), session.scenarioKey)!, drill: session.drillKey ? getDrill(session.drillKey) ?? null : null, campaign: pack, rubric, transcript, transcriptRevision })
      .then((v) => {
        this.liveError = null;
        const st = this.load();
        E.saveEvaluation(st, sessionId, v.ok ? { ...meta, status: 'completed', result: v.result } : { ...meta, status: 'unavailable', result: null, errors: v.errors });
        this.save(st);
      })
      .catch((e) => {
        this.noteLiveFailure(e);
        const st = this.load();
        E.saveEvaluation(st, sessionId, { ...meta, status: 'pending', result: null });
        this.save(st);
      })
      .finally(() => this.inFlight.delete(sessionId));
  }
  getSession(id: string) {
    return this.run((s) => {
      const session = E.getSession(s, id);
      const me = E.currentUser(s);
      return {
        session,
        reports: s.reports.filter((r) => r.sessionId === id && (me.role === 'manager' || r.reporterId === me.id)),
        reviews: me.role === 'manager' ? s.reviews.filter((r) => r.sessionId === id) : [],
      };
    });
  }
  async retryEvaluation(id: string) {
    if (!this.useLive()) return this.run((s) => E.retryEvaluation(s, id));
    await this.run((s) => {
      const x = E.getSession(s, id);
      if (x.status === 'active') throw new E.DemoError('session_active', 'End the practice first.');
    });
    this.startLiveEvaluation(id);
    return this.run((s) => E.getSession(s, id));
  }
  reportFeedback(id: string, input: Parameters<Repository['reportFeedback']>[1]) { return this.run((s) => { E.reportFeedback(s, id, input); }); }
  requestDeletion(input: { scope: 'my_transcripts' | 'my_account' }) { return this.run((s) => { E.requestDeletion(s, input.scope); }); }
  updateName(name: string) { return this.run((s) => { E.updateName(s, name); }); }
  updateTeamSettings(input: { retentionDays?: number; emailNotifications?: boolean }) { return this.run((s) => { E.updateTeamSettings(s, input); }); }
  async sendContact(): Promise<void> { throw new Error('The demo can’t send messages. Use the contact page on the live PitchReady site.'); }

  getOverview(periodDays: number) {
    return this.run((s) => ({ ...E.overview(s, periodDays), remainingSeconds: E.remainingSeconds(s), allowanceSeconds: s.usage.allowanceSeconds }));
  }
  listTeamSessions() {
    return this.run((s) => {
      if (E.currentUser(s).role !== 'manager') throw new E.DemoError('forbidden', 'Manager access required.');
      const sums = new Map(E.summaries(s).map((x) => [x.id, x]));
      return s.sessions.filter((x) => x.status !== 'active').sort((a, b) => (b.endedAt ?? '').localeCompare(a.endedAt ?? '')).map((x) => ({
        id: x.id, repName: x.repName, scenarioKey: x.scenarioKey, scenarioTitle: sums.get(x.id)!.scenarioTitle, drillKey: x.drillKey, endedAt: x.endedAt, status: x.status,
        evaluationStatus: x.evaluationStatus, openConcerns: sums.get(x.id)!.openConcerns, openReports: sums.get(x.id)!.openReports,
      }));
    });
  }
  getRoster() {
    return this.run((s) => {
      if (E.currentUser(s).role !== 'manager') throw new E.DemoError('forbidden', 'Manager access required.');
      return {
        members: E.directory(s),
        invitations: s.invitations, seatLimit: 5,
      };
    });
  }
  createInvitation(input: { email: string; role: 'rep' | 'manager' }) {
    return this.run((s) => { const r = E.createInvitation(s, input); return { link: `${location.origin}${r.link}`, expiresAt: r.invitation.expiresAt }; });
  }
  revokeInvitation(id: string) { return this.run((s) => E.revokeInvitation(s, id)); }
  setMemberActive(userId: string, active: boolean) { return this.run((s) => E.setMemberActive(s, userId, active)); }
  addReview(sessionId: string, input: Parameters<Repository['addReview']>[1]) { return this.run((s) => { E.addReview(s, sessionId, input); }); }
  async addCorrection(sessionId: string, input: Parameters<Repository['addCorrection']>[1]) {
    await this.run((s) => { E.addCorrection(s, sessionId, input, new Date(), !this.useLive()); });
    if (this.useLive()) this.startLiveEvaluation(sessionId);
  }
  getCampaignAdmin() {
    return this.run((s) => {
      if (E.currentUser(s).role !== 'manager') throw new E.DemoError('forbidden', 'Manager access required.');
      return s.campaign;
    });
  }
  saveDraft(pack: Parameters<Repository['saveDraft']>[0], rubric: Parameters<Repository['saveDraft']>[1]) { return this.run((s) => E.saveDraft(s, pack, rubric)); }
  publishDraft() { return this.run((s) => ({ version: E.publishDraft(s).version })); }
  getScenarioAdmin() { return this.run((s) => E.scenarioAdmin(s)); }
  saveScenario(input: Parameters<Repository['saveScenario']>[0]) { return this.run((s) => E.saveScenario(s, input)); }
  setScenarioArchived(key: string, archived: boolean) { return this.run((s) => { E.setScenarioArchived(s, key, archived); }); }
  setScenarioAssignments(userId: string, keys: string[]) { return this.run((s) => { E.setAssignments(s, userId, keys); }); }
  getRepProfile(userId: string) { return this.run((s) => E.repProfile(s, userId)); }
  demoSignIn(userId: string) { return this.run((s) => { E.signIn(s, userId); }); }
  demoSignOut() { return this.run((s) => { E.signOut(s); }); }

  demoReset() {
    this.memory = E.createSeedState();
    this.save(this.memory);
    return Promise.resolve();
  }
  demoSwitchUser(userId: string) {
    return this.run((s) => {
      if (!s.people.some((p) => p.id === userId)) throw new E.DemoError('not_found', 'Unknown demo person.');
      s.currentUserId = userId;
    });
  }
}
