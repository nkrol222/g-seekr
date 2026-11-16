// RomM's API, called with a user's own client token (RomM → Settings → Client API Tokens, scopes me.read and
// roms.read): RomM answers play history (rom_user) only for the account that calls.

export interface RommPlay {
  igdbId: number;
  name: string;
  lastPlayed: string | null;
  nowPlaying: boolean;
  // The user's rating in RomM, 1-10; 0 = not rated
  rating: number;
}

export class RommError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

export class RommClient {
  constructor(
    private readonly baseUrl: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  private async call<T>(token: string, path: string): Promise<T> {
    let res: Response;
    try {
      res = await this.fetchImpl(`${this.baseUrl}/api${path}`, {
        headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
        signal: AbortSignal.timeout(20_000),
      });
    } catch (err) {
      throw new RommError(`RomM is not reachable: ${(err as Error).message}`, 0);
    }
    if (res.status === 401 || res.status === 403) throw new RommError('RomM refused the token: it was revoked, expired, or lacks the me.read and roms.read scopes.', res.status);
    if (!res.ok) throw new RommError(`RomM answered ${res.status}`, res.status);
    return (await res.json()) as T;
  }

  async me(token: string): Promise<{ username: string }> {
    const me = await this.call<Record<string, unknown>>(token, '/users/me');
    return { username: String(me.username ?? '') };
  }

  // The games this user played or rated, most recently played first
  async plays(token: string, limit = 100): Promise<RommPlay[]> {
    const query = new URLSearchParams({
      order_by: 'last_played',
      order_dir: 'desc',
      limit: String(limit),
      offset: '0',
      with_char_index: 'false',
      with_filter_values: 'false',
      with_rom_id_index: 'false',
      with_total: 'false',
    });
    const page = await this.call<{ items?: Array<Record<string, unknown>> } | Array<Record<string, unknown>>>(token, `/roms?${query}`);
    const items = Array.isArray(page) ? page : (page.items ?? []);
    const plays: RommPlay[] = [];
    for (const rom of items) {
      const igdbId = typeof rom.igdb_id === 'number' ? rom.igdb_id : null;
      const user = (rom.rom_user ?? {}) as Record<string, unknown>;
      const lastPlayed = typeof user.last_played === 'string' ? user.last_played : null;
      const nowPlaying = user.now_playing === true;
      const rating = typeof user.rating === 'number' ? user.rating : 0;
      if (igdbId === null || (!lastPlayed && !nowPlaying && rating === 0)) continue;
      if (plays.some((p) => p.igdbId === igdbId)) continue;
      plays.push({ igdbId, name: String(rom.name ?? ''), lastPlayed, nowPlaying, rating });
    }
    return plays;
  }
}
