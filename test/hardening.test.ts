// Hostile input, other people's data, races and load: what a real deployment meets that the feature tests don't.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../server/src/app.js';
import { loadConfig, type Config } from '../server/src/config.js';
import { openDb } from '../server/src/db.js';
import { JellyfinClient } from '../server/src/jellyfin.js';
import { RetroArrClient } from '../server/src/retroarr.js';
import { DISCORD, Fakes, JELLYFIN, RETROARR, TOKEN } from './fakes.js';

const H = { 'x-gseekr': '1' };
const WEBHOOK_TOKEN = 'w'.repeat(32);
type App = Awaited<ReturnType<typeof buildApp>>;

let fakes: Fakes;
let built: App;
let clock: Date;

async function start(overrides: Record<string, string> = {}) {
  const env = {
    JELLYFIN_URL: JELLYFIN,
    RETROARR_URL: RETROARR,
    RETROARR_TOKEN: TOKEN,
    DISCORD_WEBHOOK_URL: DISCORD,
    ROMM_URL: 'https://romm.test',
    RETROARR_WEBHOOK_TOKEN: WEBHOOK_TOKEN,
    REQUEST_LIMIT: '2',
    ...overrides,
  };
  const config: Config = loadConfig(env);
  built = await buildApp({
    config,
    env,
    db: openDb(':memory:'),
    jellyfin: new JellyfinClient(JELLYFIN, fakes.fetch),
    retroarr: new RetroArrClient(RETROARR, TOKEN, fakes.fetch),
    fetchImpl: fakes.fetch,
    logger: false,
    now: () => clock,
  });
  return built.app;
}

async function login(username: string) {
  const res = await built.app.inject({ method: 'POST', url: '/api/auth/login', headers: H, payload: { username, password: 'pw' } });
  const cookie = res.cookies.find((c) => c.name === 'gseekr_session');
  return { res, headers: { ...H, cookie: cookie ? `gseekr_session=${cookie.value}` : '' } };
}

// More people than the feature tests need
function addUsers(n: number) {
  for (let i = 0; i < n; i++) fakes.jellyfinUsers.set(`user${i}`, { id: `jf-user${i}`, password: 'pw', admin: false });
}

const flush = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
  fakes = new Fakes();
  clock = new Date('2026-11-12T12:00:00Z');
});
afterEach(async () => {
  await built?.app.close();
  // Nothing a request sent may have polluted every object
  expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  expect(({} as Record<string, unknown>).isAdmin).toBeUndefined();
});

const BODIES: unknown[] = [
  undefined,
  null,
  [],
  {},
  'just a string',
  12345,
  true,
  { igdbId: '1020; DROP TABLE requests', platformId: -1, region: {}, variant: [], latestRevision: 'yes' },
  { igdbId: 1e308, platformId: Number.MAX_SAFE_INTEGER + 2, kind: 'hack', hackId: '../../../etc/passwd' },
  { igdbId: 1020, platformId: 41, kind: 'addons', dlc: 'all', latestUpdate: 'x', allDlc: 1 },
  { igdbId: 1020, platformId: 41, dlc: Array.from({ length: 500 }, (_, i) => ({ igdbId: i, title: 'x'.repeat(400) })) },
  { note: { $gt: '' }, reason: 7, kind: 'nope', details: ['a'] },
  { token: { toString: 'x' }, liked: 'maybe', title: 5 },
  { name: '<script>alert(1)</script>', titles: 'not a list', source: null, platformId: 'snes' },
  { publicUrl: 'javascript:alert(1)', sessionDays: 'forever', requestLimit: -5, discordWebhookUrl: 'http://evil.test/hook' },
  { enabled: 'false', interval: -1, intervalMinutes: 1e9 },
  { isAdmin: 'true', autoApprove: 1, requestLimit: '∞' },
  JSON.parse('{"__proto__": {"polluted": 1, "isAdmin": true}, "constructor": {"prototype": {"polluted": 1}}}'),
  { a: { b: { c: { d: { e: { f: { g: { h: { i: { j: { k: 'deep' } } } } } } } } } } },
  { igdbIds: Array.from({ length: 5000 }, (_, i) => i), genreIds: 'x', platformIds: [null, 'a', -1] },
  { text: '\u0000￿\uD800 null and lone surrogate', title: '😀'.repeat(1000) },
];

const PARAMS: Record<string, string[]> = {
  id: ['1', 'abc', '-1', '99999999999999999999', '1e3', '%00', '..%2F..'],
  igdbId: ['1020', 'abc', '-5', '0'],
  kind: ['series', 'list', 'nope'],
  key: ['poll', 'nope', '__proto__'],
  what: ['retroarr', 'jellyfin', 'romm', 'discord', 'nope'],
};

function fill(route: string, variant: number): string {
  return route.replace(/:(\w+)/g, (_, name: string) => {
    const options = PARAMS[name] ?? ['1'];
    return options[variant % options.length]!;
  });
}

describe('hostile input', () => {
  it('answers every route, with any body and odd ids, without a server error', async () => {
    await start();
    const root = await login('root');
    const alice = await login('alice');
    // Something for the routes to find
    await built.app.inject({ method: 'POST', url: '/api/requests', headers: alice.headers, payload: { igdbId: 1020, platformId: 41 } });

    const routes = [...new Set(built.routes)].filter((r) => !r.endsWith('/api/auth/logout') && !r.includes('*'));
    expect(routes.length).toBeGreaterThan(40);
    const failures: string[] = [];
    for (const route of routes) {
      const [method, path] = route.split(' ') as [string, string];
      for (const [who, headers] of [['admin', root.headers], ['user', alice.headers]] as const) {
        for (let v = 0; v < 7; v++) {
          const url = fill(path, v) + (v % 2 ? '?ids=,,,-1,abc&term=%00&page=-1&limit=99999999&scope=all&platform=x' : '');
          const bodies = method === 'GET' || method === 'DELETE' ? [undefined] : BODIES;
          for (const body of bodies) {
            const res = await built.app.inject({
              method: method as 'GET',
              url,
              headers: route.startsWith('POST /api/webhooks') ? { 'x-webhook-token': WEBHOOK_TOKEN, 'content-type': 'application/json' } : { ...headers, 'content-type': 'application/json' },
              ...(body === undefined ? {} : { payload: JSON.stringify(body) }),
            });
            if (res.statusCode >= 500) failures.push(`${who} ${method} ${url} ${JSON.stringify(body)?.slice(0, 80)} -> ${res.statusCode} ${res.body.slice(0, 120)}`);
          }
        }
      }
    }
    expect(failures).toEqual([]);
  }, 120_000);

  it('turns away a signed-out visitor, a forged cookie and a missing CSRF header on every private route', async () => {
    await start();
    const root = await login('root');
    const open = new Set(['GET /api/health', 'POST /api/auth/login', 'POST /api/webhooks/retroarr', 'POST /api/auth/logout']);
    for (const route of new Set(built.routes)) {
      if (open.has(route) || route.includes('*')) continue;
      const [method, path] = route.split(' ') as [string, string];
      const url = fill(path, 0);
      for (const headers of [H, { ...H, cookie: 'gseekr_session=' + 'a'.repeat(64) }, { ...H, cookie: 'gseekr_session=../../x' }]) {
        const res = await built.app.inject({ method: method as 'GET', url, headers, payload: method === 'GET' ? undefined : {} });
        expect(res.statusCode, `${route} with ${JSON.stringify(headers)}`).toBe(401);
      }
      if (method !== 'GET') {
        const res = await built.app.inject({ method: method as 'POST', url, headers: { cookie: root.headers.cookie }, payload: {} });
        expect(res.statusCode, `${route} without the CSRF header`).toBe(403);
      }
    }
  });

  it('refuses an oversized body', async () => {
    await start();
    const alice = await login('alice');
    const res = await built.app.inject({ method: 'PUT', url: '/api/me/filters', headers: { ...alice.headers, 'content-type': 'application/json' }, payload: JSON.stringify({ x: 'y'.repeat(200_000) }) });
    expect(res.statusCode).toBe(413);
  });
});

describe('other people’s data', () => {
  it('keeps each user to their own requests, timelines, problem reports and progress', async () => {
    await start();
    const alice = await login('alice');
    const bob = await login('bob');
    const root = await login('root');
    const created = await built.app.inject({ method: 'POST', url: '/api/requests', headers: root.headers, payload: { igdbId: 427, platformId: 50 } });
    const rootReq = created.json().request.id;
    const aliceReq = (await built.app.inject({ method: 'POST', url: '/api/requests', headers: alice.headers, payload: { igdbId: 1020, platformId: 41 } })).json().request.id;
    await built.app.inject({ method: 'POST', url: `/api/requests/${aliceReq}/approve`, headers: root.headers, payload: {} });
    fakes.games.find((g) => g.igdbId === 1020)!.status = 4;
    await built.requests.poll();
    const report = await built.app.inject({ method: 'POST', url: `/api/requests/${aliceReq}/issues`, headers: alice.headers, payload: { kind: 'wont_launch', details: 'black screen' } });
    expect(report.statusCode).toBe(201);

    // Bob sees none of it
    expect((await built.app.inject({ url: '/api/requests?scope=all', headers: bob.headers })).json().requests).toEqual([]);
    expect((await built.app.inject({ url: '/api/requests', headers: bob.headers })).json().requests).toEqual([]);
    expect((await built.app.inject({ url: `/api/requests/${aliceReq}/timeline`, headers: bob.headers })).statusCode).toBe(404);
    expect((await built.app.inject({ url: `/api/requests/${rootReq}/timeline`, headers: bob.headers })).statusCode).toBe(404);
    expect((await built.app.inject({ method: 'POST', url: `/api/requests/${aliceReq}/issues`, headers: bob.headers, payload: { kind: 'wont_launch' } })).statusCode).toBe(404);
    expect((await built.app.inject({ method: 'DELETE', url: `/api/requests/${aliceReq}`, headers: bob.headers })).statusCode).toBe(404);
    const issues = (await built.app.inject({ url: '/api/issues?scope=all', headers: bob.headers })).json();
    expect(JSON.stringify(issues)).not.toContain('black screen');
    const progress = (await built.app.inject({ url: '/api/progress?all=1', headers: bob.headers })).json();
    expect(progress.progress).toEqual([]);
    // Alice can't decide her own request
    expect((await built.app.inject({ method: 'POST', url: `/api/requests/${aliceReq}/retry`, headers: alice.headers, payload: {} })).statusCode).toBe(403);
    // and an admin's view has both
    expect((await built.app.inject({ url: '/api/requests?scope=all', headers: root.headers })).json().requests).toHaveLength(2);
  });

  it('never sends one user another user’s RomM token or preferences', async () => {
    await start({ ROMM_API_URL: 'http://romm.test' });
    const alice = await login('alice');
    const bob = await login('bob');
    await built.app.inject({ method: 'PUT', url: '/api/me/preferences', headers: alice.headers, payload: { region: 'Japan' } });
    const bobMe = await built.app.inject({ url: '/api/me', headers: bob.headers });
    expect(bobMe.body).not.toContain('Japan');
    expect(bobMe.body).not.toContain('rmm_');
  });
});

describe('races', () => {
  it('makes one request when many people ask for the same game at once', async () => {
    addUsers(30);
    await start();
    const people = await Promise.all(Array.from({ length: 30 }, (_, i) => login(`user${i}`)));
    const answers = await Promise.all(
      people.map((p) => built.app.inject({ method: 'POST', url: '/api/requests', headers: p.headers, payload: { igdbId: 1020, platformId: 41 } })),
    );
    const codes = answers.map((a) => a.statusCode).sort();
    expect(codes.filter((c) => c === 201)).toHaveLength(1);
    expect(codes.every((c) => c === 201 || c === 409)).toBe(true);
    expect(built.store.listRequests({ limit: null })).toHaveLength(1);
  });

  it('holds a user to their limit when they send many requests at once', async () => {
    await start();
    const alice = await login('alice');
    for (let i = 0; i < 8; i++) fakes.catalogue.set(9000 + i, { title: `Game ${i}`, year: 2000, platforms: [41] });
    const answers = await Promise.all(
      Array.from({ length: 8 }, (_, i) => built.app.inject({ method: 'POST', url: '/api/requests', headers: alice.headers, payload: { igdbId: 9000 + i, platformId: 41 } })),
    );
    expect(answers.filter((a) => a.statusCode === 201)).toHaveLength(2);
    expect(answers.filter((a) => a.statusCode === 429)).toHaveLength(6);
    expect(built.store.listRequests({ limit: null })).toHaveLength(2);
  });

  it('hands a request to RetroArr once when it is approved twice at once', async () => {
    await start();
    const alice = await login('alice');
    const root = await login('root');
    const id = (await built.app.inject({ method: 'POST', url: '/api/requests', headers: alice.headers, payload: { igdbId: 1020, platformId: 41 } })).json().request.id;
    const answers = await Promise.all(
      Array.from({ length: 10 }, () => built.app.inject({ method: 'POST', url: `/api/requests/${id}/approve`, headers: root.headers, payload: {} })),
    );
    expect(answers.filter((a) => a.statusCode === 200)).toHaveLength(1);
    expect(answers.filter((a) => a.statusCode === 409)).toHaveLength(9);
    expect(fakes.fulfilBodies).toHaveLength(1);
  });

  it('copes with a poll, a webhook and an approval for the same game arriving together', async () => {
    await start();
    const root = await login('root');
    const id = (await built.app.inject({ method: 'POST', url: '/api/requests', headers: root.headers, payload: { igdbId: 1020, platformId: 41 } })).json().request.id;
    const gameId = built.store.request(id)!.retroarrGameId!;
    fakes.games.find((g) => g.id === gameId)!.status = 4;
    await Promise.all([
      built.requests.poll(),
      built.app.inject({ method: 'POST', url: '/api/webhooks/retroarr', headers: { 'x-webhook-token': WEBHOOK_TOKEN }, payload: { event: 'OnDownloadCompleted', data: { gameId, release: 'Chrono Trigger (USA)' } } }),
      built.requests.poll(),
    ]);
    await flush();
    expect(built.store.request(id)!.status).toBe('available');
    // told once, not once per path
    expect(fakes.discord.filter((d) => d.content.includes('ready to play'))).toHaveLength(1);
  });
});

describe('sessions', () => {
  it('ends a session on sign-out, and after the session length', async () => {
    await start({ SESSION_DAYS: '2' });
    const alice = await login('alice');
    expect((await built.app.inject({ url: '/api/me', headers: alice.headers })).statusCode).toBe(200);
    await built.app.inject({ method: 'POST', url: '/api/auth/logout', headers: alice.headers });
    expect((await built.app.inject({ url: '/api/me', headers: alice.headers })).statusCode).toBe(401);

    const again = await login('alice');
    clock = new Date(clock.getTime() + 3 * 86_400_000);
    expect((await built.app.inject({ url: '/api/me', headers: again.headers })).statusCode).toBe(401);
  });

  it('keeps a user out once Jellyfin disables them, at their next sign-in', async () => {
    await start();
    fakes.jellyfinUsers.get('alice')!.disabled = true;
    const res = await login('alice');
    expect([401, 403]).toContain(res.res.statusCode);
    expect(res.headers.cookie).toBe('');
  });
});

describe('a real evening', () => {
  it('runs a user’s whole story: search, like, request, approval, download, play, report, replace', async () => {
    await start({ REQUEST_LIMIT: '5' });
    const alice = await login('alice');
    const root = await login('root');

    const found = (await built.app.inject({ url: '/api/search?q=chrono', headers: alice.headers })).json();
    expect(found.results.map((g: { title: string }) => g.title)).toContain('Chrono Trigger');
    expect((await built.app.inject({ method: 'PUT', url: '/api/games/427/like', headers: alice.headers, payload: { liked: true, title: 'Final Fantasy VII' } })).statusCode).toBeLessThan(300);

    const id = (await built.app.inject({ method: 'POST', url: '/api/requests', headers: alice.headers, payload: { igdbId: 1020, platformId: 41 } })).json().request.id;
    expect((await built.app.inject({ method: 'POST', url: `/api/requests/${id}/approve`, headers: root.headers, payload: {} })).json().request.status).toBe('searching');
    const gameId = built.store.request(id)!.retroarrGameId!;

    const hook = (event: string, data: Record<string, unknown>) =>
      built.app.inject({ method: 'POST', url: '/api/webhooks/retroarr', headers: { 'x-webhook-token': WEBHOOK_TOKEN }, payload: { event, data: { gameId, ...data } } });
    await hook('OnDownloadStarted', { release: 'Chrono Trigger (USA)' });
    expect(built.store.request(id)!.status).toBe('downloading');
    await hook('OnDownloadFailed', { reason: 'stalled', stage: 'download' });
    expect(built.store.request(id)!.status).toBe('searching');
    await hook('OnDownloadStarted', { release: 'Chrono Trigger (USA) (Rev 1)' });
    await hook('OnDownloadCompleted', { release: 'Chrono Trigger (USA) (Rev 1)' });
    expect(built.store.request(id)).toMatchObject({ status: 'available', release: 'Chrono Trigger (USA) (Rev 1)' });

    const timeline = (await built.app.inject({ url: `/api/requests/${id}/timeline`, headers: alice.headers })).json();
    expect(timeline.steps.find((s: { key: string }) => s.key === 'library')).toMatchObject({ state: 'done' });

    const report = await built.app.inject({ method: 'POST', url: `/api/requests/${id}/issues`, headers: alice.headers, payload: { kind: 'wont_launch', details: 'crashes at boot' } });
    expect(report.statusCode).toBe(201);
    const issueId = report.json().issue.id;
    const replaced = await built.app.inject({ method: 'POST', url: `/api/issues/${issueId}/replace`, headers: root.headers, payload: {} });
    expect(replaced.statusCode).toBe(200);
    expect(fakes.replaced).toEqual([expect.objectContaining({ gameId })]);
    await flush();
    const told = fakes.discord.map((d) => d.content).join('\n');
    expect(told).toContain('Chrono Trigger');
    // nothing pinged anyone
    expect(fakes.discord.every((d) => JSON.stringify(d.allowed_mentions).includes('parse'))).toBe(true);
  });
});

describe('load', () => {
  it('lists, polls and searches quickly with thousands of requests on file', async () => {
    addUsers(50);
    await start({ REQUEST_LIMIT: '0' });
    const people = await Promise.all(Array.from({ length: 50 }, (_, i) => login(`user${i}`)));
    const ids = built.store.listRequests({ limit: null });
    expect(ids).toHaveLength(0);
    const users = (await built.app.inject({ url: '/api/admin/users', headers: (await login('root')).headers })).json().users as { id: number; username: string }[];
    const version = { region: '', variant: '', latestRevision: false };
    for (let i = 0; i < 3000; i++) {
      const u = users[i % users.length]!;
      const r = built.store.createRequest({ userId: u.id, igdbId: 100000 + i, platformId: 41, platformName: 'Super Nintendo', title: `Game ${i}`, year: 1990 + (i % 30), coverUrl: null, version, kind: 'game' });
      if (i % 3 === 0) {
        fakes.games.push({ id: 10000 + i, title: `Game ${i}`, igdbId: 100000 + i, platformId: 41, status: i % 2 ? 4 : 0, monitored: true });
        built.store.updateRequest(r.id, { status: 'searching', retroarrGameId: 10000 + i });
      }
    }
    const root = await login('root');
    let t = Date.now();
    const all = await built.app.inject({ url: '/api/requests?scope=all', headers: root.headers });
    expect(all.statusCode).toBe(200);
    expect(all.json().requests.length).toBe(500);
    expect(Date.now() - t).toBeLessThan(3000);

    t = Date.now();
    await built.requests.poll();
    expect(Date.now() - t).toBeLessThan(5000);
    expect(fakes.statesCalls).toBe(2);

    // 50 people loading their pages at once
    t = Date.now();
    const pages = await Promise.all(people.map((p) => built.app.inject({ url: '/api/requests', headers: p.headers })));
    expect(pages.every((p) => p.statusCode === 200)).toBe(true);
    expect(Date.now() - t).toBeLessThan(5000);
  }, 60_000);
});
