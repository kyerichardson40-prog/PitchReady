/**
 * Root layout (server component). Reads the server-only mode/config at request time and passes
 * only `{ mode, setupError }` to the client. Rendering is dynamic so the CSP nonce set in
 * proxy.ts is applied to Next's scripts.
 */
import type { Metadata, Viewport } from 'next';
import { connection } from 'next/server';
import type { ReactNode } from 'react';
import { connectedReady, getConfig } from '../server/config.ts';
import { Shell, type BootConfig } from '../src/client/shell.tsx';
import '../src/client/styles.css';

function bootConfig(): BootConfig {
  const cfg = getConfig();
  const setupError = cfg.mode === 'connected' && !connectedReady(cfg)
    ? `Connected mode is not configured. ${cfg.problems.join(' ')} See README → Connected setup.`
    : undefined;
  return { mode: cfg.mode, setupError };
}

export async function generateMetadata(): Promise<Metadata> {
  await connection();
  const cfg = getConfig();
  const demo = cfg.mode === 'demo' ? ' (demo)' : '';
  const description = 'Sales practice with an AI customer. Reps rehearse real conversations by voice or text, on the doorstep, phone, shop floor or in meetings, and get feedback that quotes their own words.';
  return {
    metadataBase: new URL(cfg.env.APP_BASE_URL),
    title: { default: `PitchReady${demo}: practise sales conversations with an AI customer`, template: `%s · PitchReady${demo}` },
    description,
    applicationName: 'PitchReady',
    openGraph: { type: 'website', siteName: 'PitchReady', locale: 'en_GB', title: 'PitchReady: practise the pitch before the real one', description },
    twitter: { card: 'summary_large_image', title: 'PitchReady: practise the pitch before the real one', description },
  };
}

export const viewport: Viewport = { width: 'device-width', initialScale: 1, viewportFit: 'cover', themeColor: '#faf7f2' };

export default async function RootLayout({ children }: { children: ReactNode }) {
  await connection();
  return (
    <html lang="en-GB">
      <body>
        <Shell boot={bootConfig()}>{children}</Shell>
      </body>
    </html>
  );
}
