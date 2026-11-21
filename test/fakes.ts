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
  region?: string;
  variant?: string;
}

export class Fakes {
  jellyfinUsers = new Map<string, { id: string; password: string; admin: boolean; disabled?: boolean }>([
    ['alice', { id: 'jf-alice', password: 'pw', admin: false }],
    ['bob', { id: 'jf-bob', password: 'pw', admin: false }],
    ['root', { id: 'jf-root', password: 'pw', admin: true }],
  ]);
  jellyfinDown = false;
  jellyfinLogouts = 0;

  platforms: Array<{ id: number; name: string; slug: string; category: string; enabled: boolean; hasAddOns?: boolean }> = [
    { id: 41, name: 'Super Nintendo', slug: 'snes', category: 'Nintendo', enabled: true },
    { id: 50, name: 'PlayStation', slug: 'psx', category: 'Sony', enabled: true },
    { id: 60, name: 'Disabled', slug: 'off', category: 'X', enabled: false },
  ];
  catalogue = new Map<number, { title: string; year: number; platforms: number[] }>([
    [1020, { title: 'Chrono Trigger', year: 1995, platforms: [41, 50] }],
    [427, { title: 'Final Fantasy VII', year: 1997, platforms: [50] }],
  ]);
  // RetroArr's ROM hack catalogue (GET /romhacks), and the hacks requested
  romHacks: Array<Record<string, unknown>> = [];
  romHacksDown = false;
  // A console with updates and DLC, and a game on it, for the tests of those
  addSwitch() {
    this.platforms.push({ id: 70, name: 'Nintendo Switch', slug: 'switch', category: 'Nintendo', enabled: true, hasAddOns: true });
    this.catalogue.set(7346, { title: 'Breath of the Wild', year: 2017, platforms: [70] });
  }
  // RetroArr's updates and DLC per game: what is wanted (from PUT /games/{id}/addons) and what the library has
  addOns = new Map<number, { wantLatestUpdate: boolean; wantAllDlc: boolean; dlc: Array<{ igdbId: number | null; title: string }>; updateVersion: string | null; ownedDlc: Set<number>; hasDlcPack: boolean }>();
  // What the request API was asked to add of each game's updates and DLC, and whether it searched for them at once
  addOnWants: Array<{ gameId: number; addOns: Record<string, unknown>; search: boolean }> = [];
  games: FakeGame[] = [];
  nextGameId = 100;
  // POST /requests/fulfil: what it was sent, a refusal to answer with, the games it started a search for
  fulfilBodies: Array<Record<string, unknown>> = [];
  failFulfil: string | null = null;
  searched: number[] = [];
  statesDown = false;
  // RetroArr can't reach IGDB: check and fulfil answer 502
  metadataDown = false;
  statesCalls = 0;
  requestApiVersion = 1;
  calls: string[] = [];
  // The games the request API added (what a new entry was made of)
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
  // RetroArr's search log per game, and when it searches next
  hunts = new Map<number, { lastSearch: Record<string, unknown> | null; nextSearchAt: string | null }>();
  monitoring = true;
  // RetroArr's RomM sync: the RomM id of each RetroArr game RomM has
  rommIds = new Map<number, number>();
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
      if (url.pathname === '/api/heartbeat') return json({ SYSTEM: { VERSION: '5.4.1' } });
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
      if (url.pathname === '/System/Info/Public') return json({ ServerName: 'apollo', Version: '10.11.0' });
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

      if (path === '/platform') return json(this.platforms);
      if (path === '/game/lookup') {
        const term = url.searchParams.get('term')!.toLowerCase();
        const games = [...this.catalogue.entries()]
          .filter(([, g]) => g.title.toLowerCase().includes(term))
          .map(([igdbId, g]) => this.lookupGame(igdbId, g));
        return json({ games, status: 'ok' });
      }
      // The request API, as RetroArr's RequestApiService does it
      if (path === '/requests/info') return json({ apiVersion: this.requestApiVersion, appVersion: '1.0.0-fake', features: ['check', 'fulfil:game', 'fulfil:addons', 'fulfil:hack', 'states'] });
      if (path.startsWith('/requests/') && path !== '/requests/states' && this.metadataDown) return json({ code: 'metadata_unavailable', message: 'IGDB couldn’t be asked about the game right now.' }, 502);
      if (path === '/requests/check' && method === 'POST') {
        const g = this.catalogue.get(body.igdbId);
        if (!g) return json({ code: 'unknown_game', message: `IGDB has no game ${body.igdbId}.` }, 404);
        const entries = this.entriesOf(body.igdbId, body.platformId);
        const match = this.pick(entries, body);
        return json({
          game: { igdbId: body.igdbId, title: g.title, year: g.year, coverUrl: null, platformIds: g.platforms },
          entries: entries.map((e) => this.entry(e)),
          match: match ? this.entry(match) : null,
          owned: match?.status === 4,
        });
      }
      if (path === '/requests/fulfil' && method === 'POST') {
        this.fulfilBodies.push(body);
        if (this.failFulfil) return json({ code: 'duplicate', message: this.failFulfil }, 409);
        if (body.kind === 'hack') {
          const h = this.romHacks.find((x) => x.id === body.hackId);
          if (!h) return json({ code: 'unknown_hack', message: 'no such hack' }, 404);
          let hack = this.games.find((g) => g.variant === `hack:${h.id}`);
          if (!hack) {
            hack = { id: this.nextGameId++, title: String(h.title), igdbId: Number(h.baseIgdbId), platformId: Number(h.platformId), status: 0, monitored: false, variant: `hack:${h.id}` };
            this.games.push(hack);
            h.hackGameId = hack.id;
            h.hackStatus = 'Missing';
          }
          const base = this.games.find((g) => g.igdbId === h.baseIgdbId && g.platformId === h.platformId && !g.variant);
          if (!base) this.searched.push(hack.id);
          return json({ gameId: hack.id, state: 'wanted', added: false, baseGameId: base?.id ?? null, baseState: base ? this.stateOf(base) : 'wanted' });
        }
        const g = this.catalogue.get(body.igdbId);
        if (!g) return json({ code: 'unknown_game', message: `IGDB has no game ${body.igdbId}.` }, 404);
        let game = this.pick(this.entriesOf(body.igdbId, body.platformId), body);
        if (body.kind === 'addons') {
          if (!game || game.status !== 4) return json({ code: 'not_in_library', message: 'The game isn’t in the library in that version.' }, 409);
          this.wantAddOns(game.id, body.addOns, true);
          return json({ gameId: game.id, state: 'available', added: false, baseGameId: null, baseState: null });
        }
        let added = false;
        if (!game) {
          const fresh = { title: g.title, igdbId: body.igdbId, platformId: body.platformId, monitored: true, region: body.region ?? '', variant: body.variant ?? '', preferLatestRevision: body.latestRevision === true };
          this.addedBodies.push(fresh);
          game = { id: this.nextGameId++, ...fresh, status: 0 };
          this.games.push(game);
          added = true;
        }
        if (game.status !== 4) game.monitored = true;
        if (body.addOns) this.wantAddOns(game.id, body.addOns, game.status === 4);
        const state = this.stateOf(game);
        if (state === 'wanted') this.searched.push(game.id);
        return json({ gameId: game.id, state, added, baseGameId: null, baseState: null });
      }
      if (path === '/requests/states' && method === 'POST') {
        if (this.statesDown) return json({ message: 'boom' }, 500);
        const ids = body.gameIds as number[];
        if (ids.length > 500) return json({ code: 'too_many', message: 'gameIds: at most 500' }, 400);
        this.statesCalls++;
        return json({
          games: [...new Set(ids)].map((id) => {
            const g = this.games.find((x) => x.id === id);
            return g ? this.entry(g) : { gameId: id, state: 'removed', region: '', variant: '' };
          }),
        });
      }
      if (path === '/romhacks') return this.romHacksDown ? json({ message: 'boom' }, 500) : json(this.romHacks);
      let m: RegExpMatchArray | null;
      m = path.match(/^\/games\/(\d+)\/addons$/);
      if (m) {
        const id = Number(m[1]);
        const a = this.addOns.get(id) ?? { wantLatestUpdate: false, wantAllDlc: false, dlc: [], updateVersion: null, ownedDlc: new Set<number>(), hasDlcPack: false };
        if (method !== 'GET') return json({ message: 'admin only' }, 403);
        const g = this.games.find((x) => x.id === id);
        return json({
          supported: true,
          inLibrary: g?.status === 4,
          wantLatestUpdate: a.wantLatestUpdate,
          wantAllDlc: a.wantAllDlc,
          updateVersion: a.updateVersion,
          hasDlcPack: a.hasDlcPack,
          dlc: a.dlc.map((d) => ({ ...d, owned: d.igdbId !== null && a.ownedDlc.has(d.igdbId) })),
        });
      }
      if (path === '/games/search-status') {
        const ids = url.searchParams.get('ids')!.split(',').map(Number);
        return json({
          monitoring: this.monitoring,
          rssEveryMinutes: 15,
          searchEveryHours: 6,
          games: this.games
            .filter((g) => ids.includes(g.id))
            .map((g) => ({ gameId: g.id, status: g.status, monitored: g.monitored, ...(this.hunts.get(g.id) ?? { lastSearch: null, nextSearchAt: null }) })),
        });
      }
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
            library: this.games.filter((x) => x.igdbId === igdbId).map((x) => ({ gameId: x.id, platformId: x.platformId, status: x.status, rommId: this.rommIds.get(x.id) ?? null, region: x.region ?? '', variant: x.variant ?? '' })),
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
      if (path === '/discover/library/owned') {
        return json({ igdbIds: [...new Set(this.games.filter((g) => g.status === 4).map((g) => g.igdbId))] });
      }
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
      library: this.games.filter((x) => x.igdbId === igdbId).map((x) => ({ gameId: x.id, platformId: x.platformId, status: x.status, rommId: this.rommIds.get(x.id) ?? null, region: x.region ?? '', variant: x.variant ?? '' })),
    };
  }

  // RetroArr's entries of a game on a platform, ROM hacks left out
  private entriesOf(igdbId: number, platformId: number): FakeGame[] {
    return this.games.filter((g) => g.igdbId === igdbId && g.platformId === platformId && !(g.variant ?? '').startsWith('hack:'));
  }

  // The entry that is the version asked for, one in the library first (RetroArr's RequestVersion.Matches)
  private pick(entries: FakeGame[], v: { region?: string; variant?: string }): FakeGame | undefined {
    const region = (v.region ?? '').toLowerCase();
    const matches = entries.filter((e) => {
      if ((e.variant ?? '') !== (v.variant ?? '')) return false;
      if (!region) return true;
      return (e.region ?? '').split(',').map((r) => r.trim().toLowerCase()).some((r) => r === region || (region === 'usa' && (r === 'us' || r === 'north america')));
    });
    return matches.sort((a, b) => Number(b.status === 4) - Number(a.status === 4) || a.id - b.id)[0];
  }

  private stateOf(g: FakeGame): string {
    if (g.status === 4) return 'available';
    if (g.status === 3) return 'downloading';
    return g.monitored || (g.variant ?? '').startsWith('hack:') ? 'wanted' : 'unmonitored';
  }

  private entry(g: FakeGame) {
    return { gameId: g.id, state: this.stateOf(g), region: g.region ?? '', variant: g.variant ?? '' };
  }

  private wantAddOns(gameId: number, w: { latestUpdate?: boolean; allDlc?: boolean; dlc?: Array<{ igdbId: number | null; title: string }> }, search: boolean) {
    this.addOnWants.push({ gameId, addOns: w, search });
    const a = this.addOns.get(gameId) ?? { wantLatestUpdate: false, wantAllDlc: false, dlc: [], updateVersion: null, ownedDlc: new Set<number>(), hasDlcPack: false };
    if (w.latestUpdate) a.wantLatestUpdate = true;
    if (w.allDlc) a.wantAllDlc = true;
    for (const d of w.dlc ?? []) if (!a.dlc.some((x) => (d.igdbId !== null ? x.igdbId === d.igdbId : x.title === d.title))) a.dlc.push(d);
    this.addOns.set(gameId, a);
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
