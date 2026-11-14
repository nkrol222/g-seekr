import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../server/src/app.js';
import { loadConfig, type Config } from '../server/src/config.js';
import { openDb } from '../server/src/db.js';
import { JellyfinClient } from '../server/src/jellyfin.js';
import { RetroArrClient } from '../server/src/retroarr.js';
import { DISCORD, Fakes, JELLYFIN, RETROARR, TOKEN } from './fakes.js';

const H = { 'x-gseekr': '1' };
type App = Awaited<ReturnType<typeof buildApp>>;

let fakes: Fakes;
let built: App;
let clock: Date;

async function start(overrides: Record<string, string> = {}) {
  const config: Config = loadConfig({
    JELLYFIN_URL: JELLYFIN,
    RETROARR_URL: RETROARR,
    RETROARR_TOKEN: TOKEN,
    DISCORD_WEBHOOK_URL: DISCORD,
    ROMM_URL: 'https://romm.test',
    REQUEST_LIMIT: '2',
    ...overrides,
  });
  built = await buildApp({
    config,
    db: openDb(':memory:'),
    jellyfin: new JellyfinClient(JELLYFIN, fakes.fetch),
    retroarr: new RetroArrClient(RETROARR, TOKEN, fakes.fetch),
    fetchImpl: fakes.fetch,
    logger: false,
    now: () => clock,
  });
  return built.app;
}

async function login(username: string, password = 'pw') {
  const res = await built.app.inject({ method: 'POST', url: '/api/auth/login', headers: H, payload: { username, password } });
  const cookie = res.cookies.find((c) => c.name === 'gseekr_session');
  return { res, headers: { ...H, cookie: cookie ? `gseekr_session=${cookie.value}` : '' } };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
  fakes = new Fakes();
  clock = new Date('2026-11-12T12:00:00Z');
});
afterEach(async () => {
  await built?.app.close();
});

describe('config', () => {
  it('names every missing setting and refuses the instance API key', () => {
    expect(() => loadConfig({})).toThrow(/JELLYFIN_URL is required[\s\S]*RETROARR_URL is required[\s\S]*RETROARR_TOKEN is required/);
    expect(() => loadConfig({ JELLYFIN_URL: JELLYFIN, RETROARR_URL: RETROARR, RETROARR_TOKEN: 'abcdef0123456789' })).toThrow(/rat_/);
    expect(() => loadConfig({ JELLYFIN_URL: 'ftp://x', RETROARR_URL: RETROARR, RETROARR_TOKEN: TOKEN })).toThrow(/JELLYFIN_URL must be an http/);
  });
});

describe('sign-in', () => {
  it('checks the password with Jellyfin, closes the Jellyfin session and sets an httpOnly cookie', async () => {
    await start();
    expect((await built.app.inject({ url: '/api/me' })).statusCode).toBe(401);
    expect((await built.app.inject({ url: '/api/health' })).statusCode).toBe(200);

    expect((await login('alice', 'wrong')).res.statusCode).toBe(401);
    const { res, headers } = await login('alice');
    expect(res.statusCode).toBe(200);
    const cookie = res.cookies.find((c) => c.name === 'gseekr_session')!;
    expect(cookie.httpOnly).toBe(true);
    expect(cookie.secure).toBe(true);
    expect(cookie.sameSite).toBe('Lax');
    expect(fakes.jellyfinLogouts).toBe(1);

    const me = await built.app.inject({ url: '/api/me', headers });
    expect(me.json()).toMatchObject({ user: { username: 'alice', isAdmin: false }, limits: { limit: 2, used: 0 }, rommUrl: 'https://romm.test' });

    await built.app.inject({ method: 'POST', url: '/api/auth/logout', headers });
    expect((await built.app.inject({ url: '/api/me', headers })).statusCode).toBe(401);
  });

  it('refuses disabled accounts, reports Jellyfin being down, and slows down guessing', async () => {
    await start();
    fakes.jellyfinUsers.get('bob')!.disabled = true;
    expect((await login('bob')).res.statusCode).toBe(401);

    fakes.jellyfinDown = true;
    expect((await login('alice')).res.statusCode).toBe(502);
    fakes.jellyfinDown = false;

    for (let i = 0; i < 5; i++) expect((await login('alice', 'nope')).res.statusCode).toBe(401);
    expect((await login('alice')).res.statusCode).toBe(429);
  });

  it('makes Jellyfin admins admins, and the first one an admin even when that is switched off', async () => {
    await start({ JELLYFIN_ADMINS_ARE_ADMINS: 'false' });
    const alice = await login('alice');
    expect(alice.res.json().user.isAdmin).toBe(false);
    expect((await login('root')).res.json().user.isAdmin).toBe(true);
  });

  it('needs the CSRF header on every change, and the public origin when one is set', async () => {
    await start({ PUBLIC_URL: 'https://games.test' });
    const noHeader = await built.app.inject({ method: 'POST', url: '/api/auth/login', payload: { username: 'alice', password: 'pw' } });
    expect(noHeader.statusCode).toBe(403);
    const otherOrigin = await built.app.inject({
      method: 'POST',
      url: '/api/auth/login',
      headers: { ...H, origin: 'https://evil.test' },
      payload: { username: 'alice', password: 'pw' },
    });
    expect(otherOrigin.statusCode).toBe(403);
    const sameOrigin = await built.app.inject({
      method: 'POST',
      url: '/api/auth/login',
      headers: { ...H, origin: 'https://games.test' },
      payload: { username: 'alice', password: 'pw' },
    });
    expect(sameOrigin.statusCode).toBe(200);
  });
});

describe('search', () => {
  it('lists only enabled (and allowed) platforms and shows open requests per platform', async () => {
    await start({ ALLOWED_PLATFORMS: 'snes' });
    const { headers } = await login('alice');
    expect((await built.app.inject({ url: '/api/platforms', headers })).json().map((p: { slug: string }) => p.slug)).toEqual(['snes']);

    await built.app.inject({ method: 'POST', url: '/api/requests', headers, payload: { igdbId: 1020, platformId: 41 } });
    const res = await built.app.inject({ url: '/api/search?q=chrono', headers });
    expect(res.json().results).toEqual([
      expect.objectContaining({ igdbId: 1020, title: 'Chrono Trigger', platformIds: [41], requests: [expect.objectContaining({ platformId: 41, status: 'pending' })] }),
    ]);
    expect((await built.app.inject({ url: '/api/search?q=c', headers })).statusCode).toBe(400);
  });
});

describe('requests', () => {
  it('runs pending -> approved -> searching -> downloading -> available, and tells Discord', async () => {
    await start();
    const alice = await login('alice');
    const root = await login('root');

    const created = await built.app.inject({ method: 'POST', url: '/api/requests', headers: alice.headers, payload: { igdbId: 1020, platformId: 41 } });
    expect(created.statusCode).toBe(201);
    const id = created.json().request.id;
    expect(created.json().request).toMatchObject({ status: 'pending', title: 'Chrono Trigger', platformName: 'Super Nintendo', year: 1995 });
    expect(fakes.games).toHaveLength(0);

    // a user can't approve
    expect((await built.app.inject({ method: 'POST', url: `/api/requests/${id}/approve`, headers: alice.headers, payload: {} })).statusCode).toBe(403);

    const approved = await built.app.inject({ method: 'POST', url: `/api/requests/${id}/approve`, headers: root.headers, payload: { note: 'enjoy' } });
    expect(approved.json().request).toMatchObject({ status: 'searching', retroarrGameId: 100, note: 'enjoy' });
    await flush();
    expect(fakes.addedBodies[0]).toMatchObject({ title: 'Chrono Trigger', igdbId: 1020, platformId: 41, monitored: true });
    expect(fakes.addedBodies[0]).not.toHaveProperty('id');
    expect(fakes.addedBodies[0]).not.toHaveProperty('platform');
    expect(fakes.calls).toContain('PUT /games/100/monitored');
    expect(fakes.calls).toContain('POST /games/100/search-now?autoDispatch=true');

    fakes.games[0]!.status = 3;
    await built.requests.poll();
    expect(built.store.request(id)!.status).toBe('downloading');

    fakes.games[0]!.status = 4;
    await built.requests.poll();
    expect(built.store.request(id)).toMatchObject({ status: 'available', availableAt: clock.toISOString() });

    await flush();
    expect(fakes.discord.map((d) => d.content)).toEqual([
      expect.stringContaining('alice requested **Chrono Trigger** (1995) for Super Nintendo. It\'s waiting for approval'),
      expect.stringContaining('**Chrono Trigger** (1995) for Super Nintendo is ready to play, alice'),
    ]);
    expect(fakes.discord.every((d) => JSON.stringify(d.allowed_mentions) === '{"parse":[]}')).toBe(true);

    // already in the library now
    const again = await built.app.inject({ method: 'POST', url: '/api/requests', headers: alice.headers, payload: { igdbId: 1020, platformId: 41 } });
    expect(again.statusCode).toBe(409);
  });

  it('refuses duplicates, wrong platforms, unknown games and requests over the limit', async () => {
    await start();
    const alice = await login('alice');
    const bob = await login('bob');
    const post = (h: Record<string, string>, igdbId: number, platformId: number) =>
      built.app.inject({ method: 'POST', url: '/api/requests', headers: h, payload: { igdbId, platformId } });

    expect((await post(alice.headers, 1020, 41)).statusCode).toBe(201);
    const dup = await post(bob.headers, 1020, 41);
    expect(dup.statusCode).toBe(409);
    expect(dup.json().code).toBe('already_requested');
    expect((await post(alice.headers, 427, 41)).json().code).toBe('wrong_platform');
    expect((await post(alice.headers, 999, 50)).json().code).toBe('unknown_game');
    expect((await post(alice.headers, 1020, 60)).json().code).toBe('invalid_platform');

    expect((await post(alice.headers, 427, 50)).statusCode).toBe(201);
    const over = await post(alice.headers, 1020, 50);
    expect(over.statusCode).toBe(429);

    // the window moves on
    clock = new Date(clock.getTime() + 8 * 86_400_000);
    expect((await post(alice.headers, 1020, 50)).statusCode).toBe(201);
  });

  it('approves admins and auto-approve users at once, and reuses a game RetroArr already has', async () => {
    await start();
    fakes.games.push({ id: 7, title: 'Final Fantasy VII', igdbId: 427, platformId: 50, status: 2, monitored: false });
    const root = await login('root');
    const res = await built.app.inject({ method: 'POST', url: '/api/requests', headers: root.headers, payload: { igdbId: 427, platformId: 50 } });
    expect(res.json().request).toMatchObject({ status: 'searching', retroarrGameId: 7 });
    expect(fakes.addedBodies).toHaveLength(0);
    expect(fakes.games[0]!.monitored).toBe(true);

    const alice = await login('alice');
    const users = (await built.app.inject({ url: '/api/admin/users', headers: root.headers })).json().users;
    const aliceId = users.find((u: { username: string }) => u.username === 'alice').id;
    await built.app.inject({ method: 'PATCH', url: `/api/admin/users/${aliceId}`, headers: root.headers, payload: { autoApprove: true } });
    const auto = await built.app.inject({ method: 'POST', url: '/api/requests', headers: alice.headers, payload: { igdbId: 1020, platformId: 41 } });
    expect(auto.json().request.status).toBe('searching');
  });

  it('marks a request failed when RetroArr refuses the game, and retries it', async () => {
    await start();
    const root = await login('root');
    fakes.failAdd = 'duplicate title';
    const res = await built.app.inject({ method: 'POST', url: '/api/requests', headers: root.headers, payload: { igdbId: 1020, platformId: 41 } });
    expect(res.json().request).toMatchObject({ status: 'failed', error: expect.stringContaining('duplicate title') });

    fakes.failAdd = null;
    const retried = await built.app.inject({ method: 'POST', url: `/api/requests/${res.json().request.id}/retry`, headers: root.headers, payload: {} });
    expect(retried.json().request).toMatchObject({ status: 'searching', error: null });
  });

  it('lets the requester withdraw a pending request but not someone else’s', async () => {
    await start();
    const alice = await login('alice');
    const bob = await login('bob');
    const id = (await built.app.inject({ method: 'POST', url: '/api/requests', headers: alice.headers, payload: { igdbId: 1020, platformId: 41 } })).json().request.id;

    expect((await built.app.inject({ method: 'DELETE', url: `/api/requests/${id}`, headers: bob.headers })).statusCode).toBe(404);
    expect((await built.app.inject({ url: '/api/requests?scope=all', headers: bob.headers })).json().requests).toHaveLength(0);
    expect((await built.app.inject({ method: 'DELETE', url: `/api/requests/${id}`, headers: alice.headers })).statusCode).toBe(204);
    expect(built.store.request(id)).toBeNull();
  });

  it('fails a request whose game disappears from RetroArr', async () => {
    await start();
    const root = await login('root');
    const id = (await built.app.inject({ method: 'POST', url: '/api/requests', headers: root.headers, payload: { igdbId: 1020, platformId: 41 } })).json().request.id;
    fakes.games = [];
    await built.requests.poll();
    expect(built.store.request(id)).toMatchObject({ status: 'failed', error: 'The game was removed from RetroArr.' });
  });
});

describe('admin', () => {
  it('only admins manage users, and an admin can’t demote themselves', async () => {
    await start();
    const alice = await login('alice');
    const root = await login('root');
    expect((await built.app.inject({ url: '/api/admin/users', headers: alice.headers })).statusCode).toBe(403);
    const users = (await built.app.inject({ url: '/api/admin/users', headers: root.headers })).json().users;
    const rootId = users.find((u: { username: string }) => u.username === 'root').id;
    const aliceId = users.find((u: { username: string }) => u.username === 'alice').id;
    await built.app.inject({ method: 'PATCH', url: `/api/admin/users/${rootId}`, headers: root.headers, payload: { isAdmin: true } });
    expect((await built.app.inject({ method: 'PATCH', url: `/api/admin/users/${rootId}`, headers: root.headers, payload: { isAdmin: false } })).statusCode).toBe(400);
    const limited = await built.app.inject({ method: 'PATCH', url: `/api/admin/users/${aliceId}`, headers: root.headers, payload: { requestLimit: 5 } });
    expect(limited.json().user).toMatchObject({ requestLimit: 5, limits: { limit: 5 } });
    expect((await built.app.inject({ method: 'PATCH', url: `/api/admin/users/${aliceId}`, headers: root.headers, payload: { requestLimit: -1 } })).statusCode).toBe(400);
  });
});

describe('RetroArr webhooks', () => {
  const HOOK_TOKEN = 'h'.repeat(32);
  const hook = (event: string, data: Record<string, unknown>, token: string | null = HOOK_TOKEN) =>
    built.app.inject({
      method: 'POST',
      url: '/api/webhooks/retroarr',
      // RetroArr sends no session cookie, CSRF header or Origin
      headers: token === null ? {} : { 'x-webhook-token': token },
      payload: { event, timestamp: clock.toISOString(), data },
    });

  async function approvedRequest() {
    const root = await login('root');
    const created = await built.app.inject({ method: 'POST', url: '/api/requests', headers: root.headers, payload: { igdbId: 1020, platformId: 41 } });
    expect(created.json().request).toMatchObject({ status: 'searching', retroarrGameId: 100 });
    return created.json().request.id as number;
  }

  it('is off without RETROARR_WEBHOOK_TOKEN, and refuses a wrong or missing token', async () => {
    await start();
    expect((await hook('OnDownloadStarted', { gameId: 100 })).statusCode).toBe(404);
    await built.app.close();

    await start({ RETROARR_WEBHOOK_TOKEN: HOOK_TOKEN });
    expect((await hook('OnDownloadStarted', { gameId: 100 }, null)).statusCode).toBe(401);
    expect((await hook('OnDownloadStarted', { gameId: 100 }, 'x'.repeat(32))).statusCode).toBe(401);
    expect((await hook('OnDownloadStarted', { gameId: 100 })).json()).toEqual({ updated: 0 });
    expect(() => loadConfig({ JELLYFIN_URL: JELLYFIN, RETROARR_URL: RETROARR, RETROARR_TOKEN: TOKEN, RETROARR_WEBHOOK_TOKEN: 'short' })).toThrow(/at least 24/);
  });

  it('follows a request from grab to import without waiting for the poller', async () => {
    await start({ RETROARR_WEBHOOK_TOKEN: HOOK_TOKEN });
    const id = await approvedRequest();

    const grabbed = await hook('OnDownloadStarted', { gameId: 100, igdbId: 1020, release: 'Chrono Trigger (USA)', automatic: true });
    expect(grabbed.json()).toEqual({ updated: 1 });
    expect(built.store.request(id)).toMatchObject({ status: 'downloading', release: 'Chrono Trigger (USA)' });

    // RetroArr's game status doesn't show a grab: the poller leaves the request downloading
    await built.requests.poll();
    expect(built.store.request(id)!.status).toBe('downloading');

    await hook('OnDownloadCompleted', { gameId: 100, release: 'Chrono Trigger (USA)', upgrade: false });
    expect(built.store.request(id)).toMatchObject({ status: 'available', availableAt: clock.toISOString() });
    await flush();
    expect(fakes.discord.at(-1)!.content).toContain('is ready to play, root');

    // Finished requests are no longer followed
    expect((await hook('OnDownloadFailed', { gameId: 100, reason: 'x' })).json()).toEqual({ updated: 0 });
  });

  it('keeps a request whose download failed open, says why, and tells Discord', async () => {
    await start({ RETROARR_WEBHOOK_TOKEN: HOOK_TOKEN });
    const id = await approvedRequest();
    await hook('OnDownloadStarted', { gameId: 100, release: 'Chrono Trigger (USA)' });

    await hook('OnDownloadFailed', { gameId: 100, stage: 'download', reason: 'no progress for 24 hours' });

    expect(built.store.request(id)).toMatchObject({
      status: 'searching',
      error: 'The last download failed: no progress for 24 hours. RetroArr is searching again.',
    });
    await flush();
    expect(fakes.discord.at(-1)!.content).toContain('The download of **Chrono Trigger** (1995) for Super Nintendo failed (no progress for 24 hours)');

    // The next grab clears the error
    await hook('OnDownloadStarted', { gameId: 100, release: 'Chrono Trigger (Europe)' });
    expect(built.store.request(id)).toMatchObject({ status: 'downloading', release: 'Chrono Trigger (Europe)', error: null });
  });

  it('fails a request whose game is removed, and ignores other games, other events and junk', async () => {
    await start({ RETROARR_WEBHOOK_TOKEN: HOOK_TOKEN });
    const id = await approvedRequest();

    expect((await hook('OnDownloadStarted', { gameId: 999 })).json()).toEqual({ updated: 0 });
    expect((await hook('OnGameAdded', { gameId: 100 })).json()).toEqual({ updated: 0 });
    expect((await built.app.inject({ method: 'POST', url: '/api/webhooks/retroarr', headers: { 'x-webhook-token': HOOK_TOKEN }, payload: { nope: 1 } })).statusCode).toBe(400);
    expect(built.store.request(id)!.status).toBe('searching');

    await hook('OnGameRemoved', { gameId: 100, deletedFiles: false });
    expect(built.store.request(id)).toMatchObject({ status: 'failed', error: 'The game was removed from RetroArr.' });
  });
});
