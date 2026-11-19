import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../server/src/app.js';
import { loadConfig, type Config } from '../server/src/config.js';
import { openDb } from '../server/src/db.js';
import { JellyfinClient } from '../server/src/jellyfin.js';
import { RetroArrClient } from '../server/src/retroarr.js';
import { DISCORD, Fakes, JELLYFIN, RETROARR, ROMM, ROMM_TOKEN, TOKEN } from './fakes.js';

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
  it('lists the platforms enabled in RetroArr and shows open requests per platform', async () => {
    fakes.platforms.find((p) => p.slug === 'psx')!.enabled = false;
    await start();
    const { headers } = await login('alice');
    expect((await built.app.inject({ url: '/api/platforms', headers })).json().map((p: { slug: string }) => p.slug)).toEqual(['snes']);

    await built.app.inject({ method: 'POST', url: '/api/requests', headers, payload: { igdbId: 1020, platformId: 41 } });
    const res = await built.app.inject({ url: '/api/search?q=chrono', headers });
    expect(res.json().results).toEqual([
      expect.objectContaining({ igdbId: 1020, title: 'Chrono Trigger', platformIds: [41], requests: [expect.objectContaining({ platformId: 41, status: 'pending' })] }),
    ]);
    expect((await built.app.inject({ url: '/api/search?q=c', headers })).statusCode).toBe(400);

    // A leftover ALLOWED_PLATFORMS doesn't narrow anything any more
    await built.app.close();
    await start({ ALLOWED_PLATFORMS: 'psx' });
    const again = await login('alice');
    expect((await built.app.inject({ url: '/api/platforms', headers: again.headers })).json().map((p: { slug: string }) => p.slug)).toEqual(['snes']);
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

  it('requests another version of a game the library has: a second copy in RetroArr', async () => {
    await start();
    const alice = await login('alice');
    const root = await login('root');
    fakes.games.push({ id: 7, title: 'Chrono Trigger', igdbId: 1020, platformId: 41, status: 4, monitored: true, region: 'USA', variant: '' });
    const post = (payload: Record<string, unknown>) => built.app.inject({ method: 'POST', url: '/api/requests', headers: alice.headers, payload: { igdbId: 1020, platformId: 41, ...payload } });

    // the library has the USA release: any region, or the USA, is already there
    expect((await post({})).json().code).toBe('in_library');
    expect((await post({ region: 'usa' })).statusCode).toBe(409);
    expect((await post({ region: 'Mars' })).statusCode).toBe(400);
    expect((await post({ variant: 'hack' })).statusCode).toBe(400);

    const created = await post({ region: 'Japan', variant: 'en-translation', latestRevision: true });
    expect(created.statusCode).toBe(201);
    expect(created.json().request).toMatchObject({ region: 'Japan', variant: 'en-translation', latestRevision: true });
    // the same version again is a duplicate; another one isn't
    const dup = await post({ region: 'Japan', variant: 'en-translation' });
    expect(dup.json().code).toBe('already_requested');
    expect(dup.json().error).toContain('Japan · English translation');

    const approved = await built.app.inject({ method: 'POST', url: `/api/requests/${created.json().request.id}/approve`, headers: root.headers, payload: {} });
    expect(approved.json().request).toMatchObject({ status: 'searching', retroarrGameId: 100 });
    await flush();
    // a new entry beside the USA one, not the USA one reused
    expect(fakes.addedBodies[0]).toMatchObject({ igdbId: 1020, platformId: 41, region: 'Japan', variant: 'en-translation', preferLatestRevision: true });
  });

  it('requests a Switch game with its latest update and DLC: RetroArr is told once the game is added', async () => {
    fakes.addSwitch();
    await start();
    const alice = await login('alice');
    const root = await login('root');
    const post = (payload: Record<string, unknown>) => built.app.inject({ method: 'POST', url: '/api/requests', headers: alice.headers, payload });

    const platforms = await built.app.inject({ url: '/api/platforms', headers: alice.headers });
    expect(platforms.json().find((p: { id: number }) => p.id === 70)).toMatchObject({ hasAddOns: true });
    expect((await post({ igdbId: 7346, platformId: 70, dlc: 'all' })).statusCode).toBe(400);

    const created = await post({ igdbId: 7346, platformId: 70, latestUpdate: true, dlc: [{ igdbId: 900, title: 'Expansion Pass' }, { igdbId: 900, title: 'Expansion Pass' }] });
    expect(created.statusCode).toBe(201);
    expect(created.json().request).toMatchObject({ kind: 'game', addOns: { latestUpdate: true, allDlc: false, dlc: [{ igdbId: 900, title: 'Expansion Pass' }] } });

    await built.app.inject({ method: 'POST', url: `/api/requests/${created.json().request.id}/approve`, headers: root.headers, payload: {} });
    await flush();
    expect(fakes.addOnPuts).toEqual([
      { gameId: 100, body: { dlc: [{ igdbId: 900, title: 'Expansion Pass' }], append: true, search: false, wantLatestUpdate: true } },
    ]);

    // A platform without updates or DLC: the add-ons are left out
    const snes = await post({ igdbId: 1020, platformId: 41, latestUpdate: true, allDlc: true });
    expect(snes.json().request.addOns).toEqual({ latestUpdate: false, allDlc: false, dlc: [] });
  });

  it('requests DLC for a game the library has, and is done once RetroArr has it', async () => {
    fakes.addSwitch();
    await start();
    const alice = await login('alice');
    const root = await login('root');
    const post = (h: Record<string, string>, payload: Record<string, unknown>) =>
      built.app.inject({ method: 'POST', url: '/api/requests', headers: h, payload: { igdbId: 7346, platformId: 70, kind: 'addons', ...payload } });

    expect((await post(alice.headers, { dlc: [{ igdbId: 900, title: 'Expansion Pass' }] })).json().code).toBe('not_in_library');
    fakes.games.push({ id: 7, title: 'Breath of the Wild', igdbId: 7346, platformId: 70, status: 4, monitored: true });
    expect((await post(alice.headers, {})).json().code).toBe('nothing_asked');
    expect((await post(alice.headers, { igdbId: 1020, platformId: 41, latestUpdate: true })).json().code).toBe('no_addons');

    const created = await post(root.headers, { dlc: [{ igdbId: 900, title: 'Expansion Pass' }] });
    expect(created.statusCode).toBe(201);
    // an admin's request goes straight to RetroArr, which searches at once
    expect(created.json().request).toMatchObject({ kind: 'addons', status: 'searching', retroarrGameId: 7 });
    expect(fakes.addOnPuts[0]).toEqual({ gameId: 7, body: { dlc: [{ igdbId: 900, title: 'Expansion Pass' }], append: true, search: true } });
    expect((await post(alice.headers, { allDlc: true })).json().code).toBe('already_requested');
    // the game itself is still in the library
    expect((await post(alice.headers, { kind: 'game' })).json().code).toBe('in_library');

    // RetroArr's import of something else of the game doesn't finish it; having the DLC does
    built.requests.handleRetroArrEvent('OnDownloadCompleted', { gameId: 7, release: 'BotW Update v1.6.0' });
    expect(built.store.request(created.json().request.id)!.status).toBe('searching');
    await built.requests.poll();
    expect(built.store.request(created.json().request.id)!.status).toBe('searching');
    fakes.addOns.get(7)!.ownedDlc.add(900);
    await built.requests.poll();
    expect(built.store.request(created.json().request.id)!.status).toBe('available');
    await flush();
    expect(fakes.discord.map((d) => d.content)).toContainEqual(expect.stringContaining('Expansion Pass of **Breath of the Wild** (2017) for Nintendo Switch is ready to play'));
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

describe('progress and problem reports', () => {
  const HOOK_TOKEN = 'h'.repeat(32);
  const hook = (event: string, data: Record<string, unknown>) =>
    built.app.inject({ method: 'POST', url: '/api/webhooks/retroarr', headers: { 'x-webhook-token': HOOK_TOKEN }, payload: { event, data } });

  // alice's request for Chrono Trigger (SNES), approved by root and handed to RetroArr as game 100
  async function aliceRequest() {
    const alice = await login('alice');
    const root = await login('root');
    const created = await built.app.inject({ method: 'POST', url: '/api/requests', headers: alice.headers, payload: { igdbId: 1020, platformId: 41 } });
    const id = created.json().request.id as number;
    await built.app.inject({ method: 'POST', url: `/api/requests/${id}/approve`, headers: root.headers, payload: {} });
    return { alice, root, id };
  }

  it('shows live download progress for the requests being fetched, and copes with an older RetroArr', async () => {
    await start({ RETROARR_WEBHOOK_TOKEN: HOOK_TOKEN });
    const { alice, root } = await aliceRequest();
    fakes.queue = [
      { gameId: 100, release: 'Chrono Trigger (USA)', progress: 43.5, state: 'Downloading', trackedState: 'Downloading' },
      { gameId: 555, release: 'Someone else’s game', progress: 10, state: 'Downloading' },
    ];

    const mine = await built.app.inject({ url: '/api/progress', headers: alice.headers });
    expect(mine.json()).toEqual({
      progress: [{ gameId: 100, release: 'Chrono Trigger (USA)', progress: 43.5, state: 'Downloading', trackedState: 'Downloading', statusMessages: [] }],
    });
    expect(fakes.calls.at(-1)).toBe('GET /downloadclient/queue/games?ids=100');

    // bob has nothing in flight, so RetroArr isn't asked
    const bob = await login('bob');
    const calls = fakes.calls.length;
    expect((await built.app.inject({ url: '/api/progress', headers: bob.headers })).json()).toEqual({ progress: [] });
    expect(fakes.calls.length).toBe(calls);

    fakes.queue = null;
    expect((await built.app.inject({ url: '/api/progress?scope=all', headers: root.headers })).json()).toEqual({
      progress: [],
      error: 'Download progress isn’t available right now.',
    });
  });

  it('lets the requester report a problem once the game is ready, and only once', async () => {
    await start({ RETROARR_WEBHOOK_TOKEN: HOOK_TOKEN });
    const { alice, id } = await aliceRequest();
    const report = (headers: Record<string, string>, payload: Record<string, unknown>) =>
      built.app.inject({ method: 'POST', url: `/api/requests/${id}/issues`, headers, payload });

    expect((await report(alice.headers, { kind: 'wont_launch' })).json().error).toBe('Problems can be reported once a game is ready to play.');
    await hook('OnDownloadCompleted', { gameId: 100, release: 'Chrono Trigger (USA)' });

    expect((await report(alice.headers, { kind: 'nope' })).statusCode).toBe(400);
    expect((await report(alice.headers, { kind: 'other' })).json().error).toBe('Say what’s wrong.');
    const bob = await login('bob');
    expect((await report(bob.headers, { kind: 'wont_launch' })).statusCode).toBe(404);

    const created = await report(alice.headers, { kind: 'wont_launch', message: 'black screen after the logo' });
    expect(created.statusCode).toBe(201);
    expect(created.json().issue).toMatchObject({ status: 'open', kind: 'wont_launch', title: 'Chrono Trigger', username: 'alice', release: 'Chrono Trigger (USA)' });
    await flush();
    expect(fakes.discord.at(-1)!.content).toBe('🛠️ alice reported a problem with **Chrono Trigger** for Super Nintendo: Won’t launch – black screen after the logo');
    expect((await report(alice.headers, { kind: 'wrong_region' })).json().error).toBe('A problem with this game has already been reported.');

    // alice sees hers, bob none, an admin all
    expect((await built.app.inject({ url: '/api/issues', headers: alice.headers })).json().issues).toHaveLength(1);
    expect((await built.app.inject({ url: '/api/issues?scope=all', headers: bob.headers })).json().issues).toHaveLength(0);
  });

  it('replaces a reported release through RetroArr and follows the replacement to its import', async () => {
    await start({ RETROARR_WEBHOOK_TOKEN: HOOK_TOKEN });
    const { alice, root, id } = await aliceRequest();
    await hook('OnDownloadCompleted', { gameId: 100, release: 'Chrono Trigger (USA)' });
    const issue = (await built.app.inject({ method: 'POST', url: `/api/requests/${id}/issues`, headers: alice.headers, payload: { kind: 'wrong_region', message: 'Japanese text' } })).json().issue;

    expect((await built.app.inject({ method: 'POST', url: `/api/issues/${issue.id}/replace`, headers: alice.headers, payload: {} })).statusCode).toBe(403);
    const replaced = await built.app.inject({ method: 'POST', url: `/api/issues/${issue.id}/replace`, headers: root.headers, payload: {} });
    expect(replaced.json().issue).toMatchObject({ status: 'replacing', replacementRelease: 'Chrono Trigger (Europe)' });
    expect(fakes.replaced).toEqual([{ gameId: 100, reason: 'Wrong region or language: Japanese text (reported by alice in g-seekr)' }]);
    // The old release stays playable meanwhile
    expect(built.store.request(id)!.status).toBe('available');

    // The replacement's progress shows while it downloads
    fakes.queue = [{ gameId: 100, release: 'Chrono Trigger (Europe)', progress: 70, state: 'Downloading' }];
    expect((await built.app.inject({ url: '/api/progress', headers: alice.headers })).json().progress[0]).toMatchObject({ progress: 70 });

    expect((await hook('OnDownloadFailed', { gameId: 100, reason: 'stalled' })).json()).toEqual({ updated: 1 });
    expect(built.store.issue(issue.id)).toMatchObject({ status: 'replacing', resolution: 'The replacement’s download failed: stalled. RetroArr is searching again.' });
    await hook('OnDownloadStarted', { gameId: 100, release: 'Chrono Trigger (Europe) (Rev 1)' });
    await hook('OnDownloadCompleted', { gameId: 100, release: 'Chrono Trigger (Europe) (Rev 1)' });
    expect(built.store.issue(issue.id)).toMatchObject({ status: 'resolved', resolution: 'Replaced with Chrono Trigger (Europe) (Rev 1).', resolvedAt: clock.toISOString() });
    expect(built.store.request(id)).toMatchObject({ status: 'available', release: 'Chrono Trigger (Europe) (Rev 1)' });
    await flush();
    expect(fakes.discord.at(-1)!.content).toBe('✅ alice, your report on **Chrono Trigger** for Super Nintendo is resolved: Replaced with Chrono Trigger (Europe) (Rev 1).');
  });

  it('keeps the report open when nothing could be grabbed, explains RetroArr’s refusals, and resolves by hand', async () => {
    await start({ RETROARR_WEBHOOK_TOKEN: HOOK_TOKEN });
    const { alice, root, id } = await aliceRequest();
    await hook('OnDownloadCompleted', { gameId: 100 });
    const issue = (await built.app.inject({ method: 'POST', url: `/api/requests/${id}/issues`, headers: alice.headers, payload: { kind: 'missing_files' } })).json().issue;
    const replace = () => built.app.inject({ method: 'POST', url: `/api/issues/${issue.id}/replace`, headers: root.headers, payload: {} });

    fakes.replaceAnswer = { status: 200, body: { blocklisted: 'Chrono Trigger (USA)', autoQueued: false, autoDispatchSkipped: 'no release qualifies for auto-download, so the game keeps its release for now' } };
    expect((await replace()).json().issue).toMatchObject({
      status: 'open',
      resolution: 'The reported release is blocklisted, but no replacement was grabbed yet: no release qualifies for auto-download, so the game keeps its release for now. Try again later.',
    });

    fakes.replaceAnswer = { status: 409, body: { message: 'RetroArr doesn’t know which release the game has.' } };
    const refused = await replace();
    expect(refused.statusCode).toBe(409);
    expect(refused.json().error).toBe('RetroArr doesn’t know which release the game has.');

    const resolved = await built.app.inject({ method: 'POST', url: `/api/issues/${issue.id}/resolve`, headers: root.headers, payload: { note: 'Added the missing disc by hand.' } });
    expect(resolved.json().issue).toMatchObject({ status: 'resolved', resolution: 'Added the missing disc by hand.' });
    expect((await replace()).statusCode).toBe(409);
    // Resolved, so a new report can be made
    expect((await built.app.inject({ method: 'POST', url: `/api/requests/${id}/issues`, headers: alice.headers, payload: { kind: 'wont_launch' } })).statusCode).toBe(201);
  });
});

describe('discovery', () => {
  const games = (headers: Record<string, string>, payload: Record<string, unknown>) =>
    built.app.inject({ method: 'POST', url: '/api/discover/games', headers, payload });

  it('lists games on requestable platforms only, with what the library and the requests have', async () => {
    fakes.platforms.push({ id: 77, name: 'Arcade', slug: 'arcade', category: 'X', enabled: false }); // disabled in RetroArr
    await start();
    const a = await login('alice');
    await built.app.inject({ method: 'POST', url: '/api/requests', headers: a.headers, payload: { igdbId: 1020, platformId: 41 } });

    const res = await games(a.headers, { list: 'popular', filters: { includeAdult: false } });
    expect(res.statusCode).toBe(200);
    expect(fakes.discoverBodies.at(-1)).toMatchObject({ list: 'popular', sort: 'popular', platformIds: [50, 41], includeAdult: false, offset: 0, limit: 30 });
    const chrono = res.json().games.find((g: { igdbId: number }) => g.igdbId === 1020);
    expect(chrono).toMatchObject({ title: 'Chrono Trigger', owned: false, platformIds: [41, 50], requests: [{ platformId: 41, status: 'pending' }] });
  });

  it('narrows to the filter’s platforms, or one row’s, but never past what can be requested', async () => {
    await start();
    const a = await login('alice');
    await games(a.headers, { list: 'browse', sort: 'rating', page: 2, filters: { platformIds: [41, 60, 999], genreIds: [12, -1, 'x'], yearFrom: 1999, yearTo: 1990, minRating: 80, includeAdult: true } });
    expect(fakes.discoverBodies.at(-1)).toMatchObject({
      list: 'browse', sort: 'rating', platformIds: [41], genreIds: [12], yearFrom: 1990, yearTo: 1999, minRating: 80, includeAdult: true, offset: 30,
    });
    await games(a.headers, { list: 'popular', platformId: 50 });
    expect(fakes.discoverBodies.at(-1)!.platformIds).toEqual([50]);
    // A disabled platform's row asks for nothing
    const calls = fakes.discoverBodies.length;
    expect((await games(a.headers, { list: 'popular', platformId: 60 })).json()).toEqual({ games: [], page: 1, more: false });
    expect(fakes.discoverBodies.length).toBe(calls);
    expect((await games(a.headers, { query: 'x'.repeat(101) })).statusCode).toBe(400);
  });

  it('saves each user’s filters, with adult games off until they switch them on', async () => {
    await start();
    const a = await login('alice');
    expect((await built.app.inject({ url: '/api/me/filters', headers: a.headers })).json().filters).toMatchObject({ includeAdult: false, platformIds: [] });
    const saved = await built.app.inject({ method: 'PUT', url: '/api/me/filters', headers: a.headers, payload: { filters: { includeAdult: true, minRating: 500, themeIds: [42] } } });
    expect(saved.json().filters).toMatchObject({ includeAdult: true, minRating: null, themeIds: [42] });
    expect((await built.app.inject({ url: '/api/me/filters', headers: a.headers })).json().filters.includeAdult).toBe(true);
    const b = await login('bob');
    expect((await built.app.inject({ url: '/api/me/filters', headers: b.headers })).json().filters.includeAdult).toBe(false);
  });

  it('shows a game’s page with requestable releases, safe trailers and similar games that can be requested', async () => {
    await start();
    const a = await login('alice');
    const res = await built.app.inject({ url: '/api/games/1020', headers: a.headers });
    expect(res.statusCode).toBe(200);
    const page = res.json();
    expect(page.game).toMatchObject({ title: 'Chrono Trigger', platformIds: [41, 50] });
    expect(page.videos).toEqual([{ name: 'Trailer', youtubeId: 'abcdefghijk' }]);
    expect(page.releases.map((r: { platform: string; requestable: boolean }) => [r.platform, r.requestable])).toEqual([
      ['Platform 41', true],
      ['Platform 50', true],
      ['Arcade', false],
    ]);
    expect(page.similar.map((g: { title: string }) => g.title)).toEqual(['Final Fantasy VII']);
    expect(fakes.calls).toContain('GET /discover/games/1020?includeAdult=false');
    expect((await built.app.inject({ url: '/api/games/5', headers: a.headers })).statusCode).toBe(404);
  });

  it('says plainly when IGDB can’t be reached', async () => {
    await start();
    const a = await login('alice');
    fakes.igdbDown = true;
    const res = await games(a.headers, { list: 'top' });
    expect(res.statusCode).toBe(503);
    expect(res.json().error).toBe('IGDB didn’t answer; try again in a moment.');
  });
});

describe('recommendations', () => {
  // Chrono Trigger's similar games are Secret of Mana and Final Fantasy VI; Final Fantasy VII's are Final Fantasy VI and Xenogears
  function catalogue() {
    fakes.catalogue.set(1079, { title: 'Secret of Mana', year: 1993, platforms: [41] });
    fakes.catalogue.set(1009, { title: 'Final Fantasy VI', year: 1994, platforms: [41] });
    fakes.catalogue.set(1500, { title: 'Xenogears', year: 1998, platforms: [50] });
    fakes.similar.set(1020, [1079, 1009]);
    fakes.similar.set(427, [1009, 1500]);
    fakes.similar.set(1009, [1079]);
  }
  const recs = async (headers: Record<string, string>) => (await built.app.inject({ url: '/api/recommendations', headers })).json();
  const titles = (games: { title: string }[]) => games.map((g) => g.title);

  it('recommends from requests and likes, best shared first, with the reasons', async () => {
    catalogue();
    await start();
    const a = await login('alice');
    await built.app.inject({ method: 'POST', url: '/api/requests', headers: a.headers, payload: { igdbId: 1020, platformId: 41 } });
    await built.app.inject({ method: 'PUT', url: '/api/games/427/like', headers: a.headers, payload: { liked: true, title: 'Final Fantasy VII' } });

    const r = await recs(a.headers);
    // FF VI is similar to both; the liked FF VII counts more than the request
    expect(titles(r.games)).toEqual(['Final Fantasy VI', 'Xenogears', 'Secret of Mana']);
    expect(r.games[0].reasons).toEqual([
      { kind: 'liked', igdbId: 427, title: 'Final Fantasy VII' },
      { kind: 'requested', igdbId: 1020, title: 'Chrono Trigger' },
    ]);
    expect(r.because.map((b: { seed: { title: string } }) => b.seed.title)).toEqual([]); // fewer than 4 each
    expect(r.romm).toEqual({ available: false, linked: false, error: null });
    // The game page says what the user thinks of it
    expect((await built.app.inject({ url: '/api/games/427', headers: a.headers })).json().mine).toEqual({ liked: true, dismissed: false });
  });

  it('leaves out games marked not interested, and follows the saved filters', async () => {
    catalogue();
    await start();
    const a = await login('alice');
    await built.app.inject({ method: 'PUT', url: '/api/games/427/like', headers: a.headers, payload: { liked: true, title: 'Final Fantasy VII' } });
    expect(titles((await recs(a.headers)).games)).toEqual(['Final Fantasy VI', 'Xenogears']);

    await built.app.inject({ method: 'PUT', url: '/api/games/1009/dismiss', headers: a.headers, payload: { dismissed: true } });
    expect(titles((await recs(a.headers)).games)).toEqual(['Xenogears']);

    await built.app.inject({ method: 'PUT', url: '/api/me/filters', headers: a.headers, payload: { filters: { platformIds: [41] } } });
    await built.app.inject({ method: 'PUT', url: '/api/games/1009/dismiss', headers: a.headers, payload: { dismissed: false } });
    // Xenogears is PlayStation only
    expect(titles((await recs(a.headers)).games)).toEqual(['Final Fantasy VI']);
  });

  it('links RomM with the user’s own token, and recommends from what they played', async () => {
    catalogue();
    await start({ ROMM_API_URL: ROMM });
    const a = await login('alice');
    const link = (token: string) => built.app.inject({ method: 'PUT', url: '/api/me/romm', headers: a.headers, payload: { token } });

    expect((await link('nope')).json().error).toMatch(/isn’t a RomM client token/);
    fakes.rommTokens.set('rmm_' + 'b'.repeat(64), 'bob');
    expect((await link('rmm_' + 'b'.repeat(64))).json().error).toBe('That token belongs to RomM user “bob”, not you (alice).');
    expect((await link('rmm_' + 'c'.repeat(64))).json().error).toMatch(/RomM refused the token/);
    const linked = await link(ROMM_TOKEN);
    expect(linked.statusCode).toBe(200);
    expect(linked.json()).toMatchObject({ available: true, linked: true, rommUsername: 'alice' });
    // The token never comes back
    expect(JSON.stringify(linked.json())).not.toContain(ROMM_TOKEN);

    fakes.rommPlays.set('alice', [
      { igdb_id: 1020, name: 'Chrono Trigger', rom_user: { last_played: '2026-11-10T20:00:00Z', rating: 9, now_playing: false } },
      { igdb_id: 427, name: 'Final Fantasy VII', rom_user: { last_played: '2026-11-01T20:00:00Z', rating: 2, now_playing: false } },
      { igdb_id: null, name: 'Homebrew', rom_user: { last_played: '2026-11-01T20:00:00Z', rating: 0 } },
    ]);
    built.recommend.forgetPlays(1);
    const r = await recs(a.headers);
    // Chrono Trigger rated 9 leads; FF VII rated 2 is disliked, so neither it nor its similar Xenogears show
    expect(titles(r.games)).toEqual(['Secret of Mana', 'Final Fantasy VI']);
    expect(r.games[0].reasons[0]).toEqual({ kind: 'played', igdbId: 1020, title: 'Chrono Trigger' });
    expect(fakes.calls.find((c) => c.startsWith('ROMM'))).toContain('order_by=last_played');

    fakes.rommDown = true;
    built.recommend.forgetPlays(1);
    expect((await recs(a.headers)).romm).toMatchObject({ linked: true, error: expect.stringMatching(/RomM is not reachable/) });

    expect((await built.app.inject({ method: 'DELETE', url: '/api/me/romm', headers: a.headers })).json()).toMatchObject({ linked: false });
  });

  it('can’t link RomM without ROMM_API_URL', async () => {
    await start();
    const a = await login('alice');
    expect((await built.app.inject({ url: '/api/me/romm', headers: a.headers })).json()).toMatchObject({ available: false, linked: false });
    expect((await built.app.inject({ method: 'PUT', url: '/api/me/romm', headers: a.headers, payload: { token: ROMM_TOKEN } })).json().error).toMatch(/isn’t set up/);
  });
});

describe('collections', () => {
  beforeEach(() => {
    for (const [id, title, year, platforms] of [
      [1009, 'Final Fantasy VI', 1994, [41, 50]],
      [9001, 'Final Fantasy IV', 1991, [41]],
      [9002, 'Final Fantasy V', 1992, [41]],
      [9003, 'Final Fantasy Tactics', 1997, [50]],
    ] as const) fakes.catalogue.set(id, { title, year, platforms: [...platforms] });
    fakes.franchises.set(5, { name: 'Final Fantasy', games: [427, 1009, 9001, 9002, 9003] });
    // The library has Final Fantasy VII for the PlayStation
    fakes.games.push({ id: 1, title: 'Final Fantasy VII', igdbId: 427, platformId: 50, status: 4, monitored: true });
  });

  const get = (url: string, headers: Record<string, string>) => built.app.inject({ url, headers });
  const missing = (url: string, headers: Record<string, string>, platformId: number) =>
    built.app.inject({ method: 'POST', url: `${url}/request-missing`, headers, payload: { platformId } });

  it('shows a series per platform with what the library has, and requests what’s missing until the limit', async () => {
    await start();
    const a = await login('alice');
    const page = (await get('/api/collections/series/5', a.headers)).json();
    expect(page).toMatchObject({ kind: 'series', name: 'Final Fantasy' });
    expect(page.platforms).toEqual([
      { id: 50, name: 'PlayStation', total: 3, inLibrary: 1 },
      { id: 41, name: 'Super Nintendo', total: 3, inLibrary: 0 },
    ]);
    expect(page.games.find((g: { igdbId: number }) => g.igdbId === 427)).toMatchObject({ platformIds: [50], inLibrary: [50] });

    // Alice may make 2 requests: the third missing SNES game is left, and says why
    const r = (await missing('/api/collections/series/5', a.headers, 41)).json();
    expect(r.requested.map((g: { title: string }) => g.title)).toEqual(['Final Fantasy VI', 'Final Fantasy IV']);
    expect(r.skipped).toEqual([{ igdbId: 9002, title: 'Final Fantasy V', reason: 'request limit reached' }]);
    expect(r.limitReached).toBe(true);
    expect(built.store.listRequests({ userId: 1 }).map((x) => [x.igdbId, x.platformId, x.status]).sort()).toEqual([
      [1009, 41, 'pending'],
      [9001, 41, 'pending'],
    ]);

    // Bob's PlayStation run skips the game the library has
    const b = await login('bob');
    const rb = (await missing('/api/collections/series/5', b.headers, 50)).json();
    expect(rb.requested.map((g: { igdbId: number }) => g.igdbId)).toEqual([1009, 9003]);
    const again = (await get('/api/collections/series/5', b.headers)).json();
    expect(again.games.find((g: { igdbId: number }) => g.igdbId === 1009).requests.map((x: { platformId: number }) => x.platformId).sort()).toEqual([41, 50]);

    expect((await missing('/api/collections/series/5', b.headers, 60)).statusCode).toBe(400);
    expect((await get('/api/collections/series/77', b.headers)).statusCode).toBe(404);
    expect((await get('/api/collections/series?query=fant', b.headers)).json().series).toEqual([{ id: 5, name: 'Final Fantasy', gameCount: 5 }]);
  });

  it('lets admins curate lists and feature them, and finds popular and in-progress series', async () => {
    await start({ REQUEST_LIMIT: '0' });
    const root = await login('root');
    const a = await login('alice');
    expect((await built.app.inject({ method: 'POST', url: '/api/lists', headers: a.headers, payload: { name: 'Mine' } })).statusCode).toBe(403);

    const list = (await built.app.inject({ method: 'POST', url: '/api/lists', headers: root.headers, payload: { name: 'SNES RPGs', description: 'The classics' } })).json().list;
    const add = (igdbId: number, platformId: number, title: string) =>
      built.app.inject({ method: 'POST', url: `/api/lists/${list.id}/items`, headers: root.headers, payload: { igdbId, platformId, title, year: 1995, coverUrl: 'javascript:x' } });
    expect((await add(1020, 41, 'Chrono Trigger')).statusCode).toBe(201);
    expect((await add(9001, 41, 'Final Fantasy IV')).statusCode).toBe(201);
    expect((await add(9001, 41, 'Final Fantasy IV')).json()).toEqual({ added: 0 });
    await built.app.inject({ method: 'PATCH', url: `/api/lists/${list.id}`, headers: root.headers, payload: { featured: true } });

    const page = (await get(`/api/collections/lists/${list.id}`, a.headers)).json();
    expect(page).toMatchObject({ kind: 'list', name: 'SNES RPGs', description: 'The classics', featured: true, platforms: [{ id: 41, total: 2, inLibrary: 0 }] });
    expect(page.games[0]).toMatchObject({ igdbId: 1020, coverUrl: null, platformIds: [41] });

    // Alice requests the list's missing games, then two Final Fantasy games for the PlayStation
    expect((await missing(`/api/collections/lists/${list.id}`, a.headers, 41)).json().requested).toHaveLength(2);
    await built.app.inject({ method: 'POST', url: '/api/requests', headers: a.headers, payload: { igdbId: 9003, platformId: 50 } });

    const rows = (await get('/api/collections', a.headers)).json();
    expect(rows.featured).toEqual([{ kind: 'list', id: list.id, name: 'SNES RPGs', covers: [], total: 2, inLibrary: 0 }]);
    // Final Fantasy: two of its games requested (IV, Tactics), and the library has one of five
    expect(rows.popular).toMatchObject([{ kind: 'series', id: 5, name: 'Final Fantasy', total: 5, inLibrary: 1 }]);
    expect(rows.inProgress).toMatchObject([{ kind: 'series', id: 5 }]);
    expect(rows.lists).toHaveLength(1);

    await built.app.inject({ method: 'PUT', url: '/api/collections/series/5/featured', headers: root.headers, payload: { featured: true, name: 'Final Fantasy' } });
    expect((await get('/api/collections', a.headers)).json().featured.map((c: { kind: string }) => c.kind)).toEqual(['series', 'list']);

    await built.app.inject({ method: 'DELETE', url: `/api/lists/${list.id}/items/1020/41`, headers: root.headers });
    expect((await get(`/api/collections/lists/${list.id}`, a.headers)).json().games).toHaveLength(1);
    await built.app.inject({ method: 'DELETE', url: `/api/lists/${list.id}`, headers: root.headers });
    expect((await get(`/api/collections/lists/${list.id}`, a.headers)).statusCode).toBe(404);
  });

  it('imports a list: confident matches are chosen, the rest wait for review, then it saves', async () => {
    await start();
    const root = await login('root');
    fakes.matches.set('Chrono Trigger', [[1020, 0.98]]);
    fakes.matches.set('Final Fantasy', [[427, 0.7], [1009, 0.68]]);
    const text = 'Chrono Trigger (USA).bin\n# a comment\n\nFinal Fantasy (Japan)\nNothing Like It\nChrono Trigger (Europe).bin';
    const start1 = await built.app.inject({ method: 'POST', url: '/api/imports', headers: root.headers, payload: { kind: 'titles', text, platformId: 50, listName: 'PS1 picks' } });
    expect(start1.statusCode).toBe(201);
    const id = start1.json().import.id;
    await built.collections.idle();

    const review = (await get(`/api/imports/${id}`, root.headers)).json();
    expect(review.import).toMatchObject({ status: 'review', total: 3, done: 3 });
    expect(review.items.map((i: { title: string; state: string }) => [i.title, i.state])).toEqual([
      ['Chrono Trigger', 'matched'],
      ['Final Fantasy', 'uncertain'],
      ['Nothing Like It', 'unmatched'],
    ]);
    expect(review.items[1].choice).toBeNull();

    const choose = (idx: number, payload: Record<string, unknown>) => built.app.inject({ method: 'PATCH', url: `/api/imports/${id}/items/${idx}`, headers: root.headers, payload });
    expect((await choose(1, { choice: review.items[1].candidates[1] })).json().item.choice).toMatchObject({ igdbId: 1009, title: 'Final Fantasy VI' });
    await choose(2, { skip: true });

    const saved = (await built.app.inject({ method: 'POST', url: `/api/imports/${id}/save`, headers: root.headers })).json();
    expect(saved).toMatchObject({ added: 2, list: { name: 'PS1 picks', source: 'Pasted titles', itemCount: 2 } });
    expect(built.collections.lists.items(saved.list.id).map((i) => [i.igdbId, i.platformId])).toEqual([
      [1020, 50],
      [1009, 50],
    ]);
    expect((await built.app.inject({ method: 'POST', url: `/api/imports/${id}/save`, headers: root.headers })).statusCode).toBe(409);

    // A DAT added to the same list
    const dat = '<?xml version="1.0"?><datafile><game name="Final Fantasy Tactics (USA)"/><game name="[BIOS] PS (USA)"/></datafile>';
    fakes.matches.set('Final Fantasy Tactics', [[9003, 1]]);
    const d = (await built.app.inject({ method: 'POST', url: '/api/imports', headers: root.headers, payload: { kind: 'dat', text: dat, platformId: 50, listId: saved.list.id } })).json().import;
    await built.collections.idle();
    expect((await built.app.inject({ method: 'POST', url: `/api/imports/${d.id}/save`, headers: root.headers })).json()).toMatchObject({ added: 1, list: { id: saved.list.id, itemCount: 3 } });
  });

  it('reads Internet Archive items, retries an import IGDB interrupted, and keeps it to admins', async () => {
    await start();
    const root = await login('root');
    const a = await login('alice');
    expect((await built.app.inject({ method: 'POST', url: '/api/imports', headers: a.headers, payload: {} })).statusCode).toBe(403);

    fakes.archiveItems.set('psx-rpgs', [
      { name: 'Final Fantasy Tactics (USA).chd' },
      { name: 'psx-rpgs_meta.xml', source: 'metadata' },
      { name: '__ia_thumb.jpg' },
    ]);
    fakes.matches.set('Final Fantasy Tactics', [[9003, 1]]);
    fakes.igdbDown = true;
    const post = (payload: Record<string, unknown>) => built.app.inject({ method: 'POST', url: '/api/imports', headers: root.headers, payload });
    const job = (await post({ kind: 'archive', item: 'https://archive.org/details/psx-rpgs', platformId: 50, listName: 'From IA' })).json().import;
    expect(job).toMatchObject({ source: 'archive.org/details/psx-rpgs', total: 1 });
    await built.collections.idle();
    expect((await get(`/api/imports/${job.id}`, root.headers)).json().import).toMatchObject({ status: 'failed', error: expect.stringMatching(/IGDB/) });

    fakes.igdbDown = false;
    await built.app.inject({ method: 'POST', url: `/api/imports/${job.id}/retry`, headers: root.headers });
    await built.collections.idle();
    expect((await get(`/api/imports/${job.id}`, root.headers)).json().items[0]).toMatchObject({ state: 'matched', choice: { igdbId: 9003 } });

    expect((await post({ kind: 'archive', item: 'no-such-item', platformId: 50, listName: 'x' })).statusCode).toBe(404);
    expect((await post({ kind: 'titles', text: 'x', platformId: 60, listName: 'x' })).json().error).toMatch(/platform/);
    expect((await post({ kind: 'titles', text: 'Chrono Trigger', platformId: 50 })).json().error).toBe('Name the new list.');
    expect((await post({ kind: 'dat', text: '<datafile/>', platformId: 50, listName: 'x' })).json().error).toMatch(/No games found/);

    await built.app.inject({ method: 'DELETE', url: `/api/imports/${job.id}`, headers: root.headers });
    expect((await get('/api/imports', root.headers)).json().imports).toHaveLength(0);
  });
});

describe('tasks', () => {
  it('lists the timed jobs for admins, runs one now, and checks intervals', async () => {
    await start();
    const root = await login('root');
    const a = await login('alice');
    expect((await built.app.inject({ url: '/api/admin/tasks', headers: a.headers })).statusCode).toBe(403);

    const list = (await built.app.inject({ url: '/api/admin/tasks', headers: root.headers })).json().tasks;
    expect(list.map((t: { key: string }) => t.key)).toEqual(['request-sync', 'warm-discover', 'housekeeping']);
    // Never run: each waits its own delay after start
    expect(list[0]).toMatchObject({ intervalSeconds: 300, lastOutcome: null, nextRun: new Date(clock.getTime() + 30_000).toISOString() });

    // Nothing to follow: skipped, and says so
    const run = (key: string) => built.app.inject({ method: 'POST', url: `/api/admin/tasks/${key}/run`, headers: root.headers });
    expect((await run('request-sync')).statusCode).toBe(202);
    await built.tasks.idle();
    expect(built.tasks.status('request-sync')).toMatchObject({ lastOutcome: 'skipped', lastMessage: 'No open requests' });

    // With a request RetroArr is working on: checked, and the next run counts from this one
    await built.app.inject({ method: 'POST', url: '/api/requests', headers: root.headers, payload: { igdbId: 1020, platformId: 41 } });
    await run('request-sync');
    await built.tasks.idle();
    expect(built.tasks.status('request-sync')).toMatchObject({ lastOutcome: 'succeeded', lastMessage: '1 open request(s) checked, 0 changed' });
    expect(built.tasks.nextRun('request-sync')!.getTime()).toBe(clock.getTime() + 300_000);

    // Warm-up: Discover's rows (popular, top, one per platform) and the recently added
    fakes.discoverBodies = [];
    await run('warm-discover');
    await built.tasks.idle();
    expect(built.tasks.status('warm-discover')).toMatchObject({ lastOutcome: 'succeeded', lastMessage: '4 row(s) loaded; 0 popular collection(s)' });
    expect(fakes.discoverBodies.map((b) => [b.list, b.platformIds])).toEqual([
      ['popular', [50, 41]],
      ['top', [50, 41]],
      ['popular', [50]],
      ['popular', [41]],
    ]);
    fakes.igdbDown = true;
    await run('warm-discover');
    await built.tasks.idle();
    expect(built.tasks.status('warm-discover')).toMatchObject({ lastOutcome: 'failed', lastMessage: expect.stringMatching(/couldn’t load any/) });

    const put = (key: string, intervalSeconds: unknown) => built.app.inject({ method: 'PUT', url: `/api/admin/tasks/${key}`, headers: root.headers, payload: { intervalSeconds } });
    expect((await put('request-sync', 10)).json().error).toMatch(/runs every 30 s to 1 h/);
    expect((await put('request-sync', 0)).json().error).toMatch(/can’t be turned off/);
    expect((await put('warm-discover', 0)).json().task).toMatchObject({ intervalSeconds: 0, nextRun: null });
    expect((await put('request-sync', 120)).json().task.intervalSeconds).toBe(120);
    expect((await put('nope', 120)).statusCode).toBe(404);
  });
});

describe('RomM links', () => {
  it('links a ready request to the game in RomM once RetroArr’s RomM sync has seen it, and shows where to play', async () => {
    await start();
    const root = await login('root');
    const created = (await built.app.inject({ method: 'POST', url: '/api/requests', headers: root.headers, payload: { igdbId: 1020, platformId: 41 } })).json().request;
    await flush();
    const game = fakes.games.find((g) => g.igdbId === 1020)!;
    game.status = 4;
    const run = async () => {
      await built.app.inject({ method: 'POST', url: '/api/admin/tasks/request-sync/run', headers: root.headers });
      await built.tasks.idle();
    };

    // Imported, but RomM hasn't scanned it yet
    await run();
    expect(built.store.request(created.id)).toMatchObject({ status: 'available', rommId: null });
    let page = (await built.app.inject({ url: '/api/games/1020', headers: root.headers })).json();
    expect(page.game).toMatchObject({ inLibrary: [41], romm: [] });

    // RomM has it now
    fakes.rommIds.set(game.id, 555);
    await run();
    expect(built.store.request(created.id)!.rommId).toBe(555);
    expect(built.tasks.status('request-sync')!.lastMessage).toMatch(/1 linked to RomM/);
    page = (await built.app.inject({ url: '/api/games/1020', headers: root.headers })).json();
    expect(page.game.romm).toEqual([{ platformId: 41, rommId: 555 }]);

    // Nothing left to follow or link: skipped
    await run();
    expect(built.tasks.status('request-sync')).toMatchObject({ lastOutcome: 'skipped' });
  });
});

describe('request timeline', () => {
  it('shows each request’s steps in plain words, with the detail for admins only', async () => {
    await start();
    const root = await login('root');
    const a = await login('alice');
    const created = (await built.app.inject({ method: 'POST', url: '/api/requests', headers: a.headers, payload: { igdbId: 1020, platformId: 41 } })).json().request;
    const timeline = async (headers: Record<string, string>) => (await built.app.inject({ url: `/api/requests/${created.id}/timeline`, headers })).json();

    let t = await timeline(a.headers);
    expect(t.current).toMatchObject({ key: 'approved', state: 'current', detail: 'Waiting for an admin to approve it.' });
    expect(t.steps.map((s: { key: string; state: string }) => `${s.key}:${s.state}`)).toEqual([
      'requested:done',
      'approved:current',
      'looking:waiting',
      'downloading:waiting',
      'library:waiting',
      'romm:waiting',
    ]);
    // Someone else's request isn't theirs to see
    const b = await login('bob');
    expect((await built.app.inject({ url: `/api/requests/${created.id}/timeline`, headers: b.headers })).statusCode).toBe(404);

    // Approved and handed to RetroArr; its last search found releases but none good enough
    await built.app.inject({ method: 'POST', url: `/api/requests/${created.id}/approve`, headers: root.headers, payload: {} });
    await flush();
    const game = fakes.games.find((g) => g.igdbId === 1020)!;
    fakes.hunts.set(game.id, {
      lastSearch: { at: '2026-11-12T11:00:00Z', outcome: 'NoneGoodEnough', found: 4, rejected: 3, automatic: true, release: 'Chrono Trigger (Hack)', score: 40, reason: 'below auto-download threshold' },
      nextSearchAt: '2026-11-12T18:00:00Z',
    });
    t = await timeline(a.headers);
    expect(t.current).toMatchObject({ key: 'looking', detail: 'Copies were found, but none good enough yet.', nextAt: '2026-11-12T18:00:00Z', adminDetail: null });
    const admin = await timeline(root.headers);
    expect(admin.current.adminDetail).toBe('4 release(s) found, 3 rejected. Best: Chrono Trigger (Hack) (score 40). below auto-download threshold');
    expect(admin.steps[1].adminDetail).toBe('By root');

    // The list carries each request's current step
    const list = (await built.app.inject({ url: '/api/requests?withStatus=1', headers: a.headers })).json().requests;
    expect(list[0].now).toMatchObject({ key: 'looking', detail: 'Copies were found, but none good enough yet.' });

    // Grabbed, then imported, then in RomM
    built.store.updateRequest(created.id, { status: 'downloading', release: 'Chrono Trigger (USA)' });
    t = await timeline(a.headers);
    expect(t.current).toMatchObject({ key: 'downloading', state: 'current', adminDetail: null });
    built.store.updateRequest(created.id, { status: 'available', availableAt: clock.toISOString() });
    t = await timeline(a.headers);
    expect(t.current).toMatchObject({ key: 'romm', state: 'current', detail: 'Being added to RomM, usually within the hour.' });
    built.store.updateRequest(created.id, { rommId: 9 });
    t = await timeline(root.headers);
    expect(t.steps.every((s: { state: string }) => s.state === 'done')).toBe(true);
    expect(t.history.map((h: { text: string }) => h.text)).toEqual([
      'Requested',
      'Approved',
      'Looking for a copy',
      'Found a copy; downloading',
      'Added to the library',
      'Ready in RomM',
    ]);
    expect(t.history[3].adminDetail).toBe('Chrono Trigger (USA)');
    expect((await timeline(a.headers)).history[3].adminDetail).toBeNull();
  });

  it('says when a download failed and it’s looking again, and when monitoring is off', async () => {
    await start();
    const root = await login('root');
    const created = (await built.app.inject({ method: 'POST', url: '/api/requests', headers: root.headers, payload: { igdbId: 427, platformId: 50 } })).json().request;
    await flush();
    built.store.updateRequest(created.id, { status: 'downloading', release: 'FF7 (USA)' });
    built.store.updateRequest(created.id, { status: 'searching', error: 'Download stalled for 24 hours' });
    fakes.monitoring = false;
    const t = (await built.app.inject({ url: `/api/requests/${created.id}/timeline`, headers: root.headers })).json();
    expect(t.current.detail).toMatch(/^The last download didn’t work out, so it’s looking for another copy\. Waiting for its first search\./);
    expect(t.current.adminDetail).toMatch(/Download failed: Download stalled for 24 hours\. RetroArr’s monitoring is off/);
  });
});

describe('collections in progress', () => {
  it('counts the games already in the library, not only requests', async () => {
    await start();
    fakes.catalogue.set(1009, { title: 'Final Fantasy VI', year: 1994, platforms: [41, 50] });
    fakes.franchises.set(5, { name: 'Final Fantasy', games: [427, 1009] });
    // Nobody requested anything; the library has Final Fantasy VII
    fakes.games.push({ id: 1, title: 'Final Fantasy VII', igdbId: 427, platformId: 50, status: 4, monitored: false });
    const a = await login('alice');
    const rows = (await built.app.inject({ url: '/api/collections', headers: a.headers })).json();
    expect(rows.inProgress).toMatchObject([{ kind: 'series', id: 5, name: 'Final Fantasy', total: 2, inLibrary: 1 }]);
  });
});
