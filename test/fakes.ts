// In-memory stand-ins for Jellyfin, RetroArr and a Discord webhook, served through one fetch stub.

export const JELLYFIN = 'http://jellyfin.test';
export const RETROARR = 'http://retroarr.test';
export const DISCORD = 'http://discord.test/webhook';
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

  fetch: typeof fetch = async (input, init) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
    const method = init?.method ?? 'GET';
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });

    if (url.href === DISCORD) {
      this.discord.push(body);
      return new Response(null, { status: 204 });
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
      return json({ error: 'unknown route ' + path }, 404);
    }
    throw new Error('unexpected fetch ' + url.href);
  };

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
