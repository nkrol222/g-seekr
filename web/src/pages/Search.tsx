import { useEffect, useMemo, useState } from 'react';
import { api, type Platform, type SearchResult } from '../api';
import { Alert } from './shared';
import { GameModal, TitleCard } from './Titles';

export function Search({ query, onRequested }: { query: string; onRequested: () => void }) {
  const [platforms, setPlatforms] = useState<Platform[]>([]);
  const [results, setResults] = useState<SearchResult[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<number | null>(null);

  useEffect(() => {
    api.platforms().then(setPlatforms).catch((err: Error) => setError(err.message));
  }, []);
  const byId = useMemo(() => new Map(platforms.map((p) => [p.id, p])), [platforms]);

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setResults(null);
      return;
    }
    let cancelled = false;
    setBusy(true);
    setError(null);
    api
      .search(q)
      .then((r) => !cancelled && setResults(r.results))
      .catch((err: Error) => !cancelled && setError(err.message))
      .finally(() => !cancelled && setBusy(false));
    return () => {
      cancelled = true;
    };
  }, [query]);

  const game = results?.find((g) => g.igdbId === open) ?? null;

  return (
    <>
      <div className="page-title">
        <h1>{query.trim().length >= 2 ? `Search results for “${query.trim()}”` : 'Search'}</h1>
      </div>
      {error && <Alert kind="error">{error}</Alert>}
      {query.trim().length < 2 && <p className="empty">Type at least two letters in the search bar above.</p>}
      {busy && !results && <p className="empty">Searching…</p>}
      {results && results.length === 0 && !busy && <p className="empty">No games found.</p>}
      {results && results.length > 0 && (
        <div className="grid" aria-busy={busy}>
          {results.map((g) => (
            <TitleCard key={g.igdbId} game={g} onOpen={() => setOpen(g.igdbId)} />
          ))}
        </div>
      )}
      {game && (
        <GameModal
          game={game}
          platforms={byId}
          onClose={() => setOpen(null)}
          onRequested={(g, r) => {
            setResults((prev) => prev?.map((x) => (x.igdbId === g.igdbId ? { ...x, requests: [...x.requests, r] } : x)) ?? null);
            onRequested();
          }}
        />
      )}
    </>
  );
}
