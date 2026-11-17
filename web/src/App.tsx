import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { api, ApiError, type Me } from './api';
import { Login } from './pages/Login';
import { Discover } from './pages/Discover';
import { GameGrid, Search } from './pages/Search';
import { GamePage } from './pages/Game';
import { ForYou, RommLinkDialog } from './pages/ForYou';
import { isFilter, Requests } from './pages/Requests';
import { AdminUsers } from './pages/AdminUsers';
import { Issues } from './pages/Issues';
import { Collections, CollectionView } from './pages/Collections';
import { ImportReview, ImportStart } from './pages/Imports';
import { Avatar, Icon, Mark, type IconName } from './pages/shared';

type View = 'discover' | 'for-you' | 'browse' | 'search' | 'game' | 'collections' | 'collection' | 'import' | 'import-review' | 'requests' | 'issues' | 'users';

interface Route {
  view: View;
  params: URLSearchParams;
}

// #/search?q=zelda, #/requests?filter=pending, #/users; anything else is Discover
const parseHash = (): Route => {
  const [path = '', query = ''] = window.location.hash.replace(/^#\/?/, '').split('?');
  const params = new URLSearchParams(query);
  // #/game/1020
  const game = path.match(/^game\/(\d+)$/);
  if (game) {
    params.set('id', game[1]!);
    return { view: 'game', params };
  }
  // #/collection/series/5?platform=50, #/collection/list/3
  const collection = path.match(/^collection\/(series|list)\/(\d+)$/);
  if (collection) {
    params.set('kind', collection[1]!);
    params.set('id', collection[2]!);
    return { view: 'collection', params };
  }
  // #/collections/import, #/collections/import/7
  const imp = path.match(/^collections\/import(?:\/(\d+))?$/);
  if (imp) {
    if (imp[1]) params.set('id', imp[1]);
    return { view: imp[1] ? 'import-review' : 'import', params };
  }
  const view = (['for-you', 'browse', 'search', 'collections', 'requests', 'issues', 'users'] as const).find((v) => v === path) ?? 'discover';
  // #/mine and #/queue were the old requests pages
  return { view: path === 'mine' || path === 'queue' ? 'requests' : view, params };
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
  const view = !admin && (route.view === 'users' || route.view === 'import' || route.view === 'import-review') ? 'discover' : route.view;
  const num = (k: string) => Number(route.params.get(k)) || null;
  const filter = route.params.get('filter');

  return (
    <Shell me={me} view={view} query={view === 'search' ? (route.params.get('q') ?? '') : ''} pending={pending} openIssues={openIssues} onSignOut={() => setMe(null)}>
      {view === 'discover' && <Discover me={me} />}
      {view === 'search' && <Search query={route.params.get('q') ?? ''} />}
      {view === 'browse' && (
        <GameGrid
          key={route.params.toString()}
          list={(['popular', 'top', 'browse'] as const).find((l) => l === route.params.get('list')) ?? 'browse'}
          platformId={Number(route.params.get('platform')) || undefined}
        />
      )}
      {view === 'for-you' && <ForYou />}
      {view === 'collections' && <Collections me={me} />}
      {view === 'collection' && (
        <CollectionView
          kind={route.params.get('kind') === 'list' ? 'list' : 'series'}
          id={num('id')!}
          me={me}
          platformParam={num('platform')}
          onRequested={refreshMe}
        />
      )}
      {view === 'import' && <ImportStart key={route.params.toString()} listId={num('list')} platformId={num('platform')} />}
      {view === 'import-review' && <ImportReview id={num('id')!} />}
      {view === 'game' && <GamePage igdbId={Number(route.params.get('id'))} onRequested={refreshMe} />}
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
  const [rommOpen, setRommOpen] = useState(false);
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

  // A collection and the import pages sit under Collections in the sidebar
  const section: View = view === 'collection' || view === 'import' || view === 'import-review' ? 'collections' : view;
  const links: { id: View; label: string; icon: IconName; href: string; count?: number }[] = [
    { id: 'discover', label: 'Discover', icon: 'sparkles', href: '#/' },
    { id: 'for-you', label: 'For you', icon: 'heart', href: '#/for-you' },
    { id: 'browse', label: 'Browse', icon: 'squares', href: '#/browse' },
    { id: 'collections', label: 'Collections', icon: 'stack', href: '#/collections' },
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
            <a key={l.id} href={l.href} className={section === l.id ? 'active' : undefined} aria-current={section === l.id ? 'page' : undefined}>
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
                  onClick={() => {
                    setUserOpen(false);
                    setRommOpen(true);
                  }}
                >
                  <Icon name="play" /> RomM link
                </button>
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
        {rommOpen && <RommLinkDialog onClose={() => setRommOpen(false)} onChanged={() => undefined} />}
      </div>
    </>
  );
}
