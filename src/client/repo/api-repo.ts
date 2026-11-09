import { RepoError, type Repository } from './types.ts';

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
const post = <T>(path: string, data?: unknown) => call<T>(path, { method: 'POST', body: data === undefined ? undefined : JSON.stringify(data) });

/** Connected-mode repository: every call goes through authenticated server routes. */
export class ApiRepository implements Repository {
  readonly mode = 'connected' as const;
  getContext() { return call<any>('/api/me'); }
  listMySessions() { return call<any>('/api/sessions'); }
  startSession(input: any) { return post<any>('/api/sessions', input); }
  submitTypedTurn(id: string, input: any) { return post<any>(`/api/sessions/${encodeURIComponent(id)}/turns`, input); }
  submitAudioTurn(id: string, audio: Blob, meta: { expectedSequence: number; idempotencyKey: string; durationMs: number }) {
    const fd = new FormData();
    fd.set('audio', audio, 'turn');
    fd.set('expectedSequence', String(meta.expectedSequence));
    fd.set('idempotencyKey', meta.idempotencyKey);
    fd.set('durationMs', String(Math.round(meta.durationMs)));
    return call<any>(`/api/sessions/${encodeURIComponent(id)}/turns`, { method: 'POST', body: fd });
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
