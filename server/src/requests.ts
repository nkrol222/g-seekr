import { DEFAULT_VERSION, entryMatches, versionLabel, type Version } from './versions.js';
import type { Config } from './config.js';
import type { Notifier } from './notify.js';
import { RetroArrError, type RetroArrAddOns, type RetroArrClient, type RetroArrGame, type RetroArrPlatform } from './retroarr.js';
import { buildTimeline, forUser, type Timeline } from './timeline.js';
import { hasAddOns, NO_ADDONS, TRACKED_STATUSES, type AddOns, type GameRequest, type RequestKind, type RequestStatus, type Store, type User } from './store.js';

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

// The data of a RetroArr webhook: the game's ids first, then the event's own fields
export interface RetroArrEventData {
  gameId?: unknown;
  release?: unknown;
  reason?: unknown;
  stage?: unknown;
  [key: string]: unknown;
}

export interface Logger {
  info: (msg: string) => void;
  warn: (msg: string) => void;
  error: (msg: string) => void;
}

// A platform switched on or off in RetroArr shows here within two minutes
const PLATFORM_CACHE_MS = 2 * 60_000;
// A ready request still not in RomM after this long is left alone (RomM can't read it, or RetroArr has no RomM sync)
const ROMM_LINK_DAYS = 14;

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
    // Exactly what's enabled in RetroArr (Settings → Platforms): enable or disable a platform there
    const list = (await this.retroarr.platforms()).filter((p) => p.enabled);
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

  // version: which version of the game (a region, the English translation, the latest revision); the default is any.
  // addOns: its updates and DLC, on a platform that has them. kind 'addons' asks for only those, for a game the library
  // has.
  async create(
    user: User,
    igdbId: number,
    platformId: number,
    version: Version = DEFAULT_VERSION,
    addOns: AddOns = NO_ADDONS,
    kind: RequestKind = 'game',
  ): Promise<GameRequest> {
    const platform = (await this.platforms()).find((p) => p.id === platformId);
    if (!platform) throw new RequestError('That platform can’t be requested.', 400, 'invalid_platform');
    const which = versionLabel(version);
    const asked = which ? `that version (${which})` : 'that platform';
    if (!platform.hasAddOns) {
      if (kind === 'addons') throw new RequestError(`${platform.name} games have no separate updates or DLC.`, 400, 'no_addons');
      addOns = NO_ADDONS;
    }
    if (kind === 'addons' && !hasAddOns(addOns)) throw new RequestError('Pick the update or the DLC you want.', 400, 'nothing_asked');

    const existing = this.store.openRequestFor(igdbId, platformId, version, kind);
    if (existing) {
      throw new RequestError(
        kind === 'addons' ? 'Updates and DLC for this game are already requested; that request has to finish first.' : `This game has already been requested for ${asked}.`,
        409,
        'already_requested',
        existing,
      );
    }

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
    const owned = inLibrary.some((g) => g.status === 'Downloaded' && entryMatches(version, g));
    if (kind === 'game' && owned) {
      throw new RequestError(`${meta.title} is already in the library for ${platform.name}${which ? ` (${which})` : ''}.`, 409, 'in_library');
    }
    if (kind === 'addons' && !owned) {
      throw new RequestError(`${meta.title} isn’t in the library for ${platform.name} yet: request the game with its DLC instead.`, 409, 'not_in_library');
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
        version,
        kind,
        addOns,
      });
    } catch (err) {
      // Lost a race with another request for the same game, platform and version
      const open = this.store.openRequestFor(igdbId, platformId, version, kind);
      if (open) throw new RequestError(`This game has already been requested for ${asked}.`, 409, 'already_requested', open);
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
    if (this.store.openRequestFor(request.igdbId, request.platformId, request, request.kind)) {
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
      // RetroArr's entry for this version: the one it has, or a new one (another region or the translation is an entry of
      // its own beside the others)
      const version = { region: request.region, variant: request.variant as Version['variant'], latestRevision: request.latestRevision };
      let game: RetroArrGame | undefined = (await this.retroarr.findByIgdb(request.igdbId, request.platformId)).find((g) => entryMatches(version, g));
      if (request.kind === 'addons') return await this.handOffAddOns(request, game);
      if (!game) {
        const meta = await this.retroarr.lookupIgdb(request.igdbId);
        const body: Record<string, unknown> = {
          ...(meta?.raw ?? { title: request.title, igdbId: request.igdbId, year: request.year ?? 0 }),
          platformId: request.platformId,
          monitored: true,
          region: version.region,
          variant: version.variant,
          preferLatestRevision: version.latestRevision,
        };
        for (const key of ['id', 'platform', 'path', 'status', 'gameFiles', 'isOwned', 'availablePlatforms', 'availablePlatformIds']) delete body[key];
        game = await this.retroarr.addGame(body);
      }
      // The updates and DLC asked with the game: RetroArr fetches them once the game is in
      if (hasAddOns(request.addOns)) await this.retroarr.addAddOns(game.id, request.addOns, game.status === 'Downloaded');
      if (game.status === 'Downloaded') return this.markAvailable(request, game.id);

      await this.retroarr.setMonitored(game.id, true);
      const updated = this.store.updateRequest(request.id, {
        status: game.status === 'Downloading' ? 'downloading' : 'searching',
        retroarrGameId: game.id,
        release: null,
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

  // An add-on request: RetroArr adds them to what it wants of the game and searches at once
  private async handOffAddOns(request: GameRequest, game: RetroArrGame | undefined): Promise<GameRequest> {
    if (!game || game.status !== 'Downloaded') throw new RetroArrError('The game is no longer in the library, so its updates and DLC can’t be fetched.', 409);
    await this.retroarr.addAddOns(game.id, request.addOns, true);
    const updated = this.store.updateRequest(request.id, { status: 'searching', retroarrGameId: game.id, release: null, error: null })!;
    this.log.info(`request ${request.id}: updates and DLC asked of RetroArr for game ${game.id}`);
    return this.checkAddOns(updated);
  }

  // Whether everything an add-on request asked for is in: each DLC (by IGDB id, or by name), the DLC pack, an update
  static addOnsDone(asked: AddOns, have: RetroArrAddOns): boolean {
    const owned = (d: { igdbId: number | null; title: string }) =>
      have.hasDlcPack ||
      have.dlc.some((h) => h.owned && (d.igdbId !== null && h.igdbId !== null ? h.igdbId === d.igdbId : h.title.toLowerCase() === d.title.toLowerCase()));
    return asked.dlc.every(owned) && (!asked.allDlc || have.hasDlcPack) && (!asked.latestUpdate || have.updateVersion !== null);
  }

  private async checkAddOns(request: GameRequest): Promise<GameRequest> {
    if (request.retroarrGameId === null) return request;
    const have = await this.retroarr.getAddOns(request.retroarrGameId);
    return RequestService.addOnsDone(request.addOns, have) ? this.markAvailable(request, request.retroarrGameId) : request;
  }

  // One pass of the poller: follow every request RetroArr is working on. Returns a summary for the Tasks page.
  async poll(): Promise<string> {
    const tracked = this.store.listRequests({ statuses: TRACKED_STATUSES });
    let changed = 0;
    let errors = 0;
    for (const request of tracked) {
      try {
        if (request.retroarrGameId === null) {
          // Approved but the hand-off never finished (the app restarted halfway)
          await this.handOff(request);
          continue;
        }
        if (request.kind === 'addons') {
          if ((await this.checkAddOns(request)).status === 'available') changed++;
          continue;
        }
        const game = await this.retroarr.getGame(request.retroarrGameId);
        if (!game) {
          const failed = this.store.updateRequest(request.id, { status: 'failed', error: 'The game was removed from RetroArr.' })!;
          void this.notifier.statusChanged(failed);
          continue;
        }
        const next: RequestStatus = game.status === 'Downloaded' ? 'available' : game.status === 'Downloading' ? 'downloading' : 'searching';
        // RetroArr's game status says nothing of a grab: a request a webhook marked downloading stays so
        // until the import or failure webhook (or the import itself) moves it on
        const grabbed = request.status === 'downloading' && request.release !== null && next === 'searching';
        if (next === 'available') {
          this.markAvailable(request, game.id);
          changed++;
        } else if (next !== request.status && !grabbed) {
          this.store.updateRequest(request.id, { status: next });
          changed++;
        }
      } catch (err) {
        // RetroArr down: leave the request as it is and try again next time
        errors++;
        this.log.warn(`poll: request ${request.id}: ${(err as Error).message}`);
      }
    }
    if (errors > 0 && errors === tracked.length) throw new Error(`RetroArr couldn’t be asked about any of the ${tracked.length} open requests.`);
    return `${tracked.length} open request(s) checked, ${changed} changed` + (errors ? `, ${errors} couldn’t be checked` : '');
  }

  // Requests that are ready but not yet linked to the game in RomM (RomM scans new imports within the hour, then
  // RetroArr's RomM sync links them): asks RetroArr which have a RomM id now. Returns how many got one.
  async linkRomm(): Promise<number> {
    const since = this.now().getTime() - ROMM_LINK_DAYS * 86_400_000;
    const waiting = this.store
      .listRequests({ statuses: ['available'] })
      .filter((r) => r.rommId === null && r.retroarrGameId !== null && (!r.availableAt || new Date(r.availableAt).getTime() >= since));
    if (waiting.length === 0) return 0;
    const library = await this.retroarr.libraryOf([...new Set(waiting.map((r) => r.igdbId))]);
    let linked = 0;
    for (const r of waiting) {
      const entry = (library.get(r.igdbId) ?? []).find((l) => l.gameId === r.retroarrGameId && l.rommId !== null);
      if (!entry) continue;
      this.store.updateRequest(r.id, { rommId: entry.rommId });
      linked++;
    }
    return linked;
  }

  waitingForRomm(): number {
    return this.store.listRequests({ statuses: ['available'] }).filter((r) => r.rommId === null && r.retroarrGameId !== null).length;
  }

  // RetroArr's webhooks, for every request it is working on for that game. The poller stays as the backstop for a
  // webhook that never arrives. Returns how many requests changed.
  handleRetroArrEvent(event: string, data: RetroArrEventData): number {
    const gameId = typeof data.gameId === 'number' ? data.gameId : null;
    if (gameId === null) return 0;
    const affected = this.store
      .listRequests({ statuses: TRACKED_STATUSES })
      .filter((r) => r.retroarrGameId === gameId);
    const text = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null);
    for (const request of affected) {
      switch (event) {
        case 'OnDownloadStarted':
          this.store.updateRequest(request.id, { status: 'downloading', release: text(data.release), error: null });
          this.log.info(`request ${request.id}: RetroArr grabbed ${text(data.release) ?? 'a release'}`);
          break;
        case 'OnDownloadCompleted':
          // An add-on request is done once everything it asked for is in: the poller checks
          if (request.kind === 'addons') this.store.updateRequest(request.id, { status: 'searching' });
          else this.markAvailable(request, gameId, text(data.release));
          break;
        case 'OnDownloadFailed': {
          // RetroArr blocklists the release and searches again on its own: the request goes on
          const reason = text(data.reason);
          const updated = this.store.updateRequest(request.id, {
            status: 'searching',
            error: `The last download failed${reason ? `: ${reason}` : ''}. RetroArr is searching again.`,
          })!;
          this.log.warn(`request ${request.id}: download failed (${data.stage ?? 'download'}): ${reason ?? 'no reason given'}`);
          void this.notifier.downloadFailed(updated, reason);
          break;
        }
        case 'OnGameRemoved': {
          const failed = this.store.updateRequest(request.id, { status: 'failed', error: 'The game was removed from RetroArr.' })!;
          void this.notifier.statusChanged(failed);
          break;
        }
        default:
          return 0;
      }
    }
    return affected.length;
  }

  // Live download progress for the requests RetroArr is fetching (or replacing), from its download client
  async progress(user: User, all: boolean, replacingGameIds: number[] = []) {
    const mine = all && this.isAdmin(user) ? {} : { userId: user.id };
    const ids = new Set<number>(replacingGameIds);
    for (const r of this.store.listRequests({ ...mine, statuses: ['searching', 'downloading'] })) {
      if (r.retroarrGameId !== null) ids.add(r.retroarrGameId);
    }
    if (ids.size === 0) return { progress: [] };
    try {
      return { progress: await this.retroarr.progress([...ids]) };
    } catch (err) {
      // An older RetroArr has no progress endpoint; the page still works without it
      this.log.warn(`progress: ${(err as Error).message}`);
      return { progress: [], error: 'Download progress isn’t available right now.' };
    }
  }

  // Each request's timeline, with RetroArr's search status for those it's looking for. RetroArr not answering only
  // leaves out the search detail.
  async timelines(list: GameRequest[], admin: boolean): Promise<Map<number, Timeline>> {
    const hunting = list.filter((r) => r.status === 'searching' && r.retroarrGameId !== null).map((r) => r.retroarrGameId!);
    let status: Awaited<ReturnType<RetroArrClient['searchStatus']>> | null = null;
    if (hunting.length > 0) {
      try {
        status = await this.retroarr.searchStatus([...new Set(hunting)]);
      } catch (err) {
        this.log.warn(`search status: ${(err as Error).message}`);
      }
    }
    const out = new Map<number, Timeline>();
    for (const r of list) {
      const t = buildTimeline(r, this.store.requestEvents(r.id), r.retroarrGameId !== null ? status?.games.get(r.retroarrGameId) : undefined, status?.monitoring ?? true);
      out.set(r.id, admin ? t : forUser(t));
    }
    return out;
  }

  async timeline(user: User, id: number): Promise<Timeline> {
    const r = this.mustGet(id);
    if (r.userId !== user.id && !this.isAdmin(user)) throw new RequestError('Request not found.', 404, 'not_found');
    return (await this.timelines([r], this.isAdmin(user))).get(r.id)!;
  }

  // release: what was imported, when the webhook says
  private markAvailable(request: GameRequest, gameId: number, release: string | null = null): GameRequest {
    const updated = this.store.updateRequest(request.id, {
      status: 'available',
      retroarrGameId: gameId,
      release: release ?? undefined,
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
