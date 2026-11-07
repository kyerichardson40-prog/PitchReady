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
  return { title: `PitchReady${getConfig().mode === 'demo' ? ' (demo)' : ''}` };
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
