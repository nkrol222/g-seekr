import { describe, expect, it } from 'vitest';
import { openDb } from '../server/src/db.js';
import { buildWhere, DirectIgdbRetroArrClient, IgdbApi, IgdbError, similarity } from '../server/src/igdb.js';

const RETROARR = 'http://retroarr.test';
const TOKEN = 'rat_' + 'x'.repeat(43);

// Twitch, IGDB and the two RetroArr endpoints the direct client still needs
function fakes() {
  const state = {
    igdbCalls: [] as Array<{ endpoint: string; body: string; auth: string | null }>,
    retroarrCalls: [] as string[],
    tokens: 0,
    igdbDown: false,
    expireTokenOnce: false,
    owned: new Map<number, Array<{ gameId: number; platformId: number; status: number; rommId: number | null }>>([[1020, [{ gameId: 7, platformId: 41, status: 4, rommId: 55 }]]]),
  };
  const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
    if (url.host === 'id.twitch.tv') {
      state.tokens++;
      return url.searchParams.get('client_secret') === 'secret' ? json({ access_token: `tok${state.tokens}`, expires_in: 3600 }) : json({ message: 'invalid' }, 400);
    }
    if (url.host === 'api.igdb.com') {
      const endpoint = url.pathname.replace('/v4/', '');
      const body = String(init?.body ?? '');
      const auth = new Headers(init?.headers).get('Authorization');
      state.igdbCalls.push({ endpoint, body, auth });
      if (state.igdbDown) return json({ message: 'down' }, 503);
      if (state.expireTokenOnce) {
        state.expireTokenOnce = false;
        return json({ message: 'expired' }, 401);
      }
      if (endpoint === 'popularity_primitives') return json([{ game_id: 427 }, { game_id: 999 }]);
      if (endpoint === 'genres') return json([{ id: 12, name: 'Role-playing (RPG)' }]);
      if (endpoint === 'games' && body.includes('where id = 1020;'))
        return json([
          {
            id: 1020,
            name: 'Chrono Trigger',
            cover: { image_id: 'co1' },
            first_release_date: 795571200,
            platforms: [19],
            release_dates: [
              { platform: { id: 19, name: 'SNES' }, date: 795571200, region: 5 },
              { platform: { id: 19, name: 'SNES' }, date: 800000000, release_region: { region: 'north_america' } },
              { platform: { id: 7, name: 'PlayStation' }, date: 941932800 },
            ],
            franchises: [{ id: 5, name: 'Chrono' }],
            dlcs: [{ id: 91, name: 'Bonus Dungeon', first_release_date: 900000000 }, { id: 90, name: 'Early Pack', first_release_date: 800000000 }],
            expansions: [{ id: 91, name: 'Bonus Dungeon', first_release_date: 900000000 }],
            involved_companies: [{ company: { id: 70, name: 'Square' }, developer: true, publisher: true }],
            videos: [{ name: 'Trailer', video_id: 'abcdefgh' }, { name: 'bad', video_id: '<script>' }],
          },
        ]);
      if (endpoint === 'games')
        return json([
          { id: 427, name: 'Final Fantasy VII', cover: { image_id: 'co2' }, first_release_date: 852076800, total_rating: 92.456, platforms: [7, 6], genres: [{ id: 12, name: 'Role-playing (RPG)' }] },
          { id: 1020, name: 'Chrono Trigger', cover: { image_id: 'co1' }, first_release_date: 795571200, platforms: [19, 7] },
        ]);
      return json([]);
    }
    if (url.origin === RETROARR) {
      state.retroarrCalls.push(`${init?.method ?? 'GET'} ${url.pathname}`);
      if (url.pathname === '/api/v3/platform')
        return json([
          { id: 41, name: 'Super Nintendo', slug: 'snes', enabled: true, igdbPlatformId: 19 },
          { id: 50, name: 'PlayStation', slug: 'psx', enabled: true, igdbPlatformId: 7 },
          { id: 60, name: 'Off', slug: 'off', enabled: false, igdbPlatformId: 6 },
        ]);
      if (url.pathname === '/api/v3/discover/library') {
        const ids = JSON.parse(String(init?.body)).igdbIds as number[];
        return json({ games: ids.map((id) => ({ igdbId: id, library: state.owned.get(id) ?? [] })) });
      }
    }
    return json({ message: 'not found' }, 404);
  };
  return { state, fetchImpl };
}

function client(secret = 'secret') {
  const f = fakes();
  const db = openDb(':memory:');
  const api = new IgdbApi('client', secret, db, f.fetchImpl);
  return { ...f, db, api, retroarr: new DirectIgdbRetroArrClient(RETROARR, TOKEN, api, f.fetchImpl) };
}

describe('IGDB, asked directly', () => {
  it('builds Discover lists from IGDB, with RetroArr platforms and what the library has', async () => {
    const c = client();
    const games = await c.retroarr.discoverGames({ list: 'browse', sort: 'rating', platformIds: [41, 50] });
    expect(games.map((g) => g.title)).toEqual(['Final Fantasy VII', 'Chrono Trigger']);
    // IGDB platform 6 is a disabled RetroArr platform: not offered
    expect(games[0]!.platformIds).toEqual([50]);
    expect(games[0]!.rating).toBe(92.5);
    expect(games[0]!.coverUrl).toBe('https://images.igdb.com/igdb/image/upload/t_cover_big/co2.jpg');
    expect(games[1]!.library).toEqual([{ gameId: 7, platformId: 41, status: 'Downloaded', rommId: 55, region: '', variant: '', revision: null }]);
    const body = c.state.igdbCalls.find((x) => x.endpoint === 'games')!.body;
    expect(body).toContain('where platforms = (7,19) & version_parent = null & parent_game = null');
    expect(body).toContain('sort total_rating desc');
    expect(c.state.igdbCalls[0]!.auth).toBe('Bearer tok1');
    // The library in one call for the page
    expect(c.state.retroarrCalls.filter((x) => x.endsWith('/discover/library'))).toHaveLength(1);
  });

  it('keeps IGDB answers in the database, and serves them while IGDB is down', async () => {
    const c = client();
    await c.retroarr.discoverGames({ list: 'browse', sort: 'name', platformIds: [50] });
    const calls = c.state.igdbCalls.length;
    // A new client on the same database: as after a restart
    const again = new DirectIgdbRetroArrClient(RETROARR, TOKEN, new IgdbApi('client', 'secret', c.db, c.fetchImpl), c.fetchImpl);
    c.state.igdbDown = true;
    const games = await again.discoverGames({ list: 'browse', sort: 'name', platformIds: [50] });
    expect(games).toHaveLength(2);
    expect(c.state.igdbCalls.length).toBe(calls);
    await expect(again.discoverGames({ list: 'browse', sort: 'newest', platformIds: [50] })).rejects.toThrow(IgdbError);
  });

  it('a stale answer is used when IGDB fails; a fresh one replaces it when IGDB answers', async () => {
    let now = 1_000_000;
    const f = fakes();
    const db = openDb(':memory:');
    const api = new IgdbApi('client', 'secret', db, f.fetchImpl, () => now);
    await api.cached('k', async () => ['old']);
    now += 7 * 3_600_000;
    expect(await api.cached('k', async () => { throw new IgdbError('down'); })).toEqual(['old']);
    expect(await api.cached('k', async () => ['new'])).toEqual(['new']);
    now += 8 * 86_400_000;
    expect(api.prune()).toBe(1);
  });

  it('gets a new Twitch token when IGDB drops the old one, and names a bad secret', async () => {
    const c = client();
    c.state.expireTokenOnce = true;
    await c.retroarr.discoverOptions();
    expect(c.state.tokens).toBe(2);
    const bad = client('wrong');
    await expect(bad.retroarr.discoverOptions()).rejects.toThrow(/IGDB_CLIENT_ID and IGDB_CLIENT_SECRET/);
  });

  it('asks IGDB at most 4 times a second', async () => {
    const c = client();
    const started = Date.now();
    await Promise.all([1, 2, 3].map((n) => c.api.query('games', `fields name; where id = ${n};`)));
    expect(Date.now() - started).toBeGreaterThanOrEqual(500);
  });

  it('builds the game page: first release per platform, videos, series, developer', async () => {
    const c = client();
    const d = await c.retroarr.discoverGame(1020, false);
    expect(d!.game.title).toBe('Chrono Trigger');
    expect(d!.releases).toEqual([
      { platform: 'SNES', platformId: 41, date: '1995-03-19', regions: ['Japan', 'USA'] },
      { platform: 'PlayStation', platformId: 50, date: '1999-11-07', regions: [] },
    ]);
    expect(d!.videos).toEqual([{ name: 'Trailer', youtubeId: 'abcdefgh' }]);
    expect(d!.developer).toBe('Square');
    expect(d!.seriesRefs).toEqual([{ id: 5, name: 'Chrono' }]);
    expect(d!.dlc).toEqual([
      { igdbId: 90, title: 'Early Pack', year: 1995, kind: 'DLC' },
      { igdbId: 91, title: 'Bonus Dungeon', year: 1998, kind: 'DLC' },
    ]);
    expect(d!.game.library[0]!.rommId).toBe(55);
    const series = c.state.igdbCalls.find((x) => x.body.includes('where franchises = (5)'))!;
    expect(series.body).toContain('(themes = null | themes != (42))');
  });

  it('the search box marks what the library has', async () => {
    const c = client();
    const found = await c.retroarr.lookup('chrono');
    expect(found.find((g) => g.igdbId === 1020)!.owned).toBe(true);
    expect(found.find((g) => g.igdbId === 427)!.owned).toBe(false);
    expect(c.state.igdbCalls.some((x) => x.body.includes('search "chrono"'))).toBe(true);
  });
});

describe('IGDB query text', () => {
  it('is what RetroArr sent', () => {
    const now = new Date(Date.UTC(2026, 10, 19));
    expect(buildWhere({ genreIds: [12, 12], yearFrom: 1990, yearTo: 1999, minRating: 80 }, [7, 19], now)).toBe(
      'platforms = (7,19) & version_parent = null & parent_game = null & genres = (12) & (themes = null | themes != (42)) & ' +
        'first_release_date >= 631152000 & first_release_date < 946684800 & total_rating >= 80 & cover != null & first_release_date <= 1795046400',
    );
    expect(buildWhere({ query: 'zelda', includeAdult: true, themeIds: [42] }, [19], now)).toBe('platforms = (19) & version_parent = null & parent_game = null & themes = (42)');
  });

  it('finds how alike a list title and an IGDB name are', () => {
    expect(similarity('Pokémon Red', 'Pokemon Red')).toBe(1);
    expect(similarity('Chrono Trigger (USA)', 'Chrono Trigger')).toBe(0.9);
    expect(similarity('Tony Hawk\\\'s Pro Skater 2', "Tony Hawk's Pro Skater 2")).toBe(1);
    expect(similarity('Mario', 'Mario Kart')).toBeLessThan(0.9);
  });
});
