import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { api, REGIONS, type AdminSettings, type Me, type Platform, type RommStatus, type SettingKey, type SettingView, type TasteItem } from '../api';
import { AdminTasks } from './AdminTasks';
import { AdminUsers } from './AdminUsers';
import { useFilters } from './Filters';
import { RommLinkDialog } from './ForYou';
import { Alert, Icon, Toggle, type IconName } from './shared';

export type SettingsTab = 'account' | 'content' | 'recommendations' | 'general' | 'requests' | 'notifications' | 'connections' | 'users' | 'tasks';

const USER_TABS: { id: SettingsTab; label: string; icon: IconName }[] = [
  { id: 'account', label: 'Account', icon: 'users' },
  { id: 'content', label: 'Content', icon: 'funnel' },
  { id: 'recommendations', label: 'Recommendations', icon: 'heart' },
];
const ADMIN_TABS: { id: SettingsTab; label: string; icon: IconName }[] = [
  { id: 'general', label: 'General', icon: 'cog' },
  { id: 'requests', label: 'Requests', icon: 'clock' },
  { id: 'notifications', label: 'Notifications', icon: 'flag' },
  { id: 'connections', label: 'Connections', icon: 'refresh' },
  { id: 'users', label: 'Users', icon: 'users' },
  { id: 'tasks', label: 'Tasks', icon: 'refresh' },
];
export const ADMIN_SETTINGS_TABS = new Set(ADMIN_TABS.map((t) => t.id));
export const isSettingsTab = (t: string | undefined): t is SettingsTab => [...USER_TABS, ...ADMIN_TABS].some((x) => x.id === t);

// Settings, as Seerr has: the user's own pages for everyone, the server's for admins. A non-admin never sees the
// admin pages (App sends them to Account), and the server answers their API calls 403 anyway.
export function Settings({ me, tab, onChanged }: { me: Me; tab: SettingsTab; onChanged: () => void }) {
  const admin = me.user.isAdmin;
  // On a phone the tabs are a row that scrolls sideways: keep the open one in view
  const nav = useRef<HTMLElement>(null);
  useEffect(() => {
    nav.current?.querySelector('a.active')?.scrollIntoView({ block: 'nearest', inline: 'center' });
  }, [tab]);
  return (
    <section className="settings">
      <div className="page-title">
        <h1>Settings</h1>
      </div>
      <div className="settings-layout">
        <nav className="settings-nav" aria-label="Settings" ref={nav}>
          <span className="settings-nav-head">You</span>
          {USER_TABS.map((t) => (
            <a key={t.id} href={`#/settings/${t.id}`} className={tab === t.id ? 'active' : undefined} aria-current={tab === t.id ? 'page' : undefined}>
              <Icon name={t.icon} /> {t.label}
            </a>
          ))}
          {admin && (
            <>
              <span className="settings-nav-head">Server</span>
              {ADMIN_TABS.map((t) => (
                <a key={t.id} href={`#/settings/${t.id}`} className={tab === t.id ? 'active' : undefined} aria-current={tab === t.id ? 'page' : undefined}>
                  <Icon name={t.icon} /> {t.label}
                </a>
              ))}
            </>
          )}
        </nav>
        <div className="settings-panel">
          {tab === 'account' && <AccountTab me={me} />}
          {tab === 'content' && <ContentTab me={me} onChanged={onChanged} />}
          {tab === 'recommendations' && <RecommendationsTab />}
          {admin && (tab === 'general' || tab === 'requests' || tab === 'notifications' || tab === 'connections') && <ServerTab key={tab} tab={tab} onChanged={onChanged} />}
          {admin && tab === 'users' && <AdminUsers me={me} />}
          {admin && tab === 'tasks' && <AdminTasks />}
        </div>
      </div>
    </section>
  );
}

function Card({ title, hint, children }: { title: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <div className="settings-card">
      <h2>{title}</h2>
      {hint && <p className="hint">{hint}</p>}
      {children}
    </div>
  );
}

// ---------- the user's own ----------

function AccountTab({ me }: { me: Me }) {
  const [romm, setRomm] = useState<RommStatus | null>(null);
  const [linking, setLinking] = useState(false);
  const load = useCallback(() => {
    api
      .romm()
      .then(setRomm)
      .catch(() => setRomm(null));
  }, []);
  useEffect(load, [load]);
  const { limit, used, days } = me.limits;
  return (
    <>
      <Card title="You">
        <dl className="settings-facts">
          <dt>Signed in as</dt>
          <dd>{me.user.username} (your Jellyfin account)</dd>
          <dt>Role</dt>
          <dd>{me.user.isAdmin ? 'Admin' : me.user.autoApprove ? 'User, requests approved automatically' : 'User'}</dd>
          <dt>Requests</dt>
          <dd>{limit > 0 ? `${used} of ${limit} in the last ${days} days` : 'No limit'}</dd>
        </dl>
      </Card>
      <Card title="RomM" hint="Link your RomM account so what you play in RomM shapes your recommendations. Make a client token in RomM (Profile → Client API Tokens) with the me.read and roms.read scopes.">
        {romm && !romm.available ? (
          <p className="muted">Linking RomM isn’t set up on this server.</p>
        ) : romm?.linked ? (
          <p>
            Linked as <b>{romm.rommUsername}</b>
            {romm.error && <span className="muted"> · last sync failed: {romm.error}</span>}
          </p>
        ) : (
          <p className="muted">Not linked.</p>
        )}
        <div className="settings-actions">
          <button type="button" className="btn primary" onClick={() => setLinking(true)} disabled={romm?.available === false}>
            {romm?.linked ? 'Change or unlink' : 'Link RomM'}
          </button>
        </div>
      </Card>
      {linking && <RommLinkDialog onClose={() => setLinking(false)} onChanged={load} />}
    </>
  );
}

function ContentTab({ me, onChanged }: { me: Me; onChanged: () => void }) {
  const { filters, apply } = useFilters();
  const [platforms, setPlatforms] = useState<Platform[]>([]);
  const [prefs, setPrefs] = useState(me.prefs);
  const [saved, setSaved] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    api.platforms().then(setPlatforms).catch(() => undefined);
  }, []);

  const save = async (next: Me['prefs']) => {
    setPrefs(next);
    setError(null);
    try {
      setPrefs((await api.savePrefs(next)).prefs);
      setSaved('Saved.');
      onChanged();
    } catch (err) {
      setError((err as Error).message);
    }
  };
  const toggle = (id: number) => save({ ...prefs, platforms: prefs.platforms.includes(id) ? prefs.platforms.filter((p) => p !== id) : [...prefs.platforms, id] });

  return (
    <>
      {error && <Alert kind="error">{error}</Alert>}
      {saved && !error && <Alert kind="success">{saved}</Alert>}
      <Card title="Adult games" hint="Whether Discover, Browse and search show games rated for adults.">
        {filters && <Toggle label="Show adult games" checked={filters.includeAdult} onChange={(v) => void apply({ ...filters, includeAdult: v })} />}
      </Card>
      <Card title="Platforms you play on" hint="A game’s page lists these first, in the order you pick them.">
        <div className="chip-list">
          {platforms.map((p) => {
            const at = prefs.platforms.indexOf(p.id);
            return (
              <button key={p.id} type="button" className={at >= 0 ? 'chip on' : 'chip'} aria-pressed={at >= 0} onClick={() => void toggle(p.id)}>
                {at >= 0 && <span className="chip-n">{at + 1}</span>}
                {p.name}
              </button>
            );
          })}
        </div>
      </Card>
      <Card title="Region" hint="Picked for you when you choose a version of a game. A plain Request still takes any region, the preferred one first.">
        <label className="field">
          Preferred region
          <select className="select" value={prefs.region} onChange={(e) => void save({ ...prefs, region: e.target.value })}>
            <option value="">No preference</option>
            {REGIONS.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
        </label>
      </Card>
    </>
  );
}

function RecommendationsTab() {
  const [taste, setTaste] = useState<{ liked: TasteItem[]; dismissed: TasteItem[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    api
      .taste()
      .then(setTaste)
      .catch((err: Error) => setError(err.message));
  }, []);
  const unlike = async (g: TasteItem) => {
    setTaste((t) => t && { ...t, liked: t.liked.filter((x) => x.igdbId !== g.igdbId) });
    await api.like(g.igdbId, false, g.title).catch((err: Error) => setError(err.message));
  };
  const undismiss = async (g: TasteItem) => {
    setTaste((t) => t && { ...t, dismissed: t.dismissed.filter((x) => x.igdbId !== g.igdbId) });
    await api.dismiss(g.igdbId, false).catch((err: Error) => setError(err.message));
  };
  const list = (items: TasteItem[], action: string, run: (g: TasteItem) => void, empty: string) =>
    items.length === 0 ? (
      <p className="muted">{empty}</p>
    ) : (
      <ul className="taste-list">
        {items.map((g) => (
          <li key={g.igdbId}>
            <a href={`#/game/${g.igdbId}`}>{g.title || `Game ${g.igdbId}`}</a>
            <button type="button" className="btn ghost sm" onClick={() => run(g)}>
              {action}
            </button>
          </li>
        ))}
      </ul>
    );
  return (
    <>
      {error && <Alert kind="error">{error}</Alert>}
      {!taste && !error && <p className="muted">Loading…</p>}
      {taste && (
        <>
          <Card title={`Liked (${taste.liked.length})`} hint="Recommendations start from these, and from what you request and play.">
            {list(taste.liked, 'Unlike', (g) => void unlike(g), 'Nothing liked yet. Use Like on a game’s page.')}
          </Card>
          <Card title={`Not interested (${taste.dismissed.length})`} hint="Never recommended to you. Undo to see them again.">
            {list(taste.dismissed, 'Interested again', (g) => void undismiss(g), 'Nothing hidden.')}
          </Card>
        </>
      )}
    </>
  );
}

// ---------- the server's (admins) ----------

const LABELS: Record<SettingKey, { label: string; hint: string; placeholder?: string }> = {
  publicUrl: { label: 'Public address', hint: 'The address people open g-seekr at. Changes from other origins are refused when it is set.', placeholder: 'https://games.example' },
  rommUrl: { label: 'RomM address for people', hint: 'Where “Play in RomM” sends people.', placeholder: 'https://romm.example' },
  rommApiUrl: { label: 'RomM address for g-seekr', hint: 'Where g-seekr reaches RomM’s API, for linked accounts. Empty turns linking off.', placeholder: 'https://romm.internal' },
  sessionDays: { label: 'Stay signed in for (days)', hint: 'New sign-ins only.' },
  requestLimit: { label: 'Requests per user', hint: 'The default for users without a limit of their own (Users). 0 = no limit. Admins have none.' },
  requestLimitDays: { label: 'Per this many days', hint: 'The window the limit counts over.' },
  jellyfinAdminsAreAdmins: { label: 'Jellyfin admins are admins here', hint: 'Off: only users made admins in Users are (the first admin to sign in always is).' },
  discordWebhookUrl: { label: 'Discord webhook', hint: 'New requests, approvals, ready games and failures go to this channel. Empty turns them off.', placeholder: 'https://discord.com/api/webhooks/…' },
};

const SOURCE: Record<SettingView['source'], string> = { saved: 'changed here', env: 'from the server’s environment', default: 'default' };

function ServerTab({ tab, onChanged }: { tab: 'general' | 'requests' | 'notifications' | 'connections'; onChanged: () => void }) {
  const [data, setData] = useState<AdminSettings | null>(null);
  const [draft, setDraft] = useState<Partial<Record<SettingKey, string | number | boolean>>>({});
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [tests, setTests] = useState<Record<string, { ok: boolean; message: string } | 'running'>>({});

  useEffect(() => {
    api
      .adminSettings()
      .then(setData)
      .catch((err: Error) => setError(err.message));
  }, []);

  const save = async (patch: Partial<Record<SettingKey, string | number | boolean | null>>, done: string) => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      setData(await api.saveAdminSettings(patch));
      setDraft((d) => Object.fromEntries(Object.entries(d).filter(([k]) => !(k in patch))));
      setNotice(done);
      onChanged();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const test = async (what: 'jellyfin' | 'retroarr' | 'romm' | 'discord') => {
    setTests((t) => ({ ...t, [what]: 'running' }));
    try {
      const result = await api.testConnection(what);
      setTests((t) => ({ ...t, [what]: result }));
    } catch (err) {
      setTests((t) => ({ ...t, [what]: { ok: false, message: (err as Error).message } }));
    }
  };

  const TestButton = ({ what }: { what: 'jellyfin' | 'retroarr' | 'romm' | 'discord' }) => {
    const r = tests[what];
    return (
      <span className="settings-test">
        <button type="button" className="btn sm" onClick={() => void test(what)} disabled={r === 'running'}>
          {r === 'running' ? 'Testing…' : 'Test'}
        </button>
        {r && r !== 'running' && (
          <span className={r.ok ? 'test-ok' : 'test-failed'} role="status">
            {r.ok ? '✓ ' : '✗ '}
            {r.message}
          </span>
        )}
      </span>
    );
  };

  if (error && !data) return <Alert kind="error">{error}</Alert>;
  if (!data) return <p className="muted">Loading…</p>;

  const fields = data.settings.filter((s) => s.group === tab);
  const dirty = fields.some((s) => s.key in draft);

  const field = (s: SettingView) => {
    const meta = LABELS[s.key];
    const id = `setting-${s.key}`;
    const value = s.key in draft ? draft[s.key] : s.value;
    return (
      <div key={s.key} className="setting">
        {s.kind === 'bool' ? (
          <Toggle label={meta.label} checked={Boolean(value)} onChange={(v) => setDraft({ ...draft, [s.key]: v })} disabled={busy} />
        ) : (
          <label className="field" htmlFor={id}>
            {meta.label}
            <input
              id={id}
              className="input"
              type={s.kind === 'int' ? 'number' : s.kind === 'secret-url' ? 'password' : 'url'}
              autoComplete="off"
              min={s.min}
              max={s.max}
              value={value === null || value === undefined ? '' : String(value)}
              placeholder={s.kind === 'secret-url' && s.set ? 'Set (hidden). Enter a new one to replace it.' : meta.placeholder}
              onChange={(e) => setDraft({ ...draft, [s.key]: s.kind === 'int' ? e.target.value : e.target.value })}
              disabled={busy}
            />
          </label>
        )}
        <p className="hint">
          {meta.hint} <span className={`source ${s.source}`}>({SOURCE[s.source]})</span>
          {s.source === 'saved' && (
            <button type="button" className="link" onClick={() => void save({ [s.key]: null }, `${meta.label} is back to the environment’s value.`)} disabled={busy}>
              Reset
            </button>
          )}
          {s.kind === 'secret-url' && s.set && (
            <button type="button" className="link" onClick={() => void save({ [s.key]: '' }, `${meta.label} turned off.`)} disabled={busy}>
              Turn off
            </button>
          )}
        </p>
      </div>
    );
  };

  const c = data.connections;
  return (
    <>
      {error && <Alert kind="error">{error}</Alert>}
      {notice && !error && <Alert kind="success">{notice}</Alert>}
      {tab === 'connections' ? (
        <>
          <Card title="Connections" hint="Set in the server’s environment (homelab-iac), with the secrets. Test checks each one now.">
            <dl className="settings-facts">
              <dt>Jellyfin</dt>
              <dd>
                <code>{c.jellyfinUrl}</code> <TestButton what="jellyfin" />
              </dd>
              <dt>RetroArr</dt>
              <dd>
                <code>{c.retroarrUrl}</code> · token {c.retroarrToken ? 'set' : 'missing'} <TestButton what="retroarr" />
              </dd>
              <dt>RetroArr webhooks</dt>
              <dd>{c.retroarrWebhookToken ? 'On: RetroArr tells g-seekr as soon as something changes' : 'Off: requests are followed every few minutes instead'}</dd>
              <dt>RomM</dt>
              <dd>
                {c.rommApiUrl ? <code>{c.rommApiUrl}</code> : <span className="muted">not set (General)</span>} <TestButton what="romm" />
              </dd>
              <dt>IGDB</dt>
              <dd>{c.igdb ? 'g-seekr’s own IGDB app is set' : 'Through RetroArr'}</dd>
            </dl>
          </Card>
        </>
      ) : (
        <Card title={{ general: 'General', requests: 'Requests', notifications: 'Notifications' }[tab]}>
          {fields.map(field)}
          <div className="settings-actions">
            <button
              type="button"
              className="btn primary"
              disabled={!dirty || busy}
              onClick={() => {
                const patch: Partial<Record<SettingKey, string | number | boolean>> = {};
                for (const s of fields) if (s.key in draft) patch[s.key] = draft[s.key]!;
                void save(patch, 'Saved. It applies at once.');
              }}
            >
              {busy ? 'Saving…' : 'Save'}
            </button>
            {dirty && (
              <button type="button" className="btn ghost" onClick={() => setDraft({})} disabled={busy}>
                Undo changes
              </button>
            )}
            {tab === 'notifications' && <TestButton what="discord" />}
          </div>
        </Card>
      )}
    </>
  );
}
