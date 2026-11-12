import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { api, STATUS_LABEL, type Me, type Platform, type SearchResult } from '../api';
import { Cover } from './shared';

export function Search({ me, onRequested }: { me: Me; onRequested: () => void }) {
  const [platforms, setPlatforms] = useState<Platform[]>([]);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, setPending] = useState<string | null>(null);

  useEffect(() => {
    api.platforms().then(setPlatforms).catch((err: Error) => setError(err.message));
  }, []);
  const byId = useMemo(() => new Map(platforms.map((p) => [p.id, p])), [platforms]);

  const search = async (e?: FormEvent) => {
    e?.preventDefault();
    if (query.trim().length < 2) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      setResults((await api.search(query.trim())).results);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const request = async (game: SearchResult, platformId: number) => {
    const key = `${game.igdbId}:${platformId}`;
    setPending(key);
    setError(null);
    setNotice(null);
    try {
      const { request } = await api.request(game.igdbId, platformId);
      setNotice(`Requested ${request.title} for ${request.platformName}. Status: ${STATUS_LABEL[request.status]}.`);
      setResults((prev) =>
        prev?.map((g) => (g.igdbId === game.igdbId ? { ...g, requests: [...g.requests, { id: request.id, platformId, status: request.status }] } : g)) ?? null,
      );
      onRequested();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setPending(null);
    }
  };

  const { limit, used, days } = me.limits;

  return (
    <section>
      <form className="searchbar" onSubmit={search} role="search">
        <input type="search" placeholder="Search for a game…" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Game title" />
        <button type="submit" className="primary" disabled={busy || query.trim().length < 2}>
          {busy ? 'Searching…' : 'Search'}
        </button>
      </form>
      {limit > 0 && (
        <p className="muted small">
          {used} of {limit} requests used in the last {days} days.
        </p>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {notice && (
        <p className="notice" role="status">
          {notice}
        </p>
      )}
      {results && results.length === 0 && <p className="muted">No games found.</p>}
      <ul className="results">
        {results?.map((game) => (
          <li key={game.igdbId} className="card result">
            <Cover url={game.coverUrl} title={game.title} />
            <div className="body">
              <h3>
                {game.title} {game.year && <span className="muted">({game.year})</span>}
              </h3>
              {game.owned && <span className="badge available">In the library</span>}
              {game.overview && <p className="overview">{game.overview}</p>}
              <div className="platforms">
                {game.platformIds.length === 0 && <span className="muted small">Not available for any requestable platform.</span>}
                {game.platformIds.map((pid) => {
                  const platform = byId.get(pid);
                  if (!platform) return null;
                  const open = game.requests.find((r) => r.platformId === pid);
                  if (open) {
                    return (
                      <span key={pid} className={`badge ${open.status}`}>
                        {platform.name}: {STATUS_LABEL[open.status]}
                      </span>
                    );
                  }
                  const key = `${game.igdbId}:${pid}`;
                  return (
                    <button key={pid} type="button" onClick={() => request(game, pid)} disabled={pending !== null}>
                      {pending === key ? 'Requesting…' : `Request for ${platform.name}`}
                    </button>
                  );
                })}
              </div>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
