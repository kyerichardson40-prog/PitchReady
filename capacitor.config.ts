/**
 * Native app shells (iOS + Android) via Capacitor. DECISIONS.md D27.
 *
 * Two builds from the same projects:
 *  - default: the bundled, offline demo (dist/app-www, from `npm run app:build`) for trying the app on
 *    a device and internal testing. Store review will not accept a demo-only app.
 *  - PITCHREADY_APP_URL=https://… : the app opens the hosted connected (pilot) app. This is the build to
 *    submit, once the pilot is deployed (real sign-in, Supabase, providers).
 *
 * Store identity (bundle ID, name): app-identity.json, applied to the native projects by
 * scripts/set-app-identity.ts. The ID can never change after the first upload, and "PitchReady" is a
 * working name not yet cleared, so set both before publishing.
 */
import type { CapacitorConfig } from '@capacitor/cli';
import { readFileSync } from 'node:fs';

const identity = JSON.parse(readFileSync('app-identity.json', 'utf8')) as { appId: string; appName: string };

const appUrl = process.env.PITCHREADY_APP_URL;
if (appUrl && !appUrl.startsWith('https://')) throw new Error('PITCHREADY_APP_URL must be an https:// URL.');

const config: CapacitorConfig = {
  appId: identity.appId,
  appName: identity.appName,
  webDir: 'dist/app-www',
  ...(appUrl ? { server: { url: appUrl, allowNavigation: [new URL(appUrl).host], cleartext: false } } : {}),
  backgroundColor: '#faf7f2',
  ios: { contentInset: 'never', limitsNavigationsToAppBoundDomains: false },
  android: { allowMixedContent: false },
};

export default config;
