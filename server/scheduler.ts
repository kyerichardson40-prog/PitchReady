/**
 * In-process maintenance timer, so a single hosted server needs no external cron.
 * Started once per server process from instrumentation.ts. Runs maintenance every
 * MAINTENANCE_INTERVAL_MINUTES (default 10; 0 turns it off), first run one minute after start.
 * Never overlaps itself, never throws, logs one line when something was done or went wrong.
 * Safe with several server instances: the database work is lock-protected and idempotent.
 */
export function intervalMinutes(raw: string | undefined): number {
  if (raw === undefined || raw.trim() === '') return 10;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.min(Math.max(n, 1), 24 * 60);
}

type Runner = () => Promise<Record<string, unknown>>;
type Logger = Pick<Console, 'log' | 'error'>;

export function createTicker(run: Runner, log: Logger = console) {
  let busy = false;
  return async function tick(): Promise<'ran' | 'skipped' | 'failed'> {
    if (busy) return 'skipped';
    busy = true;
    try {
      const r = await run();
      const evaluations = (r.evaluations ?? {}) as Record<string, number>;
      const did = Object.entries(r).some(([k, v]) => k !== 'evaluations' && typeof v === 'number' && v > 0) || Object.keys(evaluations).length > 0;
      if (did) log.log(`[maintenance] ${JSON.stringify(r)}`);
      return 'ran';
    } catch (e: any) {
      log.error(`[maintenance] failed: ${String(e?.code ?? e?.message ?? e).slice(0, 200)}`);
      return 'failed';
    } finally {
      busy = false;
    }
  };
}

let started = false;
export async function startMaintenanceScheduler(env: NodeJS.ProcessEnv = process.env) {
  if (started) return;
  const minutes = intervalMinutes(env.MAINTENANCE_INTERVAL_MINUTES);
  if (minutes === 0) return;
  const { getConfig, connectedReady } = await import('./config.ts');
  if (!connectedReady(getConfig())) return;
  started = true;
  const { runMaintenance } = await import('./services/maintenance.ts');
  const tick = createTicker(() => runMaintenance());
  const first = setTimeout(() => { void tick(); }, 60_000);
  const every = setInterval(() => { void tick(); }, minutes * 60_000);
  first.unref?.(); every.unref?.();
  console.log(`[maintenance] scheduled every ${minutes} min`);
}
