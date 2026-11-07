/** Next.js calls register() once when a server instance starts. */
export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;
  if (process.env.NEXT_PHASE === 'phase-production-build') return;
  if (process.env.APP_MODE !== 'connected') return;
  const { startMaintenanceScheduler } = await import('./server/scheduler.ts');
  await startMaintenanceScheduler().catch((e) => console.error('[maintenance] not started:', String(e?.message ?? e).slice(0, 200)));
}
