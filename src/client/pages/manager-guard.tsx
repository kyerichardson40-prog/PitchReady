'use client';
import { useApp } from '../app-context.tsx';
import { ErrorBox, Loading } from '../components/ui.tsx';

/** Returns an element to show instead of a manager page (loading, wrong role, inactive), or null. */
export function useManagerGuard() {
  const { ctx } = useApp();
  if (!ctx) return <Loading />;
  if (ctx.user?.role !== 'manager') return <ErrorBox message="Manager access required." />;
  if (!ctx.membershipActive) return <ErrorBox message="Your membership is not active." />;
  return null;
}
