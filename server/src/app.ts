import { parseAddOns, parseVersion } from './versions.js';
import { HACK_KINDS, RomHackCatalogue } from './romhacks.js';
import { DirectIgdbRetroArrClient, IgdbError } from './igdb.js';
import { createHash, timingSafeEqual } from 'node:crypto';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import cookie from '@fastify/cookie';
import fastifyStatic from '@fastify/static';
import Fastify, { type FastifyReply, type FastifyRequest } from 'fastify';
import { CSRF_HEADER, hashSessionId, LoginLimiter, newSession, SESSION_COOKIE } from './auth.js';
import type { Config } from './config.js';
import type { Db } from './db.js';
import { JellyfinAuthError, type JellyfinClient } from './jellyfin.js';
import { Notifier } from './notify.js';
import { REQUEST_API_VERSION, RetroArrError, type RetroArrClient } from './retroarr.js';
import { RequestError, RequestService } from './requests.js';
import { IssueService, isIssueKind } from './issues.js';
import { DiscoverService } from './discover.js';
import { RecommendService } from './recommend.js';
import { RommClient, RommError } from './romm.js';
import { SettingsError, SettingsService } from './settings.js';
import { REGIONS } from './versions.js';
import { CollectionService } from './collections.js';
import { TaskRunner, TaskSkipped } from './tasks.js';
import { Store, type User } from './store.js';

declare module 'fastify' {
  interface FastifyRequest {
    user: User | null;
  }
}

export interface AppDeps {
  config: Config;
  db: Db;
  jellyfin: JellyfinClient;
  retroarr: RetroArrClient;
  fetchImpl?: typeof fetch;
  webDir?: string | null;
  now?: () => Date;
  logger?: boolean;
  // Where Settings reads which settings the environment gave (tests pass their own)
  env?: Record<string, string | undefined>;
}

const PUBLIC_ROUTES = new Set(['/api/health', '/api/auth/login']);
// Called by RetroArr, not a browser: no session or CSRF header, the shared token authenticates it
const WEBHOOK_ROUTE = '/api/webhooks/retroarr';

// Compared as hashes, so neither the length nor the content leaks through timing
function tokensMatch(given: string, expected: string): boolean {
  const a = createHash('sha256').update(given).digest();
  const b = createHash('sha256').update(expected).digest();
  return timingSafeEqual(a, b);
}

export async function buildApp(deps: AppDeps) {
  const { config, db } = deps;
  // Fastify takes a hop count for trustProxy too; its typings only list string and boolean
  const app = Fastify({ logger: deps.logger ?? true, trustProxy: config.trustProxy as boolean | string, bodyLimit: 64 * 1024 });
  const log = {
    info: (m: string) => app.log.info(m),
    warn: (m: string) => app.log.warn(m),
    error: (m: string) => app.log.error(m),
  };
  const store = new Store(db, deps.now);
  // Settings an admin saved replace the environment's values in config, so everything below reads them
  const settings = new SettingsService(config, store, deps.env ?? process.env);
  const notifier = new Notifier(() => config.discordWebhookUrl, log, deps.fetchImpl);
  const requests = new RequestService(config, store, deps.retroarr, notifier, log, deps.now);
  const issues = new IssueService(store, deps.retroarr, notifier, log, (u) => requests.isAdmin(u), deps.now);
  const discover = new DiscoverService(store, deps.retroarr, requests);
  // RomM's API address can change in Settings: one client per address, made when first needed
  let rommClient: { url: string; client: RommClient } | null = null;
  const romm = (): RommClient | null => {
    const url = config.rommApiUrl;
    if (!url) return null;
    if (rommClient?.url !== url) rommClient = { url, client: new RommClient(url, deps.fetchImpl) };
    return rommClient.client;
  };
  // RetroArr's ROM hack catalogue (homelab-iac's files/retroarr/romhacks.yaml)
  const romHacks = new RomHackCatalogue(deps.retroarr, store, () => requests.platforms(), deps.now);
  const recommend = new RecommendService(config, store, discover, romm, log, deps.now, romHacks);
  const collections = new CollectionService(db, store, deps.retroarr, requests, discover, log, deps.fetchImpl, deps.now);
  const limiter = new LoginLimiter();

  // The timed jobs, one at a time (Tasks page). Started by index.ts, not here, so tests drive them by hand.
  const tasks = new TaskRunner(
    db,
    [
      {
        key: 'request-sync',
        name: 'Follow requests',
        description: 'Asks RetroArr about every request it’s working on, in case a webhook was missed, and links ready ones to the game in RomM once RomM has it (for “Play in RomM”).',
        defaultSeconds: config.pollSeconds,
        minSeconds: 30,
        maxSeconds: 3600,
        canTurnOff: false,
        firstRunMs: 30_000,
        run: async () => {
          const open = store.listRequests({ statuses: ['approved', 'searching', 'downloading'], limit: null }).length;
          if (open === 0 && requests.waitingForRomm() === 0) throw new TaskSkipped('No open requests');
          const polled = open > 0 ? await requests.poll() : 'No open requests';
          const linked = await requests.linkRomm();
          return linked > 0 ? `${polled}; ${linked} linked to RomM` : polled;
        },
      },
      {
        key: 'warm-discover',
        name: 'Warm up Discover',
        description: 'Loads Discover’s rows (popular, top rated, popular per platform) and the popular collections ahead of time, so the page opens fast. RetroArr keeps IGDB answers for 6 hours.',
        defaultSeconds: 5 * 3600,
        minSeconds: 3600,
        maxSeconds: 24 * 3600,
        canTurnOff: true,
        firstRunMs: 2 * 60_000,
        run: async () => {
          const { loaded, failed } = await discover.warm();
          if (loaded === 0 && failed > 0) throw new Error('RetroArr couldn’t load any of Discover’s rows (is IGDB set up and reachable?)');
          const series = await collections.refreshPopular().catch(() => 0);
          return `${loaded} row(s) loaded${failed ? `, ${failed} failed` : ''}; ${series} popular collection(s)`;
        },
      },
      {
        key: 'housekeeping',
        name: 'Housekeeping',
        description: 'Deletes expired sign-ins, list imports saved more than 30 days ago (their games stay in the list), and IGDB answers kept over a week.',
        defaultSeconds: 24 * 3600,
        minSeconds: 3600,
        maxSeconds: 7 * 24 * 3600,
        canTurnOff: false,
        firstRunMs: 10 * 60_000,
        run: async () => {
          store.pruneSessions();
          const now = deps.now?.() ?? new Date();
          const imports = collections.lists.pruneSavedImports(new Date(now.getTime() - 30 * 86_400_000));
          const igdb = deps.retroarr instanceof DirectIgdbRetroArrClient ? deps.retroarr.igdbApi.prune() : 0;
          return `${imports} old import(s) removed${igdb ? `, ${igdb} old IGDB answer(s)` : ''}`;
        },
      },
    ],
    log,
    deps.now,
  );

  app.decorate('requestService', requests);
  app.decorateRequest('user', null);
  await app.register(cookie);

  app.addHook('onSend', async (_req, reply) => {
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('Referrer-Policy', 'same-origin');
    reply.header('X-Frame-Options', 'DENY');
    reply.header(
      'Content-Security-Policy',
      // Trailers play in YouTube's privacy-enhanced player
      "default-src 'self'; img-src 'self' https: data:; style-src 'self' 'unsafe-inline'; frame-src https://www.youtube-nocookie.com; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
    );
  });

  // Session, CSRF and Origin checks for the API
  app.addHook('preHandler', async (req, reply) => {
    if (!req.url.startsWith('/api/')) return;
    const path = req.url.split('?')[0]!;
    if (path === WEBHOOK_ROUTE) return;

    if (req.method !== 'GET' && req.method !== 'HEAD') {
      if (req.headers[CSRF_HEADER] !== '1') return reply.code(403).send({ error: 'Missing request header.' });
      const origin = req.headers.origin;
      if (config.publicUrl && origin && origin !== new URL(config.publicUrl).origin) {
        return reply.code(403).send({ error: 'Cross-origin request refused.' });
      }
    }

    const sid = req.cookies[SESSION_COOKIE];
    req.user = sid ? store.sessionUser(hashSessionId(sid)) : null;
    if (!req.user && !PUBLIC_ROUTES.has(path)) return reply.code(401).send({ error: 'Sign in first.' });
  });

  const requireAdmin = async (req: FastifyRequest, reply: FastifyReply) => {
    if (!req.user || !requests.isAdmin(req.user)) return reply.code(403).send({ error: 'Admins only.' });
  };
  // Every admins-only route, as "METHOD /path": the tests send a non-admin to each one
  const adminRoutes: string[] = [];
  // Every route, for the tests that send each one hostile input
  const routes: string[] = [];
  app.addHook('onRoute', (route) => {
    for (const m of [route.method].flat()) if (m !== 'HEAD') routes.push(`${m} ${route.url}`);
    const pre = route.preHandler;
    if (pre === requireAdmin || (Array.isArray(pre) && pre.includes(requireAdmin)))
      for (const m of [route.method].flat()) if (m !== 'HEAD') adminRoutes.push(`${m} ${route.url}`);
  });

  app.setErrorHandler((err, req, reply) => {
    if (err instanceof RequestError) {
      return reply.code(err.statusCode).send({ error: err.message, code: err.code, request: err.request });
    }
    // RetroArr couldn't ask IGDB (not set up, or not answering): say so plainly
    if (err instanceof RetroArrError && (err.status === 503 || err.status === 502)) {
      return reply.code(503).send({ error: err.message.replace(/^RetroArr answered 50[23]: /, '') });
    }
    // g-seekr's own IGDB app: not answering, or its credentials refused
    if (err instanceof IgdbError) {
      req.log.warn(err.message);
      return reply.code(503).send({ error: `IGDB isn't answering just now: ${err.message}` });
    }
    const status = (err as { statusCode?: number }).statusCode;
    if (status && status < 500) return reply.code(status).send({ error: (err as Error).message });
    req.log.error(err);
    return reply.code(502).send({ error: `Something went wrong upstream: ${(err as Error).message}` });
  });

  const me = (user: User) => ({
    user: { id: user.id, username: user.username, isAdmin: requests.isAdmin(user), autoApprove: user.autoApprove },
    limits: requests.limitFor(user),
    rommUrl: config.rommUrl,
    prefs: store.userPrefs(user.id),
  });

  // ---- auth ----

  // RetroArr's webhooks (OnDownloadStarted, OnDownloadCompleted, OnDownloadFailed, OnGameRemoved). Off, and answered
  // 404, without RETROARR_WEBHOOK_TOKEN.
  app.post<{ Body: { event?: unknown; data?: unknown } }>(WEBHOOK_ROUTE, async (req, reply) => {
    const expected = config.retroarrWebhookToken;
    if (!expected) return reply.code(404).send({ error: 'Not found.' });
    const given = req.headers['x-webhook-token'];
    if (typeof given !== 'string' || !tokensMatch(given, expected)) return reply.code(401).send({ error: 'Wrong or missing webhook token.' });
    const event = typeof req.body?.event === 'string' ? req.body.event : null;
    const data = req.body?.data && typeof req.body.data === 'object' ? (req.body.data as Record<string, unknown>) : null;
    if (!event || !data) return reply.code(400).send({ error: 'Expected {"event": …, "data": {…}}.' });
    const updated = requests.handleRetroArrEvent(event, data) + issues.handleRetroArrEvent(event, data);
    return reply.code(200).send({ updated });
  });

  app.get('/api/health', async () => {
    db.prepare('SELECT 1').get();
    return { ok: true };
  });

  app.post<{ Body: { username?: unknown; password?: unknown } }>('/api/auth/login', async (req, reply) => {
    const username = typeof req.body?.username === 'string' ? req.body.username.trim() : '';
    const password = typeof req.body?.password === 'string' ? req.body.password : '';
    if (!username) return reply.code(400).send({ error: 'Enter your Jellyfin username.' });
    if (limiter.blocked(req.ip, username)) return reply.code(429).send({ error: 'Too many failed sign-ins. Wait a few minutes.' });

    let jf;
    try {
      jf = await deps.jellyfin.authenticate(username, password);
    } catch (err) {
      if (err instanceof JellyfinAuthError) {
        req.log.warn(err.message);
        return reply.code(502).send({ error: 'Jellyfin can’t be reached right now.' });
      }
      throw err;
    }
    if (!jf) {
      limiter.fail(req.ip, username);
      req.log.info(`failed sign-in for ${username} from ${req.ip}`);
      return reply.code(401).send({ error: 'Wrong username or password.' });
    }

    let user = store.upsertUser(jf.id, jf.name, jf.isAdmin);
    // The first Jellyfin admin to sign in runs g-seekr, even when Jellyfin admins aren't admins here
    if (jf.isAdmin && !user.isAdmin && !store.anyAdmin()) user = store.updateUser(user.id, { isAdmin: true })!;
    store.pruneSessions();
    const session = newSession(store, user, config.sessionDays, deps.now?.());
    reply.setCookie(SESSION_COOKIE, session.id, {
      path: '/',
      httpOnly: true,
      sameSite: 'lax',
      secure: config.secureCookies,
      expires: session.expires,
    });
    req.log.info(`${user.username} signed in`);
    return me(user);
  });

  app.post('/api/auth/logout', async (req, reply) => {
    const sid = req.cookies[SESSION_COOKIE];
    if (sid) store.deleteSession(hashSessionId(sid));
    reply.clearCookie(SESSION_COOKIE, { path: '/' });
    return { ok: true };
  });

  app.get('/api/me', async (req) => me(req.user!));

  // ---- browsing ----

  app.get('/api/platforms', async () =>
    (await requests.platforms()).map(({ id, name, slug, category, hasAddOns }) => ({ id, name, slug, category, hasAddOns: hasAddOns === true })),
  );

  app.get<{ Querystring: { q?: string } }>('/api/search', async (req, reply) => {
    const q = (req.query.q ?? '').trim();
    if (q.length < 2) return reply.code(400).send({ error: 'Type at least two characters.' });
    if (q.length > 100) return reply.code(400).send({ error: 'That search is too long.' });
    return { results: await requests.search(q) };
  });

  // ---- discovery (IGDB lists through RetroArr) ----

  app.get('/api/me/filters', async (req) => ({ filters: discover.filtersFor(req.user!) }));
  app.put<{ Body: { filters?: unknown } }>('/api/me/filters', async (req) => ({ filters: discover.saveFilters(req.user!, req.body?.filters) }));

  app.get('/api/discover/options', async () => discover.options());

  app.get('/api/discover/recent', async () => ({ games: await discover.recentlyAdded() }));

  app.post<{ Body: { list?: unknown; sort?: unknown; query?: unknown; page?: unknown; platformId?: unknown; filters?: unknown } }>(
    '/api/discover/games',
    async (req) => discover.games(req.body ?? {}),
  );

  const gameId = (raw: string): number | null => {
    const id = Number(raw);
    return Number.isInteger(id) && id > 0 ? id : null;
  };

  app.get<{ Params: { igdbId: string } }>('/api/games/:igdbId', async (req, reply) => {
    const igdbId = gameId(req.params.igdbId);
    if (igdbId === null) return reply.code(404).send({ error: 'Game not found.' });
    const page = await discover.game(igdbId, discover.filtersFor(req.user!).includeAdult);
    const liked = store.likes(req.user!.id).some((l) => l.igdbId === igdbId);
    return { ...page, mine: { liked, dismissed: store.dismissed(req.user!.id).has(igdbId) } };
  });

  // ---- ROM hacks ----

  // ?igdbId= (the hacks of a game), ?platform=, ?kind=
  app.get<{ Querystring: { igdbId?: string; platform?: string; kind?: string } }>('/api/romhacks', async (req) => {
    const igdbId = Number(req.query.igdbId) || null;
    const platformId = Number(req.query.platform) || undefined;
    const kind = HACK_KINDS.find((k) => k === req.query.kind);
    try {
      return { hacks: await romHacks.cards({ igdbIds: igdbId ? [igdbId] : undefined, platformId, kind }, requests.isAdmin(req.user!)), kinds: HACK_KINDS };
    } catch (err) {
      // An older RetroArr without the catalogue, or RetroArr down: no hacks, not an error page
      app.log.warn(`romhacks: ${(err as Error).message}`);
      return { hacks: [], kinds: HACK_KINDS, error: 'RetroArr’s ROM hack catalogue couldn’t be read.' };
    }
  });

  // ---- recommendations ----

  app.get('/api/recommendations', async (req) => recommend.forUser(req.user!));

  app.put<{ Params: { igdbId: string }; Body: { liked?: unknown; title?: unknown } }>('/api/games/:igdbId/like', async (req, reply) => {
    const igdbId = gameId(req.params.igdbId);
    if (igdbId === null || typeof req.body?.liked !== 'boolean') return reply.code(400).send({ error: 'Say whether you like it.' });
    const title = typeof req.body.title === 'string' ? req.body.title.trim().slice(0, 200) : '';
    store.setLike(req.user!.id, igdbId, title || `Game ${igdbId}`, req.body.liked);
    if (req.body.liked) store.setDismissed(req.user!.id, igdbId, false);
    recommend.forget(req.user!.id);
    return { liked: req.body.liked };
  });

  app.put<{ Params: { igdbId: string }; Body: { dismissed?: unknown; title?: unknown } }>('/api/games/:igdbId/dismiss', async (req, reply) => {
    const igdbId = gameId(req.params.igdbId);
    if (igdbId === null || typeof req.body?.dismissed !== 'boolean') return reply.code(400).send({ error: 'Say whether you’re interested.' });
    const title = typeof req.body.title === 'string' ? req.body.title.trim().slice(0, 200) : '';
    store.setDismissed(req.user!.id, igdbId, req.body.dismissed, title);
    if (req.body.dismissed) store.setLike(req.user!.id, igdbId, '', false);
    recommend.forget(req.user!.id);
    return { dismissed: req.body.dismissed };
  });

  // ---- settings: the user's own ----

  // Settings → Recommendations: what the user liked and marked "not interested", to undo either. A "not interested"
  // from before titles were kept is looked up once (20 at a time) and remembered.
  app.get('/api/me/taste', async (req) => {
    const userId = req.user!.id;
    const dismissed = store.dismissedList(userId);
    const missing = dismissed.filter((d) => !d.title).slice(0, 20);
    await Promise.all(
      missing.map(async (d) => {
        const game = await deps.retroarr.discoverGame(d.igdbId, true).catch(() => null);
        if (game?.game.title) {
          d.title = game.game.title;
          store.setDismissedTitle(userId, d.igdbId, game.game.title);
        }
      }),
    );
    return { liked: store.likes(userId), dismissed };
  });

  // Settings → Content: the platforms to offer first and the region to pick when requesting
  app.put<{ Body: { platforms?: unknown; region?: unknown } }>('/api/me/preferences', async (req, reply) => {
    const raw = req.body?.platforms;
    if (!Array.isArray(raw) || raw.length > 50 || !raw.every((n) => Number.isInteger(n) && (n as number) > 0))
      return reply.code(400).send({ error: 'Platforms must be a list of platform ids.' });
    const region = typeof req.body?.region === 'string' ? req.body.region.trim() : '';
    if (region && !(REGIONS as readonly string[]).includes(region)) return reply.code(400).send({ error: `Region must be one of ${REGIONS.join(', ')}.` });
    const known = new Set((await requests.platforms()).map((p) => p.id));
    const platforms = [...new Set(raw as number[])].filter((id) => known.has(id));
    store.saveUserPrefs(req.user!.id, { platforms, region });
    return { prefs: store.userPrefs(req.user!.id) };
  });

  // ---- settings: the server's (admins only) ----

  const connections = () => ({
    jellyfinUrl: config.jellyfinUrl,
    retroarrUrl: config.retroarrUrl,
    retroarrToken: Boolean(config.retroarrToken),
    retroarrWebhookToken: Boolean(config.retroarrWebhookToken),
    igdb: Boolean(config.igdbClientId && config.igdbClientSecret),
    rommApiUrl: config.rommApiUrl,
  });

  app.get('/api/admin/settings', { preHandler: requireAdmin }, async () => ({ settings: settings.list(), connections: connections() }));

  app.patch<{ Body: { settings?: unknown } }>('/api/admin/settings', { preHandler: requireAdmin }, async (req, reply) => {
    try {
      return { settings: settings.update(req.body?.settings as Record<string, unknown>, req.user!.id), connections: connections() };
    } catch (err) {
      if (err instanceof SettingsError) return reply.code(400).send({ error: err.message });
      throw err;
    }
  });

  // Settings → Connections and Notifications: try one connection now and say how it went
  app.post<{ Params: { what: string } }>('/api/admin/settings/test/:what', { preHandler: requireAdmin }, async (req, reply) => {
    const ok = (message: string) => ({ ok: true, message });
    const failed = (err: unknown) => ({ ok: false, message: (err as Error).message });
    switch (req.params.what) {
      case 'jellyfin':
        return deps.jellyfin
          .ping()
          .then((i) => ok(`Jellyfin answered${i.serverName ? `: ${i.serverName}` : ''}${i.version ? ` (${i.version})` : ''}.`))
          .catch(failed);
      case 'retroarr':
        return deps.retroarr
          .info()
          .then((i) =>
            i.apiVersion === REQUEST_API_VERSION
              ? ok(`RetroArr accepted the token${i.appVersion ? ` (version ${i.appVersion})` : ''}; its request API matches.`)
              : { ok: false, message: `RetroArr's request API is version ${i.apiVersion}; this g-seekr speaks ${REQUEST_API_VERSION}. Update ${i.apiVersion < REQUEST_API_VERSION ? 'RetroArr' : 'g-seekr'}.` },
          )
          .catch((err: unknown) =>
            err instanceof RetroArrError && err.status === 404
              ? { ok: false, message: 'RetroArr accepted the token but has no request API: update RetroArr.' }
              : failed(err),
          );
      case 'romm': {
        const client = romm();
        if (!client) return { ok: false, message: 'No RomM API address is set.' };
        return client
          .heartbeat()
          .then((h) => ok(`RomM answered${h.version ? ` (version ${h.version})` : ''}.`))
          .catch(failed);
      }
      case 'discord':
        return notifier
          .test()
          .then(() => ok('Sent a test message to the Discord channel.'))
          .catch(failed);
      default:
        return reply.code(404).send({ error: 'Nothing to test by that name.' });
    }
  });

  app.get('/api/me/romm', async (req) => recommend.rommStatus(req.user!));

  app.put<{ Body: { token?: unknown } }>('/api/me/romm', async (req, reply) => {
    if (typeof req.body?.token !== 'string') return reply.code(400).send({ error: 'Paste your RomM client token.' });
    try {
      await recommend.link(req.user!, req.body.token);
    } catch (err) {
      if (err instanceof RommError) return reply.code(err.status === 0 || err.status >= 500 ? 502 : 400).send({ error: err.message });
      throw err;
    }
    req.log.info(`${req.user!.username} linked RomM`);
    return recommend.rommStatus(req.user!);
  });

  app.delete('/api/me/romm', async (req) => {
    recommend.unlink(req.user!);
    return recommend.rommStatus(req.user!);
  });

  // ---- collections: IGDB series and curated / imported lists ----

  const collectionId = (raw: string, what: string): number => {
    const id = Number(raw);
    if (!Number.isInteger(id) || id <= 0) throw new RequestError(`${what} not found.`, 404, 'not_found');
    return id;
  };
  const isKind = (k: string): k is 'series' | 'lists' => k === 'series' || k === 'lists';
  // A row that can't load (RetroArr or IGDB down) is left empty rather than failing the whole page
  const orEmpty = async <T>(what: string, p: Promise<T[]>): Promise<T[]> => {
    try {
      return await p;
    } catch (err) {
      log.warn(`collections: ${what}: ${(err as Error).message}`);
      return [];
    }
  };

  app.get('/api/collections', async (req) => {
    const [featured, popular, inProgress, lists] = await Promise.all([
      orEmpty('featured', collections.featured(req.user!)),
      orEmpty('popular', collections.popular(req.user!)),
      orEmpty('in progress', collections.inProgress(req.user!)),
      orEmpty('lists', collections.allLists()),
    ]);
    return { featured, popular, inProgress, lists };
  });

  app.get<{ Querystring: { query?: string } }>('/api/collections/series', async (req, reply) => {
    const q = (req.query.query ?? '').trim();
    if (q.length < 2 || q.length > 100) return reply.code(400).send({ error: 'Type at least two characters.' });
    return { series: await collections.searchSeries(q) };
  });

  app.get<{ Params: { kind: string; id: string } }>('/api/collections/:kind/:id', async (req, reply) => {
    const { kind } = req.params;
    if (!isKind(kind)) return reply.code(404).send({ error: 'Not found.' });
    const id = collectionId(req.params.id, 'Collection');
    return kind === 'series' ? collections.seriesPage(req.user!, id) : collections.listPage(id);
  });

  app.post<{ Params: { kind: string; id: string }; Body: { platformId?: unknown } }>('/api/collections/:kind/:id/request-missing', async (req, reply) => {
    const { kind } = req.params;
    if (!isKind(kind)) return reply.code(404).send({ error: 'Not found.' });
    const platformId = Number(req.body?.platformId);
    if (!Number.isInteger(platformId) || platformId <= 0) return reply.code(400).send({ error: 'Pick a platform.' });
    const result = await collections.requestMissing(req.user!, kind === 'series' ? 'series' : 'list', collectionId(req.params.id, 'Collection'), platformId);
    recommend.forget(req.user!.id);
    return result;
  });

  app.put<{ Params: { id: string }; Body: { featured?: unknown; name?: unknown } }>(
    '/api/collections/series/:id/featured',
    { preHandler: requireAdmin },
    async (req, reply) => {
      if (typeof req.body?.featured !== 'boolean' || typeof req.body.name !== 'string') return reply.code(400).send({ error: 'Say whether to feature it.' });
      collections.lists.setFeaturedSeries(collectionId(req.params.id, 'Series'), req.body.name.trim().slice(0, 200), req.body.featured);
      return { featured: req.body.featured };
    },
  );

  const listText = (v: unknown, max: number): string | null | undefined =>
    v === null ? null : typeof v === 'string' ? v.trim().slice(0, max) || null : undefined;

  app.post<{ Body: { name?: unknown; description?: unknown } }>('/api/lists', { preHandler: requireAdmin }, async (req, reply) => {
    const name = listText(req.body?.name, 120);
    if (!name) return reply.code(400).send({ error: 'Name the list.' });
    const list = collections.lists.createList({ name, description: listText(req.body?.description, 1000) ?? null, source: null, createdBy: req.user!.id });
    return reply.code(201).send({ list });
  });

  app.patch<{ Params: { id: string }; Body: { name?: unknown; description?: unknown; featured?: unknown } }>(
    '/api/lists/:id',
    { preHandler: requireAdmin },
    async (req, reply) => {
      const id = collectionId(req.params.id, 'List');
      if (!collections.lists.list(id)) return reply.code(404).send({ error: 'List not found.' });
      const b = req.body ?? {};
      const name = listText(b.name, 120);
      if (name === null) return reply.code(400).send({ error: 'A list needs a name.' });
      const list = collections.lists.updateList(id, {
        name,
        description: listText(b.description, 1000),
        featured: typeof b.featured === 'boolean' ? b.featured : undefined,
      });
      return { list };
    },
  );

  app.delete<{ Params: { id: string } }>('/api/lists/:id', { preHandler: requireAdmin }, async (req, reply) => {
    collections.lists.deleteList(collectionId(req.params.id, 'List'));
    return reply.code(204).send();
  });

  app.post<{ Params: { id: string }; Body: { igdbId?: unknown; platformId?: unknown; title?: unknown; year?: unknown; coverUrl?: unknown } }>(
    '/api/lists/:id/items',
    { preHandler: requireAdmin },
    async (req, reply) => {
      const id = collectionId(req.params.id, 'List');
      if (!collections.lists.list(id)) return reply.code(404).send({ error: 'List not found.' });
      const b = req.body ?? {};
      const igdbId = Number(b.igdbId);
      const platformId = Number(b.platformId);
      const title = listText(b.title, 200);
      if (!Number.isInteger(igdbId) || igdbId <= 0 || !Number.isInteger(platformId) || platformId <= 0 || !title) {
        return reply.code(400).send({ error: 'Pick a game and a platform.' });
      }
      const year = Number(b.year);
      const coverUrl = typeof b.coverUrl === 'string' && /^https:\/\//.test(b.coverUrl) ? b.coverUrl : null;
      const added = collections.lists.addItems(id, [{ igdbId, platformId, title, year: Number.isInteger(year) && year > 0 ? year : null, coverUrl }]);
      return reply.code(added ? 201 : 200).send({ added });
    },
  );

  app.delete<{ Params: { id: string; igdbId: string; platformId: string } }>(
    '/api/lists/:id/items/:igdbId/:platformId',
    { preHandler: requireAdmin },
    async (req, reply) => {
      collections.lists.removeItem(collectionId(req.params.id, 'List'), Number(req.params.igdbId), Number(req.params.platformId));
      return reply.code(204).send();
    },
  );

  // Imports: a DAT file can be a few MB
  app.get('/api/imports', { preHandler: requireAdmin }, async () => ({ imports: collections.lists.imports() }));

  app.post<{ Body: Record<string, unknown> }>('/api/imports', { preHandler: requireAdmin, bodyLimit: 16 * 1024 * 1024 }, async (req, reply) =>
    reply.code(201).send({ import: await collections.startImport(req.user!, req.body ?? {}) }),
  );

  app.get<{ Params: { id: string } }>('/api/imports/:id', { preHandler: requireAdmin }, async (req) => collections.review(collectionId(req.params.id, 'Import')));

  app.patch<{ Params: { id: string; idx: string }; Body: { choice?: unknown; skip?: unknown } }>(
    '/api/imports/:id/items/:idx',
    { preHandler: requireAdmin },
    async (req) => ({ item: collections.chooseItem(collectionId(req.params.id, 'Import'), Number(req.params.idx), req.body ?? {}) }),
  );

  app.post<{ Params: { id: string } }>('/api/imports/:id/retry', { preHandler: requireAdmin }, async (req) => ({
    import: collections.retryImport(collectionId(req.params.id, 'Import')),
  }));

  app.post<{ Params: { id: string } }>('/api/imports/:id/save', { preHandler: requireAdmin }, async (req) => collections.save(req.user!, collectionId(req.params.id, 'Import')));

  app.delete<{ Params: { id: string } }>('/api/imports/:id', { preHandler: requireAdmin }, async (req, reply) => {
    collections.discardImport(collectionId(req.params.id, 'Import'));
    return reply.code(204).send();
  });

  // ---- tasks (admin) ----

  app.get('/api/admin/tasks', { preHandler: requireAdmin }, async () => ({ tasks: tasks.statuses() }));

  app.put<{ Params: { key: string }; Body: { intervalSeconds?: unknown } }>('/api/admin/tasks/:key', { preHandler: requireAdmin }, async (req, reply) => {
    if (!tasks.status(req.params.key)) return reply.code(404).send({ error: 'No such task.' });
    try {
      return { task: tasks.setInterval(req.params.key, Number(req.body?.intervalSeconds)) };
    } catch (err) {
      if (err instanceof RangeError) return reply.code(400).send({ error: err.message });
      throw err;
    }
  });

  app.post<{ Params: { key: string } }>('/api/admin/tasks/:key/run', { preHandler: requireAdmin }, async (req, reply) => {
    if (!tasks.status(req.params.key)) return reply.code(404).send({ error: 'No such task.' });
    if (!tasks.runNow(req.params.key)) return reply.code(409).send({ error: 'It’s already running or waiting its turn.', task: tasks.status(req.params.key) });
    return reply.code(202).send({ task: tasks.status(req.params.key) });
  });

  // ---- requests ----

  const idParam = (raw: string): number => {
    const id = Number(raw);
    if (!Number.isInteger(id) || id <= 0) throw new RequestError('Request not found.', 404, 'not_found');
    return id;
  };
  const optionalNote = (body: unknown): string | undefined => {
    const note = (body as { note?: unknown } | undefined)?.note;
    return typeof note === 'string' && note.trim() ? note.trim().slice(0, 500) : undefined;
  };

  // withStatus: each request's current step ("No copy found yet, next look at 6 pm"), for the Requests page
  app.get<{ Querystring: { scope?: string; withStatus?: string } }>('/api/requests', async (req) => {
    const admin = requests.isAdmin(req.user!);
    const all = req.query.scope === 'all' && admin;
    const list = store.listRequests(all ? {} : { userId: req.user!.id });
    if (req.query.withStatus !== '1') return { requests: list };
    const timelines = await requests.timelines(list, admin);
    return { requests: list.map((r) => ({ ...r, now: timelines.get(r.id)!.current })) };
  });

  app.get<{ Params: { id: string } }>('/api/requests/:id/timeline', async (req) => requests.timeline(req.user!, idParam(req.params.id)));

  app.post<{
    Body: {
      igdbId?: unknown;
      platformId?: unknown;
      region?: unknown;
      variant?: unknown;
      latestRevision?: unknown;
      kind?: unknown;
      latestUpdate?: unknown;
      allDlc?: unknown;
      dlc?: unknown;
      hackId?: unknown;
    };
  }>('/api/requests', async (req, reply) => {
    // A ROM hack from RetroArr's catalogue: { kind: 'hack', hackId }
    if (req.body?.kind === 'hack') {
      const hack = typeof req.body.hackId === 'string' ? await romHacks.find(req.body.hackId) : null;
      if (!hack) return reply.code(404).send({ error: 'That ROM hack isn’t in the catalogue.' });
      const created = await requests.createHack(req.user!, hack);
      romHacks.forget();
      recommend.forget(req.user!.id);
      return reply.code(201).send({ request: created });
    }
    const igdbId = Number(req.body?.igdbId);
    const platformId = Number(req.body?.platformId);
    if (!Number.isInteger(igdbId) || igdbId <= 0 || !Number.isInteger(platformId) || platformId <= 0) {
      return reply.code(400).send({ error: 'Pick a game and a platform.' });
    }
    // Which version: a region, the English translation, the latest revision (none: any, as before)
    const version = parseVersion(req.body);
    if (typeof version === 'string') return reply.code(400).send({ error: version });
    // Updates and DLC, with the game or (kind addons) for a game the library has
    const addOns = parseAddOns(req.body);
    if (typeof addOns === 'string') return reply.code(400).send({ error: addOns });
    const kind = req.body?.kind === 'addons' ? 'addons' : 'game';
    const created = await requests.create(req.user!, igdbId, platformId, version, addOns, kind);
    recommend.forget(req.user!.id);
    return reply.code(201).send({ request: created });
  });

  app.post<{ Params: { id: string } }>('/api/requests/:id/approve', { preHandler: requireAdmin }, async (req) => ({
    request: await requests.approve(req.user!, idParam(req.params.id), optionalNote(req.body)),
  }));

  app.post<{ Params: { id: string } }>('/api/requests/:id/decline', { preHandler: requireAdmin }, async (req) => ({
    request: await requests.decline(req.user!, idParam(req.params.id), optionalNote(req.body)),
  }));

  app.post<{ Params: { id: string } }>('/api/requests/:id/retry', { preHandler: requireAdmin }, async (req) => ({
    request: await requests.retry(req.user!, idParam(req.params.id)),
  }));

  app.delete<{ Params: { id: string } }>('/api/requests/:id', async (req, reply) => {
    requests.cancel(req.user!, idParam(req.params.id));
    return reply.code(204).send();
  });

  // Live progress of what RetroArr is downloading for the user's requests (everyone's for an admin)
  app.get<{ Querystring: { scope?: string } }>('/api/progress', async (req) => {
    const all = req.query.scope === 'all' && requests.isAdmin(req.user!);
    const replacing = issues
      .list(req.user!, all)
      .filter((i) => i.status === 'replacing' && i.retroarrGameId !== null)
      .map((i) => i.retroarrGameId!);
    return requests.progress(req.user!, all, replacing);
  });

  // ---- problem reports ----

  app.get<{ Querystring: { scope?: string } }>('/api/issues', async (req) => ({ issues: issues.list(req.user!, req.query.scope === 'all') }));

  app.post<{ Params: { id: string }; Body: { kind?: unknown; message?: unknown } }>('/api/requests/:id/issues', async (req, reply) => {
    const kind = req.body?.kind;
    if (!isIssueKind(kind)) return reply.code(400).send({ error: 'Pick what’s wrong.' });
    const raw = req.body?.message;
    const message = typeof raw === 'string' && raw.trim() ? raw.trim().slice(0, 1000) : null;
    if (kind === 'other' && !message) return reply.code(400).send({ error: 'Say what’s wrong.' });
    return reply.code(201).send({ issue: issues.report(req.user!, idParam(req.params.id), kind, message) });
  });

  app.post<{ Params: { id: string } }>('/api/issues/:id/replace', { preHandler: requireAdmin }, async (req) => ({
    issue: await issues.replace(req.user!, idParam(req.params.id)),
  }));

  app.post<{ Params: { id: string } }>('/api/issues/:id/resolve', { preHandler: requireAdmin }, async (req) => ({
    issue: issues.resolve(req.user!, idParam(req.params.id), optionalNote(req.body) ?? null),
  }));

  // ---- admin ----

  app.get('/api/admin/users', { preHandler: requireAdmin }, async () => ({
    users: store.listUsers().map((u) => ({ ...u, effectiveAdmin: requests.isAdmin(u), limits: requests.limitFor(u) })),
  }));

  app.patch<{ Params: { id: string }; Body: { isAdmin?: unknown; autoApprove?: unknown; requestLimit?: unknown } }>(
    '/api/admin/users/:id',
    { preHandler: requireAdmin },
    async (req, reply) => {
      const id = Number(req.params.id);
      const target = Number.isInteger(id) ? store.userById(id) : null;
      if (!target) return reply.code(404).send({ error: 'User not found.' });
      const b = req.body ?? {};
      const patch: { isAdmin?: boolean; autoApprove?: boolean; requestLimit?: number | null } = {};
      if (typeof b.isAdmin === 'boolean') {
        if (target.id === req.user!.id && !b.isAdmin) return reply.code(400).send({ error: 'You can’t remove your own admin rights.' });
        patch.isAdmin = b.isAdmin;
      }
      if (typeof b.autoApprove === 'boolean') patch.autoApprove = b.autoApprove;
      if (b.requestLimit === null) patch.requestLimit = null;
      else if (b.requestLimit !== undefined) {
        const n = Number(b.requestLimit);
        if (!Number.isInteger(n) || n < 0 || n > 1000) return reply.code(400).send({ error: 'The limit must be 0 to 1000 (0 = unlimited).' });
        patch.requestLimit = n;
      }
      const user = store.updateUser(id, patch)!;
      return { user: { ...user, effectiveAdmin: requests.isAdmin(user), limits: requests.limitFor(user) } };
    },
  );

  // ---- the web UI ----

  const webDir = deps.webDir === undefined ? null : deps.webDir;
  if (webDir && existsSync(join(webDir, 'index.html'))) {
    await app.register(fastifyStatic, {
      root: webDir,
      wildcard: false,
      cacheControl: false,
      // Vite names everything under assets/ by its content hash: cached for good. index.html names the current ones.
      setHeaders: (res, path) => {
        res.header('Cache-Control', /[\\/]assets[\\/]/.test(path) ? 'public, max-age=31536000, immutable' : 'no-cache');
      },
    });
    app.setNotFoundHandler((req, reply) => {
      if (req.url.startsWith('/api/') || (req.method !== 'GET' && req.method !== 'HEAD')) return reply.code(404).send({ error: 'Not found.' });
      return reply.header('Cache-Control', 'no-cache').sendFile('index.html');
    });
  } else {
    app.setNotFoundHandler((_req, reply) => reply.code(404).send({ error: 'Not found.' }));
  }

  return { app, store, requests, issues, recommend, collections, tasks, settings, adminRoutes, routes };
}

declare module 'fastify' {
  interface FastifyInstance {
    requestService: RequestService;
  }
}
