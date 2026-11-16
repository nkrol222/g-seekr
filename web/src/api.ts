export type RequestStatus = 'pending' | 'approved' | 'searching' | 'downloading' | 'available' | 'declined' | 'failed';

export interface Me {
  user: { id: number; username: string; isAdmin: boolean; autoApprove: boolean };
  limits: { limit: number; days: number; used: number };
  rommUrl: string | null;
}

export interface Platform {
  id: number;
  name: string;
  slug: string;
  category: string | null;
}

export interface SearchResult {
  igdbId: number;
  title: string;
  year: number | null;
  overview: string | null;
  coverUrl: string | null;
  owned: boolean;
  platformIds: number[];
  requests: { id: number; platformId: number; status: RequestStatus }[];
}

// A game in Discover, Browse and search: the platforms it can be requested for, whether the library has it, its requests
export interface GameCard extends SearchResult {
  rating: number | null;
  ratingCount: number | null;
  genres: string[];
}

export interface Filters {
  platformIds: number[];
  genreIds: number[];
  themeIds: number[];
  gameModeIds: number[];
  yearFrom: number | null;
  yearTo: number | null;
  minRating: number | null;
  minRatingCount: number | null;
  includeAdult: boolean;
}

export const DEFAULT_FILTERS: Filters = {
  platformIds: [],
  genreIds: [],
  themeIds: [],
  gameModeIds: [],
  yearFrom: null,
  yearTo: null,
  minRating: null,
  minRatingCount: null,
  includeAdult: false,
};

export interface FilterOption {
  id: number;
  name: string;
}

export interface FilterOptions {
  genres: FilterOption[];
  themes: FilterOption[];
  gameModes: FilterOption[];
}

export type ListKind = 'popular' | 'top' | 'browse';
export type SortKind = 'popular' | 'rating' | 'newest' | 'name';

export interface GamePage {
  game: GameCard;
  storyline: string | null;
  backgroundUrl: string | null;
  screenshots: string[];
  videos: { name: string; youtubeId: string }[];
  themes: string[];
  gameModes: string[];
  developers: string[];
  publishers: string[];
  franchises: string[];
  releases: { platform: string; platformId: number | null; date: string | null; requestable: boolean }[];
  similar: GameCard[];
  series: GameCard[];
  developer: string | null;
  fromDeveloper: GameCard[];
  // What the user said about it
  mine: { liked: boolean; dismissed: boolean };
}

export type SeedKind = 'requested' | 'played' | 'liked';
export interface Reason {
  kind: SeedKind;
  igdbId: number;
  title: string;
}

export interface Recommended extends GameCard {
  reasons: Reason[];
}

export interface RommLink {
  available: boolean;
  linked: boolean;
  error: string | null;
}

export interface Recommendations {
  games: Recommended[];
  because: { seed: Reason; games: Recommended[] }[];
  romm: RommLink;
  basedOn: number;
}

export interface RommStatus extends RommLink {
  rommUsername: string | null;
  linkedAt: string | null;
  rommUrl: string | null;
}

export const REASON_VERB: Record<SeedKind, string> = { requested: 'requested', played: 'played', liked: 'liked' };

export interface GameRequest {
  id: number;
  userId: number;
  username: string;
  igdbId: number;
  platformId: number;
  platformName: string;
  title: string;
  year: number | null;
  coverUrl: string | null;
  status: RequestStatus;
  // The game in RetroArr, once handed off; download progress is looked up by it
  retroarrGameId: number | null;
  // What RetroArr grabbed for it
  release: string | null;
  note: string | null;
  error: string | null;
  createdAt: string;
  updatedAt: string;
  availableAt: string | null;
}

// What the download client is doing for a game RetroArr is fetching
export interface Progress {
  gameId: number;
  release: string;
  progress: number;
  state: string;
  trackedState: string | null;
  statusMessages: string[];
}

export type IssueKind = 'wont_launch' | 'wrong_game' | 'wrong_region' | 'missing_files' | 'other';
export type IssueStatus = 'open' | 'replacing' | 'resolved';

export interface Issue {
  id: number;
  requestId: number;
  userId: number;
  username: string;
  kind: IssueKind;
  message: string | null;
  status: IssueStatus;
  resolution: string | null;
  replacementRelease: string | null;
  resolvedAt: string | null;
  createdAt: string;
  updatedAt: string;
  title: string;
  year: number | null;
  platformName: string;
  coverUrl: string | null;
  retroarrGameId: number | null;
  release: string | null;
}

export const ISSUE_KIND_LABEL: Record<IssueKind, string> = {
  wont_launch: 'Won’t launch',
  wrong_game: 'Wrong game',
  wrong_region: 'Wrong region or language',
  missing_files: 'Missing files or discs',
  other: 'Something else',
};

export const ISSUE_STATUS_LABEL: Record<IssueStatus, string> = {
  open: 'Open',
  replacing: 'Being replaced',
  resolved: 'Resolved',
};

export interface AdminUser {
  id: number;
  username: string;
  isAdmin: boolean;
  jellyfinAdmin: boolean;
  effectiveAdmin: boolean;
  autoApprove: boolean;
  requestLimit: number | null;
  lastLoginAt: string | null;
  limits: { limit: number; days: number; used: number };
}

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method,
    credentials: 'same-origin',
    headers: {
      ...(method !== 'GET' ? { 'x-gseekr': '1' } : {}),
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (res.status === 204) return undefined as T;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError((data as { error?: string }).error ?? `Request failed (${res.status})`, res.status);
  return data as T;
}

export const api = {
  me: () => call<Me>('GET', '/me'),
  login: (username: string, password: string) => call<Me>('POST', '/auth/login', { username, password }),
  logout: () => call<void>('POST', '/auth/logout', {}),
  platforms: () => call<Platform[]>('GET', '/platforms'),
  search: (q: string) => call<{ results: SearchResult[] }>('GET', `/search?q=${encodeURIComponent(q)}`),
  requests: (scope: 'mine' | 'all') => call<{ requests: GameRequest[] }>('GET', `/requests?scope=${scope}`),
  request: (igdbId: number, platformId: number) => call<{ request: GameRequest }>('POST', '/requests', { igdbId, platformId }),
  approve: (id: number, note?: string) => call<{ request: GameRequest }>('POST', `/requests/${id}/approve`, { note }),
  decline: (id: number, note?: string) => call<{ request: GameRequest }>('POST', `/requests/${id}/decline`, { note }),
  retry: (id: number) => call<{ request: GameRequest }>('POST', `/requests/${id}/retry`, {}),
  remove: (id: number) => call<void>('DELETE', `/requests/${id}`),
  progress: (scope: 'mine' | 'all') => call<{ progress: Progress[]; error?: string }>('GET', `/progress?scope=${scope}`),
  issues: (scope: 'mine' | 'all') => call<{ issues: Issue[] }>('GET', `/issues?scope=${scope}`),
  report: (requestId: number, kind: IssueKind, message: string) =>
    call<{ issue: Issue }>('POST', `/requests/${requestId}/issues`, { kind, message: message.trim() || undefined }),
  replaceIssue: (id: number) => call<{ issue: Issue }>('POST', `/issues/${id}/replace`, {}),
  resolveIssue: (id: number, note?: string) => call<{ issue: Issue }>('POST', `/issues/${id}/resolve`, { note }),
  filters: () => call<{ filters: Filters }>('GET', '/me/filters'),
  saveFilters: (filters: Filters) => call<{ filters: Filters }>('PUT', '/me/filters', { filters }),
  filterOptions: () => call<FilterOptions>('GET', '/discover/options'),
  discover: (body: { list?: ListKind; sort?: SortKind; query?: string; page?: number; platformId?: number; filters?: Partial<Filters> }) =>
    call<{ games: GameCard[]; page: number; more: boolean }>('POST', '/discover/games', body),
  recentlyAdded: () => call<{ games: GameCard[] }>('GET', '/discover/recent'),
  game: (igdbId: number) => call<GamePage>('GET', `/games/${igdbId}`),
  recommendations: () => call<Recommendations>('GET', '/recommendations'),
  like: (igdbId: number, liked: boolean, title: string) => call<{ liked: boolean }>('PUT', `/games/${igdbId}/like`, { liked, title }),
  dismiss: (igdbId: number, dismissed: boolean) => call<{ dismissed: boolean }>('PUT', `/games/${igdbId}/dismiss`, { dismissed }),
  romm: () => call<RommStatus>('GET', '/me/romm'),
  linkRomm: (token: string) => call<RommStatus>('PUT', '/me/romm', { token }),
  unlinkRomm: () => call<RommStatus>('DELETE', '/me/romm'),
  users: () => call<{ users: AdminUser[] }>('GET', '/admin/users'),
  updateUser: (id: number, patch: Partial<{ isAdmin: boolean; autoApprove: boolean; requestLimit: number | null }>) =>
    call<{ user: AdminUser }>('PATCH', `/admin/users/${id}`, patch),
};

export const STATUS_LABEL: Record<RequestStatus, string> = {
  pending: 'Waiting for approval',
  approved: 'Approved',
  searching: 'Searching',
  downloading: 'Downloading',
  available: 'Ready to play',
  declined: 'Declined',
  failed: 'Failed',
};
