import type { Db } from './db.js';
import {
  RetroArrClient,
  type DiscoverOption,
  type RetroArrDiscoverDetail,
  type RetroArrDiscoverGame,
  type RetroArrLookupGame,
  type RetroArrPlatform,
} from './retroarr.js';

// IGDB, straight from g-seekr: the lists, game pages, series and list matching people browse, without going through
// RetroArr on orion. g-seekr has its own Twitch app (its own 4 requests a second), and keeps IGDB's answers in its
// database for six hours, across restarts. What the library has of a game still comes from RetroArr, in one call per
// page. Ported from RetroArr's DiscoveryService, so the lists come out the same.

const CACHE_MS = 6 * 3_600_000;
// Genres, themes and game modes hardly change
const OPTIONS_CACHE_MS = 7 * 86_400_000;
const MIN_GAP_MS = 260;
const ADULT_THEME = 42;
const POPULARITY_VISITS = 1;
const POPULAR_POOL = 500;
const MAX_LIMIT = 50;
const TOP_MIN_RATINGS = 5;
const CARD_FIELDS = 'name, summary, cover.image_id, first_release_date, total_rating, total_rating_count, genres.name, platforms';

export class IgdbError extends Error {}

interface IgdbCard {
  id: number;
  name: string;
  summary?: string;
  cover?: { image_id?: string };
  first_release_date?: number;
  total_rating?: number;
  total_rating_count?: number;
  genres?: { id: number; name: string }[];
  platforms?: number[];
}

interface IgdbDetail extends IgdbCard {
  storyline?: string;
  screenshots?: { image_id?: string }[];
  artworks?: { image_id?: string }[];
  videos?: { name?: string; video_id?: string }[];
  themes?: { id: number; name: string }[];
  game_modes?: { id: number; name: string }[];
  involved_companies?: { company?: { id: number; name: string }; developer?: boolean; publisher?: boolean }[];
  // region: IGDB's old enum; release_region: its newer table (either may be there)
  release_dates?: { platform?: { id: number; name: string }; date?: number; region?: number; release_region?: { region?: string } }[];
  franchises?: { id: number; name: string }[];
  similar_games?: number[];
  dlcs?: { id: number; name: string; first_release_date?: number }[];
  expansions?: { id: number; name: string; first_release_date?: number }[];
}

type Size = 'cover_big' | '1080p' | 'screenshot_big';
// IGDB's release regions in RetroArr's region names
const REGION_ENUM: Record<number, string> = { 1: 'Europe', 2: 'USA', 3: 'Australia', 4: 'Australia', 5: 'Japan', 6: 'China', 7: 'Asia', 8: 'World', 9: 'Korea', 10: 'Brazil' };
const REGION_NAME: Record<string, string> = {
  europe: 'Europe', north_america: 'USA', australia: 'Australia', new_zealand: 'Australia', japan: 'Japan', china: 'China', asia: 'Asia', worldwide: 'World', korea: 'Korea', brazil: 'Brazil',
};
const regionOf = (r: { region?: number; release_region?: { region?: string } }): string | null =>
  (r.release_region?.region ? REGION_NAME[r.release_region.region.toLowerCase()] : undefined) ?? (r.region ? REGION_ENUM[r.region] : undefined) ?? null;

const image = (id: string | undefined, size: Size) => (id ? `https://images.igdb.com/igdb/image/upload/t_${size}/${id}.jpg` : null);
const escape = (s: string) => s.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
const unix = (d: Date) => Math.floor(d.getTime() / 1000);
const blank = (s: string | undefined | null) => (s && s.trim() ? s : null);

// The Twitch token, the 4-a-second pace and the cache
export class IgdbApi {
  private token: { value: string; until: number } | null = null;
  private last = 0;
  private queue: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly clientId: string,
    private readonly clientSecret: string,
    private readonly db: Db,
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly now: () => number = () => Date.now(),
  ) {}

  private async accessToken(): Promise<string> {
    if (this.token && this.token.until > this.now() + 60_000) return this.token.value;
    const url = `https://id.twitch.tv/oauth2/token?client_id=${encodeURIComponent(this.clientId)}&client_secret=${encodeURIComponent(this.clientSecret)}&grant_type=client_credentials`;
    const res = await this.fetchImpl(url, { method: 'POST', signal: AbortSignal.timeout(15_000) }).catch((e: Error) => {
      throw new IgdbError(`Twitch can't be reached: ${e.message}`);
    });
    if (!res.ok) throw new IgdbError(`Twitch refused g-seekr's IGDB app (${res.status}): check IGDB_CLIENT_ID and IGDB_CLIENT_SECRET`);
    const body = (await res.json()) as { access_token?: string; expires_in?: number };
    if (!body.access_token) throw new IgdbError('Twitch sent no token');
    this.token = { value: body.access_token, until: this.now() + (body.expires_in ?? 3600) * 1000 };
    return this.token.value;
  }

  // One request at a time, at least 260 ms apart: IGDB allows 4 a second
  private paced<T>(work: () => Promise<T>): Promise<T> {
    const run = this.queue.then(async () => {
      const wait = this.last + MIN_GAP_MS - this.now();
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
      this.last = this.now();
      return work();
    });
    this.queue = run.catch(() => undefined);
    return run;
  }

  async query<T>(endpoint: string, body: string): Promise<T[]> {
    return this.paced(async () => {
      for (let attempt = 0; ; attempt++) {
        const token = await this.accessToken();
        const res = await this.fetchImpl(`https://api.igdb.com/v4/${endpoint}`, {
          method: 'POST',
          headers: { 'Client-ID': this.clientId, Authorization: `Bearer ${token}`, Accept: 'application/json' },
          body,
          signal: AbortSignal.timeout(30_000),
        }).catch((e: Error) => {
          throw new IgdbError(`IGDB can't be reached: ${e.message}`);
        });
        if (res.ok) return (await res.json()) as T[];
        // A token Twitch dropped early; IGDB's own "too many" (another app on the same client id)
        if (res.status === 401 && attempt === 0) {
          this.token = null;
          continue;
        }
        if (res.status === 429 && attempt < 2) {
          await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
          continue;
        }
        throw new IgdbError(`IGDB answered ${res.status} for ${endpoint}`);
      }
    });
  }

  // From the database while fresh; IGDB otherwise. A stale answer is still used when IGDB is down.
  async cached<T>(key: string, load: () => Promise<T>, maxAge = CACHE_MS): Promise<T> {
    const row = this.db.prepare('SELECT at, value FROM igdb_cache WHERE key = ?').get(key) as { at: number; value: string } | undefined;
    if (row && this.now() - row.at < maxAge) return JSON.parse(row.value) as T;
    try {
      const fresh = await load();
      this.db.prepare('INSERT INTO igdb_cache (key, at, value) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET at = excluded.at, value = excluded.value').run(key, this.now(), JSON.stringify(fresh));
      return fresh;
    } catch (err) {
      if (row) return JSON.parse(row.value) as T;
      throw err;
    }
  }

  // Drops answers older than a week (the housekeeping task)
  prune(): number {
    return Number(this.db.prepare('DELETE FROM igdb_cache WHERE at < ?').run(this.now() - 7 * 86_400_000).changes);
  }
}

// "Pokémon.Ultra_Moon" and "pokemon ultra moon" are the same name
export function normalize(s: string): string {
  return s.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

function levenshtein(a: string, b: string): number {
  const row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let prev = row[0]!;
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cur = row[j]!;
      row[j] = Math.min(row[j]! + 1, row[j - 1]! + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = cur;
    }
  }
  return row[b.length]!;
}

// How alike a title from a list and an IGDB name are, 0 to 1 (as RetroArr's ComputeReleaseTitleSimilarity)
export function similarity(title: string, name: string): number {
  const a = normalize(title.replace(/\\/g, ''));
  const b = normalize(name);
  if (!a || !b) return 0;
  if (a === b) return 1;
  if (` ${a} `.includes(` ${b} `)) return 0.9;
  return 1 - levenshtein(a, b) / Math.max(a.length, b.length);
}

export interface DiscoverQueryBody {
  list?: string;
  query?: string | null;
  platformIds?: number[];
  genreIds?: number[];
  themeIds?: number[];
  gameModeIds?: number[];
  yearFrom?: number | null;
  yearTo?: number | null;
  minRating?: number | null;
  minRatingCount?: number | null;
  includeAdult?: boolean;
  sort?: string;
  offset?: number;
  limit?: number;
}

export function buildWhere(q: DiscoverQueryBody, igdbPlatforms: number[], now: Date): string {
  const ids = (list: number[] | undefined) => [...new Set((list ?? []).filter((i) => i > 0))].join(',');
  const parts = [`platforms = (${igdbPlatforms.join(',')})`, 'version_parent = null', 'parent_game = null'];
  // Each genre, theme and mode picked narrows the list: a game has all of them. IGDB's "= (a,b)" is any of them,
  // so every pick widened it, and by three picks nearly everything matched; "= [a,b]" is all of them.
  if (ids(q.genreIds)) parts.push(`genres = [${ids(q.genreIds)}]`);
  if (ids(q.gameModeIds)) parts.push(`game_modes = [${ids(q.gameModeIds)}]`);
  const themes = (q.themeIds ?? []).filter((i) => i > 0 && (q.includeAdult || i !== ADULT_THEME));
  if (themes.length) parts.push(`themes = [${ids(themes)}]`);
  if (!q.includeAdult) parts.push(`(themes = null | themes != (${ADULT_THEME}))`);
  const year = (y: number) => Math.min(2100, Math.max(1950, y));
  if (q.yearFrom != null) parts.push(`first_release_date >= ${unix(new Date(Date.UTC(year(q.yearFrom), 0, 1)))}`);
  if (q.yearTo != null) parts.push(`first_release_date < ${unix(new Date(Date.UTC(year(q.yearTo) + 1, 0, 1)))}`);
  if (q.minRating != null && q.minRating > 0) parts.push(`total_rating >= ${Math.min(100, q.minRating)}`);
  if (q.minRatingCount != null && q.minRatingCount > 0) parts.push(`total_rating_count >= ${q.minRatingCount}`);
  if (!q.query?.trim()) {
    parts.push('cover != null');
    parts.push(`first_release_date <= ${unix(now)}`);
  }
  return parts.join(' & ');
}

// RetroArr's client with the IGDB parts answered here
export class DirectIgdbRetroArrClient extends RetroArrClient {
  private platformMap: { at: number; byIgdb: Map<number, number[]>; toIgdb: Map<number, number> } | null = null;

  constructor(
    baseUrl: string,
    token: string,
    private readonly igdb: IgdbApi,
    fetchImpl: typeof fetch = fetch,
    private readonly clock: () => Date = () => new Date(),
  ) {
    super(baseUrl, token, fetchImpl);
  }

  get igdbApi(): IgdbApi {
    return this.igdb;
  }

  // RetroArr's enabled platforms by IGDB platform id, and back (several can share one: Super Famicom and SNES)
  private async platformsByIgdb() {
    if (this.platformMap && this.clock().getTime() - this.platformMap.at < 10 * 60_000) return this.platformMap;
    const list = (await this.platforms()).filter((p): p is RetroArrPlatform & { igdbPlatformId: number } => p.enabled && (p.igdbPlatformId ?? 0) > 0);
    const byIgdb = new Map<number, number[]>();
    const toIgdb = new Map<number, number>();
    for (const p of [...list].sort((a, b) => a.id - b.id)) {
      byIgdb.set(p.igdbPlatformId, [...(byIgdb.get(p.igdbPlatformId) ?? []), p.id]);
      toIgdb.set(p.id, p.igdbPlatformId);
    }
    this.platformMap = { at: this.clock().getTime(), byIgdb, toIgdb };
    return this.platformMap;
  }

  private async igdbPlatformIds(platformIds: number[]): Promise<number[]> {
    const { toIgdb } = await this.platformsByIgdb();
    return [...new Set(platformIds.map((p) => toIgdb.get(p)).filter((p): p is number => p != null))].sort((a, b) => a - b);
  }

  private card(c: IgdbCard, byIgdb: Map<number, number[]>): RetroArrDiscoverGame {
    return {
      igdbId: c.id,
      title: c.name,
      year: c.first_release_date ? new Date(c.first_release_date * 1000).getUTCFullYear() : null,
      coverUrl: image(c.cover?.image_id, 'cover_big'),
      summary: blank(c.summary),
      rating: c.total_rating != null ? Math.round(c.total_rating * 10) / 10 : null,
      ratingCount: c.total_rating_count ?? null,
      genres: (c.genres ?? []).map((g) => g.name),
      platformIds: [...new Set((c.platforms ?? []).flatMap((p) => byIgdb.get(p) ?? []))],
      library: [],
    };
  }

  // What the library has of each game: one call to RetroArr for the whole page
  private async withLibrary(games: RetroArrDiscoverGame[]): Promise<RetroArrDiscoverGame[]> {
    const ids = [...new Set(games.map((g) => g.igdbId))];
    if (ids.length === 0) return games;
    const library = await this.libraryOf(ids);
    for (const g of games) g.library = library.get(g.igdbId) ?? [];
    return games;
  }

  private q<T>(key: string, endpoint: string, body: string, maxAge?: number): Promise<T[]> {
    return this.igdb.cached(key, () => this.igdb.query<T>(endpoint, body), maxAge);
  }

  override async discoverGames(query: Record<string, unknown>): Promise<RetroArrDiscoverGame[]> {
    const q = query as DiscoverQueryBody;
    const igdbPlatforms = await this.igdbPlatformIds(q.platformIds ?? []);
    if (igdbPlatforms.length === 0) return [];
    const limit = Math.min(MAX_LIMIT, Math.max(1, q.limit ?? 30));
    const offset = Math.max(0, q.offset ?? 0);
    const where = buildWhere(q, igdbPlatforms, this.clock());
    const search = q.query?.trim() || null;
    const list = q.list ?? 'browse';
    const sort = q.sort ?? 'popular';
    let cards: IgdbCard[];
    if (!search && (list === 'popular' || (list !== 'top' && sort === 'popular'))) {
      cards = await this.popular(where, offset, limit);
    } else {
      let body = `fields ${CARD_FIELDS}; `;
      if (search) body += `search "${escape(search)}"; `;
      const listWhere = list === 'top' && q.minRatingCount == null ? `${where} & total_rating_count >= ${TOP_MIN_RATINGS}` : where;
      body += `where ${listWhere}; `;
      if (!search) {
        const by = list === 'top' ? 'rating' : sort;
        body += by === 'rating' ? 'sort total_rating desc; ' : by === 'newest' ? 'sort first_release_date desc; ' : by === 'name' ? 'sort name asc; ' : 'sort total_rating_count desc; ';
      }
      body += `limit ${limit}; offset ${offset};`;
      cards = await this.q<IgdbCard>(`games:${body}`, 'games', body);
    }
    const { byIgdb } = await this.platformsByIgdb();
    return this.withLibrary(cards.map((c) => this.card(c, byIgdb)));
  }

  // IGDB's most visited games that match, in that order, then the other matches by how many rated them
  private async popular(where: string, offset: number, limit: number): Promise<IgdbCard[]> {
    let pool: number[];
    try {
      pool = await this.igdb.cached('popularity', async () =>
        [...new Set((await this.igdb.query<{ game_id: number }>('popularity_primitives', `fields game_id, value; where popularity_type = ${POPULARITY_VISITS}; sort value desc; limit ${POPULAR_POOL};`)).map((r) => r.game_id))],
      );
    } catch {
      pool = [];
    }
    let first: IgdbCard[] = [];
    if (pool.length) {
      const matching = await this.q<IgdbCard>(`popular:${where}`, 'games', `fields ${CARD_FIELDS}; where id = (${pool.join(',')}) & ${where}; limit ${POPULAR_POOL};`);
      const rank = new Map(pool.map((id, i) => [id, i] as const));
      first = [...matching].sort((a, b) => (rank.get(a.id) ?? 1e9) - (rank.get(b.id) ?? 1e9));
    }
    const cards = first.slice(offset, offset + limit);
    const rest = limit - cards.length;
    if (rest <= 0) return cards;
    const restWhere = first.length ? `${where} & id != (${first.map((c) => c.id).join(',')})` : where;
    const text = `fields ${CARD_FIELDS}; where ${restWhere}; sort total_rating_count desc; limit ${rest}; offset ${Math.max(0, offset - first.length)};`;
    const more = await this.q<IgdbCard>(`games:${text}`, 'games', text);
    for (const m of more) if (!cards.some((c) => c.id === m.id)) cards.push(m);
    return cards;
  }

  override async discoverGame(igdbId: number, includeAdult: boolean): Promise<RetroArrDiscoverDetail | null> {
    const fields =
      `${CARD_FIELDS}, storyline, screenshots.image_id, artworks.image_id, videos.video_id, videos.name, themes.id, themes.name, ` +
      'game_modes.name, involved_companies.company.name, involved_companies.developer, involved_companies.publisher, ' +
      'release_dates.platform.id, release_dates.platform.name, release_dates.date, release_dates.region, release_dates.release_region.region, ' +
      'franchises.id, franchises.name, similar_games, involved_companies.company.id, ' +
      'dlcs.id, dlcs.name, dlcs.first_release_date, expansions.id, expansions.name, expansions.first_release_date';
    const [g] = await this.q<IgdbDetail>(`game:${igdbId}`, 'games', `fields ${fields}; where id = ${igdbId};`);
    if (!g) return null;
    const { byIgdb } = await this.platformsByIgdb();
    const card = (c: IgdbCard) => this.card(c, byIgdb);
    const companies = g.involved_companies ?? [];
    const firstDates = new Map<number, { name: string; date?: number; regions: Set<string> }>();
    for (const r of g.release_dates ?? []) {
      if (!r.platform) continue;
      const seen = firstDates.get(r.platform.id) ?? { name: r.platform.name, date: r.date, regions: new Set<string>() };
      if ((r.date ?? Infinity) < (seen.date ?? Infinity)) seen.date = r.date;
      const region = regionOf(r);
      if (region) seen.regions.add(region);
      firstDates.set(r.platform.id, seen);
    }
    const adult = includeAdult ? '' : ` & (themes = null | themes != (${ADULT_THEME}))`;
    const others = `id != ${igdbId} & version_parent = null & parent_game = null & cover != null${adult}`;
    const similarIds = (g.similar_games ?? []).slice(0, 20);
    const franchiseIds = [...new Set((g.franchises ?? []).map((f) => f.id).filter((i) => i > 0))];
    const developer = companies.find((c) => c.developer && (c.company?.id ?? 0) > 0);

    const [similar, series, byDeveloper] = await Promise.all([
      similarIds.length
        ? this.q<IgdbCard>(`similar:${igdbId}:${includeAdult}`, 'games', `fields ${CARD_FIELDS}; where id = (${similarIds.join(',')}) & cover != null${adult}; limit 20;`)
        : Promise.resolve([]),
      franchiseIds.length
        ? this.q<IgdbCard>(`series:${franchiseIds.join(',')}:${igdbId}:${includeAdult}`, 'games', `fields ${CARD_FIELDS}; where franchises = (${franchiseIds.join(',')}) & ${others}; sort first_release_date asc; limit 30;`)
        : Promise.resolve([]),
      developer
        ? this.q<IgdbCard>(`developer:${developer.company!.id}:${igdbId}:${includeAdult}`, 'games', `fields ${CARD_FIELDS}; where involved_companies.company = ${developer.company!.id} & ${others}; sort total_rating_count desc; limit 20;`)
        : Promise.resolve([]),
    ]);

    const detail: RetroArrDiscoverDetail = {
      game: card(g),
      storyline: blank(g.storyline),
      backgroundUrl: [...(g.artworks ?? []), ...(g.screenshots ?? [])].map((i) => image(i.image_id, '1080p')).find(Boolean) ?? null,
      screenshots: (g.screenshots ?? []).map((i) => image(i.image_id, 'screenshot_big')).filter((u): u is string => !!u).slice(0, 12),
      videos: (g.videos ?? []).filter((v) => v.video_id && /^[\w-]{6,20}$/.test(v.video_id)).slice(0, 4).map((v) => ({ name: v.name ?? 'Trailer', youtubeId: v.video_id! })),
      themes: (g.themes ?? []).map((t) => t.name),
      gameModes: (g.game_modes ?? []).map((m) => m.name),
      developers: [...new Set(companies.filter((c) => c.developer && c.company).map((c) => c.company!.name))],
      publishers: [...new Set(companies.filter((c) => c.publisher && c.company).map((c) => c.company!.name))],
      franchises: (g.franchises ?? []).map((f) => f.name),
      releases: [...firstDates.entries()]
        .map(([id, r]) => ({
          platform: r.name,
          platformId: byIgdb.get(id)?.[0] ?? null,
          date: r.date ? new Date(r.date * 1000).toISOString().slice(0, 10) : null,
          regions: [...r.regions].sort(),
        }))
        .sort((a, b) => (a.date ?? '9999').localeCompare(b.date ?? '9999')),
      similar: similar.map(card),
      series: series.map(card),
      developer: developer?.company?.name ?? null,
      fromDeveloper: byDeveloper.map(card),
      seriesRefs: (g.franchises ?? []).filter((f) => f.id > 0).map((f) => ({ id: f.id, name: f.name })),
      // Oldest first, an expansion listed under both once
      dlc: [...(g.dlcs ?? []).map((d) => ({ d, kind: 'DLC' })), ...(g.expansions ?? []).map((d) => ({ d, kind: 'Expansion' }))]
        .filter((x, i, all) => x.d.id > 0 && x.d.name && all.findIndex((y) => y.d.id === x.d.id) === i)
        .sort((a, b) => (a.d.first_release_date ?? Infinity) - (b.d.first_release_date ?? Infinity) || a.d.name.localeCompare(b.d.name))
        .map(({ d, kind }) => ({ igdbId: d.id, title: d.name, year: d.first_release_date ? new Date(d.first_release_date * 1000).getUTCFullYear() : null, kind })),
    };
    await this.withLibrary([detail.game, ...detail.similar, ...detail.series, ...detail.fromDeveloper]);
    return detail;
  }

  override async discoverOptions(): Promise<{ genres: DiscoverOption[]; themes: DiscoverOption[]; gameModes: DiscoverOption[] }> {
    const named = (endpoint: string) =>
      this.q<{ id: number; name: string }>(endpoint, endpoint, 'fields name; sort name asc; limit 500;', OPTIONS_CACHE_MS).then((l) => l.map((n) => ({ id: n.id, name: n.name })));
    const [genres, themes, gameModes] = await Promise.all([named('genres'), named('themes'), named('game_modes')]);
    return { genres, themes, gameModes };
  }

  override async series(franchiseId: number, includeAdult: boolean): Promise<{ id: number; name: string; games: RetroArrDiscoverGame[] } | null> {
    const [franchise] = await this.q<{ id: number; name: string }>(`franchise:${franchiseId}`, 'franchises', `fields name; where id = ${franchiseId};`);
    if (!franchise) return null;
    const adult = includeAdult ? '' : ` & (themes = null | themes != (${ADULT_THEME}))`;
    const cards = await this.q<IgdbCard>(
      `franchise-games:${franchiseId}:${includeAdult}`,
      'games',
      `fields ${CARD_FIELDS}; where franchises = (${franchiseId}) & version_parent = null & parent_game = null${adult}; sort first_release_date asc; limit 500;`,
    );
    const { byIgdb } = await this.platformsByIgdb();
    return { id: franchise.id, name: franchise.name, games: await this.withLibrary(cards.map((c) => this.card(c, byIgdb))) };
  }

  override async searchSeries(query: string): Promise<{ id: number; name: string; gameCount: number }[]> {
    const q = escape(query.trim());
    const found = await this.q<{ id: number; name: string; games?: number[] }>(`franchise-search:${q.toLowerCase()}`, 'franchises', `fields name, games; where name ~ *"${q}"*; limit 50;`);
    return found
      .map((f) => ({ id: f.id, name: f.name, gameCount: f.games?.length ?? 0 }))
      .sort((a, b) => b.gameCount - a.gameCount)
      .slice(0, 20);
  }

  override async seriesOf(igdbIds: number[]): Promise<Map<number, DiscoverOption[]>> {
    const map = new Map<number, DiscoverOption[]>();
    const ids = [...new Set(igdbIds.filter((i) => i > 0))].sort((a, b) => a - b);
    for (let i = 0; i < ids.length; i += 400) {
      const key = ids.slice(i, i + 400).join(',');
      const games = await this.q<{ id: number; franchises?: { id: number; name: string }[] }>(`franchises-of:${key}`, 'games', `fields franchises.id, franchises.name; where id = (${key}); limit 500;`);
      for (const g of games) map.set(g.id, (g.franchises ?? []).filter((f) => f.id > 0).map((f) => ({ id: f.id, name: f.name })));
    }
    return map;
  }

  override async match(platformId: number, titles: string[]): Promise<{ title: string; candidates: { game: RetroArrDiscoverGame; similarity: number }[] }[]> {
    const igdbPlatforms = await this.igdbPlatformIds([platformId]);
    const { byIgdb } = await this.platformsByIgdb();
    const results: { title: string; candidates: { game: RetroArrDiscoverGame; similarity: number }[] }[] = [];
    for (const raw of titles) {
      const title = raw.trim();
      if (!title || igdbPlatforms.length === 0) {
        results.push({ title: raw, candidates: [] });
        continue;
      }
      const body = `fields ${CARD_FIELDS}; search "${escape(title)}"; where platforms = (${igdbPlatforms.join(',')}) & version_parent = null & parent_game = null; limit 8;`;
      const cards = await this.q<IgdbCard>(`match:${body}`, 'games', body);
      const candidates = cards
        .map((c) => ({ game: this.card(c, byIgdb), similarity: Math.round(similarity(title, c.name) * 1000) / 1000 }))
        .sort((a, b) => b.similarity - a.similarity)
        .slice(0, 5);
      results.push({ title: raw, candidates });
    }
    await this.withLibrary(results.flatMap((r) => r.candidates.map((c) => c.game)));
    return results;
  }

  // The search box: IGDB's search on every requestable platform, owned when the library has it downloaded
  override async lookup(term: string): Promise<RetroArrLookupGame[]> {
    const { toIgdb } = await this.platformsByIgdb();
    const games = await this.discoverGames({ query: term, platformIds: [...toIgdb.keys()], limit: 30 });
    return games.map((g) => ({
      igdbId: g.igdbId,
      title: g.title,
      year: g.year ?? 0,
      overview: g.summary,
      coverUrl: g.coverUrl,
      platformIds: g.platformIds,
      owned: g.library.some((l) => l.status === 'Downloaded'),
    }));
  }
}
