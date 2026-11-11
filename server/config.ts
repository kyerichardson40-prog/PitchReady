/**
 * Server-only configuration. Nothing here is ever bundled for the browser
 * (scripts/check-bundle-secrets.ts verifies that). `.env` loading for CLI scripts is in dotenv.ts;
 * Next.js loads `.env` itself.
 */
import { existsSync } from 'node:fs';
import { z } from 'zod';

const optional = z.string().trim().optional().transform((v) => (v ? v : undefined));
const intOpt = z.string().trim().optional().transform((v, ctx) => {
  if (!v) return undefined;
  const n = Number(v);
  if (!Number.isInteger(n) || n < 0) { ctx.addIssue({ code: 'custom', message: 'must be a non-negative integer' }); return z.NEVER; }
  return n;
});

const envSchema = z.object({
  APP_MODE: z.enum(['demo', 'connected']).default('demo'),
  APP_BASE_URL: z.string().url().default('http://localhost:3000'),
  HOST: optional,
  PORT: optional,
  NODE_ENV: optional,
  NEXT_PUBLIC_SUPABASE_URL: optional,
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: optional,
  SUPABASE_SECRET_KEY: optional,
  ANTHROPIC_API_KEY: optional,
  ANTHROPIC_ROLEPLAY_MODEL: optional,
  ANTHROPIC_EVALUATION_MODEL: optional,
  DEEPGRAM_API_KEY: optional,
  DEEPGRAM_STT_MODEL: optional,
  DEEPGRAM_TTS_MODEL: optional,
  TRANSCRIPT_RETENTION_DAYS: intOpt,
  PILOT_INCLUDED_SECONDS: intOpt,
  SUBSCRIPTION_INCLUDED_SECONDS: intOpt,
  LIVE_AI_ENABLED: z.enum(['true', 'false']).default('false'),
  AI_PROVIDER: z.enum(['anthropic', 'mock']).optional(),
  AI_GLOBAL_BUDGET_MINOR_UNITS: intOpt,
  AI_AGENCY_BUDGET_MINOR_UNITS: intOpt,
  AI_BUDGET_CURRENCY: optional,
  PROVIDER_RATE_CARD_PATH: optional,
  MAINTENANCE_SECRET: optional,
  /** Site owner(s) who can open the owner suite (comma-separated emails). */
  OWNER_EMAILS: optional,
  /** Free pilots that people start themselves. Off with SELF_SERVE_PILOTS=false. */
  SELF_SERVE_PILOTS: z.enum(['true', 'false']).default('true'),
  SELF_SERVE_PILOT_SECONDS: intOpt,
  SELF_SERVE_PILOT_DAYS: intOpt,
  /** Test-only: route DB calls through local psql instead of Supabase REST. Refused in production. */
  PITCHREADY_TEST_DB_URL: optional,
});

export type Env = z.infer<typeof envSchema>;

export interface ServerConfig {
  env: Env;
  mode: 'demo' | 'connected';
  production: boolean;
  problems: string[];
  liveAi: boolean;
  providerKind: 'anthropic' | 'mock' | 'none';
  voice: { stt: boolean; tts: boolean };
}

let cached: ServerConfig | null = null;

export function getConfig(source: NodeJS.ProcessEnv = process.env, fresh = false): ServerConfig {
  if (cached && !fresh && source === process.env) return cached;
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    const problems = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`);
    return { env: {} as Env, mode: 'connected', production: source.NODE_ENV === 'production', problems, liveAi: false, providerKind: 'none', voice: { stt: false, tts: false } };
  }
  const env = parsed.data;
  const production = env.NODE_ENV === 'production';
  const problems: string[] = [];

  for (const [k, v] of Object.entries(source)) {
    if (k.startsWith('NEXT_PUBLIC_') && /SECRET|SERVICE|PRIVATE|API_KEY/i.test(k)) problems.push(`${k} looks like a secret but has a public NEXT_PUBLIC_ prefix.`);
    void v;
  }
  if (env.APP_MODE === 'demo' && production) problems.push('APP_MODE=demo cannot run with NODE_ENV=production.');

  if (env.APP_MODE === 'connected') {
    if (env.PITCHREADY_TEST_DB_URL) {
      if (production) problems.push('PITCHREADY_TEST_DB_URL is test-only and is refused in production.');
    } else {
      if (!env.NEXT_PUBLIC_SUPABASE_URL) problems.push('NEXT_PUBLIC_SUPABASE_URL is required in connected mode.');
      if (!env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY) problems.push('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY is required in connected mode.');
      if (!env.SUPABASE_SECRET_KEY) problems.push('SUPABASE_SECRET_KEY is required in connected mode (server-only).');
    }
    if (!env.MAINTENANCE_SECRET || env.MAINTENANCE_SECRET.length < 32) problems.push('MAINTENANCE_SECRET must be set (32+ random characters) in connected mode.');
  }

  // Live provider calls stay disabled until keys, models, rate card and budgets are all configured.
  let providerKind: ServerConfig['providerKind'] = 'none';
  const liveRequested = env.LIVE_AI_ENABLED === 'true';
  const wantMock = env.AI_PROVIDER === 'mock';
  if (wantMock) {
    if (production) problems.push('AI_PROVIDER=mock is for tests and CI only and is refused in production.');
    else providerKind = 'mock';
  } else if (liveRequested) {
    const missing = ([
      ['ANTHROPIC_API_KEY', env.ANTHROPIC_API_KEY], ['ANTHROPIC_ROLEPLAY_MODEL', env.ANTHROPIC_ROLEPLAY_MODEL], ['ANTHROPIC_EVALUATION_MODEL', env.ANTHROPIC_EVALUATION_MODEL],
      ['PROVIDER_RATE_CARD_PATH', env.PROVIDER_RATE_CARD_PATH], ['AI_GLOBAL_BUDGET_MINOR_UNITS', env.AI_GLOBAL_BUDGET_MINOR_UNITS],
      ['AI_AGENCY_BUDGET_MINOR_UNITS', env.AI_AGENCY_BUDGET_MINOR_UNITS], ['AI_BUDGET_CURRENCY', env.AI_BUDGET_CURRENCY],
    ] as const).filter(([, v]) => v === undefined).map(([k]) => k);
    if (missing.length) problems.push(`LIVE_AI_ENABLED=true but missing: ${missing.join(', ')}. Live AI stays disabled.`);
    else if (env.PROVIDER_RATE_CARD_PATH && !existsSync(env.PROVIDER_RATE_CARD_PATH)) problems.push(`PROVIDER_RATE_CARD_PATH ${env.PROVIDER_RATE_CARD_PATH} does not exist. Live AI stays disabled.`);
    else providerKind = 'anthropic';
  }
  const deepgramReady = providerKind === 'anthropic' && !!env.DEEPGRAM_API_KEY;
  const config: ServerConfig = {
    env, mode: env.APP_MODE, production, problems,
    liveAi: providerKind === 'anthropic',
    providerKind,
    voice: {
      stt: providerKind === 'mock' || (deepgramReady && !!env.DEEPGRAM_STT_MODEL),
      tts: providerKind === 'mock' || (deepgramReady && !!env.DEEPGRAM_TTS_MODEL),
    },
  };
  if (source === process.env) cached = config;
  return config;
}

/** Connected mode refuses to serve protected routes when required configuration is missing. */
export function connectedReady(c: ServerConfig): boolean {
  return c.mode === 'connected' && !c.problems.some((p) => !p.includes('Live AI stays disabled'));
}

export function resetConfigCache() { cached = null; }
