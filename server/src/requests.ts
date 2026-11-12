import type { Config } from './config.js';
import type { Notifier } from './notify.js';
import { RetroArrError, type RetroArrClient, type RetroArrGame, type RetroArrPlatform } from './retroarr.js';
import { TRACKED_STATUSES, type GameRequest, type RequestStatus, type Store, type User } from './store.js';

export class RequestError extends Error {
  constructor(
    message: string,
    readonly statusCode: number,
    readonly code: string,
    readonly request?: GameRequest,
  ) {
    super(message);
  }
}

export interface Logger {
  info: (msg: string) => void;
  warn: (msg: string) => void;
  error: (msg: string) => void;
}

const PLATFORM_CACHE_MS = 10 * 60_000;

// The request lifecycle:
//   pending ──approve──▶ approved ──handed to RetroArr──▶ searching ──▶ downloading ──▶ available
//      └──decline──▶ declined          └──RetroArr error──▶ failed ──retry──▶ approved …
// Admins' and auto-approve users' requests skip pending.
export class RequestService {
  private platformCache: { at: number; list: RetroArrPlatform[] } | null = null;

  constructor(
    private readonly config: Config,
    private readonly store: Store,
    private readonly retroarr: RetroArrClient,
    private readonly notifier: Notifier,
    private readonly log: Logger,
    private readonly now: () => Date = () => new Date(),
  ) {}

  isAdmin(user: User): boolean {
    return user.isAdmin || (this.config.jellyfinAdminsAreAdmins && user.jellyfinAdmin);
  }

  // ---- platforms and search ----

  async platforms(): Promise<RetroArrPlatform[]> {
    const cached = this.platformCache;
    if (cached && this.now().getTime() - cached.at < PLATFORM_CACHE_MS) return cached.list;
    const allowed = this.config.allowedPlatforms;
    const list = (await this.retroarr.platforms()).filter((p) => p.enabled && (!allowed || allowed.includes(p.slug)));
    list.sort((a, b) => a.name.localeCompare(b.name));
    this.platformCache = { at: this.now().getTime(), list };
    return list;
  }

  async search(term: string) {
    const [games, platforms] = await Promise.all([this.retroarr.lookup(term), this.platforms()]);
    const allowed = new Set(platforms.map((p) => p.id));
    const withIds = games.filter((g): g is typeof g & { igdbId: number } => g.igdbId !== null);
    const open = this.store.openRequestsForGames(withIds.map((g) => g.igdbId));
    return withIds.map((g) => ({
      igdbId: g.igdbId,
      title: g.title,
      year: g.year || null,
      overview: g.overview,
      coverUrl: g.coverUrl,
      owned: g.owned,
      platformIds: g.platformIds.filter((id) => allowed.has(id)),
      requests: open
        .filter((r) => r.igdbId === g.igdbId)
        .map((r) => ({ id: r.id, platformId: r.platformId, status: r.status })),
    }));
  }

  // ---- limits ----

  limitFor(user: User): { limit: number; days: number; used: number } {
    const days = this.config.requestLimitDays;
    const limit = this.isAdmin(user) ? 0 : (user.requestLimit ?? this.config.requestLimit);
    const since = new Date(this.now().getTime() - days * 86_400_000);
    return { limit, days, used: this.store.countRecentRequests(user.id, since) };
  }

  // ---- lifecycle ----

  async create(user: User, igdbId: number, platformId: number): Promise<GameRequest> {
    const platform = (await this.platforms()).find((p) => p.id === platformId);
    if (!platform) throw new RequestError('That platform can’t be requested.', 400, 'invalid_platform');

    const existing = this.store.openRequestFor(igdbId, platformId);
    if (existing) throw new RequestError('This game has already been requested for that platform.', 409, 'already_requested', existing);

    const { limit, used, days } = this.limitFor(user);
    if (limit > 0 && used >= limit) {
      throw new RequestError(`You can make ${limit} requests every ${days} days. Try again later.`, 429, 'limit_reached');
    }

    const meta = await this.retroarr.lookupIgdb(igdbId);
    if (!meta) throw new RequestError('That game wasn’t found on IGDB.', 404, 'unknown_game');
    if (meta.platformIds.length > 0 && !meta.platformIds.includes(platformId)) {
      throw new RequestError(`${meta.title} isn’t available for ${platform.name}.`, 400, 'wrong_platform');
    }

    const inLibrary = await this.retroarr.findByIgdb(igdbId, platformId);
    if (inLibrary.some((g) => g.status === 'Downloaded')) {
      throw new RequestError(`${meta.title} is already in the library for ${platform.name}.`, 409, 'in_library');
    }

    let request: GameRequest;
    try {
      request = this.store.createRequest({
        userId: user.id,
        igdbId,
        platformId,
        platformName: platform.name,
        title: meta.title,
        year: meta.year || null,
        coverUrl: meta.coverUrl,
      });
    } catch (err) {
      // Lost a race with another request for the same game and platform
      const open = this.store.openRequestFor(igdbId, platformId);
      if (open) throw new RequestError('This game has already been requested for that platform.', 409, 'already_requested', open);
      throw err;
    }
    this.log.info(`request ${request.id}: ${user.username} requested ${request.title} (${platform.name})`);

    if (this.isAdmin(user) || user.autoApprove) {
      request = this.store.updateRequest(request.id, { status: 'approved', decidedBy: user.id, decidedAt: this.now().toISOString() })!;
      void this.notifier.requestCreated(request);
      return this.handOff(request);
    }
    void this.notifier.requestCreated(request);
    return request;
  }

  async approve(admin: User, id: number, note?: string): Promise<GameRequest> {
    const request = this.mustGet(id);
    if (request.status !== 'pending') throw new RequestError(`Only pending requests can be approved (this one is ${request.status}).`, 409, 'wrong_status', request);
    const approved = this.store.updateRequest(id, { status: 'approved', decidedBy: admin.id, decidedAt: this.now().toISOString(), note: note ?? null })!;
    this.log.info(`request ${id}: approved by ${admin.username}`);
    return this.handOff(approved);
  }

  async decline(admin: User, id: number, note?: string): Promise<GameRequest> {
    const request = this.mustGet(id);
    if (request.status !== 'pending') throw new RequestError(`Only pending requests can be declined (this one is ${request.status}).`, 409, 'wrong_status', request);
    const declined = this.store.updateRequest(id, { status: 'declined', decidedBy: admin.id, decidedAt: this.now().toISOString(), note: note ?? null })!;
    this.log.info(`request ${id}: declined by ${admin.username}`);
    void this.notifier.statusChanged(declined);
    return declined;
  }

  async retry(admin: User, id: number): Promise<GameRequest> {
    const request = this.mustGet(id);
    if (request.status !== 'failed') throw new RequestError(`Only failed requests can be retried (this one is ${request.status}).`, 409, 'wrong_status', request);
    if (this.store.openRequestFor(request.igdbId, request.platformId)) {
      throw new RequestError('Another open request for this game and platform exists.', 409, 'already_requested');
    }
    const approved = this.store.updateRequest(id, { status: 'approved', error: null, decidedBy: admin.id, decidedAt: this.now().toISOString() })!;
    this.log.info(`request ${id}: retried by ${admin.username}`);
    return this.handOff(approved);
  }

  // The requester can withdraw a pending request; an admin can remove any
  cancel(user: User, id: number): void {
    const request = this.mustGet(id);
    if (!this.isAdmin(user)) {
      if (request.userId !== user.id) throw new RequestError('Request not found.', 404, 'not_found');
      if (request.status !== 'pending') throw new RequestError('Only pending requests can be withdrawn.', 409, 'wrong_status', request);
    }
    this.store.deleteRequest(id);
    this.log.info(`request ${id}: removed by ${user.username}`);
  }

  // Adds the game to RetroArr (or reuses the entry it already has), monitors it and starts a
  // search. The search runs on its own: indexers can take minutes and RetroArr's monitored
  // sweep searches again later anyway.
  async handOff(request: GameRequest): Promise<GameRequest> {
    try {
      let game: RetroArrGame | undefined = (await this.retroarr.findByIgdb(request.igdbId, request.platformId))[0];
      if (!game) {
        const meta = await this.retroarr.lookupIgdb(request.igdbId);
        const body: Record<string, unknown> = {
          ...(meta?.raw ?? { title: request.title, igdbId: request.igdbId, year: request.year ?? 0 }),
          platformId: request.platformId,
          monitored: true,
        };
        for (const key of ['id', 'platform', 'path', 'status', 'gameFiles', 'isOwned', 'availablePlatforms', 'availablePlatformIds']) delete body[key];
        game = await this.retroarr.addGame(body);
      }
      if (game.status === 'Downloaded') return this.markAvailable(request, game.id);

      await this.retroarr.setMonitored(game.id, true);
      const updated = this.store.updateRequest(request.id, {
        status: game.status === 'Downloading' ? 'downloading' : 'searching',
        retroarrGameId: game.id,
        error: null,
      })!;
      this.log.info(`request ${request.id}: in RetroArr as game ${game.id}, searching`);
      this.retroarr.searchNow(game.id).catch((err: Error) => this.log.warn(`request ${request.id}: search-now failed: ${err.message}`));
      return updated;
    } catch (err) {
      const message = err instanceof RetroArrError ? err.message : `Unexpected error: ${(err as Error).message}`;
      this.log.error(`request ${request.id}: hand-off to RetroArr failed: ${message}`);
      const failed = this.store.updateRequest(request.id, { status: 'failed', error: message })!;
      void this.notifier.statusChanged(failed);
      return failed;
    }
  }

  // One pass of the poller: follow every request RetroArr is working on
  async poll(): Promise<void> {
    for (const request of this.store.listRequests({ statuses: TRACKED_STATUSES })) {
      try {
        if (request.retroarrGameId === null) {
          // Approved but the hand-off never finished (the app restarted halfway)
          await this.handOff(request);
          continue;
        }
        const game = await this.retroarr.getGame(request.retroarrGameId);
        if (!game) {
          const failed = this.store.updateRequest(request.id, { status: 'failed', error: 'The game was removed from RetroArr.' })!;
          void this.notifier.statusChanged(failed);
          continue;
        }
        const next: RequestStatus = game.status === 'Downloaded' ? 'available' : game.status === 'Downloading' ? 'downloading' : 'searching';
        if (next === 'available') this.markAvailable(request, game.id);
        else if (next !== request.status) this.store.updateRequest(request.id, { status: next });
      } catch (err) {
        // RetroArr down: leave the request as it is and try again next time
        this.log.warn(`poll: request ${request.id}: ${(err as Error).message}`);
      }
    }
  }

  private markAvailable(request: GameRequest, gameId: number): GameRequest {
    const updated = this.store.updateRequest(request.id, {
      status: 'available',
      retroarrGameId: gameId,
      availableAt: this.now().toISOString(),
      error: null,
    })!;
    this.log.info(`request ${request.id}: available`);
    void this.notifier.statusChanged(updated);
    return updated;
  }

  private mustGet(id: number): GameRequest {
    const request = this.store.request(id);
    if (!request) throw new RequestError('Request not found.', 404, 'not_found');
    return request;
  }
}
