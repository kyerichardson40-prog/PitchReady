/**
 * Entry for the standalone demo: one self-contained HTML file, demo mode only, no server and no
 * API. Same pages, shell, demo repository and "Demo feedback" rules as `npm run dev`.
 * See DECISIONS.md D23.
 */
import { AboutPage, ContactPage, DpaPage, HowItWorksPage, PrivacyPage, TermsPage } from '../client/pages/site.tsx';
import { createRoot } from 'react-dom/client';
import type { ReactNode } from 'react';
import { usePathname, useSearchParams } from './next-navigation.ts';
import { Shell } from '../client/shell.tsx';
import { DemoRepository } from '../client/repo/demo-repo.ts';
import { ClaudeLiveAi, type Message } from './live-ai.ts';
import { HistoryPage, HomePage, NotFoundPage, PracticePage, SessionPage, SettingsPage } from '../client/pages/rep.tsx';
import { PracticeSessionPage } from '../client/pages/PracticeSessionPage.tsx';
import { InvitePage, LoginPage } from '../client/pages/auth.tsx';
import { ManagerCampaignPage, ManagerOverviewPage, ManagerRepsPage, ManagerSessionPage } from '../client/pages/manager.tsx';
import { ManagerScenariosPage, RepProfilePage } from '../client/pages/manager-team.tsx';

// The hosting frame ignores window.confirm. The demo's confirmations (reset, publish, deactivate)
// only touch fictional data in this browser, so they proceed without a prompt here.
try { window.confirm = () => true; } catch { /* ignore */ }

const routes: [RegExp, (m: string[], search: string) => ReactNode][] = [
  [/^\/$/, () => <HomePage />],
  [/^\/login$/, () => <LoginPage />],
  [/^\/how-it-works$/, () => <HowItWorksPage />],
  [/^\/about$/, () => <AboutPage />],
  [/^\/contact$/, () => <ContactPage />],
  [/^\/terms$/, () => <TermsPage />],
  [/^\/dpa$/, () => <DpaPage />],
  [/^\/privacy$/, () => <PrivacyPage />],
  [/^\/invite\/([^/]+)$/, (m) => <InvitePage token={m[1]!} />],
  [/^\/practice$/, () => <PracticePage />],
  [/^\/practice\/([^/]+)$/, (m, s) => <PracticeSessionPage key={m[1]! + s} scenarioId={m[1]!} />],
  [/^\/sessions\/([^/]+)$/, (m) => <SessionPage id={decodeURIComponent(m[1]!)} />],
  [/^\/history$/, () => <HistoryPage />],
  [/^\/settings$/, () => <SettingsPage />],
  [/^\/manager$/, () => <ManagerOverviewPage />],
  [/^\/manager\/reps$/, () => <ManagerRepsPage />],
  [/^\/manager\/reps\/([^/]+)$/, (m) => <RepProfilePage id={decodeURIComponent(m[1]!)} />],
  [/^\/manager\/scenarios$/, () => <ManagerScenariosPage />],
  [/^\/manager\/sessions\/([^/]+)$/, (m) => <ManagerSessionPage id={decodeURIComponent(m[1]!)} />],
  [/^\/manager\/campaign$/, () => <ManagerCampaignPage />],
];

function Routes() {
  const pathname = usePathname();
  const search = useSearchParams().toString();
  for (const [re, render] of routes) {
    const m = pathname.match(re);
    if (m) return <>{render(m, search)}</>;
  }
  return <NotFoundPage />;
}

/**
 * Inside claude.ai the page can ask Claude through the viewer's own account (the `sample`
 * capability, which asks the viewer for consent on first use). Anywhere else `window.claude` is
 * absent, or `use()` resolves null, and the demo runs scripted as before.
 */
type SampleFn = { json(input: Message[], opts?: { modelTier?: 'quick' | 'default'; cache?: boolean }): Promise<unknown> };
// The reason code tells apart "not inside a Claude viewer" from "viewer present, Claude not offered".
const NO_CLAUDE = (code: string) => `Live AI is off: this view can’t reach Claude. Open the link on claude.ai while signed in to a Claude account to use it. (${code})`;
const IN_APP = 'Live AI isn’t available in the app’s built-in demo: it uses the scripted resident and rule-based feedback. The pilot app uses real AI.';
async function detectLiveAi(): Promise<{ live: ClaudeLiveAi | null; note?: string }> {
  // Inside the iOS/Android app shell (Capacitor) there is no claude.ai viewer to ask.
  if ((window as unknown as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor?.isNativePlatform?.()) return { live: null, note: IN_APP };
  const claude = (window as unknown as { claude?: { use(name: string): Promise<unknown> } }).claude;
  if (!claude?.use) return { live: null, note: NO_CLAUDE('no-viewer') };
  const t0 = Date.now();
  try {
    const sample = await claude.use('sample') as SampleFn | null;
    if (!sample) return { live: null, note: NO_CLAUDE(`not-offered-${Math.round((Date.now() - t0) / 1000)}s`) };
    return { live: new ClaudeLiveAi((messages, tier) => sample.json(messages, { modelTier: tier, cache: false })) };
  } catch { return { live: null, note: NO_CLAUDE('use-failed') }; }
}

const root = createRoot(document.getElementById('root')!);
root.render(<p className="muted" style={{ padding: '1rem' }}>Loading the PitchReady demo…</p>);
void detectLiveAi().then(({ live, note }) => {
  const repo = new DemoRepository(live, note);
  root.render(<Shell boot={{ mode: 'demo' }} repo={repo}><Routes /></Shell>);
});
