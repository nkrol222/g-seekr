// The RetroArr endpoints a token with the "requests" scope may call.

export interface RetroArrPlatform {
  id: number;
  name: string;
  slug: string;
  category: string | null;
  enabled: boolean;
}

export interface RetroArrLookupGame {
  igdbId: number | null;
  title: string;
  year: number;
  overview: string | null;
  coverUrl: string | null;
  platformIds: number[];
  owned: boolean;
  // The full metadata object, sent back as is when the game is added
  raw: Record<string, unknown>;
}

export type RetroArrGameStatus = 'TBA' | 'Announced' | 'Released' | 'Downloading' | 'Downloaded' | 'Missing' | 'InstallerDetected' | 'Unknown';

export interface RetroArrGame {
  id: number;
  title: string;
  status: RetroArrGameStatus;
  monitored: boolean;
}

export interface RetroArrProgress {
  gameId: number;
  release: string;
  // 0-100
  progress: number;
  state: string;
  trackedState: string | null;
  statusMessages: string[];
}

export interface RetroArrReplaceResult {
  blocklisted: string | null;
  autoQueued: boolean;
  release: string | null;
  // Why nothing was grabbed
  skipped: string | null;
  error: string | null;
}

export interface DiscoverOption {
  id: number;
  name: string;
}

export interface RetroArrDiscoverGame {
  igdbId: number;
  title: string;
  year: number | null;
  coverUrl: string | null;
  summary: string | null;
  rating: number | null;
  ratingCount: number | null;
  genres: string[];
  platformIds: number[];
  // What RetroArr's library has of it, per platform
  // rommId: the game in RomM, once RetroArr's RomM sync has seen it there
  library: { gameId: number; platformId: number; status: RetroArrGameStatus; rommId: number | null }[];
}

export interface RetroArrDiscoverDetail {
  game: RetroArrDiscoverGame;
  storyline: string | null;
  backgroundUrl: string | null;
  screenshots: string[];
  videos: { name: string; youtubeId: string }[];
  themes: string[];
  gameModes: string[];
  developers: string[];
  publishers: string[];
  franchises: string[];
  releases: { platform: string; platformId: number | null; date: string | null }[];
  similar: RetroArrDiscoverGame[];
  // Other games of its series, and its main developer's other games (empty from an older RetroArr)
  series: RetroArrDiscoverGame[];
  developer: string | null;
  fromDeveloper: RetroArrDiscoverGame[];
  // Its series, to link to their collection pages
  seriesRefs: DiscoverOption[];
}

function toDiscoverGame(g: Record<string, unknown>): RetroArrDiscoverGame {
  const nums = (v: unknown) => (Array.isArray(v) ? v.filter((n): n is number => typeof n === 'number') : []);
  return {
    igdbId: Number(g.igdbId),
    title: String(g.title ?? ''),
    year: typeof g.year === 'number' ? g.year : null,
    coverUrl: typeof g.coverUrl === 'string' ? g.coverUrl : null,
    summary: typeof g.summary === 'string' ? g.summary : null,
    rating: typeof g.rating === 'number' ? g.rating : null,
    ratingCount: typeof g.ratingCount === 'number' ? g.ratingCount : null,
    genres: Array.isArray(g.genres) ? g.genres.filter((x): x is string => typeof x === 'string') : [],
    platformIds: nums(g.platformIds),
    library: (Array.isArray(g.library) ? g.library : []).map((l) => {
      const o = l as Record<string, unknown>;
      return { gameId: Number(o.gameId), platformId: Number(o.platformId), status: gameStatus(o.status), rommId: o.rommId == null ? null : Number(o.rommId) };
    }),
  };
}

export class RetroArrError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

const STATUSES: RetroArrGameStatus[] = ['TBA', 'Announced', 'Released', 'Downloading', 'Downloaded', 'Missing', 'InstallerDetected'];

// RetroArr sends the enum as a number on some endpoints and as a name on others
export function gameStatus(value: unknown): RetroArrGameStatus {
  if (typeof value === 'number') return STATUSES[value] ?? 'Unknown';
  if (typeof value === 'string') return STATUSES.find((s) => s.toLowerCase() === value.toLowerCase()) ?? 'Unknown';
  return 'Unknown';
}

function toLookupGame(g: Record<string, unknown>): RetroArrLookupGame {
  const images = (g.images ?? {}) as Record<string, unknown>;
  return {
    igdbId: typeof g.igdbId === 'number' ? g.igdbId : null,
    title: String(g.title ?? ''),
    year: typeof g.year === 'number' ? g.year : 0,
    overview: typeof g.overview === 'string' ? g.overview : null,
    coverUrl: typeof images.coverUrl === 'string' ? images.coverUrl : null,
    platformIds: Array.isArray(g.availablePlatformIds) ? g.availablePlatformIds.filter((n): n is number => typeof n === 'number') : [],
    owned: g.isOwned === true,
    raw: g,
  };
}

function toGame(g: Record<string, unknown>): RetroArrGame {
  return { id: Number(g.id), title: String(g.title ?? ''), status: gameStatus(g.status), monitored: g.monitored === true };
}

export class RetroArrClient {
  constructor(
    private readonly baseUrl: string,
    private readonly token: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  private async call<T>(method: string, path: string, body?: unknown, timeoutMs = 30_000): Promise<T> {
    let res: Response;
    try {
      res = await this.fetchImpl(`${this.baseUrl}/api/v3${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${this.token}`,
          Accept: 'application/json',
          ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (err) {
      throw new RetroArrError(`RetroArr is not reachable: ${(err as Error).message}`, 0);
    }
    if (!res.ok) {
      let message = `RetroArr answered ${res.status}`;
      try {
        const err = (await res.json()) as { message?: string; error?: string };
        message += `: ${err.message ?? err.error ?? ''}`.trimEnd();
      } catch {
        /* no JSON body */
      }
      throw new RetroArrError(message, res.status);
    }
    if (res.status === 204) return undefined as T;
    const text = await res.text();
    return (text ? JSON.parse(text) : undefined) as T;
  }

  async status(): Promise<{ version?: string }> {
    return this.call('GET', '/system/status');
  }

  async platforms(): Promise<RetroArrPlatform[]> {
    const list = await this.call<Array<Record<string, unknown>>>('GET', '/platform?enabledOnly=true');
    return list.map((p) => ({
      id: Number(p.id),
      name: String(p.name ?? ''),
      slug: String(p.slug ?? '').toLowerCase(),
      category: typeof p.category === 'string' ? p.category : null,
      enabled: p.enabled !== false,
    }));
  }

  async lookup(term: string): Promise<RetroArrLookupGame[]> {
    const res = await this.call<{ games?: Array<Record<string, unknown>> }>('GET', `/game/lookup?term=${encodeURIComponent(term)}`);
    return (res.games ?? []).map(toLookupGame);
  }

  async lookupIgdb(igdbId: number): Promise<RetroArrLookupGame | null> {
    try {
      return toLookupGame(await this.call<Record<string, unknown>>('GET', `/game/lookup/igdb/${igdbId}`));
    } catch (err) {
      if (err instanceof RetroArrError && err.status === 404) return null;
      throw err;
    }
  }

  async findByIgdb(igdbId: number, platformId: number): Promise<RetroArrGame[]> {
    const list = await this.call<Array<Record<string, unknown>>>('GET', `/game/by-igdb/${igdbId}?platformId=${platformId}`);
    return list.map(toGame);
  }

  async getGame(id: number): Promise<RetroArrGame | null> {
    try {
      return toGame(await this.call<Record<string, unknown>>('GET', `/game/${id}`));
    } catch (err) {
      if (err instanceof RetroArrError && err.status === 404) return null;
      throw err;
    }
  }

  async addGame(game: Record<string, unknown>): Promise<RetroArrGame> {
    return toGame(await this.call<Record<string, unknown>>('POST', '/game', game));
  }

  async setMonitored(id: number, monitored: boolean): Promise<void> {
    await this.call('PUT', `/games/${id}/monitored`, { monitored });
  }

  // What the download client is doing for these games: the release, how far along, RetroArr's view of it
  async progress(gameIds: number[]): Promise<RetroArrProgress[]> {
    if (gameIds.length === 0) return [];
    const list = await this.call<Array<Record<string, unknown>>>('GET', `/downloadclient/queue/games?ids=${gameIds.join(',')}`);
    return list.map((d) => ({
      gameId: Number(d.gameId),
      release: String(d.release ?? ''),
      progress: typeof d.progress === 'number' ? Math.max(0, Math.min(100, d.progress)) : 0,
      state: String(d.state ?? ''),
      trackedState: typeof d.trackedState === 'string' ? d.trackedState : null,
      statusMessages: Array.isArray(d.statusMessages) ? d.statusMessages.filter((m): m is string => typeof m === 'string').slice(0, 5) : [],
    }));
  }

  // Blocklists the game's release and grabs another that qualifies; its import replaces the old one. Can take a while.
  async replace(gameId: number, reason: string): Promise<RetroArrReplaceResult> {
    const r = await this.call<Record<string, unknown>>('POST', `/games/${gameId}/replace`, { reason }, 180_000);
    const text = (v: unknown) => (typeof v === 'string' && v.trim() ? v : null);
    return {
      blocklisted: text(r.blocklisted),
      autoQueued: r.autoQueued === true,
      release: text(r.autoQueuedRelease),
      skipped: text(r.autoDispatchSkipped),
      error: text(r.error),
    };
  }

  // ---- discovery (IGDB lists, through RetroArr) ----

  async discoverGames(query: Record<string, unknown>): Promise<RetroArrDiscoverGame[]> {
    const res = await this.call<{ games?: Array<Record<string, unknown>> }>('POST', '/discover/games', query, 60_000);
    return (res.games ?? []).map(toDiscoverGame);
  }

  async discoverGame(igdbId: number, includeAdult: boolean): Promise<RetroArrDiscoverDetail | null> {
    try {
      const d = await this.call<Record<string, unknown>>('GET', `/discover/games/${igdbId}?includeAdult=${includeAdult}`, undefined, 60_000);
      const strings = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);
      return {
        game: toDiscoverGame((d.game ?? {}) as Record<string, unknown>),
        storyline: typeof d.storyline === 'string' ? d.storyline : null,
        backgroundUrl: typeof d.backgroundUrl === 'string' ? d.backgroundUrl : null,
        screenshots: strings(d.screenshots),
        videos: (Array.isArray(d.videos) ? d.videos : [])
          .map((v) => v as Record<string, unknown>)
          .filter((v) => typeof v.youtubeId === 'string' && /^[\w-]{6,20}$/.test(v.youtubeId))
          .map((v) => ({ name: String(v.name ?? 'Trailer'), youtubeId: String(v.youtubeId) })),
        themes: strings(d.themes),
        gameModes: strings(d.gameModes),
        developers: strings(d.developers),
        publishers: strings(d.publishers),
        franchises: strings(d.franchises),
        releases: (Array.isArray(d.releases) ? d.releases : []).map((r) => {
          const o = r as Record<string, unknown>;
          return { platform: String(o.platform ?? ''), platformId: typeof o.platformId === 'number' ? o.platformId : null, date: typeof o.date === 'string' ? o.date : null };
        }),
        similar: (Array.isArray(d.similar) ? d.similar : []).map((g) => toDiscoverGame(g as Record<string, unknown>)),
        series: (Array.isArray(d.series) ? d.series : []).map((g) => toDiscoverGame(g as Record<string, unknown>)),
        developer: typeof d.developer === 'string' ? d.developer : null,
        fromDeveloper: (Array.isArray(d.fromDeveloper) ? d.fromDeveloper : []).map((g) => toDiscoverGame(g as Record<string, unknown>)),
        seriesRefs: (Array.isArray(d.seriesRefs) ? d.seriesRefs : []).map((r) => {
          const o = r as Record<string, unknown>;
          return { id: Number(o.id), name: String(o.name ?? '') };
        }),
      };
    } catch (err) {
      if (err instanceof RetroArrError && err.status === 404) return null;
      throw err;
    }
  }

  async discoverOptions(): Promise<{ genres: DiscoverOption[]; themes: DiscoverOption[]; gameModes: DiscoverOption[] }> {
    const o = await this.call<Record<string, unknown>>('GET', '/discover/options');
    const list = (v: unknown): DiscoverOption[] =>
      (Array.isArray(v) ? v : []).map((x) => x as Record<string, unknown>).map((x) => ({ id: Number(x.id), name: String(x.name ?? '') })).filter((x) => x.id > 0 && x.name);
    return { genres: list(o.genres), themes: list(o.themes), gameModes: list(o.gameModes) };
  }

  // ---- collections ----

  async series(franchiseId: number, includeAdult: boolean): Promise<{ id: number; name: string; games: RetroArrDiscoverGame[] } | null> {
    try {
      const s = await this.call<Record<string, unknown>>('GET', `/discover/series/${franchiseId}?includeAdult=${includeAdult}`, undefined, 60_000);
      return { id: Number(s.id), name: String(s.name ?? ''), games: (Array.isArray(s.games) ? s.games : []).map((g) => toDiscoverGame(g as Record<string, unknown>)) };
    } catch (err) {
      if (err instanceof RetroArrError && err.status === 404) return null;
      throw err;
    }
  }

  async searchSeries(query: string): Promise<{ id: number; name: string; gameCount: number }[]> {
    const res = await this.call<{ series?: Array<Record<string, unknown>> }>('GET', `/discover/series?query=${encodeURIComponent(query)}`);
    return (res.series ?? []).map((s) => ({ id: Number(s.id), name: String(s.name ?? ''), gameCount: Number(s.gameCount ?? 0) }));
  }

  // Each game's series
  async seriesOf(igdbIds: number[]): Promise<Map<number, DiscoverOption[]>> {
    const map = new Map<number, DiscoverOption[]>();
    for (let i = 0; i < igdbIds.length; i += 2000) {
      const res = await this.call<{ games?: Array<{ igdbId: number; series?: DiscoverOption[] }> }>('POST', '/discover/series-of', { igdbIds: igdbIds.slice(i, i + 2000) }, 60_000);
      for (const g of res.games ?? []) map.set(Number(g.igdbId), (g.series ?? []).map((s) => ({ id: Number(s.id), name: String(s.name) })));
    }
    return map;
  }

  // What the library has of each game, per platform
  async libraryOf(igdbIds: number[]): Promise<Map<number, RetroArrDiscoverGame['library']>> {
    const map = new Map<number, RetroArrDiscoverGame['library']>();
    for (let i = 0; i < igdbIds.length; i += 5000) {
      const res = await this.call<{ games?: Array<{ igdbId: number; library?: unknown[] }> }>('POST', '/discover/library', { igdbIds: igdbIds.slice(i, i + 5000) });
      for (const g of res.games ?? []) {
        map.set(
          Number(g.igdbId),
          (g.library ?? []).map((l) => {
            const o = l as Record<string, unknown>;
            return { gameId: Number(o.gameId), platformId: Number(o.platformId), status: gameStatus(o.status), rommId: o.rommId == null ? null : Number(o.rommId) };
          }),
        );
      }
    }
    return map;
  }

  // Titles from an imported list, found on IGDB for one platform (at most 20 a call)
  async match(platformId: number, titles: string[]): Promise<{ title: string; candidates: { game: RetroArrDiscoverGame; similarity: number }[] }[]> {
    const res = await this.call<{ results?: Array<{ title: string; candidates?: Array<{ game: Record<string, unknown>; similarity: number }> }> }>(
      'POST',
      '/discover/match',
      { platformId, titles },
      120_000,
    );
    return (res.results ?? []).map((r) => ({
      title: String(r.title),
      candidates: (r.candidates ?? []).map((c) => ({ game: toDiscoverGame(c.game), similarity: Number(c.similarity) })),
    }));
  }

  async recentlyAdded(limit: number): Promise<RetroArrDiscoverGame[]> {
    const res = await this.call<{ games?: Array<Record<string, unknown>> }>('GET', `/discover/library/recent?limit=${limit}`);
    return (res.games ?? []).map(toDiscoverGame);
  }

  // Searches the indexers and grabs a release that scores high enough. Can take a while.
  async searchNow(id: number): Promise<void> {
    await this.call('POST', `/games/${id}/search-now?autoDispatch=true`, undefined, 180_000);
  }
}
