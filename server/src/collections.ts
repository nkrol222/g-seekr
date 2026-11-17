import { CollectionStore, type GameRef, type Import, type ImportItem, type List } from './collections-store.js';
import type { DiscoverService } from './discover.js';
import { archiveItemId, parseArchiveFiles, parseDat, parseTitles, type ImportTitle } from './import-parse.js';
import { RequestError, type Logger, type RequestService } from './requests.js';
import { RetroArrError, type RetroArrClient, type RetroArrDiscoverGame } from './retroarr.js';
import type { RequestStatus, Store, User } from './store.js';

export type CollectionKind = 'series' | 'list';

// A game on a collection page. Per platform: whether the library has it, and the open requests for it.
export interface CollectionGame {
  igdbId: number;
  title: string;
  year: number | null;
  coverUrl: string | null;
  rating: number | null;
  // The requestable platforms it can be on here: its platforms for a series, the list's entries for a list
  platformIds: number[];
  inLibrary: number[];
  requests: { id: number; platformId: number; status: RequestStatus }[];
}

export interface CollectionPage {
  kind: CollectionKind;
  id: number;
  name: string;
  description: string | null;
  source: string | null;
  featured: boolean;
  // Per requestable platform: how many of the collection's games are on it, and how many of those the library has
  platforms: { id: number; name: string; total: number; inLibrary: number }[];
  games: CollectionGame[];
}

// A collection as a poster on Discover and the Collections page: "7 of 12"
export interface CollectionCard {
  kind: CollectionKind;
  id: number;
  name: string;
  covers: string[];
  total: number;
  inLibrary: number;
}

export interface RequestMissingResult {
  requested: { igdbId: number; title: string }[];
  skipped: { igdbId: number; title: string; reason: string }[];
  // The user's request limit stopped it before the end
  limitReached: boolean;
}

const BATCH = 20;
const SERIES_OF_FOR = 24 * 60 * 60_000;
const POPULAR_FOR = 10 * 60_000;
const CONFIDENT = 0.9;
const POSSIBLE = 0.5;
const MAX_IMPORT = 5000;

// Collections: IGDB series (live, through RetroArr) and lists admins curate or import, each a game on a platform.
// A collection page shows, for the platform the user picks, what the library has and what's missing; "Request
// missing" makes one request per missing game, as if requested one by one (limits and approval apply).
export class CollectionService {
  readonly lists: CollectionStore;
  private readonly seriesOfCache = new Map<number, { at: number; series: { id: number; name: string }[] }>();
  private queue: Promise<void> = Promise.resolve();
  private popularCache = new Map<boolean, { at: number; cards: CollectionCard[] }>();

  constructor(
    db: ConstructorParameters<typeof CollectionStore>[0],
    private readonly store: Store,
    private readonly retroarr: RetroArrClient,
    private readonly requests: RequestService,
    private readonly discover: DiscoverService,
    private readonly log: Logger,
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly now: () => Date = () => new Date(),
  ) {
    this.lists = new CollectionStore(db, now);
  }

  // ---- pages ----

  async seriesPage(user: User, franchiseId: number): Promise<CollectionPage> {
    const series = await this.retroarr.series(franchiseId, this.discover.filtersFor(user).includeAdult);
    if (!series) throw new RequestError('That series wasn’t found on IGDB.', 404, 'not_found');
    const featured = this.lists.featuredSeries().some((f) => f.franchiseId === franchiseId);
    const games = await this.games(series.games.map((g) => ({ game: g, platformIds: g.platformIds })));
    return { kind: 'series', id: series.id, name: series.name, description: null, source: 'IGDB', featured, platforms: await this.platformTotals(games), games };
  }

  async listPage(id: number): Promise<CollectionPage> {
    const list = this.lists.list(id);
    if (!list) throw new RequestError('That list doesn’t exist.', 404, 'not_found');
    const items = this.lists.items(id);
    const library = items.length ? await this.retroarr.libraryOf([...new Set(items.map((i) => i.igdbId))]) : new Map();
    // One entry per game; a game listed for two platforms is one poster with both
    const byGame = new Map<number, { game: RetroArrDiscoverGame; platformIds: number[] }>();
    for (const item of items) {
      const entry = byGame.get(item.igdbId);
      if (entry) entry.platformIds.push(item.platformId);
      else
        byGame.set(item.igdbId, {
          game: { igdbId: item.igdbId, title: item.title, year: item.year, coverUrl: item.coverUrl, summary: null, rating: null, ratingCount: null, genres: [], platformIds: [], library: library.get(item.igdbId) ?? [] },
          platformIds: [item.platformId],
        });
    }
    const games = await this.games([...byGame.values()]);
    return { kind: 'list', id, name: list.name, description: list.description, source: list.source, featured: list.featured, platforms: await this.platformTotals(games), games };
  }

  private async games(entries: { game: RetroArrDiscoverGame; platformIds: number[] }[]): Promise<CollectionGame[]> {
    const requestable = new Set((await this.requests.platforms()).map((p) => p.id));
    const open = this.store.openRequestsForGames(entries.map((e) => e.game.igdbId));
    return entries.map(({ game, platformIds }) => ({
      igdbId: game.igdbId,
      title: game.title,
      year: game.year,
      coverUrl: game.coverUrl,
      rating: game.rating,
      platformIds: [...new Set(platformIds)].filter((p) => requestable.has(p)),
      inLibrary: game.library.filter((l) => l.status === 'Downloaded').map((l) => l.platformId),
      requests: open.filter((r) => r.igdbId === game.igdbId).map((r) => ({ id: r.id, platformId: r.platformId, status: r.status })),
    }));
  }

  private async platformTotals(games: CollectionGame[]) {
    return (await this.requests.platforms())
      .map((p) => {
        const on = games.filter((g) => g.platformIds.includes(p.id));
        return { id: p.id, name: p.name, total: on.length, inLibrary: on.filter((g) => g.inLibrary.includes(p.id)).length };
      })
      .filter((p) => p.total > 0)
      .sort((a, b) => b.total - a.total || a.name.localeCompare(b.name));
  }

  // One request per game on the platform that the library doesn't have and nobody requested yet, until the user's
  // limit stops it. Each goes through the same rules as a single request (approval, auto-approve, hand-off).
  async requestMissing(user: User, kind: CollectionKind, id: number, platformId: number): Promise<RequestMissingResult> {
    const page = kind === 'series' ? await this.seriesPage(user, id) : await this.listPage(id);
    if (!page.platforms.some((p) => p.id === platformId)) throw new RequestError('No game of this collection is on that platform.', 400, 'wrong_platform');
    const result: RequestMissingResult = { requested: [], skipped: [], limitReached: false };
    for (const game of page.games) {
      if (!game.platformIds.includes(platformId) || game.inLibrary.includes(platformId) || game.requests.some((r) => r.platformId === platformId)) continue;
      if (result.limitReached) {
        result.skipped.push({ igdbId: game.igdbId, title: game.title, reason: 'request limit reached' });
        continue;
      }
      try {
        await this.requests.create(user, game.igdbId, platformId);
        result.requested.push({ igdbId: game.igdbId, title: game.title });
      } catch (err) {
        if (err instanceof RequestError && err.code === 'limit_reached') {
          result.limitReached = true;
          result.skipped.push({ igdbId: game.igdbId, title: game.title, reason: 'request limit reached' });
        } else if (err instanceof RequestError) {
          result.skipped.push({ igdbId: game.igdbId, title: game.title, reason: err.message });
        } else {
          throw err;
        }
      }
    }
    this.log.info(`${user.username} requested ${result.requested.length} missing game(s) of ${kind} ${id} for platform ${platformId}`);
    return result;
  }

  // ---- cards for Discover and the Collections page ----

  async featured(user: User): Promise<CollectionCard[]> {
    const series = await Promise.all(this.lists.featuredSeries().map((f) => this.seriesCard(user, f.franchiseId).catch(() => null)));
    const lists = await Promise.all(this.lists.lists().filter((l) => l.featured).map((l) => this.listCard(l)));
    return [...series.filter((c): c is CollectionCard => c !== null), ...lists];
  }

  // The series people request most: two or more of their games requested, by anyone
  async popular(user: User): Promise<CollectionCard[]> {
    const adult = this.discover.filtersFor(user).includeAdult;
    const cached = this.popularCache.get(adult);
    if (cached && this.now().getTime() - cached.at < POPULAR_FOR) return cached.cards;
    const counts = await this.seriesCounts(this.store.listRequests({}).map((r) => r.igdbId));
    const top = [...counts.entries()].filter(([, c]) => c.games.size >= 2).sort((a, b) => b[1].games.size - a[1].games.size).slice(0, 10);
    const cards = (await Promise.all(top.map(([id]) => this.seriesCard(user, id).catch(() => null)))).filter((c): c is CollectionCard => c !== null);
    // Nothing popular yet is cheap to ask again, and shouldn't hide the first series for ten minutes
    if (cards.length > 0) this.popularCache.set(adult, { at: this.now().getTime(), cards });
    return cards;
  }

  // Series of the games this user requested or liked, where the library has some but not all
  async inProgress(user: User): Promise<CollectionCard[]> {
    const mine = [...this.store.listRequests({ userId: user.id }).map((r) => r.igdbId), ...this.store.likes(user.id).map((l) => l.igdbId)];
    const counts = await this.seriesCounts(mine);
    const top = [...counts.entries()].sort((a, b) => b[1].games.size - a[1].games.size).slice(0, 8);
    const cards = await Promise.all(top.map(([id]) => this.seriesCard(user, id).catch(() => null)));
    return cards.filter((c): c is CollectionCard => c !== null && c.inLibrary > 0 && c.inLibrary < c.total).slice(0, 6);
  }

  async allLists(): Promise<CollectionCard[]> {
    return Promise.all(this.lists.lists().map((l) => this.listCard(l)));
  }

  searchSeries(query: string) {
    return this.retroarr.searchSeries(query);
  }

  private async seriesCard(user: User, franchiseId: number): Promise<CollectionCard | null> {
    const page = await this.seriesPage(user, franchiseId);
    return this.card(page);
  }

  private async listCard(list: List): Promise<CollectionCard> {
    return this.card(await this.listPage(list.id));
  }

  private card(page: CollectionPage): CollectionCard {
    const games = page.games.filter((g) => g.platformIds.length > 0);
    return {
      kind: page.kind,
      id: page.id,
      name: page.name,
      covers: games.map((g) => g.coverUrl).filter((c): c is string => !!c).slice(0, 4),
      total: games.length,
      inLibrary: games.filter((g) => g.inLibrary.some((p) => g.platformIds.includes(p))).length,
    };
  }

  // How many of these games each series has
  private async seriesCounts(igdbIds: number[]): Promise<Map<number, { name: string; games: Set<number> }>> {
    const ids = [...new Set(igdbIds)];
    const now = this.now().getTime();
    const missing = ids.filter((id) => {
      const c = this.seriesOfCache.get(id);
      return !c || now - c.at > SERIES_OF_FOR;
    });
    if (missing.length > 0) {
      const map = await this.retroarr.seriesOf(missing);
      for (const id of missing) this.seriesOfCache.set(id, { at: now, series: map.get(id) ?? [] });
    }
    const counts = new Map<number, { name: string; games: Set<number> }>();
    for (const id of ids) {
      for (const s of this.seriesOfCache.get(id)?.series ?? []) {
        const entry = counts.get(s.id) ?? { name: s.name, games: new Set<number>() };
        entry.games.add(id);
        counts.set(s.id, entry);
      }
    }
    return counts;
  }

  // ---- imports ----

  // Reads the source, then finds its titles on IGDB in the background; the review page follows along
  async startImport(
    user: User,
    body: { listName?: unknown; listId?: unknown; platformId?: unknown; kind?: unknown; text?: unknown; item?: unknown },
  ): Promise<Import> {
    const platformId = Number(body.platformId);
    if (!(await this.requests.platforms()).some((p) => p.id === platformId)) throw new RequestError('Pick a platform the list is for.', 400, 'bad_platform');
    const listId = body.listId == null || body.listId === '' ? null : Number(body.listId);
    if (listId !== null && !this.lists.list(listId)) throw new RequestError('That list doesn’t exist.', 404, 'not_found');
    const listName = typeof body.listName === 'string' ? body.listName.trim().slice(0, 120) : '';
    if (listId === null && !listName) throw new RequestError('Name the new list.', 400, 'bad_name');

    let titles: ImportTitle[];
    let source: string;
    if (body.kind === 'titles' && typeof body.text === 'string') {
      titles = parseTitles(body.text);
      source = 'Pasted titles';
    } else if (body.kind === 'dat' && typeof body.text === 'string') {
      titles = parseDat(body.text);
      source = 'DAT file';
      if (titles.length === 0) throw new RequestError('No games found in that file: it should be a No-Intro or Redump DAT (XML).', 400, 'bad_source');
    } else if (body.kind === 'archive' && typeof body.item === 'string') {
      const id = archiveItemId(body.item);
      if (!id) throw new RequestError('That isn’t an Internet Archive item id or URL.', 400, 'bad_source');
      titles = await this.archiveTitles(id);
      source = `archive.org/details/${id}`;
    } else {
      throw new RequestError('Paste titles, upload a DAT file or give an Internet Archive item.', 400, 'bad_source');
    }
    if (titles.length === 0) throw new RequestError('There are no titles to import.', 400, 'empty');
    if (titles.length > MAX_IMPORT) throw new RequestError(`That’s ${titles.length} titles; one import takes at most ${MAX_IMPORT}.`, 400, 'too_big');

    const job = this.lists.createImport({ createdBy: user.id, listId, listName: listName || this.lists.list(listId!)!.name, platformId, source, titles });
    this.log.info(`import ${job.id}: ${user.username} imports ${titles.length} titles (${source}) for platform ${platformId}`);
    this.enqueue(job.id);
    return job;
  }

  private async archiveTitles(id: string): Promise<ImportTitle[]> {
    let res: Response;
    try {
      res = await this.fetchImpl(`https://archive.org/metadata/${encodeURIComponent(id)}`, { signal: AbortSignal.timeout(30_000) });
    } catch (err) {
      throw new RequestError(`archive.org can’t be reached: ${(err as Error).message}`, 502, 'archive_down');
    }
    if (!res.ok) throw new RequestError(`archive.org answered ${res.status}.`, 502, 'archive_down');
    const meta = (await res.json()) as { files?: { name?: unknown; source?: unknown }[] };
    if (!meta.files) throw new RequestError('That Internet Archive item doesn’t exist, or has no files.', 404, 'not_found');
    return parseArchiveFiles(meta.files);
  }

  // Imports still matching when the app stopped carry on
  resume(): void {
    for (const job of this.lists.importsMatching()) this.enqueue(job.id);
  }

  // One import at a time: IGDB allows 4 searches a second for everyone
  private enqueue(id: number): void {
    this.queue = this.queue.then(() => this.runImport(id)).catch((err: Error) => this.log.error(`import ${id}: ${err.message}`));
  }

  // For tests: wait for the imports in the queue
  idle(): Promise<void> {
    return this.queue;
  }

  private async runImport(id: number): Promise<void> {
    const job = this.lists.import(id);
    if (!job || job.status !== 'matching') return;
    const pending = this.lists.importItems(id, 'pending');
    let done = job.total - pending.length;
    for (let i = 0; i < pending.length; i += BATCH) {
      const batch = pending.slice(i, i + BATCH);
      let results;
      try {
        results = await this.retroarr.match(job.platformId, batch.map((b) => b.title));
      } catch (err) {
        const message = err instanceof RetroArrError ? err.message : (err as Error).message;
        this.lists.updateImport(id, { status: 'failed', error: message });
        this.log.warn(`import ${id}: stopped at ${done}/${job.total}: ${message}`);
        return;
      }
      batch.forEach((item, n) => {
        const candidates = (results[n]?.candidates ?? []).map((c) => ({ ...ref(c.game), similarity: c.similarity }));
        const [best, second] = candidates;
        const confident = best && best.similarity >= CONFIDENT && (!second || second.similarity < best.similarity - 0.05);
        const state = confident ? 'matched' : best && best.similarity >= POSSIBLE ? 'uncertain' : 'unmatched';
        this.lists.setImportItem(id, item.idx, { state, candidates, choice: confident ? withoutScore(best!) : null });
      });
      done += batch.length;
      this.lists.updateImport(id, { done });
    }
    this.lists.updateImport(id, { status: 'review', error: null });
    this.log.info(`import ${id}: matched, waiting for review`);
  }

  retryImport(id: number): Import {
    const job = this.mustImport(id);
    if (job.status !== 'failed') throw new RequestError('Only a failed import can be retried.', 409, 'wrong_status');
    this.lists.updateImport(id, { status: 'matching', error: null });
    this.enqueue(id);
    return this.lists.import(id)!;
  }

  review(id: number): { import: Import; items: ImportItem[] } {
    return { import: this.mustImport(id), items: this.lists.importItems(id) };
  }

  // The admin picks a game for an entry (a candidate, or one found by searching), or skips it
  chooseItem(id: number, idx: number, body: { choice?: unknown; skip?: unknown }): ImportItem {
    const job = this.mustImport(id);
    if (job.status !== 'review') throw new RequestError('This import isn’t waiting for review.', 409, 'wrong_status');
    const item = this.lists.importItems(id).find((i) => i.idx === idx);
    if (!item) throw new RequestError('No such entry.', 404, 'not_found');
    if (typeof body.skip === 'boolean') this.lists.setImportItem(id, idx, { skip: body.skip });
    if (body.choice !== undefined) {
      const c = body.choice as Record<string, unknown> | null;
      const choice: GameRef | null =
        c && Number.isInteger(Number(c.igdbId)) && Number(c.igdbId) > 0
          ? {
              igdbId: Number(c.igdbId),
              title: String(c.title ?? '').slice(0, 200) || item.title,
              year: Number.isInteger(Number(c.year)) && Number(c.year) > 0 ? Number(c.year) : null,
              coverUrl: typeof c.coverUrl === 'string' && /^https:\/\//.test(c.coverUrl) ? c.coverUrl : null,
            }
          : null;
      this.lists.setImportItem(id, idx, { choice, skip: choice ? false : item.skip });
    }
    return this.lists.importItems(id).find((i) => i.idx === idx)!;
  }

  // Saves every chosen, not skipped entry to the list (a new one, or the one picked), for the import's platform
  save(user: User, id: number): { list: List; added: number } {
    const job = this.mustImport(id);
    if (job.status !== 'review') throw new RequestError('This import isn’t waiting for review.', 409, 'wrong_status');
    const chosen = this.lists.importItems(id).filter((i) => i.choice && !i.skip);
    const list = (job.listId !== null ? this.lists.list(job.listId) : null) ?? this.lists.createList({ name: job.listName, description: null, source: job.source, createdBy: user.id });
    const added = this.lists.addItems(list.id, chosen.map((i) => ({ ...i.choice!, platformId: job.platformId })));
    this.lists.updateImport(id, { status: 'saved', listId: list.id });
    this.log.info(`import ${id}: ${user.username} saved ${added} game(s) to list ${list.id}`);
    return { list: this.lists.list(list.id)!, added };
  }

  discardImport(id: number): void {
    const job = this.mustImport(id);
    if (job.status === 'matching') throw new RequestError('Wait until it has finished matching.', 409, 'wrong_status');
    this.lists.deleteImport(id);
  }

  private mustImport(id: number): Import {
    const job = this.lists.import(id);
    if (!job) throw new RequestError('No such import.', 404, 'not_found');
    return job;
  }
}

const ref = (g: RetroArrDiscoverGame): GameRef => ({ igdbId: g.igdbId, title: g.title, year: g.year, coverUrl: g.coverUrl });
const withoutScore = ({ igdbId, title, year, coverUrl }: GameRef & { similarity: number }): GameRef => ({ igdbId, title, year, coverUrl });
