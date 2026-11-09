'use client';
/**
 * Client shell rendered by the root layout (app/layout.tsx). Picks the repository for the mode
 * the server reports, applies the signed-in guard, and moves focus after client-side navigation.
 *
 * Page content renders only after mount. Pages read browser-only state (localStorage in demo mode,
 * speech synthesis, clocks), and the data they show is per-user and fetched client-side, so
 * server-rendering it would only produce hydration mismatches. The layout chrome and setup errors
 * are still server-rendered.
 */
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { AppProvider, useApp } from './app-context.tsx';
import { useLocation, useNavigate } from './router.tsx';
import { DemoRepository } from './repo/demo-repo.ts';
import { ApiRepository } from './repo/api-repo.ts';
import type { Repository } from './repo/types.ts';
import { Layout } from './components/Layout.tsx';
import { ErrorBox, Loading } from './components/ui.tsx';

export interface BootConfig { mode: 'demo' | 'connected'; setupError?: string }

const PUBLIC = new Set(['/', '/login', '/how-it-works', '/about', '/contact', '/terms', '/privacy']);

function Gate({ setupError, children }: { setupError?: string; children: ReactNode }) {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const { repo, ctx, ctxError } = useApp();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  // Both modes: pages other than the start, sign-in and invitation pages need someone signed in.
  // The demo's sign-in is simulated and starts from the role picker on the home page.
  const needsAuth = !PUBLIC.has(pathname) && !pathname.startsWith('/invite/');
  useEffect(() => {
    if (needsAuth && ctx && !ctx.user) navigate(repo.mode === 'demo' ? '/' : `/login?next=${encodeURIComponent(pathname)}`, { replace: true });
  }, [needsAuth, ctx, pathname, navigate, repo.mode]);
  // Move focus to the content region after client-side navigation (not on first load, so Tab reaches
  // the skip link). Compares pathnames rather than a first-run flag so StrictMode's double effect run
  // on mount does not count as a navigation.
  const lastPath = useRef(pathname);
  useEffect(() => {
    if (lastPath.current === pathname) return;
    lastPath.current = pathname;
    document.getElementById('main')?.focus({ preventScroll: true });
  }, [pathname]);
  if (setupError) return <ErrorBox message={setupError} />;
  if (!mounted) return <Loading />;
  if (needsAuth && ctxError) return <ErrorBox message={ctxError} />;
  if (needsAuth && !ctx) return <Loading />;
  return <>{children}</>;
}

export function Shell({ boot, repo: given, children }: { boot: BootConfig; repo?: Repository; children: ReactNode }) {
  const [repo] = useState<Repository>(() => given ?? (boot.mode === 'connected' ? new ApiRepository() : new DemoRepository()));
  return (
    <AppProvider repo={repo}>
      <Layout><Gate setupError={boot.setupError}>{children}</Gate></Layout>
    </AppProvider>
  );
}
