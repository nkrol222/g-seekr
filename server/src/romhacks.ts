import type { RetroArrClient, RomHackInfo } from './retroarr.js';
import type { GameRequest, Store } from './store.js';

// ROM hacks as the web UI shows them: RetroArr's catalogue entry, whether it can be requested here, and the user's
// view of it (requested, in the library)
export interface RomHackCard extends Omit<RomHackInfo, 'hackError' | 'baseGameId' | 'hackGameId'> {
  platformName: string | null;
  // 'available' once patched, the open request's status while one is open, null otherwise
  status: string | null;
  requestId: number | null;
  // Why patching failed (admins only)
  error?: string | null;
}

export const HACK_KINDS = ['improvement', 'difficulty', 'new-content', 'quality-of-life', 'graphics', 'story', 'translation-plus'] as const;
const CACHE_MS = 5 * 60_000;

export class RomHackCatalogue {
  private cache: { at: number; hacks: RomHackInfo[] } | null = null;

  constructor(
    private readonly retroarr: RetroArrClient,
    private readonly store: Store,
    private readonly platforms: () => Promise<Array<{ id: number; name: string }>>,
    private readonly now: () => Date = () => new Date(),
  ) {}

  // A request or a patch changes what the list shows
  forget(): void {
    this.cache = null;
  }

  async all(): Promise<RomHackInfo[]> {
    if (this.cache && this.now().getTime() - this.cache.at < CACHE_MS) return this.cache.hacks;
    const hacks = await this.retroarr.romHacks();
    this.cache = { at: this.now().getTime(), hacks };
    return hacks;
  }

  async find(id: string): Promise<RomHackInfo | null> {
    return (await this.all()).find((h) => h.id === id) ?? null;
  }

  // The hacks on platforms that can be requested here, as cards; filter by game, platform or kind
  async cards(filter: { igdbIds?: number[]; platformId?: number; kind?: string } = {}, admin = false): Promise<RomHackCard[]> {
    const platforms = new Map((await this.platforms()).map((p) => [p.id, p.name]));
    const open = new Map(this.store.openHackRequests().map((r) => [r.variant.slice('hack:'.length), r] as [string, GameRequest]));
    return (await this.all())
      .filter((h) => h.platformId !== null && platforms.has(h.platformId))
      .filter((h) => !filter.igdbIds || (h.baseIgdbId !== null && filter.igdbIds.includes(h.baseIgdbId)))
      .filter((h) => filter.platformId === undefined || h.platformId === filter.platformId)
      .filter((h) => !filter.kind || h.kind === filter.kind)
      .map((h) => {
        const request = open.get(h.id) ?? null;
        const { hackError, baseGameId: _b, hackGameId: _h, ...rest } = h;
        return {
          ...rest,
          platformName: platforms.get(h.platformId!) ?? null,
          status: h.hackStatus === 'Downloaded' ? 'available' : (request?.status ?? null),
          requestId: request?.id ?? null,
          ...(admin ? { error: hackError } : {}),
        };
      })
      .sort((a, b) => a.baseTitle.localeCompare(b.baseTitle) || a.title.localeCompare(b.title));
  }
}
