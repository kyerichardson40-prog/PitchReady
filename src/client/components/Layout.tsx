import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useApp } from '../app-context.tsx';
import { Link, useNavigate, useLocation } from '../router.tsx';
import { auth } from '../repo/api-repo.ts';

/** Public marketing pages: full-width, with their own footer. */
const SITE_PAGES = new Set(['/', '/how-it-works', '/pricing', '/about', '/contact', '/terms', '/privacy', '/dpa']);

/** The public site's pages, shown to visitors under the Menu button. */
const SITE_MENU: [string, string][] = [['/', 'Home'], ['/how-it-works', 'How it works'], ['/pricing', 'Pricing'], ['/about', 'About us'], ['/contact', 'Contact us']];

export function Layout({ children }: { children: ReactNode }) {
  const navigate = useNavigate();
  const { ctx, repo, refresh } = useApp();
  const { pathname } = useLocation();
  const role = ctx?.user?.role;
  const links: [string, string][] = role === 'manager'
    ? [['/manager', 'Overview'], ['/manager/reps', 'Team'], ['/manager/tasks', 'Practice tasks'], ['/manager/scenarios', 'Scenarios'], ['/manager/campaign', 'Rules & campaign'], ['/manager/billing', 'Billing'], ['/settings', 'Settings']]
    : role === 'rep'
      ? [['/practice', 'Practise'], ['/history', 'History'], ['/settings', 'Settings']]
      : [];
  // One Menu button everywhere: signed-in people get their app pages (and Owner), visitors the site's pages.
  const menuLinks: [string, string][] = ctx?.user ? [...links, ...(ctx.isOwner ? [['/owner', 'Owner'] as [string, string]] : [])] : SITE_MENU;
  const signOut = !ctx?.user ? null
    : repo.mode === 'connected' ? async () => { await auth.signOut().catch(() => {}); await refresh(); navigate('/login?signedOut=1'); }
    : async () => { await repo.demoSignOut!(); await refresh(); navigate('/'); };
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
      {ctx?.announcement && (
        <div className={`announce announce-${ctx.announcement.tone}`} role="region" aria-label="Announcement"><p>{ctx.announcement.text}</p></div>
      )}
      <header className="topbar">
        <div className="topbar-inner">
          <Link to={role === 'manager' ? '/manager' : role ? '/practice' : '/'} className="brand">PitchReady<small>{repo.mode === 'demo' ? 'demo' : 'pilot'}</small></Link>
          {!ctx?.user && pathname !== '/login' && <Link to="/login" className="btn primary header-signin">Sign in</Link>}
          <SiteMenu pathname={pathname} links={menuLinks} isCurrent={isCurrent} who={ctx?.user ? ctx.user.name || ctx.user.email : null} signOut={signOut} />
        </div>
      </header>
      <main id="main" tabIndex={-1} className={SITE_PAGES.has(pathname) ? 'main-wide' : undefined}>{children}</main>
    </>
  );
}

/**
 * The Menu button, the same on every page. Signed-in people see their pages (and Sign out);
 * visitors see the site's pages. Closes on choosing an item, Escape (focus returns to the
 * button), or a tap outside.
 */
function SiteMenu({ pathname, links, isCurrent, who, signOut }: { pathname: string; links: [string, string][]; isCurrent: (href: string) => boolean; who: string | null; signOut: (() => Promise<void>) | null }) {
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
          {who && <p className="site-menu-who">Signed in as <strong>{who}</strong></p>}
          {links.map(([href, label]) => (
            <Link key={href} to={href} current={href === '/' ? pathname === '/' : isCurrent(href)}>{label}</Link>
          ))}
          {signOut && <button type="button" className="site-menu-signout" aria-label={who ? `Sign out (${who})` : 'Sign out'} onClick={() => { setOpen(false); void signOut(); }}>Sign out</button>}
        </nav>
      )}
    </div>
  );
}
