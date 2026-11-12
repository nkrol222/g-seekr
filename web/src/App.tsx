import { useCallback, useEffect, useState } from 'react';
import { api, ApiError, type Me } from './api';
import { Login } from './pages/Login';
import { Search } from './pages/Search';
import { MyRequests } from './pages/MyRequests';
import { AdminRequests } from './pages/AdminRequests';
import { AdminUsers } from './pages/AdminUsers';

type View = 'search' | 'mine' | 'queue' | 'users';
const VIEWS: View[] = ['search', 'mine', 'queue', 'users'];

const viewFromHash = (): View => {
  const v = window.location.hash.replace('#/', '') as View;
  return VIEWS.includes(v) ? v : 'search';
};

export function App() {
  const [me, setMe] = useState<Me | null>(null);
  const [checked, setChecked] = useState(false);
  const [view, setView] = useState<View>(viewFromHash);

  const refreshMe = useCallback(async () => {
    try {
      setMe(await api.me());
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) setMe(null);
    } finally {
      setChecked(true);
    }
  }, []);

  useEffect(() => {
    void refreshMe();
    const onHash = () => setView(viewFromHash());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, [refreshMe]);

  if (!checked) return null;
  if (!me) return <Login onSignedIn={setMe} />;

  const admin = me.user.isAdmin;
  const current = !admin && (view === 'queue' || view === 'users') ? 'search' : view;
  const tabs: { id: View; label: string }[] = [
    { id: 'search', label: 'Find a game' },
    { id: 'mine', label: 'My requests' },
    ...(admin ? ([{ id: 'queue', label: 'All requests' }, { id: 'users', label: 'Users' }] as const) : []),
  ];

  return (
    <div className="shell">
      <header className="topbar">
        <span className="brand">g-seekr</span>
        <nav aria-label="Main">
          {tabs.map((t) => (
            <a key={t.id} href={`#/${t.id}`} className={current === t.id ? 'active' : undefined} aria-current={current === t.id ? 'page' : undefined}>
              {t.label}
            </a>
          ))}
        </nav>
        <span className="who">
          {me.user.username}
          <button
            type="button"
            className="link"
            onClick={async () => {
              await api.logout().catch(() => undefined);
              setMe(null);
            }}
          >
            Sign out
          </button>
        </span>
      </header>
      <main>
        {current === 'search' && <Search me={me} onRequested={refreshMe} />}
        {current === 'mine' && <MyRequests me={me} onChanged={refreshMe} />}
        {current === 'queue' && <AdminRequests me={me} />}
        {current === 'users' && <AdminUsers me={me} />}
      </main>
    </div>
  );
}
