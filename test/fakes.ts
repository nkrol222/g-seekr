// In-memory stand-ins for Jellyfin, RetroArr and a Discord webhook, served through one fetch stub.

export const JELLYFIN = 'http://jellyfin.test';
export const RETROARR = 'http://retroarr.test';
export const DISCORD = 'http://discord.test/webhook';
export const ROMM = 'http://romm.test';
export const ROMM_TOKEN = 'rmm_' + 'a'.repeat(64);
export const TOKEN = 'rat_' + 'x'.repeat(43);

export interface FakeGame {
  id: number;
  title: string;
  igdbId: number;
  platformId: number;
  status: number; // RetroArr's enum: 3 Downloading, 4 Downloaded
  monitored: boolean;
}

export class Fakes {
  jellyfinUsers = new Map<string, { id: string; password: string; admin: boolean; disabled?: boolean }>([
    ['alice', { id: 'jf-alice', password: 'pw', admin: false }],
    ['bob', { id: 'jf-bob', password: 'pw', admin: false }],
    ['root', { id: 'jf-root', password: 'pw', admin: true }],
  ]);
  jellyfinDown = false;
  jellyfinLogouts = 0;

  platforms = [
    { id: 41, name: 'Super Nintendo', slug: 'snes', category: 'Nintendo', enabled: true },
    { id: 50, name: 'PlayStation', slug: 'psx', category: 'Sony', enabled: true },
    { id: 60, name: 'Disabled', slug: 'off', category: 'X', enabled: false },
  ];
  catalogue = new Map<number, { title: string; year: number; platforms: number[] }>([
    [1020, { title: 'Chrono Trigger', year: 1995, platforms: [41, 50] }],
    [427, { title: 'Final Fantasy VII', year: 1997, platforms: [50] }],
  ]);
  games: FakeGame[] = [];
  nextGameId = 100;
  failAdd: string | null = null;
  calls: string[] = [];
  addedBodies: Array<Record<string, unknown>> = [];
  discord: Array<{ content: string; allowed_mentions: unknown }> = [];
  // The download client's queue as RetroArr reports it per game; null = an older RetroArr without the endpoint
  queue: Array<{ gameId: number; release: string; progress: number; state: string; trackedState?: string; statusMessages?: string[] }> | null = [];
  // What POST /games/{id}/replace answers
  replaceAnswer: { status: number; body: Record<string, unknown> } = {
    status: 200,
    body: { blocklisted: 'Chrono Trigger (USA)', autoQueued: true, autoQueuedRelease: 'Chrono Trigger (Europe)', autoDispatchSkipped: null, error: null },
  };
  replaced: Array<{ gameId: number; reason: string }> = [];
  // The bodies of POST /discover/games, and whether IGDB is "down"
  discoverBodies: Array<Record<string, unknown>> = [];
  // RomM: client tokens to their users, and each user's play history
  rommTokens = new Map<string, string>([[ROMM_TOKEN, 'alice']]);
  rommPlays = new Map<string, Array<{ igdb_id: number | null; name: string; rom_user: Record<string, unknown> }>>();
  rommDown = false;
  igdbDown = false;
  // IGDB's similar games per game; unset = every other game in the catalogue
  similar = new Map<number, number[]>();
  // IGDB series (franchises) and their games
  franchises = new Map<number, { name: string; games: number[] }>([[5, { name: 'Final Fantasy', games: [427, 1020] }]]);
  // Titles IGDB "finds" for POST /discover/match: title → [igdbId, similarity][]
  matches = new Map<string, Array<[number, number]>>();
  // Files of Internet Archive items
  archiveItems = new Map<string, Array<{ name: string; source?: string }>>();

  fetch: typeof fetch = async (input, init) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
    const method = init?.method ?? 'GET';
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });

    if (url.href === DISCORD) {
      this.discord.push(body);
      return new Response(null, { status: 204 });
    }

    if (url.origin === ROMM) {
      if (this.rommDown) throw new TypeError('fetch failed');
      const token = new Headers(init?.headers).get('authorization')?.replace(/^Bearer /, '') ?? '';
      const user = this.rommTokens.get(token);
      if (!user) return json({ detail: 'Forbidden' }, 403);
      if (url.pathname === '/api/users/me') return json({ id: 1, username: user });
      if (url.pathname === '/api/roms') {
        this.calls.push(`ROMM ${url.search}`);
        return json({ items: this.rommPlays.get(user) ?? [], limit: 100, offset: 0, total: null });
      }
      return json({ detail: 'Not found' }, 404);
    }

    if (url.origin === 'https://archive.org') {
      const id = decodeURIComponent(url.pathname.replace('/metadata/', ''));
      const files = this.archiveItems.get(id);
      return json(files ? { files } : {});
    }

    if (url.origin === JELLYFIN) {
      if (this.jellyfinDown) throw new TypeError('fetch failed');
      if (url.pathname === '/Sessions/Logout') {
        this.jellyfinLogouts++;
        return new Response(null, { status: 204 });
      }
      const u = this.jellyfinUsers.get(String(body?.Username).toLowerCase());
      if (!u || u.password !== body?.Pw) return new Response('', { status: 401 });
      return json({
        AccessToken: 'jf-token',
        User: { Id: u.id, Name: String(body.Username), Policy: { IsAdministrator: u.admin, IsDisabled: u.disabled === true } },
      });
    }

    if (url.origin === RETROARR) {
      const headers = new Headers(init?.headers);
      if (headers.get('authorization') !== `Bearer ${TOKEN}`) return json({ error: 'nope' }, 401);
      const path = url.pathname.replace('/api/v3', '');
      this.calls.push(`${method} ${path}${url.search}`);

      if (path === '/system/status') return json({ version: '1' });
      if (path === '/platform') return json(this.platforms);
      if (path === '/game/lookup') {
        const term = url.searchParams.get('term')!.toLowerCase();
        const games = [...this.catalogue.entries()]
          .filter(([, g]) => g.title.toLowerCase().includes(term))
          .map(([igdbId, g]) => this.lookupGame(igdbId, g));
        return json({ games, status: 'ok' });
      }
      let m = path.match(/^\/game\/lookup\/igdb\/(\d+)$/);
      if (m) {
        const g = this.catalogue.get(Number(m[1]));
        return g ? json(this.lookupGame(Number(m[1]), g)) : json({}, 404);
      }
      m = path.match(/^\/game\/by-igdb\/(\d+)$/);
      if (m) {
        const pid = Number(url.searchParams.get('platformId'));
        return json(this.games.filter((g) => g.igdbId === Number(m![1]) && g.platformId === pid).map((g) => ({ ...g, status: ['TBA', 'Announced', 'Released', 'Downloading', 'Downloaded'][g.status] })));
      }
      if (path === '/game' && method === 'POST') {
        if (this.failAdd) return json({ message: this.failAdd }, 409);
        this.addedBodies.push(body);
        const game: FakeGame = { id: this.nextGameId++, title: body.title, igdbId: body.igdbId, platformId: body.platformId, status: 0, monitored: body.monitored };
        this.games.push(game);
        return json(game, 201);
      }
      m = path.match(/^\/game\/(\d+)$/);
      if (m) {
        const g = this.games.find((x) => x.id === Number(m![1]));
        return g ? json(g) : json({}, 404);
      }
      m = path.match(/^\/games\/(\d+)\/monitored$/);
      if (m) {
        const g = this.games.find((x) => x.id === Number(m![1]))!;
        g.monitored = body.monitored;
        return json({ ok: true });
      }
      if (/^\/games\/\d+\/search-now$/.test(path)) return json({ scored: [] });
      if (path.startsWith('/discover') && this.igdbDown) return json({ message: 'IGDB didn’t answer; try again in a moment.' }, 503);
      if (path === '/discover/games' && method === 'POST') {
        this.discoverBodies.push(body);
        const term = typeof body.query === 'string' ? body.query.toLowerCase() : '';
        const games = [...this.catalogue.entries()]
          .filter(([, g]) => g.platforms.some((p) => (body.platformIds as number[]).includes(p)) && (!term || g.title.toLowerCase().includes(term)))
          .slice(body.offset, body.offset + body.limit)
          .map(([igdbId, g]) => this.discoverGame(igdbId, g));
        return json({ games });
      }
      m = path.match(/^\/discover\/games\/(\d+)$/);
      if (m) {
        const g = this.catalogue.get(Number(m[1]));
        if (!g) return json({ message: 'No such game on IGDB.' }, 404);
        const others = [...this.catalogue.entries()].filter(([id]) => id !== Number(m![1]));
        return json({
          game: this.discoverGame(Number(m[1]), g),
          storyline: 'Long ago…',
          backgroundUrl: null,
          screenshots: ['https://images.igdb.test/s1.jpg'],
          videos: [{ name: 'Trailer', youtubeId: 'abcdefghijk' }, { name: 'Bad', youtubeId: 'x"><script>' }],
          themes: ['Fantasy'],
          gameModes: ['Single player'],
          developers: ['Square'],
          publishers: ['Square'],
          franchises: [],
          releases: g.platforms.map((p) => ({ platform: `Platform ${p}`, platformId: p, date: `${g.year}-03-11` })).concat([{ platform: 'Arcade', platformId: null, date: null } as never]),
          similar: [...(this.similar.get(Number(m[1])) ?? others.map(([id]) => id)).map((id) => this.discoverGame(id, this.catalogue.get(id)!)), { ...this.discoverGame(9999, { title: 'Elsewhere', year: 2001, platforms: [77] }) }],
          series: [],
          developer: 'Square',
          fromDeveloper: others.slice(0, 1).map(([id, o]) => this.discoverGame(id, o)),
        });
      }
      m = path.match(/^\/discover\/series\/(\d+)$/);
      if (m) {
        const f = this.franchises.get(Number(m[1]));
        if (!f) return json({ message: 'No such series on IGDB.' }, 404);
        return json({ id: Number(m[1]), name: f.name, games: f.games.map((id) => this.discoverGame(id, this.catalogue.get(id)!)) });
      }
      if (path === '/discover/series') {
        const q = url.searchParams.get('query')!.toLowerCase();
        return json({ series: [...this.franchises.entries()].filter(([, f]) => f.name.toLowerCase().includes(q)).map(([id, f]) => ({ id, name: f.name, gameCount: f.games.length })) });
      }
      if (path === '/discover/series-of' && method === 'POST') {
        return json({
          games: (body.igdbIds as number[]).map((igdbId) => ({
            igdbId,
            series: [...this.franchises.entries()].filter(([, f]) => f.games.includes(igdbId)).map(([id, f]) => ({ id, name: f.name })),
          })),
        });
      }
      if (path === '/discover/library' && method === 'POST') {
        return json({
          games: (body.igdbIds as number[]).map((igdbId) => ({
            igdbId,
            library: this.games.filter((x) => x.igdbId === igdbId).map((x) => ({ gameId: x.id, platformId: x.platformId, status: x.status })),
          })),
        });
      }
      if (path === '/discover/match' && method === 'POST') {
        return json({
          results: (body.titles as string[]).map((title) => ({
            title,
            candidates: (this.matches.get(title) ?? []).map(([id, similarity]) => ({ game: this.discoverGame(id, this.catalogue.get(id)!), similarity })),
          })),
        });
      }
      if (path === '/discover/options') return json({ genres: [{ id: 12, name: 'Role-playing (RPG)' }], themes: [{ id: 42, name: 'Erotic' }], gameModes: [{ id: 1, name: 'Single player' }] });
      if (path === '/discover/library/recent') {
        return json({ games: this.games.filter((g) => g.status === 4).map((g) => this.discoverGame(g.igdbId, this.catalogue.get(g.igdbId)!)) });
      }
      if (path === '/downloadclient/queue/games') {
        if (this.queue === null) return json({ error: 'unknown route' }, 404);
        const ids = url.searchParams.get('ids')!.split(',').map(Number);
        return json(this.queue.filter((d) => ids.includes(d.gameId)));
      }
      m = path.match(/^\/games\/(\d+)\/replace$/);
      if (m && method === 'POST') {
        this.replaced.push({ gameId: Number(m[1]), reason: body.reason });
        return json(this.replaceAnswer.body, this.replaceAnswer.status);
      }
      return json({ error: 'unknown route ' + path }, 404);
    }
    throw new Error('unexpected fetch ' + url.href);
  };

  private discoverGame(igdbId: number, g: { title: string; year: number; platforms: number[] }) {
    return {
      igdbId,
      title: g.title,
      year: g.year,
      coverUrl: `https://images.igdb.test/${igdbId}.jpg`,
      summary: 'A game.',
      rating: 90,
      ratingCount: 100,
      genres: ['Role-playing (RPG)'],
      platformIds: g.platforms,
      library: this.games.filter((x) => x.igdbId === igdbId).map((x) => ({ gameId: x.id, platformId: x.platformId, status: x.status })),
    };
  }

  private lookupGame(igdbId: number, g: { title: string; year: number; platforms: number[] }) {
    return {
      id: 0,
      title: g.title,
      year: g.year,
      igdbId,
      overview: 'A game.',
      images: { coverUrl: `https://images.igdb.test/${igdbId}.jpg` },
      availablePlatformIds: g.platforms,
      isOwned: this.games.some((x) => x.igdbId === igdbId),
      platform: { id: 1 },
    };
  }
}
