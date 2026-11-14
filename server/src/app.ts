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
import type { RetroArrClient } from './retroarr.js';
import { RequestError, RequestService } from './requests.js';
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
  const notifier = new Notifier(config.discordWebhookUrl, log, deps.fetchImpl);
  const requests = new RequestService(config, store, deps.retroarr, notifier, log, deps.now);
  const limiter = new LoginLimiter();

  app.decorate('requestService', requests);
  app.decorateRequest('user', null);
  await app.register(cookie);

  app.addHook('onSend', async (_req, reply) => {
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('Referrer-Policy', 'same-origin');
    reply.header('X-Frame-Options', 'DENY');
    reply.header(
      'Content-Security-Policy',
      "default-src 'self'; img-src 'self' https: data:; style-src 'self' 'unsafe-inline'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
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

  app.setErrorHandler((err, req, reply) => {
    if (err instanceof RequestError) {
      return reply.code(err.statusCode).send({ error: err.message, code: err.code, request: err.request });
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
    const updated = requests.handleRetroArrEvent(event, data);
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

  app.get('/api/platforms', async () => (await requests.platforms()).map(({ id, name, slug, category }) => ({ id, name, slug, category })));

  app.get<{ Querystring: { q?: string } }>('/api/search', async (req, reply) => {
    const q = (req.query.q ?? '').trim();
    if (q.length < 2) return reply.code(400).send({ error: 'Type at least two characters.' });
    if (q.length > 100) return reply.code(400).send({ error: 'That search is too long.' });
    return { results: await requests.search(q) };
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

  app.get<{ Querystring: { scope?: string } }>('/api/requests', async (req) => {
    const all = req.query.scope === 'all' && requests.isAdmin(req.user!);
    return { requests: store.listRequests(all ? {} : { userId: req.user!.id }) };
  });

  app.post<{ Body: { igdbId?: unknown; platformId?: unknown } }>('/api/requests', async (req, reply) => {
    const igdbId = Number(req.body?.igdbId);
    const platformId = Number(req.body?.platformId);
    if (!Number.isInteger(igdbId) || igdbId <= 0 || !Number.isInteger(platformId) || platformId <= 0) {
      return reply.code(400).send({ error: 'Pick a game and a platform.' });
    }
    return reply.code(201).send({ request: await requests.create(req.user!, igdbId, platformId) });
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
    await app.register(fastifyStatic, { root: webDir, wildcard: false });
    app.setNotFoundHandler((req, reply) => {
      if (req.url.startsWith('/api/') || req.method !== 'GET') return reply.code(404).send({ error: 'Not found.' });
      return reply.header('Cache-Control', 'no-cache').sendFile('index.html');
    });
  } else {
    app.setNotFoundHandler((_req, reply) => reply.code(404).send({ error: 'Not found.' }));
  }

  return { app, store, requests };
}

declare module 'fastify' {
  interface FastifyInstance {
    requestService: RequestService;
  }
}
