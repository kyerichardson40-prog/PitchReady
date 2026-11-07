import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import type { AppContextData, Repository } from './repo/types.ts';

interface AppState {
  repo: Repository;
  ctx: AppContextData | null;
  ctxError: string | null;
  refresh: () => Promise<void>;
}

const Ctx = createContext<AppState | null>(null);

export function AppProvider({ repo, children }: { repo: Repository; children: ReactNode }) {
  const [ctx, setCtx] = useState<AppContextData | null>(null);
  const [ctxError, setErr] = useState<string | null>(null);
  const refresh = useCallback(async () => {
    try { setCtx(await repo.getContext()); setErr(null); }
    catch (e: any) { setErr(e?.message ?? 'Could not load your account.'); setCtx(null); }
  }, [repo]);
  useEffect(() => { void refresh(); }, [refresh]);
  return <Ctx.Provider value={{ repo, ctx, ctxError, refresh }}>{children}</Ctx.Provider>;
}

export function useApp(): AppState {
  const v = useContext(Ctx);
  if (!v) throw new Error('AppProvider missing');
  return v;
}

/** Loads async data with explicit loading / error / empty states. */
export function useAsync<T>(fn: () => Promise<T>, deps: unknown[]) {
  const [state, setState] = useState<{ loading: boolean; data: T | null; error: string | null }>({ loading: true, data: null, error: null });
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let live = true;
    setState((s) => ({ ...s, loading: true, error: null }));
    fn().then((data) => live && setState({ loading: false, data, error: null }))
      .catch((e) => live && setState({ loading: false, data: null, error: e?.message ?? 'Something went wrong.' }));
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick]);
  return { ...state, reload: () => setTick((t) => t + 1) };
}

export function newKey(prefix = 'op'): string {
  const bytes = new Uint8Array(12);
  crypto.getRandomValues(bytes);
  return `${prefix}-${Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')}`;
}
