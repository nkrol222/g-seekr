import { RequestError, type RequestService } from './requests.js';
import type { RetroArrClient, RetroArrDiscoverGame } from './retroarr.js';
import type { RequestStatus, Store, User } from './store.js';

// What a user narrows Discover, Browse and search with. Saved per user; adult games are off until they switch them on.
export interface Filters {
  platformIds: number[];
  genreIds: number[];
  themeIds: number[];
  gameModeIds: number[];
  yearFrom: number | null;
  yearTo: number | null;
  minRating: number | null;
  minRatingCount: number | null;
  includeAdult: boolean;
}

export const DEFAULT_FILTERS: Filters = {
  platformIds: [],
  genreIds: [],
  themeIds: [],
  gameModeIds: [],
  yearFrom: null,
  yearTo: null,
  minRating: null,
  minRatingCount: null,
  includeAdult: false,
};

export type ListKind = 'popular' | 'top' | 'browse';
export type SortKind = 'popular' | 'rating' | 'newest' | 'name';
const LISTS: ListKind[] = ['popular', 'top', 'browse'];
const SORTS: SortKind[] = ['popular', 'rating', 'newest', 'name'];
const PAGE = 30;

// A game as the web UI shows it: only the platforms it can be requested for, whether the library has it, and the
// open requests for it
export interface DiscoverCard {
  igdbId: number;
  title: string;
  year: number | null;
  overview: string | null;
  coverUrl: string | null;
  rating: number | null;
  ratingCount: number | null;
  genres: string[];
  owned: boolean;
  // The platforms the library has it on, and where it can be played: the game in RomM per platform
  inLibrary: number[];
  romm: { platformId: number; rommId: number }[];
  platformIds: number[];
  requests: { id: number; platformId: number; status: RequestStatus }[];
}

const ids = (v: unknown, max = 50): number[] =>
  Array.isArray(v) ? [...new Set(v.map(Number).filter((n) => Number.isInteger(n) && n > 0))].slice(0, max) : [];
const intOrNull = (v: unknown, min: number, max: number): number | null => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isInteger(n) && n >= min && n <= max ? n : null;
};

// Anything a client sends, made into valid filters
export function cleanFilters(raw: unknown): Filters {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  let yearFrom = intOrNull(r.yearFrom, 1950, 2100);
  let yearTo = intOrNull(r.yearTo, 1950, 2100);
  if (yearFrom !== null && yearTo !== null && yearFrom > yearTo) [yearFrom, yearTo] = [yearTo, yearFrom];
  return {
    platformIds: ids(r.platformIds),
    genreIds: ids(r.genreIds),
    themeIds: ids(r.themeIds),
    gameModeIds: ids(r.gameModeIds),
    yearFrom,
    yearTo,
    minRating: intOrNull(r.minRating, 0, 100),
    minRatingCount: intOrNull(r.minRatingCount, 0, 100_000),
    includeAdult: r.includeAdult === true,
  };
}

export class DiscoverService {
  constructor(
    private readonly store: Store,
    private readonly retroarr: RetroArrClient,
    private readonly requests: RequestService,
  ) {}

  filtersFor(user: User): Filters {
    const saved = this.store.userFilters(user.id);
    return saved === null ? { ...DEFAULT_FILTERS } : cleanFilters(saved);
  }

  saveFilters(user: User, raw: unknown): Filters {
    const filters = cleanFilters(raw);
    this.store.saveUserFilters(user.id, filters);
    return filters;
  }

  // A list or a search. Platforms: the filter's, within what can be requested, or every requestable one.
  async games(args: { list?: unknown; sort?: unknown; query?: unknown; page?: unknown; platformId?: unknown; filters?: unknown }): Promise<{ games: DiscoverCard[]; page: number; more: boolean }> {
    const list: ListKind = LISTS.includes(args.list as ListKind) ? (args.list as ListKind) : 'browse';
    const sort: SortKind = SORTS.includes(args.sort as SortKind) ? (args.sort as SortKind) : 'popular';
    const query = typeof args.query === 'string' ? args.query.trim() : '';
    if (query.length > 100) throw new RequestError('That search is too long.', 400, 'bad_query');
    const page = intOrNull(args.page, 1, 100) ?? 1;
    const filters = cleanFilters(args.filters);

    const requestable = (await this.requests.platforms()).map((p) => p.id);
    // A per-platform row narrows to one platform, the filters to theirs; neither can reach past what's requestable
    const wanted = intOrNull(args.platformId, 1, 1_000_000) !== null ? [Number(args.platformId)] : filters.platformIds;
    const platformIds = wanted.length > 0 ? wanted.filter((id) => requestable.includes(id)) : requestable;
    if (platformIds.length === 0) return { games: [], page, more: false };

    const games = await this.retroarr.discoverGames({
      list,
      sort,
      query: query || undefined,
      platformIds,
      genreIds: filters.genreIds,
      themeIds: filters.themeIds,
      gameModeIds: filters.gameModeIds,
      yearFrom: filters.yearFrom ?? undefined,
      yearTo: filters.yearTo ?? undefined,
      minRating: filters.minRating ?? undefined,
      minRatingCount: filters.minRatingCount ?? undefined,
      includeAdult: filters.includeAdult,
      offset: (page - 1) * PAGE,
      limit: PAGE,
    });
    return { games: await this.cards(games), page, more: games.length === PAGE };
  }

  // For the warm-up task: asks for Discover's rows (popular and top rated, then popular per platform) so RetroArr has
  // them from IGDB before anyone opens the page. One at a time, so IGDB's rate limit is kept. Returns how many loaded.
  async warm(): Promise<{ loaded: number; failed: number }> {
    const asks: Array<{ list: ListKind; platformId?: number }> = [{ list: 'popular' }, { list: 'top' }];
    for (const p of await this.requests.platforms()) asks.push({ list: 'popular', platformId: p.id });
    let loaded = 0;
    let failed = 0;
    for (const a of asks) {
      try {
        await this.games({ ...a, filters: { includeAdult: false } });
        loaded++;
      } catch {
        failed++;
      }
    }
    await this.recentlyAdded().catch(() => failed++);
    return { loaded, failed };
  }

  async recentlyAdded(): Promise<DiscoverCard[]> {
    return this.cards(await this.retroarr.recentlyAdded(20));
  }

  async game(igdbId: number, includeAdult: boolean) {
    const detail = await this.retroarr.discoverGame(igdbId, includeAdult);
    if (!detail) throw new RequestError('That game wasn’t found on IGDB.', 404, 'unknown_game');
    const all = await this.cards([detail.game, ...detail.similar, ...detail.series, ...detail.fromDeveloper]);
    const game = all[0]!;
    const similar = all.slice(1, 1 + detail.similar.length);
    const series = all.slice(1 + detail.similar.length, 1 + detail.similar.length + detail.series.length);
    const fromDeveloper = all.slice(1 + detail.similar.length + detail.series.length);
    const requestable = new Map((await this.requests.platforms()).map((p) => [p.id, p.name]));
    // Games that can't be requested anywhere here aren't worth a poster
    const askable = (list: DiscoverCard[]) => list.filter((g) => g.platformIds.length > 0);
    return {
      ...detail,
      game,
      similar: askable(similar),
      series: askable(series),
      fromDeveloper: askable(fromDeveloper),
      releases: detail.releases.map((r) => ({ ...r, requestable: r.platformId !== null && requestable.has(r.platformId) })),
    };
  }

  options() {
    return this.retroarr.discoverOptions();
  }

  private async cards(games: RetroArrDiscoverGame[]): Promise<DiscoverCard[]> {
    const requestable = new Set((await this.requests.platforms()).map((p) => p.id));
    const open = this.store.openRequestsForGames(games.map((g) => g.igdbId));
    return games.map((g) => ({
      igdbId: g.igdbId,
      title: g.title,
      year: g.year,
      overview: g.summary,
      coverUrl: g.coverUrl,
      rating: g.rating,
      ratingCount: g.ratingCount,
      genres: g.genres,
      owned: g.library.some((l) => l.status === 'Downloaded'),
      inLibrary: g.library.filter((l) => l.status === 'Downloaded').map((l) => l.platformId),
      romm: g.library.filter((l) => l.rommId !== null).map((l) => ({ platformId: l.platformId, rommId: l.rommId! })),
      platformIds: g.platformIds.filter((id) => requestable.has(id)),
      requests: open.filter((r) => r.igdbId === g.igdbId).map((r) => ({ id: r.id, platformId: r.platformId, status: r.status })),
    }));
  }
}
