import type { NextConfig } from 'next';
import { PHASE_PRODUCTION_BUILD, PHASE_PRODUCTION_SERVER } from 'next/constants.js';

const common = [
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'same-origin' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Permissions-Policy', value: 'microphone=(self), camera=(), geolocation=()' },
];

const nextConfig: NextConfig = {
  poweredByHeader: false,
  agentRules: false,
  reactStrictMode: true,
  // Test servers run several `next dev` instances side by side; each needs its own build dir.
  distDir: process.env.NEXT_DIST_DIR || '.next',
  // Test servers also use a throwaway tsconfig, because Next adds each build dir's type globs to it.
  typescript: { tsconfigPath: process.env.NEXT_TSCONFIG_PATH || 'tsconfig.json' },
  async headers() {
    return [
      { source: '/:path*', headers: common },
      // Pages get a per-request nonce CSP from proxy.ts. API responses are JSON/audio only.
      { source: '/api/:path*', headers: [{ key: 'Content-Security-Policy', value: "default-src 'none'; frame-ancestors 'none'" }] },
    ];
  },
};

/*
 * Demo mode is localhost-only and never runs as a production build or server, so `next build` and
 * `next start` refuse it. (Host binding is checked by scripts/serve.ts, used by `npm run dev` / `npm start`.)
 */
export default function config(phase: string): NextConfig {
  if ((phase === PHASE_PRODUCTION_BUILD || phase === PHASE_PRODUCTION_SERVER) && (process.env.APP_MODE ?? 'demo') === 'demo') {
    console.error('Refusing to build or start: APP_MODE=demo is not allowed in a production build or server. Set APP_MODE=connected.');
    process.exit(1);
  }
  return nextConfig;
}
