/**
 * Stand-in for `next/navigation` in the standalone demo build (scripts/build-static-demo.ts).
 * Routing is kept in memory: the hosting frame only allows plain `#name` hashes, so paths and
 * query strings cannot live in the URL. Reloading returns to the start view; demo data persists
 * in localStorage as usual.
 */
import { useSyncExternalStore } from 'react';

let current = { pathname: '/', search: '' };
const listeners = new Set<() => void>();
const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; };
const snapshot = () => current;

function show(to: string) {
  const u = new URL(to, 'https://demo.invalid');
  current = { pathname: u.pathname, search: u.search };
  try { window.scrollTo(0, 0); } catch { /* ignore */ }
  listeners.forEach((l) => l());
}

/**
 * Each screen is also recorded in the browser history (state only, the URL never changes), so the
 * browser's and Android's Back button step back through screens instead of leaving the page/app.
 */
export function go(to: string, replace = false) {
  try {
    if (replace) history.replaceState({ pitchready: to }, '');
    else history.pushState({ pitchready: to }, '');
  } catch { /* history unavailable: in-memory only */ }
  show(to);
}
if (typeof window !== 'undefined') {
  try { history.replaceState({ pitchready: current.pathname }, ''); } catch { /* ignore */ }
  window.addEventListener('popstate', (e) => {
    const to = (e.state as { pitchready?: string } | null)?.pitchready;
    if (typeof to === 'string') show(to);
  });
}

const router = { push: (to: string) => go(to), replace: (to: string) => go(to, true), back: () => history.back(), forward: () => history.forward(), refresh: () => {}, prefetch: () => {} };
export function useRouter() { return router; }
export function usePathname() { return useSyncExternalStore(subscribe, snapshot, snapshot).pathname; }
export function useSearchParams() { return new URLSearchParams(useSyncExternalStore(subscribe, snapshot, snapshot).search); }
