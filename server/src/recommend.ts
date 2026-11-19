import type { Config } from './config.js';
import type { DiscoverCard, DiscoverService, Filters } from './discover.js';
import type { Logger } from './requests.js';
import { RommError, type RommClient, type RommPlay } from './romm.js';
import type { RomHackCard, RomHackCatalogue } from './romhacks.js';
import type { Store, User } from './store.js';

// Why a game is recommended: a game the user requested, played (in RomM) or liked
export type SeedKind = 'requested' | 'played' | 'liked';
export interface Reason {
  kind: SeedKind;
  igdbId: number;
  title: string;
}

export interface Recommended extends DiscoverCard {
  reasons: Reason[];
}

export interface Recommendations {
  games: Recommended[];
  // "Because you played Chrono Trigger": the strongest seeds, each with its own similar games
  because: { seed: Reason; games: Recommended[] }[];
  romm: { available: boolean; linked: boolean; error: string | null };
  // The seeds used, so the page can say what recommendations are based on
  basedOn: number;
  // ROM hacks of games the user played or liked, not yet in the library
  hacks: (RomHackCard & { reasons: Reason[] })[];
}

interface Seed extends Reason {
  weight: number;
  at: string;
}

const MAX_SEEDS = 8;
const PLAYS_FOR = 60 * 60_000;
const RESULT_FOR = 30 * 60_000;
// A RomM rating this low says the user didn't like it: not a seed, and its similar games count less
const DISLIKED_RATING = 3;

// Recommendations from what each user requested, played in RomM and liked: IGDB's similar games for each, scored by
// how many of the user's games lead to them and how much those games count. Played and liked games count more than
// requests; a game rated 8 or more in RomM counts most. Games the user marked "not interested" never show, and the
// user's saved filters apply (platforms, years, rating, rating count, genres, adult games).
export class RecommendService {
  private readonly plays = new Map<number, { at: number; plays: RommPlay[] }>();
  private readonly results = new Map<number, { at: number; value: Recommendations }>();

  constructor(
    private readonly config: Config,
    private readonly store: Store,
    private readonly discover: DiscoverService,
    private readonly romm: RommClient | null,
    private readonly log: Logger,
    private readonly now: () => Date = () => new Date(),
    private readonly romHacks: RomHackCatalogue | null = null,
  ) {}

  // A like, a dismissal, a request or a RomM link changes what to recommend
  forget(userId: number): void {
    this.results.delete(userId);
  }

  async forUser(user: User): Promise<Recommendations> {
    const cached = this.results.get(user.id);
    if (cached && this.now().getTime() - cached.at < RESULT_FOR) return cached.value;
    const value = await this.compute(user);
    this.results.set(user.id, { at: this.now().getTime(), value });
    return value;
  }

  private async compute(user: User): Promise<Recommendations> {
    const filters = this.discover.filtersFor(user);
    const { seeds, disliked, romm } = await this.seeds(user);
    const dismissed = this.store.dismissed(user.id);
    const seedIds = new Set(seeds.map((s) => s.igdbId));
    const genreNames = await this.genreNames(filters);

    const scored = new Map<number, { card: DiscoverCard; score: number; reasons: Reason[] }>();
    const because: { seed: Reason; games: Recommended[] }[] = [];
    const keep = (card: DiscoverCard) => !seedIds.has(card.igdbId) && !dismissed.has(card.igdbId) && !disliked.has(card.igdbId) && matches(card, filters, genreNames);

    // A few at a time: each is a RetroArr call, and a few IGDB queries the first time
    const pages = await mapLimit(seeds.slice(0, MAX_SEEDS), 3, async (seed) => {
      try {
        return { seed, page: await this.discover.game(seed.igdbId, filters.includeAdult) };
      } catch (err) {
        this.log.warn(`recommendations: ${seed.title} (${seed.igdbId}): ${(err as Error).message}`);
        return { seed, page: null };
      }
    });

    for (const { seed, page } of pages) {
      if (!page) continue;
      const reason: Reason = { kind: seed.kind, igdbId: seed.igdbId, title: page.game.title || seed.title };
      // IGDB lists similar games best match first; the series counts a little less
      const candidates = [
        ...page.similar.map((card, i) => ({ card, weight: 1 - i / 30 })),
        ...page.series.map((card, i) => ({ card, weight: 0.6 - i / 60 })),
      ];
      const own: Recommended[] = [];
      for (const { card, weight } of candidates) {
        if (!keep(card)) continue;
        const entry = scored.get(card.igdbId) ?? { card, score: 0, reasons: [] };
        entry.score += seed.weight * Math.max(0.1, weight);
        if (!entry.reasons.some((r) => r.igdbId === reason.igdbId)) entry.reasons.push(reason);
        scored.set(card.igdbId, entry);
        if (!own.some((o) => o.igdbId === card.igdbId)) own.push({ ...card, reasons: [reason] });
      }
      if (own.length >= 4 && because.length < 3) because.push({ seed: reason, games: own.slice(0, 20) });
    }

    const games = [...scored.values()]
      // Recommended by several of the user's games first, then IGDB's own rating breaks ties
      .sort((a, b) => b.score - a.score || (b.card.rating ?? 0) - (a.card.rating ?? 0))
      .slice(0, 120)
      .map((e) => ({ ...e.card, reasons: e.reasons.slice(0, 3) }));
    return { games, because, romm, basedOn: Math.min(seeds.length, MAX_SEEDS), hacks: await this.hacksFor(seeds) };
  }

  // Hacks of the games the user played or liked (a request alone says less about liking a game)
  private async hacksFor(seeds: Seed[]): Promise<Recommendations['hacks']> {
    if (!this.romHacks) return [];
    const strong = seeds.filter((s) => s.kind !== 'requested');
    if (strong.length === 0) return [];
    try {
      const cards = await this.romHacks.cards({ igdbIds: strong.map((s) => s.igdbId) });
      const rank = new Map(strong.map((s, i) => [s.igdbId, i]));
      return cards
        .filter((c) => c.status !== 'available')
        .map((c) => {
          const seed = strong.find((s) => s.igdbId === c.baseIgdbId)!;
          return { ...c, reasons: [{ kind: seed.kind, igdbId: seed.igdbId, title: seed.title }] };
        })
        .sort((a, b) => rank.get(a.baseIgdbId!)! - rank.get(b.baseIgdbId!)!)
        .slice(0, 20);
    } catch (err) {
      this.log.warn(`recommendations: ROM hacks: ${(err as Error).message}`);
      return [];
    }
  }

  // The user's games that recommendations grow from, strongest first
  private async seeds(user: User): Promise<{ seeds: Seed[]; disliked: Set<number>; romm: Recommendations['romm'] }> {
    const byId = new Map<number, Seed>();
    const add = (s: Seed) => {
      const existing = byId.get(s.igdbId);
      if (!existing || existing.weight < s.weight) byId.set(s.igdbId, existing ? { ...s, weight: Math.max(s.weight, existing.weight) + 0.5 } : s);
    };
    for (const like of this.store.likes(user.id)) add({ kind: 'liked', igdbId: like.igdbId, title: like.title, weight: 3, at: like.createdAt });
    for (const r of this.store.listRequests({ userId: user.id })) {
      if (r.status === 'declined') continue;
      add({ kind: 'requested', igdbId: r.igdbId, title: r.title, weight: r.status === 'available' ? 1.5 : 1, at: r.createdAt });
    }

    const disliked = new Set<number>();
    const romm = { available: this.romm !== null, linked: false, error: null as string | null };
    const link = this.romm ? this.store.rommLink(user.id) : null;
    if (link && this.romm) {
      romm.linked = true;
      try {
        for (const play of await this.playsOf(user.id, link.token)) {
          if (play.rating > 0 && play.rating <= DISLIKED_RATING) {
            disliked.add(play.igdbId);
            continue;
          }
          add({
            kind: 'played',
            igdbId: play.igdbId,
            title: play.name,
            weight: play.rating >= 8 ? 3 : play.nowPlaying ? 2.5 : 2,
            at: play.lastPlayed ?? '',
          });
        }
        if (link.lastError) this.store.setRommError(user.id, null);
      } catch (err) {
        romm.error = err instanceof RommError ? err.message : `RomM: ${(err as Error).message}`;
        this.store.setRommError(user.id, romm.error);
      }
    }
    for (const id of disliked) byId.delete(id);
    const seeds = [...byId.values()].sort((a, b) => b.weight - a.weight || b.at.localeCompare(a.at));
    return { seeds, disliked, romm };
  }

  private async playsOf(userId: number, token: string): Promise<RommPlay[]> {
    const cached = this.plays.get(userId);
    if (cached && this.now().getTime() - cached.at < PLAYS_FOR) return cached.plays;
    const plays = await this.romm!.plays(token);
    this.plays.set(userId, { at: this.now().getTime(), plays });
    return plays;
  }

  forgetPlays(userId: number): void {
    this.plays.delete(userId);
    this.forget(userId);
  }

  // Cards carry genre names, the filters genre ids
  private async genreNames(filters: Filters): Promise<Set<string> | null> {
    if (filters.genreIds.length === 0) return null;
    try {
      const { genres } = await this.discover.options();
      return new Set(genres.filter((g) => filters.genreIds.includes(g.id)).map((g) => g.name));
    } catch {
      return null;
    }
  }

  // The RomM link: checks the token is this user's own RomM account (usernames match between Jellyfin and RomM)
  async link(user: User, token: string): Promise<{ rommUsername: string }> {
    if (!this.romm) throw new RommError('Linking RomM isn’t set up on this server (ROMM_API_URL).', 400);
    const trimmed = token.trim();
    if (!/^rmm_[0-9a-f]{64}$/i.test(trimmed)) throw new RommError('That isn’t a RomM client token: it starts with rmm_ followed by 64 characters.', 400);
    const { username } = await this.romm.me(trimmed);
    if (username.toLowerCase() !== user.username.toLowerCase()) {
      throw new RommError(`That token belongs to RomM user “${username}”, not you (${user.username}).`, 400);
    }
    // The history must be readable too, or the link is no use
    await this.romm.plays(trimmed, 1);
    this.store.setRommLink(user.id, trimmed, username);
    this.forgetPlays(user.id);
    return { rommUsername: username };
  }

  unlink(user: User): void {
    this.store.deleteRommLink(user.id);
    this.forgetPlays(user.id);
  }

  rommStatus(user: User) {
    const link = this.store.rommLink(user.id);
    return {
      available: this.romm !== null,
      linked: link !== null,
      rommUsername: link?.rommUsername ?? null,
      linkedAt: link?.linkedAt ?? null,
      error: link?.lastError ?? null,
      rommUrl: this.config.rommUrl,
    };
  }
}

// The user's filters on a card that has no theme or mode data (those filters only narrow Browse and search)
function matches(card: DiscoverCard, f: Filters, genres: Set<string> | null): boolean {
  if (card.platformIds.length === 0) return false;
  if (f.platformIds.length > 0 && !card.platformIds.some((p) => f.platformIds.includes(p))) return false;
  if (f.yearFrom !== null && (card.year === null || card.year < f.yearFrom)) return false;
  if (f.yearTo !== null && (card.year === null || card.year > f.yearTo)) return false;
  if (f.minRating !== null && (card.rating ?? 0) < f.minRating) return false;
  if (f.minRatingCount !== null && (card.ratingCount ?? 0) < f.minRatingCount) return false;
  if (genres && !card.genres.some((g) => genres.has(g))) return false;
  return true;
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]!);
    }
  });
  await Promise.all(workers);
  return out;
}

