import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { api, ApiError, type Me } from './api';
import { Login } from './pages/Login';
import { Discover } from './pages/Discover';
import { Search } from './pages/Search';
import { isFilter, Requests } from './pages/Requests';
import { AdminUsers } from './pages/AdminUsers';
import { Issues } from './pages/Issues';
import { Avatar, Icon, Mark, type IconName } from './pages/shared';

type View = 'discover' | 'search' | 'requests' | 'issues' | 'users';

interface Route {
  view: View;
  params: URLSearchParams;
}

// #/search?q=zelda, #/requests?filter=pending, #/users; anything else is Discover
const parseHash = (): Route => {
  const [path = '', query = ''] = window.location.hash.replace(/^#\/?/, '').split('?');
  const view = (['search', 'requests', 'issues', 'users'] as const).find((v) => v === path) ?? 'discover';
  // #/mine and #/queue were the old requests pages
  return { view: path === 'mine' || path === 'queue' ? 'requests' : view, params: new URLSearchParams(query) };
};

export function App() {
  const [me, setMe] = useState<Me | null>(null);
  const [checked, setChecked] = useState(false);
  const [route, setRoute] = useState<Route>(parseHash);
  const [pending, setPending] = useState(0);
  const [openIssues, setOpenIssues] = useState(0);

  const refreshMe = useCallback(async () => {
    try {
      const next = await api.me();
      setMe(next);
      if (next.user.isAdmin) {
        const [{ requests }, { issues }] = await Promise.all([api.requests('all'), api.issues('all')]);
        setPending(requests.filter((r) => r.status === 'pending').length);
        setOpenIssues(issues.filter((i) => i.status === 'open').length);
      }
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) setMe(null);
    } finally {
      setChecked(true);
    }
  }, []);

  useEffect(() => {
    void refreshMe();
    const onHash = () => setRoute(parseHash());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, [refreshMe]);

  if (!checked) return null;
  if (!me) return <Login onSignedIn={(m) => (setMe(m), void refreshMe())} />;

  const admin = me.user.isAdmin;
  const view = !admin && route.view === 'users' ? 'discover' : route.view;
  const filter = route.params.get('filter');

  return (
    <Shell me={me} view={view} query={view === 'search' ? (route.params.get('q') ?? '') : ''} pending={pending} openIssues={openIssues} onSignOut={() => setMe(null)}>
      {view === 'discover' && <Discover me={me} />}
      {view === 'search' && <Search query={route.params.get('q') ?? ''} onRequested={refreshMe} />}
      {view === 'requests' && <Requests me={me} filter={isFilter(filter) ? filter : admin ? 'open' : 'all'} onChanged={refreshMe} />}
      {view === 'issues' && <Issues me={me} onChanged={refreshMe} />}
      {view === 'users' && <AdminUsers me={me} />}
    </Shell>
  );
}

function Shell({
  me,
  view,
  query,
  pending,
  openIssues,
  onSignOut,
  children,
}: {
  me: Me;
  view: View;
  query: string;
  pending: number;
  openIssues: number;
  onSignOut: () => void;
  children: React.ReactNode;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [userOpen, setUserOpen] = useState(false);
  const [text, setText] = useState(query);
  const userRef = useRef<HTMLDivElement>(null);

  useEffect(() => setText(query), [query]);
  useEffect(() => setMenuOpen(false), [view]);
  useEffect(() => {
    if (!userOpen) return;
    const close = (e: MouseEvent) => !userRef.current?.contains(e.target as Node) && setUserOpen(false);
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [userOpen]);

  const search = (e: FormEvent) => {
    e.preventDefault();
    if (text.trim().length >= 2) window.location.hash = `#/search?q=${encodeURIComponent(text.trim())}`;
  };

  const links: { id: View; label: string; icon: IconName; href: string; count?: number }[] = [
    { id: 'discover', label: 'Discover', icon: 'sparkles', href: '#/' },
    { id: 'requests', label: me.user.isAdmin ? 'Requests' : 'My requests', icon: 'clock', href: '#/requests', count: me.user.isAdmin ? pending : 0 },
    { id: 'issues', label: me.user.isAdmin ? 'Issues' : 'My problems', icon: 'flag', href: '#/issues', count: me.user.isAdmin ? openIssues : 0 },
    ...(me.user.isAdmin ? [{ id: 'users' as const, label: 'Users', icon: 'users' as const, href: '#/users' }] : []),
  ];

  return (
    <>
      <aside className={menuOpen ? 'sidebar open' : 'sidebar'} aria-label="Sidebar">
        <a className="logo" href="#/">
          <span className="mark">
            <Mark />
          </span>
          <b>g-seekr</b>
        </a>
        <nav aria-label="Main">
          {links.map((l) => (
            <a key={l.id} href={l.href} className={view === l.id ? 'active' : undefined} aria-current={view === l.id ? 'page' : undefined}>
              <Icon name={l.icon} />
              {l.label}
              {l.count ? (
                <span className="count" aria-label={`${l.count} waiting`}>
                  {l.count}
                </span>
              ) : null}
            </a>
          ))}
        </nav>
        <div className="foot">Games are fetched by RetroArr and played in RomM.</div>
      </aside>
      <div className={menuOpen ? 'scrim open' : 'scrim'} onClick={() => setMenuOpen(false)} aria-hidden="true" />
      <div className="main">
        <header className="topbar">
          <button type="button" className="btn ghost menu" aria-label="Open the menu" onClick={() => setMenuOpen(true)}>
            <Icon name="menu" />
          </button>
          <form role="search" onSubmit={search}>
            <Icon name="search" />
            <input type="search" placeholder="Search games" aria-label="Search games" value={text} onChange={(e) => setText(e.target.value)} />
          </form>
          <div className="user-menu" ref={userRef}>
            <button type="button" className="avatar" aria-haspopup="menu" aria-expanded={userOpen} aria-label={`Account: ${me.user.username}`} onClick={() => setUserOpen((o) => !o)}>
              {me.user.username.slice(0, 1)}
            </button>
            {userOpen && (
              <div className="dropdown" role="menu">
                <div className="who">
                  <Avatar name={me.user.username} />
                  <span>
                    {me.user.username}
                    <small>{me.user.isAdmin ? 'Admin' : me.user.autoApprove ? 'Auto-approved' : 'User'}</small>
                  </span>
                </div>
                <button
                  type="button"
                  role="menuitem"
                  className="btn ghost"
                  onClick={async () => {
                    await api.logout().catch(() => undefined);
                    onSignOut();
                  }}
                >
                  <Icon name="logout" /> Sign out
                </button>
              </div>
            )}
          </div>
        </header>
        <main className="content">{children}</main>
      </div>
    </>
  );
}
