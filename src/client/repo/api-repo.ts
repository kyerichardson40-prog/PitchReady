import type { NewTask, PracticeTask } from '../../../lib/domain/tasks.ts';
import { RepoError, type Repository, type TurnEvents, type TurnResult } from './types.ts';

async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body && !(init.body instanceof FormData)) headers.set('content-type', 'application/json');
  let res: Response;
  try {
    res = await fetch(path, { ...init, headers, credentials: 'same-origin' });
  } catch {
    throw new RepoError('network_error', 'Could not reach the server. Check your connection and try again.');
  }
  const body = res.status === 204 ? null : await res.json().catch(() => null);
  if (!res.ok) {
    const err = body?.error ?? {};
    throw new RepoError(err.code ?? 'http_error', err.message ?? `Request failed (${res.status}).`, err.requestId, res.status);
  }
  return body as T;
}
/**
 * A turn with live updates: the server sends one JSON line per event (rep words saved, reply text
 * so far, each sentence's audio) and finishes with `done` (the usual result) or `error`.
 */
async function callStream(path: string, init: RequestInit, events: TurnEvents): Promise<TurnResult> {
  const headers = new Headers(init.headers);
  if (init.body && !(init.body instanceof FormData)) headers.set('content-type', 'application/json');
  headers.set('accept', 'application/x-ndjson');
  let res: Response;
  try { res = await fetch(path, { ...init, headers, credentials: 'same-origin' }); }
  catch { throw new RepoError('network_error', 'Could not reach the server. Check your connection and try again.'); }
  if (!res.ok || !res.body || !(res.headers.get('content-type') ?? '').includes('ndjson')) {
    const body = await res.json().catch(() => null);
    if (res.ok && body) return body as TurnResult; // a server that doesn't stream: same result in one go
    const err = body?.error ?? {};
    throw new RepoError(err.code ?? 'http_error', err.message ?? `Request failed (${res.status}).`, err.requestId, res.status);
  }
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  for (;;) {
    let chunk: ReadableStreamReadResult<Uint8Array>;
    try { chunk = await reader.read(); }
    catch { throw new RepoError('network_error', 'The connection dropped while the reply was on its way. Send your reply again; it won’t be added twice.'); }
    if (chunk.done) break;
    buf += dec.decode(chunk.value, { stream: true });
    let nl: number;
    while ((nl = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (!line) continue;
      const ev = JSON.parse(line);
      if (ev.type === 'rep') events.rep?.(ev.session);
      else if (ev.type === 'partial') events.partial?.(ev.text);
      else if (ev.type === 'audio') events.audio?.(ev.index, { base64: ev.base64, mimeType: ev.mimeType });
      else if (ev.type === 'error') throw new RepoError(ev.code, ev.message, undefined, ev.status);
      else if (ev.type === 'done') { const { type: _t, ...r } = ev; return r as TurnResult; }
    }
  }
  throw new RepoError('network_error', 'The connection dropped while the reply was on its way. Send your reply again; it won’t be added twice.');
}

const post = <T>(path: string, data?: unknown) => call<T>(path, { method: 'POST', body: data === undefined ? undefined : JSON.stringify(data) });

/** First-time questions (connected mode only). */
export const onboardingApi = {
  save: (data: { role: 'rep' | 'manager'; struggles: string[]; strugglesOther?: string; goals: string[]; goalsOther?: string; skipped?: boolean }) => post<{ done: true }>('/api/onboarding', data),
  team: () => call<TeamAnswer[]>('/api/onboarding'),
};
export interface TeamAnswer { name: string; role: 'rep' | 'manager'; struggles: string[]; strugglesOther: string | null; goals: string[]; goalsOther: string | null; at: string }

/** Owner suite calls (connected mode only; the server checks the caller is the owner). */
export const ownerApi = {
  view: <T>(view: string, params: Record<string, string> = {}) => call<T>(`/api/owner?${new URLSearchParams({ view, ...params })}`),
  act: <T = unknown>(action: string, data: Record<string, unknown> = {}) => post<T>('/api/owner', { action, ...data }),
};

/** Connected-mode repository: every call goes through authenticated server routes. */
export class ApiRepository implements Repository {
  readonly mode = 'connected' as const;
  getContext() { return call<any>('/api/me'); }
  listMySessions() { return call<any>('/api/sessions'); }
  startSession(input: any) { return post<any>('/api/sessions', input); }
  submitTypedTurn(id: string, input: any, events?: TurnEvents) {
    const path = `/api/sessions/${encodeURIComponent(id)}/turns`;
    return events ? callStream(path, { method: 'POST', body: JSON.stringify(input) }, events) : post<any>(path, input);
  }
  submitAudioTurn(id: string, audio: Blob, meta: { expectedSequence: number; idempotencyKey: string; durationMs: number }, events?: TurnEvents) {
    const fd = new FormData();
    fd.set('audio', audio, 'turn');
    fd.set('expectedSequence', String(meta.expectedSequence));
    fd.set('idempotencyKey', meta.idempotencyKey);
    fd.set('durationMs', String(Math.round(meta.durationMs)));
    const path = `/api/sessions/${encodeURIComponent(id)}/turns`;
    return events ? callStream(path, { method: 'POST', body: fd }, events) : call<any>(path, { method: 'POST', body: fd });
  }
  endSession(id: string, input: any) { return post<any>(`/api/sessions/${encodeURIComponent(id)}/end`, input); }
  getSession(id: string) { return call<any>(`/api/sessions/${encodeURIComponent(id)}`); }
  retryEvaluation(id: string) { return post<any>(`/api/sessions/${encodeURIComponent(id)}/evaluate`, {}); }
  async reportFeedback(id: string, input: any) { await post(`/api/sessions/${encodeURIComponent(id)}/reports`, input); }
  async requestDeletion(input: any) { await post('/api/me/deletion-requests', input); }
  async sendContact(input: any) { await post('/api/contact', input); }
  async updateName(name: string) { await call('/api/me', { method: 'PUT', body: JSON.stringify({ name }) }); }
  async updateTeamSettings(input: any) { await call('/api/manager/settings', { method: 'PUT', body: JSON.stringify(input) }); }
  getOverview(periodDays: number) { return call<any>(`/api/manager/overview?days=${periodDays}`); }
  listTeamSessions() { return call<any>('/api/manager/sessions'); }
  getRoster() { return call<any>('/api/manager/roster'); }
  createInvitation(input: any) { return post<any>('/api/manager/invitations', { ...input, expiresInDays: 7 }); }
  async revokeInvitation(id: string) { await post(`/api/manager/invitations/${encodeURIComponent(id)}/revoke`, {}); }
  async setMemberActive(userId: string, active: boolean) { await post(`/api/manager/members/${encodeURIComponent(userId)}`, { active }); }
  async addReview(sessionId: string, input: any) { await post(`/api/manager/sessions/${encodeURIComponent(sessionId)}/reviews`, input); }
  async addCorrection(sessionId: string, input: any) { await post(`/api/manager/sessions/${encodeURIComponent(sessionId)}/corrections`, input); }
  getCampaignAdmin() { return call<any>('/api/manager/campaign'); }
  async saveDraft(pack: any, rubric: any) { await call('/api/manager/campaign', { method: 'PUT', body: JSON.stringify({ pack, rubric: rubric.dimensions }) }); }
  publishDraft() { return post<any>('/api/manager/campaign/publish', {}); }
  getScenarioAdmin() { return call<any>('/api/manager/scenarios'); }
  saveScenario(input: any) { return post<any>('/api/manager/scenarios', input); }
  async setScenarioArchived(key: string, archived: boolean) { await post(`/api/manager/scenarios/${encodeURIComponent(key)}/archive`, { archived }); }
  async setScenarioAssignments(userId: string, keys: string[]) { await call(`/api/manager/members/${encodeURIComponent(userId)}/scenarios`, { method: 'PUT', body: JSON.stringify({ keys }) }); }
  getRepProfile(userId: string) { return call<any>(`/api/manager/members/${encodeURIComponent(userId)}`); }
  listTasks(opts: { includeArchived?: boolean } = {}) { return call<PracticeTask[]>(`/api/tasks${opts.includeArchived ? '?archived=1' : ''}`); }
  createTask(input: NewTask) { return post<PracticeTask>('/api/tasks', input); }
  async archiveTask(id: string) { await call(`/api/tasks/${encodeURIComponent(id)}`, { method: 'DELETE' }); }
}

export const auth = {
  signIn: (email: string, password: string) => post<{ ok: true }>('/api/auth/sign-in', { email, password }),
  signUp: (email: string, password: string) => post<{ ok: true; confirmationRequired: boolean }>('/api/auth/sign-up', { email, password, acceptTerms: true }),
  signOut: () => post<{ ok: true }>('/api/auth/sign-out', {}),
  forgotPassword: (email: string) => post<{ ok: true }>('/api/auth/forgot', { email }),
  passwordStatus: () => call<{ recovery: boolean }>('/api/auth/password'),
  changePassword: (newPassword: string, currentPassword?: string) => post<{ ok: true }>('/api/auth/password', currentPassword ? { newPassword, currentPassword } : { newPassword }),
  startPilot: (teamName: string, yourName: string) => post<{ ok: true }>('/api/pilot', { teamName, yourName }),
  adoptSession: (accessToken: string, refreshToken: string) => post<{ ok: true }>('/api/auth/session', { accessToken, refreshToken }),
  checkInvite: (token: string) => post<{ status: string; email?: string; role?: string; agencyName?: string }>('/api/invitations/check', { token }),
  acceptInvite: (token: string) => post<{ ok: true }>('/api/invitations/accept', { token }),
};
