'use client';
/**
 * Thin adapter over next/navigation so pages keep a small, stable routing API
 * (`Link to=…`, `useNavigate()`, `useLocation()`). Replaces the hand-rolled router used before
 * the move to Next.js (DECISIONS.md D1).
 */
import NextLink from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useCallback, type ReactNode } from 'react';

export function useNavigate() {
  const router = useRouter();
  return useCallback((to: string, opts: { replace?: boolean } = {}) => {
    if (opts.replace) router.replace(to); else router.push(to);
  }, [router]);
}

export function useLocation(): { pathname: string; search: string } {
  const pathname = usePathname() ?? '/';
  const sp = useSearchParams();
  const qs = sp?.toString() ?? '';
  return { pathname, search: qs ? `?${qs}` : '' };
}

export function Link(props: { to: string; children: ReactNode; className?: string; current?: boolean; 'aria-label'?: string }) {
  return (
    <NextLink href={props.to} prefetch={false} className={props.className} aria-current={props.current ? 'page' : undefined} aria-label={props['aria-label']}>
      {props.children}
    </NextLink>
  );
}
