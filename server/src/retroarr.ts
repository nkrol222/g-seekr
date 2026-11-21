// The RetroArr endpoints a token with the "requests" scope may call: the request API (check, fulfil, states) and reads.

export interface RetroArrPlatform {
  id: number;
  name: string;
  slug: string;
  category: string | null;
  enabled: boolean;
  // IGDB's id for the platform (g-seekr asks IGDB itself)
  igdbPlatformId?: number | null;
  // Its games get updates and DLC as separate downloads (false from an older RetroArr)
  hasAddOns?: boolean;
}

// A ROM hack in RetroArr's catalogue, with what the library has of it and of its game
export interface RomHackInfo {
  id: string;
  title: string;
  baseTitle: string;
  baseIgdbId: number | null;
  platformId: number | null;
  kind: string;
  authors: string[];
  version: string | null;
  year: number | null;
  summary: string | null;
  romhackingId: number | null;
  // The hack's entry ('Downloaded' once patched), why patching failed, its game's entry
  hackGameId: number | null;
  hackStatus: string | null;
  hackError: string | null;
  baseGameId: number | null;
  baseStatus: string | null;
}

// A game's DLC or expansion on IGDB
export interface DlcInfo {
  igdbId: number;
  title: string;
  year: number | null;
  kind: string;
}

// What RetroArr has of a game's updates and DLC, against what is wanted
export interface RetroArrAddOns {
  supported: boolean;
  inLibrary: boolean;
  wantLatestUpdate: boolean;
  wantAllDlc: boolean;
  updateVersion: string | null;
  hasDlcPack: boolean;
  dlc: { igdbId: number | null; title: string; owned: boolean }[];
}

export interface RetroArrLookupGame {
  igdbId: number | null;
  title: string;
  year: number;
  overview: string | null;
  coverUrl: string | null;
  platformIds: number[];
  owned: boolean;
}

export type RetroArrGameStatus = 'TBA' | 'Announced' | 'Released' | 'Downloading' | 'Downloaded' | 'Missing' | 'InstallerDetected' | 'Unknown';

// The request API (RetroArr's api/v3/requests): the contract g-seekr hands requests over through. g-seekr says what a
// user asked for; RetroArr picks the entry, fetches the metadata, monitors and searches. docs/retroarr-api.md.
export const REQUEST_API_VERSION = 1;

// wanted: monitored, not in the library yet; unmonitored: not looked for; removed: the entry is gone
export type RequestState = 'wanted' | 'downloading' | 'available' | 'unmonitored' | 'removed';

// One of the library's entries of a game: which version it is and where it stands
export interface RequestEntry {
  gameId: number;
  state: RequestState;
  region: string;
  variant: string;
}

export interface RequestCheck {
  game: { igdbId: number; title: string; year: number | null; coverUrl: string | null; platformIds: number[] };
  entries: RequestEntry[];
  // The entry that is the version asked for, and whether it's in the library
  match: RequestEntry | null;
  owned: boolean;
}

export type FulfilAsk =
  | { kind: 'game'; igdbId: number; platformId: number; region: string; variant: string; latestRevision: boolean; addOns?: AddOnWants }
  | { kind: 'addons'; igdbId: number; platformId: number; region: string; variant: string; addOns: AddOnWants }
  | { kind: 'hack'; hackId: string };

export interface AddOnWants {
  latestUpdate: boolean;
  allDlc: boolean;
  dlc: { igdbId: number | null; title: string }[];
}

export interface Fulfilled {
  gameId: number;
  state: RequestState;
  // A new entry was made for it
  added: boolean;
  // A ROM hack's game
  baseGameId: number | null;
  baseState: RequestState | null;
}

export interface RequestApiInfo {
  apiVersion: number;
  appVersion: string | null;
  features: string[];
}

const STATES: RequestState[] = ['wanted', 'downloading', 'available', 'unmonitored', 'removed'];

function requestState(v: unknown): RequestState {
  return STATES.find((s) => s === v) ?? 'wanted';
}

function toEntry(e: unknown): RequestEntry {
  const o = (e ?? {}) as Record<string, unknown>;
  return {
    gameId: Number(o.gameId),
    state: requestState(o.state),
    region: typeof o.region === 'string' ? o.region : '',
    variant: typeof o.variant === 'string' ? o.variant : '',
  };
}

// What the library has of a game on a platform, and which version it is
export interface LibraryEntry {
  gameId: number;
  platformId: number;
  status: RetroArrGameStatus;
  rommId: number | null;
  region: string;
  variant: string;
  revision: string | null;
}

function toLibraryEntry(l: unknown): LibraryEntry {
  const o = l as Record<string, unknown>;
  return {
    gameId: Number(o.gameId),
    platformId: Number(o.platformId),
    status: gameStatus(o.status),
    rommId: o.rommId == null ? null : Number(o.rommId),
    region: typeof o.region === 'string' ? o.region : '',
    variant: typeof o.variant === 'string' ? o.variant : '',
    revision: typeof o.revision === 'string' && o.revision ? o.revision : null,
  };
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
  library: LibraryEntry[];
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
  // regions: where it came out on that platform (from IGDB directly; empty through RetroArr)
  releases: { platform: string; platformId: number | null; date: string | null; regions?: string[] }[];
  similar: RetroArrDiscoverGame[];
  // Other games of its series, and its main developer's other games (empty from an older RetroArr)
  series: RetroArrDiscoverGame[];
  developer: string | null;
  fromDeveloper: RetroArrDiscoverGame[];
  // Its series, to link to their collection pages
  seriesRefs: DiscoverOption[];
  // Its DLC and expansions (from IGDB directly; empty through RetroArr)
  dlc: DlcInfo[];
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
    library: (Array.isArray(g.library) ? g.library : []).map(toLibraryEntry),
  };
}

export type RetroArrSearchOutcome = 'Grabbed' | 'NothingFound' | 'NoneGoodEnough' | 'NotGrabbed' | 'Failed';

export interface RetroArrGameHunt {
  monitored: boolean;
  // The next search that includes it; null when it isn't wanted or monitoring is off
  nextSearchAt: string | null;
  lastSearch: {
    at: string;
    outcome: RetroArrSearchOutcome;
    found: number;
    rejected: number;
    automatic: boolean;
    release: string | null;
    score: number | null;
    reason: string | null;
  } | null;
}

export interface RetroArrSearchStatus {
  monitoring: boolean;
  rssEveryMinutes: number | null;
  games: Map<number, RetroArrGameHunt>;
}

export class RetroArrError extends Error {
  constructor(
    message: string,
    readonly status: number,
    // The request API's error code (unknown_game, not_in_library, …), when RetroArr sent one
    readonly code: string | null = null,
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
  };
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
      let code: string | null = null;
      try {
        const err = (await res.json()) as { message?: string; error?: string; code?: unknown };
        message += `: ${err.message ?? err.error ?? ''}`.trimEnd();
        if (typeof err.code === 'string') code = err.code;
      } catch {
        /* no JSON body */
      }
      throw new RetroArrError(message, res.status, code);
    }
    if (res.status === 204) return undefined as T;
    const text = await res.text();
    return (text ? JSON.parse(text) : undefined) as T;
  }

  // What RetroArr's request API speaks; RetroArrError 404 from a RetroArr that predates it
  async info(): Promise<RequestApiInfo> {
    const i = await this.call<Record<string, unknown>>('GET', '/requests/info');
    return {
      apiVersion: typeof i.apiVersion === 'number' ? i.apiVersion : 0,
      appVersion: typeof i.appVersion === 'string' ? i.appVersion : null,
      features: Array.isArray(i.features) ? i.features.filter((f): f is string => typeof f === 'string') : [],
    };
  }

  // The game on IGDB and what the library has of it on the platform, in that version. null: IGDB has no such game.
  async check(igdbId: number, platformId: number, version: { region: string; variant: string }): Promise<RequestCheck | null> {
    let r: Record<string, unknown>;
    try {
      r = await this.call<Record<string, unknown>>('POST', '/requests/check', { igdbId, platformId, region: version.region, variant: version.variant });
    } catch (err) {
      // Only RetroArr saying IGDB has no such game; a 404 without the code is a RetroArr without the request API
      if (err instanceof RetroArrError && err.status === 404 && err.code === 'unknown_game') return null;
      throw err;
    }
    const g = (r.game ?? {}) as Record<string, unknown>;
    return {
      game: {
        igdbId: Number(g.igdbId ?? igdbId),
        title: String(g.title ?? ''),
        year: typeof g.year === 'number' && g.year > 0 ? g.year : null,
        coverUrl: typeof g.coverUrl === 'string' ? g.coverUrl : null,
        platformIds: Array.isArray(g.platformIds) ? g.platformIds.filter((n): n is number => typeof n === 'number') : [],
      },
      entries: (Array.isArray(r.entries) ? r.entries : []).map(toEntry),
      match: r.match ? toEntry(r.match) : null,
      owned: r.owned === true,
    };
  }

  // Does what an approved request asks. Adding a game and its metadata can take a while on a cold IGDB cache.
  async fulfil(ask: FulfilAsk): Promise<Fulfilled> {
    const r = await this.call<Record<string, unknown>>('POST', '/requests/fulfil', ask, 60_000);
    return {
      gameId: Number(r.gameId),
      state: requestState(r.state),
      added: r.added === true,
      baseGameId: typeof r.baseGameId === 'number' ? r.baseGameId : null,
      baseState: r.baseState == null ? null : requestState(r.baseState),
    };
  }

  // Where each entry stands, asked 500 at a time
  async states(gameIds: number[]): Promise<Map<number, RequestEntry>> {
    const out = new Map<number, RequestEntry>();
    const ids = [...new Set(gameIds)];
    for (let i = 0; i < ids.length; i += 500) {
      const r = await this.call<{ games?: unknown[] }>('POST', '/requests/states', { gameIds: ids.slice(i, i + 500) });
      for (const e of (r.games ?? []).map(toEntry)) out.set(e.gameId, e);
    }
    return out;
  }

  async platforms(): Promise<RetroArrPlatform[]> {
    const list = await this.call<Array<Record<string, unknown>>>('GET', '/platform?enabledOnly=true');
    return list.map((p) => ({
      id: Number(p.id),
      name: String(p.name ?? ''),
      slug: String(p.slug ?? '').toLowerCase(),
      category: typeof p.category === 'string' ? p.category : null,
      enabled: p.enabled !== false,
      igdbPlatformId: typeof p.igdbPlatformId === 'number' ? p.igdbPlatformId : null,
      hasAddOns: p.hasAddOns === true,
    }));
  }

  async lookup(term: string): Promise<RetroArrLookupGame[]> {
    const res = await this.call<{ games?: Array<Record<string, unknown>> }>('GET', `/game/lookup?term=${encodeURIComponent(term)}`);
    return (res.games ?? []).map(toLookupGame);
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

  // Where each game stands in the hunt for a release: its last search and when RetroArr searches again. Empty from an
  // older RetroArr without the endpoint.
  async searchStatus(gameIds: number[]): Promise<RetroArrSearchStatus> {
    const empty: RetroArrSearchStatus = { monitoring: true, rssEveryMinutes: null, games: new Map() };
    if (gameIds.length === 0) return empty;
    let res: Record<string, unknown>;
    try {
      res = await this.call<Record<string, unknown>>('GET', `/games/search-status?ids=${gameIds.slice(0, 500).join(',')}`);
    } catch (err) {
      if (err instanceof RetroArrError && err.status === 404) return empty;
      throw err;
    }
    const games = new Map<number, RetroArrGameHunt>();
    for (const g of Array.isArray(res.games) ? (res.games as Array<Record<string, unknown>>) : []) {
      const last = g.lastSearch && typeof g.lastSearch === 'object' ? (g.lastSearch as Record<string, unknown>) : null;
      const text = (v: unknown) => (typeof v === 'string' && v ? v : null);
      games.set(Number(g.gameId), {
        monitored: g.monitored === true,
        nextSearchAt: text(g.nextSearchAt),
        lastSearch: last
          ? {
              at: String(last.at),
              outcome: String(last.outcome) as RetroArrSearchOutcome,
              found: Number(last.found ?? 0),
              rejected: Number(last.rejected ?? 0),
              automatic: last.automatic === true,
              release: text(last.release),
              score: typeof last.score === 'number' ? last.score : null,
              reason: text(last.reason),
            }
          : null,
      });
    }
    return { monitoring: res.monitoring !== false, rssEveryMinutes: typeof res.rssEveryMinutes === 'number' ? res.rssEveryMinutes : null, games };
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
        dlc: [],
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

  // Every IGDB game the library has; empty from an older RetroArr without the endpoint
  async ownedIgdbIds(): Promise<number[]> {
    try {
      const res = await this.call<{ igdbIds?: unknown[] }>('GET', '/discover/library/owned');
      return (res.igdbIds ?? []).map(Number).filter((n) => Number.isInteger(n) && n > 0);
    } catch (err) {
      if (err instanceof RetroArrError && err.status === 404) return [];
      throw err;
    }
  }

  // What the library has of each game, per platform
  async libraryOf(igdbIds: number[]): Promise<Map<number, RetroArrDiscoverGame['library']>> {
    const map = new Map<number, RetroArrDiscoverGame['library']>();
    for (let i = 0; i < igdbIds.length; i += 5000) {
      const res = await this.call<{ games?: Array<{ igdbId: number; library?: unknown[] }> }>('POST', '/discover/library', { igdbIds: igdbIds.slice(i, i + 5000) });
      for (const g of res.games ?? []) {
        map.set(
          Number(g.igdbId),
          (g.library ?? []).map(toLibraryEntry),
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

  async getAddOns(id: number): Promise<RetroArrAddOns> {
    const a = await this.call<Record<string, unknown>>('GET', `/games/${id}/addons`);
    return {
      supported: a.supported === true,
      inLibrary: a.inLibrary === true,
      wantLatestUpdate: a.wantLatestUpdate === true,
      wantAllDlc: a.wantAllDlc === true,
      updateVersion: typeof a.updateVersion === 'string' ? a.updateVersion : null,
      hasDlcPack: a.hasDlcPack === true,
      dlc: (Array.isArray(a.dlc) ? a.dlc : []).map((d) => {
        const o = d as Record<string, unknown>;
        return { igdbId: typeof o.igdbId === 'number' ? o.igdbId : null, title: String(o.title ?? ''), owned: o.owned === true };
      }),
    };
  }


  async romHacks(): Promise<RomHackInfo[]> {
    const list = await this.call<Array<Record<string, unknown>>>('GET', '/romhacks');
    const num = (v: unknown) => (typeof v === 'number' ? v : null);
    const str = (v: unknown) => (typeof v === 'string' && v ? v : null);
    return list.map((h) => ({
      id: String(h.id ?? ''),
      title: String(h.title ?? ''),
      baseTitle: String(h.baseTitle ?? ''),
      baseIgdbId: num(h.baseIgdbId),
      platformId: num(h.platformId),
      kind: String(h.kind ?? 'improvement'),
      authors: Array.isArray(h.authors) ? h.authors.filter((a): a is string => typeof a === 'string') : [],
      version: str(h.version),
      year: num(h.year),
      summary: str(h.summary),
      romhackingId: num(h.romhackingId),
      hackGameId: num(h.hackGameId),
      hackStatus: str(h.hackStatus),
      hackError: str(h.hackError),
      baseGameId: num(h.baseGameId),
      baseStatus: str(h.baseStatus),
    }));
  }
}

// What the request lifecycle needs of RetroArr: the request API, plus reads for search results, progress and
// add-ons. RequestService depends on this, not on the whole client, so the boundary stays this narrow.
export type RequestBackend = Pick<
  RetroArrClient,
  'platforms' | 'lookup' | 'check' | 'fulfil' | 'states' | 'getAddOns' | 'progress' | 'searchStatus' | 'libraryOf'
>;
