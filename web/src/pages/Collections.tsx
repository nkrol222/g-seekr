import { useEffect, useState, type FormEvent } from 'react';
import {
  api,
  STATUS_LABEL,
  type CollectionCard,
  type CollectionGame,
  type CollectionKind,
  type CollectionPage,
  type CollectionRows,
  type Me,
  type RequestMissingResult,
  type RequestStatus,
  type SearchResult,
} from '../api';
import { Alert, Icon, Poster, StatusBadge } from './shared';

// Up to four covers in a square; covers that don't load drop out, and with none left the name shows instead
function Mosaic({ covers, name }: { covers: string[]; name: string }) {
  const [failed, setFailed] = useState<Set<string>>(new Set());
  const shown = covers.filter((c) => !failed.has(c)).slice(0, 4);
  return (
    <span className={`mosaic n${shown.length}`} aria-hidden="true">
      {shown.length === 0 ? (
        <span className="ph">{name}</span>
      ) : (
        shown.map((c) => <img key={c} src={c} alt="" loading="lazy" referrerPolicy="no-referrer" onError={() => setFailed((f) => new Set(f).add(c))} />)
      )}
    </span>
  );
}

const collectionHref = (kind: CollectionKind, id: number, platformId?: number) => `#/collection/${kind}/${id}${platformId ? `?platform=${platformId}` : ''}`;

// A collection's poster: up to four covers, its name and how much of it the library has
export function CollectionTile({ card }: { card: CollectionCard }) {
  const pct = card.total ? Math.round((card.inLibrary / card.total) * 100) : 0;
  return (
    <a className="collection-tile" href={collectionHref(card.kind, card.id)} aria-label={`${card.name}: ${card.inLibrary} of ${card.total} in the library`}>
      <Mosaic covers={card.covers} name={card.name} />
      <span className="collection-caption">
        <strong>{card.name}</strong>
        <span className="muted small">
          {card.kind === 'series' ? 'Series' : 'List'} · {card.inLibrary} of {card.total}
        </span>
        <span className="meter" aria-hidden="true">
          <span style={{ width: `${pct}%` }} />
        </span>
      </span>
    </a>
  );
}

export function CollectionRow({ title, cards, link }: { title: string; cards: CollectionCard[]; link?: string }) {
  if (cards.length === 0) return null;
  return (
    <section className="slider">
      <div className="slider-head">
        <h2>{title}</h2>
        {link && (
          <a href={link}>
            View all <span aria-hidden="true">→</span>
          </a>
        )}
      </div>
      <div className="slider-track collection-track">
        {cards.map((c) => (
          <CollectionTile key={`${c.kind}-${c.id}`} card={c} />
        ))}
      </div>
    </section>
  );
}

export function useCollectionRows(): { rows: CollectionRows | null; error: string | null } {
  const [rows, setRows] = useState<CollectionRows | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    api
      .collections()
      .then(setRows)
      .catch((err: Error) => setError(err.message));
  }, []);
  return { rows, error };
}

// The Collections page: featured and popular series and lists, the user's own in progress, every list, and a
// search for any IGDB series
export function Collections({ me }: { me: Me }) {
  const { rows, error } = useCollectionRows();
  const [query, setQuery] = useState('');
  const [found, setFound] = useState<{ id: number; name: string; gameCount: number }[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const search = async (e: FormEvent) => {
    e.preventDefault();
    if (query.trim().length < 2) return;
    setSearching(true);
    setSearchError(null);
    try {
      setFound((await api.searchSeries(query.trim())).series);
    } catch (err) {
      setSearchError((err as Error).message);
    } finally {
      setSearching(false);
    }
  };

  return (
    <>
      <div className="page-title">
        <h1>Collections</h1>
        {me.user.isAdmin && (
          <div className="tools">
            <button type="button" className="btn" onClick={() => setCreating(true)}>
              <Icon name="plus" /> New list
            </button>
            <a className="btn" href="#/collections/import">
              <Icon name="upload" /> Import a list
            </a>
          </div>
        )}
      </div>
      <p className="lead muted">
        A series from IGDB, or a list put together here. Pick a platform on a collection to see what the library has, and request the rest in one go.
      </p>

      <form className="series-search" role="search" onSubmit={search}>
        <label className="sr-only" htmlFor="series-q">
          Find a series
        </label>
        <input id="series-q" className="input" type="search" placeholder="Find a series: Final Fantasy, Mega Man, Zelda…" value={query} onChange={(e) => setQuery(e.target.value)} />
        <button type="submit" className="btn primary" disabled={searching || query.trim().length < 2}>
          <Icon name="search" /> {searching ? 'Searching…' : 'Search'}
        </button>
      </form>
      {searchError && <Alert kind="error">{searchError}</Alert>}
      {found && (
        <section className="slider">
          <div className="slider-head">
            <h2>Series matching “{query.trim()}”</h2>
          </div>
          {found.length === 0 ? (
            <p className="muted small">No series by that name on IGDB.</p>
          ) : (
            <ul className="series-results">
              {found.map((s) => (
                <li key={s.id}>
                  <a href={collectionHref('series', s.id)}>
                    <Icon name="stack" /> <strong>{s.name}</strong> <span className="muted small">{s.gameCount} games</span>
                  </a>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {error && <Alert kind="error">{error}</Alert>}
      {!rows && !error && (
        <div className="slider-track collection-track" aria-busy="true">
          {Array.from({ length: 6 }, (_, i) => (
            <span key={i} className="collection-tile skeleton" aria-hidden="true" />
          ))}
        </div>
      )}
      {rows && (
        <>
          <CollectionRow title="Featured" cards={rows.featured} />
          <CollectionRow title="Collections in progress" cards={rows.inProgress} />
          <CollectionRow title="Popular collections" cards={rows.popular} />
          <section className="slider">
            <div className="slider-head">
              <h2>Lists</h2>
            </div>
            {rows.lists.length === 0 ? (
              <p className="muted small">{me.user.isAdmin ? 'No lists yet. Make one, or import one from a DAT file, an Internet Archive item or a list of titles.' : 'No lists yet.'}</p>
            ) : (
              <div className="collection-grid">
                {rows.lists.map((c) => (
                  <CollectionTile key={c.id} card={c} />
                ))}
              </div>
            )}
          </section>
          {rows.featured.length + rows.popular.length + rows.inProgress.length === 0 && (
            <p className="muted small">
              Series show up here once people request a few games from them. Open a game’s page and follow its series to see the whole collection.
            </p>
          )}
        </>
      )}
      {creating && (
        <ListDialog
          onClose={() => setCreating(false)}
          onSave={async (name, description) => {
            const { list } = await api.createList(name, description);
            window.location.hash = collectionHref('list', list.id);
          }}
        />
      )}
    </>
  );
}

function ListDialog({
  initial,
  onClose,
  onSave,
}: {
  initial?: { name: string; description: string | null };
  onClose: () => void;
  onSave: (name: string, description: string) => Promise<void>;
}) {
  const [name, setName] = useState(initial?.name ?? '');
  const [description, setDescription] = useState(initial?.description ?? '');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await onSave(name.trim(), description.trim());
      onClose();
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  };
  return (
    <div className="modal-back" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <form className="modal dialog" role="dialog" aria-modal="true" aria-labelledby="list-title" onSubmit={submit}>
        <button type="button" className="btn ghost close" onClick={onClose} aria-label="Close">
          <Icon name="close" />
        </button>
        <div className="dialog-body">
          <h2 id="list-title">{initial ? 'Edit the list' : 'New list'}</h2>
          {error && <Alert kind="error">{error}</Alert>}
          <label className="field">
            Name
            <input className="input" value={name} maxLength={120} required autoFocus onChange={(e) => setName(e.target.value)} />
          </label>
          <label className="field">
            Description <span className="muted small">(optional)</span>
            <textarea className="input" rows={3} maxLength={1000} value={description} onChange={(e) => setDescription(e.target.value)} />
          </label>
          <div className="dialog-actions">
            <button type="button" className="btn" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="btn primary" disabled={busy || !name.trim()}>
              {busy ? 'Saving…' : 'Save'}
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}

type GameState = { kind: 'library' } | { kind: 'requested'; status: RequestStatus } | { kind: 'missing' } | { kind: 'elsewhere' };

function stateOn(game: CollectionGame, platformId: number): GameState {
  if (!game.platformIds.includes(platformId)) return { kind: 'elsewhere' };
  if (game.inLibrary.includes(platformId)) return { kind: 'library' };
  const r = game.requests.find((x) => x.platformId === platformId);
  return r ? { kind: 'requested', status: r.status } : { kind: 'missing' };
}

// A collection: a platform switcher, what the library has on it, and Request missing for the rest. Games that
// aren't on the platform are greyed out.
export function CollectionView({ kind, id, me, platformParam, onRequested }: { kind: CollectionKind; id: number; me: Me; platformParam: number | null; onRequested: () => void }) {
  const [page, setPage] = useState<CollectionPage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [platformId, setPlatformId] = useState<number | null>(platformParam);
  const [confirm, setConfirm] = useState(false);
  const [result, setResult] = useState<RequestMissingResult | null>(null);
  const [editing, setEditing] = useState(false);
  const [adding, setAdding] = useState(false);
  const admin = me.user.isAdmin;

  const load = async () => {
    try {
      const p = await api.collection(kind, id);
      setPage(p);
      setPlatformId((cur) => (cur && p.platforms.some((x) => x.id === cur) ? cur : (p.platforms[0]?.id ?? null)));
    } catch (err) {
      setError((err as Error).message);
    }
  };

  useEffect(() => {
    setPage(null);
    setError(null);
    setResult(null);
    window.scrollTo(0, 0);
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind, id]);

  const pickPlatform = (pid: number) => {
    setPlatformId(pid);
    setResult(null);
    // Keep the choice in the address, so a shared link or a reload opens the same platform
    window.history.replaceState(null, '', collectionHref(kind, id, pid));
  };

  if (error && !page) return <Alert kind="error">{error}</Alert>;
  if (!page) {
    return (
      <div className="collection-page" aria-busy="true">
        <div className="collection-head skeleton" />
        <div className="grid">
          {Array.from({ length: 12 }, (_, i) => (
            <span key={i} className="title-card skeleton" aria-hidden="true" />
          ))}
        </div>
      </div>
    );
  }

  const platform = page.platforms.find((p) => p.id === platformId) ?? null;
  const games = platform
    ? [...page.games].sort((a, b) => Number(!a.platformIds.includes(platform.id)) - Number(!b.platformIds.includes(platform.id)))
    : page.games;
  const missing = platform ? page.games.filter((g) => stateOn(g, platform.id).kind === 'missing') : [];
  const left = me.limits.limit > 0 ? Math.max(0, me.limits.limit - me.limits.used) : null;
  const covers = page.games.map((g) => g.coverUrl).filter((c): c is string => !!c);

  const featured = async () => {
    try {
      if (kind === 'series') await api.featureSeries(id, page.name, !page.featured);
      else await api.updateList(id, { featured: !page.featured });
      setPage({ ...page, featured: !page.featured });
    } catch (err) {
      setError((err as Error).message);
    }
  };

  return (
    <article className="collection-page">
      <header className="collection-head">
        <Mosaic covers={covers} name={page.name} />
        <div className="collection-info">
          <span className="muted small">
            {kind === 'series' ? 'Series' : 'List'}
            {page.source ? ` · ${page.source}` : ''} · {page.games.length} games
          </span>
          <h1>{page.name}</h1>
          {page.description && <p className="muted">{page.description}</p>}
          {page.platforms.length === 0 ? (
            <p className="muted">None of its games are on a platform that can be requested here.</p>
          ) : (
            <>
              <div className="chips platform-switch" role="radiogroup" aria-label="Platform">
                {page.platforms.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    role="radio"
                    aria-checked={p.id === platformId}
                    className={p.id === platformId ? 'chip on' : 'chip'}
                    onClick={() => pickPlatform(p.id)}
                  >
                    {p.name} <span className="chip-count">{p.inLibrary}/{p.total}</span>
                  </button>
                ))}
              </div>
              {platform && (
                <div className="collection-progress">
                  <span className="meter" aria-hidden="true">
                    <span style={{ width: `${platform.total ? (platform.inLibrary / platform.total) * 100 : 0}%` }} />
                  </span>
                  <span>
                    <strong>
                      {platform.inLibrary} of {platform.total}
                    </strong>{' '}
                    on {platform.name} in the library
                  </span>
                </div>
              )}
            </>
          )}
          <div className="game-actions">
            {platform && (
              <button type="button" className="btn primary" disabled={missing.length === 0} onClick={() => setConfirm(true)}>
                <Icon name="download" /> {missing.length === 0 ? 'Nothing missing' : `Request ${missing.length} missing`}
              </button>
            )}
            {admin && (
              <button type="button" className={page.featured ? 'btn on' : 'btn'} aria-pressed={page.featured} onClick={featured}>
                <Icon name="star" /> {page.featured ? 'Featured' : 'Feature on Discover'}
              </button>
            )}
            {admin && kind === 'list' && (
              <>
                <button type="button" className="btn" onClick={() => setAdding(true)}>
                  <Icon name="plus" /> Add a game
                </button>
                <a className="btn" href={`#/collections/import?list=${id}${platformId ? `&platform=${platformId}` : ''}`}>
                  <Icon name="upload" /> Import into it
                </a>
                <button type="button" className="btn" onClick={() => setEditing(true)}>
                  <Icon name="pencil" /> Edit
                </button>
                <button
                  type="button"
                  className="btn danger"
                  onClick={async () => {
                    if (!window.confirm(`Delete the list “${page.name}”? Requests made from it stay.`)) return;
                    await api.deleteList(id);
                    window.location.hash = '#/collections';
                  }}
                >
                  <Icon name="trash" /> Delete
                </button>
              </>
            )}
          </div>
        </div>
      </header>

      {error && <Alert kind="error">{error}</Alert>}
      {result && <MissingResult result={result} platform={platform?.name ?? ''} />}

      {page.games.length === 0 ? (
        <p className="empty">{admin && kind === 'list' ? 'This list is empty. Add games, or import a list into it.' : 'Nothing in this collection yet.'}</p>
      ) : (
        <div className="grid">
          {games.map((g) => (
            <CollectionGameCard
              key={g.igdbId}
              game={g}
              platform={platform}
              onRemove={
                admin && kind === 'list' && platform && g.platformIds.includes(platform.id)
                  ? async () => {
                      await api.removeFromList(id, g.igdbId, platform.id);
                      await load();
                    }
                  : undefined
              }
            />
          ))}
        </div>
      )}

      {confirm && platform && (
        <div className="modal-back" onMouseDown={(e) => e.target === e.currentTarget && setConfirm(false)}>
          <ConfirmMissing
            count={missing.length}
            platform={platform.name}
            left={left}
            autoApproved={me.user.isAdmin || me.user.autoApprove}
            onClose={() => setConfirm(false)}
            onConfirm={async () => {
              const r = await api.requestMissing(kind, id, platform.id);
              setResult(r);
              setConfirm(false);
              onRequested();
              await load();
            }}
          />
        </div>
      )}
      {editing && (
        <ListDialog
          initial={{ name: page.name, description: page.description }}
          onClose={() => setEditing(false)}
          onSave={async (name, description) => {
            await api.updateList(id, { name, description: description || null });
            await load();
          }}
        />
      )}
      {adding && <AddGameDialog listId={id} onClose={() => setAdding(false)} onAdded={load} />}
    </article>
  );
}

function ConfirmMissing({
  count,
  platform,
  left,
  autoApproved,
  onClose,
  onConfirm,
}: {
  count: number;
  platform: string;
  left: number | null;
  autoApproved: boolean;
  onClose: () => void;
  onConfirm: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="modal dialog" role="dialog" aria-modal="true" aria-labelledby="missing-title">
      <button type="button" className="btn ghost close" onClick={onClose} aria-label="Close">
        <Icon name="close" />
      </button>
      <div className="dialog-body">
        <h2 id="missing-title">
          Request {count} {count === 1 ? 'game' : 'games'} for {platform}?
        </h2>
        <p className="muted">
          One request per game the library doesn’t have and nobody has requested yet{autoApproved ? '; they go straight to RetroArr.' : ', each waiting for an admin’s approval.'}
        </p>
        {left !== null && (
          <Alert kind={left < count ? 'info' : 'success'}>
            {left < count
              ? `You have ${left} ${left === 1 ? 'request' : 'requests'} left, so only the first ${left} will be requested. The rest can be requested once your limit frees up.`
              : `This uses ${count} of your ${left} remaining requests.`}
          </Alert>
        )}
        {error && <Alert kind="error">{error}</Alert>}
        <div className="dialog-actions">
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="btn primary"
            disabled={busy || left === 0}
            onClick={async () => {
              setBusy(true);
              setError(null);
              try {
                await onConfirm();
              } catch (err) {
                setError((err as Error).message);
                setBusy(false);
              }
            }}
          >
            {busy ? 'Requesting…' : `Request ${left !== null ? Math.min(left, count) : count}`}
          </button>
        </div>
      </div>
    </div>
  );
}

function MissingResult({ result, platform }: { result: RequestMissingResult; platform: string }) {
  const n = result.requested.length;
  return (
    <Alert kind={n > 0 ? 'success' : 'info'}>
      <div>
        <strong>
          {n === 0 ? 'Nothing was requested.' : `Requested ${n} ${n === 1 ? 'game' : 'games'} for ${platform}.`}
        </strong>
        {result.limitReached && <> Your request limit stopped it; request the rest once it frees up.</>}
        {result.skipped.length > 0 && (
          <details>
            <summary>
              {result.skipped.length} not requested
            </summary>
            <ul>
              {result.skipped.map((s) => (
                <li key={s.igdbId}>
                  {s.title}: {s.reason}
                </li>
              ))}
            </ul>
          </details>
        )}
      </div>
    </Alert>
  );
}

function CollectionGameCard({ game, platform, onRemove }: { game: CollectionGame; platform: { id: number; name: string } | null; onRemove?: () => Promise<void> }) {
  const state: GameState = platform ? stateOn(game, platform.id) : { kind: 'elsewhere' };
  const label =
    state.kind === 'library' ? 'In the library' : state.kind === 'requested' ? STATUS_LABEL[state.status] : state.kind === 'missing' ? 'Missing' : `Not on ${platform?.name ?? 'a requestable platform'}`;
  const card = (
    <a className={state.kind === 'elsewhere' ? 'title-card off' : 'title-card'} href={`#/game/${game.igdbId}`} aria-label={`${game.title}${game.year ? ` (${game.year})` : ''}: ${label}`}>
      <Poster url={game.coverUrl} title={game.title} />
      {state.kind === 'elsewhere' && <span className="type">Not on {platform?.name}</span>}
      {state.kind === 'missing' && <span className="type missing">Missing</span>}
      {(state.kind === 'library' || state.kind === 'requested') && (
        <span className="status">
          <StatusBadge status={state.kind === 'library' ? 'available' : state.status} compact />
        </span>
      )}
      <span className="info">
        {game.year && <span className="year">{game.year}</span>}
        <h3>{game.title}</h3>
        <span className="cta">{label}</span>
      </span>
    </a>
  );
  if (!onRemove) return card;
  return (
    <div className="rec-card">
      {card}
      <button type="button" className="dismiss" title="Remove from the list" aria-label={`Remove ${game.title} from the list`} onClick={() => void onRemove()}>
        <Icon name="x" />
      </button>
    </div>
  );
}

// Find a game (IGDB through RetroArr) and add it to a list for one of its platforms
function AddGameDialog({ listId, onClose, onAdded }: { listId: number; onClose: () => void; onAdded: () => Promise<void> }) {
  const [q, setQ] = useState('');
  const [results, setResults] = useState<SearchResult[] | null>(null);
  const [platforms, setPlatforms] = useState<Map<number, string>>(new Map());
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    api
      .platforms()
      .then((list) => setPlatforms(new Map(list.map((p) => [p.id, p.name]))))
      .catch(() => undefined);
  }, []);

  const search = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      setResults((await api.search(q.trim())).results);
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const add = async (g: SearchResult, platformId: number) => {
    setError(null);
    try {
      const { added } = await api.addToList(listId, { igdbId: g.igdbId, title: g.title, year: g.year, coverUrl: g.coverUrl }, platformId);
      setNotice(added ? `Added ${g.title} for ${platforms.get(platformId)}.` : `${g.title} is already on the list for ${platforms.get(platformId)}.`);
      await onAdded();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  return (
    <div className="modal-back" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal dialog wide" role="dialog" aria-modal="true" aria-labelledby="add-title">
        <button type="button" className="btn ghost close" onClick={onClose} aria-label="Close">
          <Icon name="close" />
        </button>
        <div className="dialog-body">
          <h2 id="add-title">Add a game</h2>
          <form className="series-search" onSubmit={search}>
            <input className="input" type="search" placeholder="Game title" aria-label="Game title" value={q} autoFocus onChange={(e) => setQ(e.target.value)} />
            <button type="submit" className="btn primary" disabled={q.trim().length < 2}>
              <Icon name="search" /> Search
            </button>
          </form>
          {error && <Alert kind="error">{error}</Alert>}
          {notice && <Alert kind="success">{notice}</Alert>}
          {results && results.length === 0 && <p className="muted small">No games found.</p>}
          {results && results.length > 0 && (
            <ul className="pick-list">
              {results.map((g) => (
                <li key={g.igdbId}>
                  <span className="thumb">
                    <Poster url={g.coverUrl} title={g.title} />
                  </span>
                  <span className="pick-body">
                    <strong>{g.title}</strong> {g.year && <span className="muted">({g.year})</span>}
                    <span className="chips">
                      {g.platformIds.length === 0 ? (
                        <span className="muted small">Not on a platform that can be requested</span>
                      ) : (
                        g.platformIds.map((pid) => (
                          <button key={pid} type="button" className="chip" onClick={() => void add(g, pid)}>
                            <Icon name="plus" /> {platforms.get(pid) ?? `Platform ${pid}`}
                          </button>
                        ))
                      )}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
