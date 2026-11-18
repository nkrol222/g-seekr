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
  // The platforms the library has it on, and the game in RomM on each (for "Play in RomM")
  inLibrary?: number[];
  romm?: { platformId: number; rommId: number }[];
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
  // Its series, each a collection page
  seriesRefs?: FilterOption[];
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

export type StepKey = 'requested' | 'approved' | 'looking' | 'downloading' | 'library' | 'romm';

// One step of a request's timeline, in plain words; adminDetail only reaches admins
export interface TimelineStep {
  key: StepKey;
  label: string;
  state: 'done' | 'current' | 'waiting' | 'failed';
  at: string | null;
  detail: string | null;
  adminDetail: string | null;
  nextAt: string | null;
  lastAt: string | null;
}

export interface Timeline {
  steps: TimelineStep[];
  current: TimelineStep;
  history: { at: string; text: string; adminDetail: string | null }[];
}

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
  // The game in RomM, once RomM has it (RomM scans new games within the hour)
  rommId: number | null;
  // Where it's at, when the list was asked for with the status
  now?: TimelineStep;
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

// ---- collections ----

export type CollectionKind = 'series' | 'list';

export interface CollectionCard {
  kind: CollectionKind;
  id: number;
  name: string;
  covers: string[];
  total: number;
  inLibrary: number;
}

export interface CollectionGame {
  igdbId: number;
  title: string;
  year: number | null;
  coverUrl: string | null;
  rating: number | null;
  platformIds: number[];
  inLibrary: number[];
  requests: { id: number; platformId: number; status: RequestStatus }[];
}

export interface CollectionPage {
  kind: CollectionKind;
  id: number;
  name: string;
  description: string | null;
  source: string | null;
  featured: boolean;
  platforms: { id: number; name: string; total: number; inLibrary: number }[];
  games: CollectionGame[];
}

export interface CollectionRows {
  featured: CollectionCard[];
  popular: CollectionCard[];
  inProgress: CollectionCard[];
  lists: CollectionCard[];
}

export interface RequestMissingResult {
  requested: { igdbId: number; title: string }[];
  skipped: { igdbId: number; title: string; reason: string }[];
  limitReached: boolean;
}

export interface CuratedList {
  id: number;
  name: string;
  description: string | null;
  source: string | null;
  featured: boolean;
  itemCount: number;
}

export interface GameRef {
  igdbId: number;
  title: string;
  year: number | null;
  coverUrl: string | null;
}

export type ImportStatus = 'matching' | 'review' | 'saved' | 'failed';
export type ImportItemState = 'pending' | 'matched' | 'uncertain' | 'unmatched';

export interface ImportJob {
  id: number;
  listId: number | null;
  listName: string;
  platformId: number;
  source: string;
  status: ImportStatus;
  total: number;
  done: number;
  error: string | null;
  createdAt: string;
}

export interface ImportItem {
  idx: number;
  raw: string;
  title: string;
  state: ImportItemState;
  choice: GameRef | null;
  candidates: (GameRef & { similarity: number })[];
  skip: boolean;
}

export type ImportSource = { kind: 'titles' | 'dat'; text: string } | { kind: 'archive'; item: string };

const collectionPath = (kind: CollectionKind, id: number) => `/collections/${kind === 'series' ? 'series' : 'lists'}/${id}`;

export interface AdminTask {
  key: string;
  name: string;
  description: string;
  intervalSeconds: number;
  minSeconds: number;
  maxSeconds: number;
  canTurnOff: boolean;
  running: boolean;
  queued: boolean;
  startedAt: string | null;
  lastStarted: string | null;
  lastFinished: string | null;
  lastDurationMs: number | null;
  lastOutcome: 'succeeded' | 'failed' | 'skipped' | null;
  lastMessage: string | null;
  nextRun: string | null;
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
  requests: (scope: 'mine' | 'all', withStatus = false) => call<{ requests: GameRequest[] }>('GET', `/requests?scope=${scope}${withStatus ? '&withStatus=1' : ''}`),
  timeline: (id: number) => call<Timeline>('GET', `/requests/${id}/timeline`),
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
  collections: () => call<CollectionRows>('GET', '/collections'),
  collection: (kind: CollectionKind, id: number) => call<CollectionPage>('GET', collectionPath(kind, id)),
  searchSeries: (query: string) => call<{ series: { id: number; name: string; gameCount: number }[] }>('GET', `/collections/series?query=${encodeURIComponent(query)}`),
  requestMissing: (kind: CollectionKind, id: number, platformId: number) => call<RequestMissingResult>('POST', `${collectionPath(kind, id)}/request-missing`, { platformId }),
  featureSeries: (id: number, name: string, featured: boolean) => call<{ featured: boolean }>('PUT', `/collections/series/${id}/featured`, { name, featured }),
  createList: (name: string, description: string) => call<{ list: CuratedList }>('POST', '/lists', { name, description }),
  updateList: (id: number, patch: Partial<{ name: string; description: string | null; featured: boolean }>) => call<{ list: CuratedList }>('PATCH', `/lists/${id}`, patch),
  deleteList: (id: number) => call<void>('DELETE', `/lists/${id}`),
  addToList: (id: number, game: GameRef, platformId: number) => call<{ added: number }>('POST', `/lists/${id}/items`, { ...game, platformId }),
  removeFromList: (id: number, igdbId: number, platformId: number) => call<void>('DELETE', `/lists/${id}/items/${igdbId}/${platformId}`),
  imports: () => call<{ imports: ImportJob[] }>('GET', '/imports'),
  startImport: (body: ImportSource & { platformId: number; listName?: string; listId?: number }) => call<{ import: ImportJob }>('POST', '/imports', body),
  importReview: (id: number) => call<{ import: ImportJob; items: ImportItem[] }>('GET', `/imports/${id}`),
  chooseImportItem: (id: number, idx: number, patch: { choice?: GameRef | null; skip?: boolean }) => call<{ item: ImportItem }>('PATCH', `/imports/${id}/items/${idx}`, patch),
  retryImport: (id: number) => call<{ import: ImportJob }>('POST', `/imports/${id}/retry`, {}),
  saveImport: (id: number) => call<{ list: CuratedList; added: number }>('POST', `/imports/${id}/save`, {}),
  discardImport: (id: number) => call<void>('DELETE', `/imports/${id}`),
  tasks: () => call<{ tasks: AdminTask[] }>('GET', '/admin/tasks'),
  setTaskInterval: (key: string, intervalSeconds: number) => call<{ task: AdminTask }>('PUT', `/admin/tasks/${key}`, { intervalSeconds }),
  runTask: (key: string) => call<{ task: AdminTask }>('POST', `/admin/tasks/${key}/run`, {}),
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
