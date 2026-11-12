// The RetroArr endpoints a token with the "requests" scope may call.

export interface RetroArrPlatform {
  id: number;
  name: string;
  slug: string;
  category: string | null;
  enabled: boolean;
}

export interface RetroArrLookupGame {
  igdbId: number | null;
  title: string;
  year: number;
  overview: string | null;
  coverUrl: string | null;
  platformIds: number[];
  owned: boolean;
  // The full metadata object, sent back as is when the game is added
  raw: Record<string, unknown>;
}

export type RetroArrGameStatus = 'TBA' | 'Announced' | 'Released' | 'Downloading' | 'Downloaded' | 'Missing' | 'InstallerDetected' | 'Unknown';

export interface RetroArrGame {
  id: number;
  title: string;
  status: RetroArrGameStatus;
  monitored: boolean;
}

export class RetroArrError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

const STATUSES: RetroArrGameStatus[] = ['TBA', 'Announced', 'Released', 'Downloading', 'Downloaded', 'Missing', 'InstallerDetected'];

// RetroArr sends the enum as a number on some endpoints and as a name on others
export function gameStatus(value: unknown): RetroArrGameStatus {
  if (typeof value === 'number') return STATUSES[value] ?? 'Unknown';
  if (typeof value === 'string') return STATUSES.find((s) => s.toLowerCase() === value.toLowerCase()) ?? 'Unknown';
  return 'Unknown';
}

function toLookupGame(g: Record<string, unknown>): RetroArrLookupGame {
  const images = (g.images ?? {}) as Record<string, unknown>;
  return {
    igdbId: typeof g.igdbId === 'number' ? g.igdbId : null,
    title: String(g.title ?? ''),
    year: typeof g.year === 'number' ? g.year : 0,
    overview: typeof g.overview === 'string' ? g.overview : null,
    coverUrl: typeof images.coverUrl === 'string' ? images.coverUrl : null,
    platformIds: Array.isArray(g.availablePlatformIds) ? g.availablePlatformIds.filter((n): n is number => typeof n === 'number') : [],
    owned: g.isOwned === true,
    raw: g,
  };
}

function toGame(g: Record<string, unknown>): RetroArrGame {
  return { id: Number(g.id), title: String(g.title ?? ''), status: gameStatus(g.status), monitored: g.monitored === true };
}

export class RetroArrClient {
  constructor(
    private readonly baseUrl: string,
    private readonly token: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  private async call<T>(method: string, path: string, body?: unknown, timeoutMs = 30_000): Promise<T> {
    let res: Response;
    try {
      res = await this.fetchImpl(`${this.baseUrl}/api/v3${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${this.token}`,
          Accept: 'application/json',
          ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (err) {
      throw new RetroArrError(`RetroArr is not reachable: ${(err as Error).message}`, 0);
    }
    if (!res.ok) {
      let message = `RetroArr answered ${res.status}`;
      try {
        const err = (await res.json()) as { message?: string; error?: string };
        message += `: ${err.message ?? err.error ?? ''}`.trimEnd();
      } catch {
        /* no JSON body */
      }
      throw new RetroArrError(message, res.status);
    }
    if (res.status === 204) return undefined as T;
    const text = await res.text();
    return (text ? JSON.parse(text) : undefined) as T;
  }

  async status(): Promise<{ version?: string }> {
    return this.call('GET', '/system/status');
  }

  async platforms(): Promise<RetroArrPlatform[]> {
    const list = await this.call<Array<Record<string, unknown>>>('GET', '/platform?enabledOnly=true');
    return list.map((p) => ({
      id: Number(p.id),
      name: String(p.name ?? ''),
      slug: String(p.slug ?? '').toLowerCase(),
      category: typeof p.category === 'string' ? p.category : null,
      enabled: p.enabled !== false,
    }));
  }

  async lookup(term: string): Promise<RetroArrLookupGame[]> {
    const res = await this.call<{ games?: Array<Record<string, unknown>> }>('GET', `/game/lookup?term=${encodeURIComponent(term)}`);
    return (res.games ?? []).map(toLookupGame);
  }

  async lookupIgdb(igdbId: number): Promise<RetroArrLookupGame | null> {
    try {
      return toLookupGame(await this.call<Record<string, unknown>>('GET', `/game/lookup/igdb/${igdbId}`));
    } catch (err) {
      if (err instanceof RetroArrError && err.status === 404) return null;
      throw err;
    }
  }

  async findByIgdb(igdbId: number, platformId: number): Promise<RetroArrGame[]> {
    const list = await this.call<Array<Record<string, unknown>>>('GET', `/game/by-igdb/${igdbId}?platformId=${platformId}`);
    return list.map(toGame);
  }

  async getGame(id: number): Promise<RetroArrGame | null> {
    try {
      return toGame(await this.call<Record<string, unknown>>('GET', `/game/${id}`));
    } catch (err) {
      if (err instanceof RetroArrError && err.status === 404) return null;
      throw err;
    }
  }

  async addGame(game: Record<string, unknown>): Promise<RetroArrGame> {
    return toGame(await this.call<Record<string, unknown>>('POST', '/game', game));
  }

  async setMonitored(id: number, monitored: boolean): Promise<void> {
    await this.call('PUT', `/games/${id}/monitored`, { monitored });
  }

  // Searches the indexers and grabs a release that scores high enough. Can take a while.
  async searchNow(id: number): Promise<void> {
    await this.call('POST', `/games/${id}/search-now?autoDispatch=true`, undefined, 180_000);
  }
}
