import { useEffect, useState } from 'react';
import { api, type GameCard, type ListKind, type Platform, type SortKind } from '../api';
import { FilterButton, FilterPanel, useFilters } from './Filters';
import { Alert } from './shared';
import { TitleCard } from './Titles';

const SORTS: { id: SortKind; label: string }[] = [
  { id: 'popular', label: 'Most popular' },
  { id: 'rating', label: 'Top rated' },
  { id: 'newest', label: 'Newest' },
  { id: 'name', label: 'Title A–Z' },
];

const TITLES: Record<ListKind, string> = { popular: 'Popular right now', top: 'Top rated', browse: 'Browse games' };

// Browse (a list with filters and a sort) and search (a query with filters) share one page, like Seerr's
export function GameGrid({ query, list = 'browse', sort: initialSort, platformId }: { query?: string; list?: ListKind; sort?: SortKind; platformId?: number }) {
  const searching = query !== undefined;
  const q = (query ?? '').trim();
  const { filters, apply } = useFilters();
  const [platforms, setPlatforms] = useState<Platform[]>([]);
  const [sort, setSort] = useState<SortKind>(initialSort ?? (list === 'top' ? 'rating' : 'popular'));
  const [games, setGames] = useState<GameCard[] | null>(null);
  const [page, setPage] = useState(1);
  const [more, setMore] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [panel, setPanel] = useState(false);

  useEffect(() => {
    api.platforms().then(setPlatforms).catch(() => undefined);
  }, []);
  useEffect(() => setSort(initialSort ?? (list === 'top' ? 'rating' : 'popular')), [initialSort, list]);

  // A new query, sort or set of filters starts again from page 1
  useEffect(() => {
    if (!filters || (searching && q.length < 2)) {
      setGames(null);
      return;
    }
    let cancelled = false;
    setBusy(true);
    setError(null);
    api
      .discover({ list: searching ? 'browse' : list, sort, query: searching ? q : undefined, page: 1, platformId, filters })
      .then((r) => {
        if (cancelled) return;
        setGames(r.games);
        setPage(1);
        setMore(r.more);
      })
      .catch((err: Error) => !cancelled && setError(err.message))
      .finally(() => !cancelled && setBusy(false));
    return () => {
      cancelled = true;
    };
  }, [filters, sort, q, searching, list, platformId]);

  const loadMore = async () => {
    if (!filters) return;
    setBusy(true);
    try {
      const r = await api.discover({ list: searching ? 'browse' : list, sort, query: searching ? q : undefined, page: page + 1, platformId, filters });
      setGames((prev) => [...(prev ?? []), ...r.games.filter((g) => !prev?.some((p) => p.igdbId === g.igdbId))]);
      setPage(r.page);
      setMore(r.more);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const platformName = platformId ? platforms.find((p) => p.id === platformId)?.name : null;
  const title = searching ? (q.length >= 2 ? `Search results for “${q}”` : 'Search') : platformName ? `${list === 'top' ? 'Top rated' : 'Popular'} on ${platformName}` : TITLES[list];

  return (
    <>
      <div className="page-title">
        <h1>{title}</h1>
        <div className="tools">
          {!searching && list === 'browse' && (
            <>
              <label className="sr-only" htmlFor="grid-sort">
                Sort
              </label>
              <select id="grid-sort" className="select" value={sort} onChange={(e) => setSort(e.target.value as SortKind)}>
                {SORTS.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.label}
                  </option>
                ))}
              </select>
            </>
          )}
          <FilterButton filters={filters} onClick={() => setPanel(true)} />
        </div>
      </div>
      {error && <Alert kind="error">{error}</Alert>}
      {searching && q.length < 2 && <p className="empty">Type at least two letters in the search bar above.</p>}
      {busy && !games && (
        <div className="grid" aria-busy="true">
          {Array.from({ length: 18 }, (_, i) => (
            <span key={i} className="title-card skeleton" aria-hidden="true" />
          ))}
        </div>
      )}
      {games && games.length === 0 && !busy && <p className="empty">No games match{searching ? ' this search' : ''} with these filters.</p>}
      {games && games.length > 0 && (
        <>
          <div className="grid" aria-busy={busy}>
            {games.map((g) => (
              <TitleCard key={g.igdbId} game={g} />
            ))}
          </div>
          {more && (
            <div className="more">
              <button type="button" className="btn" onClick={loadMore} disabled={busy}>
                {busy ? 'Loading…' : 'Load more'}
              </button>
            </div>
          )}
        </>
      )}
      {panel && filters && <FilterPanel filters={filters} platforms={platforms} onApply={(f) => void apply(f)} onClose={() => setPanel(false)} />}
    </>
  );
}

export function Search({ query }: { query: string }) {
  return <GameGrid query={query} />;
}
