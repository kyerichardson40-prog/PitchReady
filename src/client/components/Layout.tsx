import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useApp } from '../app-context.tsx';
import { Link, useNavigate, useLocation } from '../router.tsx';
import { auth } from '../repo/api-repo.ts';

/** Public marketing pages: full-width, with their own footer. */
const SITE_PAGES = new Set(['/', '/how-it-works', '/pricing', '/about', '/contact', '/terms', '/privacy', '/dpa']);

/** The public site's pages, shown to visitors under the Menu button. */
const SITE_MENU: [string, string][] = [['/how-it-works', 'How it works'], ['/pricing', 'Pricing'], ['/about', 'About us'], ['/contact', 'Contact us']];

export function Layout({ children }: { children: ReactNode }) {
  const navigate = useNavigate();
  const { ctx, repo, refresh } = useApp();
  const { pathname } = useLocation();
  const role = ctx?.user?.role;
  const links: [string, string][] = role === 'manager'
    ? [['/manager', 'Overview'], ['/manager/reps', 'Team'], ['/manager/scenarios', 'Scenarios'], ['/manager/campaign', 'Rules & campaign'], ['/settings', 'Settings']]
    : role === 'rep'
      ? [['/practice', 'Practise'], ['/history', 'History'], ['/settings', 'Settings']]
      : [];
  const isCurrent = (href: string) => pathname === href || (href !== '/manager' && pathname.startsWith(href + '/')) || (href === '/practice' && pathname.startsWith('/sessions/'));

  return (
    <>
      <a href="#main" className="skip">Skip to content</a>
      {repo.mode === 'demo' && ctx && (
        <div className="banner" role="region" aria-label="Demo mode">
          <div className="banner-inner">
            <strong>Demo mode</strong>
            <span>
              Synthetic, fictional data stored only in this browser.{' '}
              {ctx.liveAi
                ? 'Live AI is on: the AI customer and the feedback come from Claude, using your claude.ai account.'
                : 'Feedback is rule-based “Demo feedback”, not AI.'}
            </span>
            {!repo.liveAi && repo.liveAiNote && <span className="small">{repo.liveAiNote}</span>}
            {repo.liveAi && (
              <label className="row live-toggle">
                <input type="checkbox" checked={repo.liveAi.enabled} onChange={async (e) => { repo.liveAi!.setEnabled(e.target.checked); await refresh(); }} />
                Live AI
              </label>
            )}
            <button className="btn" onClick={async () => { if (confirm('Reset all demo data to the fictional seed? You will be signed out.')) { await repo.demoReset!(); await refresh(); navigate('/'); } }}>Reset demo data</button>
          </div>
        </div>
      )}
      <header className="topbar">
        <div className="topbar-inner">
          <Link to={role === 'manager' ? '/manager' : role ? '/practice' : '/'} className="brand">PitchReady<small>{repo.mode === 'demo' ? 'demo' : 'pilot'}</small></Link>
          {!ctx?.user && pathname !== '/login' && <Link to="/login" className="btn primary header-signin">Sign in</Link>}
          {!role && <SiteMenu pathname={pathname} />}
          {links.length > 0 && <nav className="nav" aria-label="Main">
            {links.map(([href, label]) => <Link key={href} to={href} current={isCurrent(href)}>{label}</Link>)}
            {repo.mode === 'connected' && ctx?.user && (
              <button className="btn link" onClick={async () => { await auth.signOut().catch(() => {}); await refresh(); navigate('/login?signedOut=1'); }}>Sign out</button>
            )}
            {repo.mode === 'demo' && ctx?.user && (
              <button className="btn link" aria-label={`Sign out (${ctx.user.name})`} onClick={async () => { await repo.demoSignOut!(); await refresh(); navigate('/'); }}>Sign out</button>
            )}
          </nav>}
        </div>
      </header>
      <main id="main" tabIndex={-1} className={SITE_PAGES.has(pathname) ? 'main-wide' : undefined}>{children}</main>
    </>
  );
}

/**
 * Menu button for visitors: the site's pages open in a small panel instead of a row of links.
 * Closes on choosing a page, Escape (focus returns to the button), or a tap outside.
 */
function SiteMenu({ pathname }: { pathname: string }) {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  useEffect(() => { setOpen(false); }, [pathname]);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { setOpen(false); button.current?.focus(); } };
    const onDown = (e: PointerEvent) => { if (wrap.current && !wrap.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onDown);
    return () => { document.removeEventListener('keydown', onKey); document.removeEventListener('pointerdown', onDown); };
  }, [open]);
  return (
    <div className="site-menu" ref={wrap}>
      <button ref={button} type="button" className="site-menu-btn" aria-expanded={open} aria-controls="site-menu-panel" onClick={() => setOpen((o) => !o)}>
        <span className="site-menu-icon" aria-hidden="true"><span /><span /><span /></span>Menu
      </button>
      {open && (
        <nav id="site-menu-panel" className="site-menu-panel" aria-label="Menu">
          {SITE_MENU.map(([href, label]) => (
            <Link key={href} to={href} current={pathname === href}>{label}</Link>
          ))}
        </nav>
      )}
    </div>
  );
}
