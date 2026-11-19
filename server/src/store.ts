import type { Db } from './db.js';

export type RequestStatus = 'pending' | 'approved' | 'searching' | 'downloading' | 'available' | 'declined' | 'failed';
export const OPEN_STATUSES: RequestStatus[] = ['pending', 'approved', 'searching', 'downloading', 'available'];
// Handed to RetroArr and not finished: the poller follows these
export const TRACKED_STATUSES: RequestStatus[] = ['approved', 'searching', 'downloading'];
// An add-on request is open until what it asked for is in
export const OPEN_ADDON_STATUSES: RequestStatus[] = ['pending', 'approved', 'searching', 'downloading'];

export type RequestKind = 'game' | 'addons';
export interface WantedDlc {
  igdbId: number | null;
  title: string;
}
// Updates and DLC asked for with a game, or for a game the library has
export interface AddOns {
  latestUpdate: boolean;
  allDlc: boolean;
  dlc: WantedDlc[];
}
export const NO_ADDONS: AddOns = { latestUpdate: false, allDlc: false, dlc: [] };
export const hasAddOns = (a: AddOns) => a.latestUpdate || a.allDlc || a.dlc.length > 0;

function parseDlc(raw: unknown): WantedDlc[] {
  try {
    const list = JSON.parse(String(raw ?? '[]')) as unknown;
    if (!Array.isArray(list)) return [];
    return list
      .filter((d): d is { igdbId?: unknown; title?: unknown } => typeof d === 'object' && d !== null)
      .map((d) => ({ igdbId: typeof d.igdbId === 'number' ? d.igdbId : null, title: String(d.title ?? '') }))
      .filter((d) => d.title);
  } catch {
    return [];
  }
}

export interface User {
  id: number;
  jellyfinId: string;
  username: string;
  isAdmin: boolean;
  jellyfinAdmin: boolean;
  autoApprove: boolean;
  requestLimit: number | null;
  createdAt: string;
  lastLoginAt: string | null;
}

// What happened to a request: its status changes, a grab, RomM picking it up
export type RequestEventKind = RequestStatus | 'requested' | 'grabbed' | 'in_romm';

export interface RequestEvent {
  at: string;
  kind: RequestEventKind;
  release: string | null;
  error: string | null;
  note: string | null;
  actor: string | null;
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
  retroarrGameId: number | null;
  // The release RetroArr grabbed, from its OnDownloadStarted webhook
  release: string | null;
  note: string | null;
  error: string | null;
  decidedBy: number | null;
  decidedAt: string | null;
  availableAt: string | null;
  // The game in RomM, once RetroArr's RomM sync has seen it there
  rommId: number | null;
  // The version asked for: '' region is any; variant '' or en-translation
  region: string;
  variant: string;
  latestRevision: boolean;
  // 'addons': updates and DLC for a game the library has
  kind: RequestKind;
  addOns: AddOns;
  createdAt: string;
  updatedAt: string;
}

export type IssueKind = 'wont_launch' | 'wrong_game' | 'wrong_region' | 'missing_files' | 'other';
export const ISSUE_KINDS: IssueKind[] = ['wont_launch', 'wrong_game', 'wrong_region', 'missing_files', 'other'];
// open: reported; replacing: RetroArr grabbed another release; resolved: replaced or closed by an admin
export type IssueStatus = 'open' | 'replacing' | 'resolved';

export interface Issue {
  id: number;
  requestId: number;
  userId: number;
  username: string;
  kind: IssueKind;
  message: string | null;
  status: IssueStatus;
  // What was done, or why nothing could be yet
  resolution: string | null;
  // The release RetroArr grabbed to replace the reported one
  replacementRelease: string | null;
  resolvedBy: number | null;
  resolvedAt: string | null;
  createdAt: string;
  updatedAt: string;
  // From the request
  title: string;
  year: number | null;
  platformName: string;
  coverUrl: string | null;
  retroarrGameId: number | null;
  release: string | null;
}

type Row = Record<string, unknown>;

const toUser = (r: Row): User => ({
  id: Number(r.id),
  jellyfinId: String(r.jellyfin_id),
  username: String(r.username),
  isAdmin: r.is_admin === 1,
  jellyfinAdmin: r.jellyfin_admin === 1,
  autoApprove: r.auto_approve === 1,
  requestLimit: r.request_limit == null ? null : Number(r.request_limit),
  createdAt: String(r.created_at),
  lastLoginAt: r.last_login_at == null ? null : String(r.last_login_at),
});

const toRequest = (r: Row): GameRequest => ({
  id: Number(r.id),
  userId: Number(r.user_id),
  username: String(r.username ?? ''),
  igdbId: Number(r.igdb_id),
  platformId: Number(r.platform_id),
  platformName: String(r.platform_name),
  title: String(r.title),
  year: r.year == null ? null : Number(r.year),
  coverUrl: r.cover_url == null ? null : String(r.cover_url),
  status: String(r.status) as RequestStatus,
  retroarrGameId: r.retroarr_game_id == null ? null : Number(r.retroarr_game_id),
  release: r.release == null ? null : String(r.release),
  note: r.note == null ? null : String(r.note),
  error: r.error == null ? null : String(r.error),
  decidedBy: r.decided_by == null ? null : Number(r.decided_by),
  decidedAt: r.decided_at == null ? null : String(r.decided_at),
  availableAt: r.available_at == null ? null : String(r.available_at),
  rommId: r.romm_id == null ? null : Number(r.romm_id),
  region: String(r.region ?? ''),
  variant: String(r.variant ?? ''),
  latestRevision: Number(r.latest_revision ?? 0) === 1,
  kind: r.kind === 'addons' ? 'addons' : 'game',
  addOns: { latestUpdate: Number(r.latest_update ?? 0) === 1, allDlc: Number(r.all_dlc ?? 0) === 1, dlc: parseDlc(r.dlc) },
  createdAt: String(r.created_at),
  updatedAt: String(r.updated_at),
});

const toIssue = (r: Row): Issue => ({
  id: Number(r.id),
  requestId: Number(r.request_id),
  userId: Number(r.user_id),
  username: String(r.username ?? ''),
  kind: String(r.kind) as IssueKind,
  message: r.message == null ? null : String(r.message),
  status: String(r.status) as IssueStatus,
  resolution: r.resolution == null ? null : String(r.resolution),
  replacementRelease: r.replacement_release == null ? null : String(r.replacement_release),
  resolvedBy: r.resolved_by == null ? null : Number(r.resolved_by),
  resolvedAt: r.resolved_at == null ? null : String(r.resolved_at),
  createdAt: String(r.created_at),
  updatedAt: String(r.updated_at),
  title: String(r.title ?? ''),
  year: r.year == null ? null : Number(r.year),
  platformName: String(r.platform_name ?? ''),
  coverUrl: r.cover_url == null ? null : String(r.cover_url),
  retroarrGameId: r.retroarr_game_id == null ? null : Number(r.retroarr_game_id),
  release: r.release == null ? null : String(r.release),
});

const ISSUE_SELECT = `SELECT i.*, u.username, q.title, q.year, q.platform_name, q.cover_url, q.retroarr_game_id, q.release
  FROM issues i JOIN users u ON u.id = i.user_id JOIN requests q ON q.id = i.request_id`;

const REQUEST_SELECT = 'SELECT r.*, u.username FROM requests r JOIN users u ON u.id = r.user_id';

export class Store {
  constructor(
    private readonly db: Db,
    private readonly now: () => Date = () => new Date(),
  ) {}

  private ts(): string {
    return this.now().toISOString();
  }

  // ---- users ----

  upsertUser(jellyfinId: string, username: string, jellyfinAdmin: boolean): User {
    const now = this.ts();
    this.db
      .prepare(
        `INSERT INTO users (jellyfin_id, username, jellyfin_admin, created_at, last_login_at) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(jellyfin_id) DO UPDATE SET username = excluded.username, jellyfin_admin = excluded.jellyfin_admin,
           last_login_at = excluded.last_login_at`,
      )
      .run(jellyfinId, username, jellyfinAdmin ? 1 : 0, now, now);
    return this.userByJellyfinId(jellyfinId)!;
  }

  userByJellyfinId(jellyfinId: string): User | null {
    const r = this.db.prepare('SELECT * FROM users WHERE jellyfin_id = ?').get(jellyfinId) as Row | undefined;
    return r ? toUser(r) : null;
  }

  userById(id: number): User | null {
    const r = this.db.prepare('SELECT * FROM users WHERE id = ?').get(id) as Row | undefined;
    return r ? toUser(r) : null;
  }

  listUsers(): User[] {
    return (this.db.prepare('SELECT * FROM users ORDER BY username COLLATE NOCASE').all() as Row[]).map(toUser);
  }

  anyAdmin(): boolean {
    return this.db.prepare('SELECT 1 FROM users WHERE is_admin = 1 LIMIT 1').get() !== undefined;
  }

  updateUser(id: number, patch: { isAdmin?: boolean; autoApprove?: boolean; requestLimit?: number | null }): User | null {
    const sets: string[] = [];
    const args: Array<number | null> = [];
    if (patch.isAdmin !== undefined) {
      sets.push('is_admin = ?');
      args.push(patch.isAdmin ? 1 : 0);
    }
    if (patch.autoApprove !== undefined) {
      sets.push('auto_approve = ?');
      args.push(patch.autoApprove ? 1 : 0);
    }
    if (patch.requestLimit !== undefined) {
      sets.push('request_limit = ?');
      args.push(patch.requestLimit);
    }
    if (sets.length > 0) this.db.prepare(`UPDATE users SET ${sets.join(', ')} WHERE id = ?`).run(...args, id);
    return this.userById(id);
  }

  // Saved discovery filters, as the JSON the user last applied (null: never saved)
  userFilters(id: number): unknown {
    const r = this.db.prepare('SELECT filters FROM users WHERE id = ?').get(id) as { filters: string | null } | undefined;
    if (!r?.filters) return null;
    try {
      return JSON.parse(r.filters) as unknown;
    } catch {
      return null;
    }
  }

  saveUserFilters(id: number, filters: unknown): void {
    this.db.prepare('UPDATE users SET filters = ? WHERE id = ?').run(JSON.stringify(filters), id);
  }

  // ---- likes, "not interested", RomM links ----

  likes(userId: number): { igdbId: number; title: string; createdAt: string }[] {
    return (this.db.prepare('SELECT igdb_id, title, created_at FROM likes WHERE user_id = ? ORDER BY created_at DESC').all(userId) as Row[]).map((r) => ({
      igdbId: Number(r.igdb_id),
      title: String(r.title),
      createdAt: String(r.created_at),
    }));
  }

  setLike(userId: number, igdbId: number, title: string, liked: boolean): void {
    if (liked) this.db.prepare('INSERT OR IGNORE INTO likes (user_id, igdb_id, title, created_at) VALUES (?, ?, ?, ?)').run(userId, igdbId, title, this.ts());
    else this.db.prepare('DELETE FROM likes WHERE user_id = ? AND igdb_id = ?').run(userId, igdbId);
  }

  dismissed(userId: number): Set<number> {
    return new Set((this.db.prepare('SELECT igdb_id FROM dismissed WHERE user_id = ?').all(userId) as Row[]).map((r) => Number(r.igdb_id)));
  }

  setDismissed(userId: number, igdbId: number, dismissed: boolean): void {
    if (dismissed) this.db.prepare('INSERT OR IGNORE INTO dismissed (user_id, igdb_id, created_at) VALUES (?, ?, ?)').run(userId, igdbId, this.ts());
    else this.db.prepare('DELETE FROM dismissed WHERE user_id = ? AND igdb_id = ?').run(userId, igdbId);
  }

  rommLink(userId: number): { token: string; rommUsername: string; linkedAt: string; lastError: string | null } | null {
    const r = this.db.prepare('SELECT * FROM romm_links WHERE user_id = ?').get(userId) as Row | undefined;
    return r
      ? { token: String(r.token), rommUsername: String(r.romm_username), linkedAt: String(r.linked_at), lastError: r.last_error == null ? null : String(r.last_error) }
      : null;
  }

  setRommLink(userId: number, token: string, rommUsername: string): void {
    this.db
      .prepare(
        `INSERT INTO romm_links (user_id, token, romm_username, linked_at) VALUES (?, ?, ?, ?)
         ON CONFLICT(user_id) DO UPDATE SET token = excluded.token, romm_username = excluded.romm_username, linked_at = excluded.linked_at, last_error = NULL`,
      )
      .run(userId, token, rommUsername, this.ts());
  }

  setRommError(userId: number, error: string | null): void {
    this.db.prepare('UPDATE romm_links SET last_error = ? WHERE user_id = ?').run(error, userId);
  }

  deleteRommLink(userId: number): void {
    this.db.prepare('DELETE FROM romm_links WHERE user_id = ?').run(userId);
  }

  // ---- sessions ----

  createSession(idHash: string, userId: number, expiresAt: Date): void {
    this.db.prepare('INSERT INTO sessions (id_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)').run(idHash, userId, this.ts(), expiresAt.toISOString());
  }

  sessionUser(idHash: string): User | null {
    const r = this.db
      .prepare('SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.id_hash = ? AND s.expires_at > ?')
      .get(idHash, this.ts()) as Row | undefined;
    return r ? toUser(r) : null;
  }

  deleteSession(idHash: string): void {
    this.db.prepare('DELETE FROM sessions WHERE id_hash = ?').run(idHash);
  }

  pruneSessions(): void {
    this.db.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(this.ts());
  }

  // ---- requests ----

  createRequest(r: {
    userId: number;
    igdbId: number;
    platformId: number;
    platformName: string;
    title: string;
    year: number | null;
    coverUrl: string | null;
    version?: { region: string; variant: string; latestRevision: boolean };
    kind?: RequestKind;
    addOns?: AddOns;
  }): GameRequest {
    const now = this.ts();
    const v = r.version ?? { region: '', variant: '', latestRevision: false };
    const a = r.addOns ?? NO_ADDONS;
    const res = this.db
      .prepare(
        `INSERT INTO requests (user_id, igdb_id, platform_id, platform_name, title, year, cover_url, status, region, variant, latest_revision,
           kind, latest_update, all_dlc, dlc, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(r.userId, r.igdbId, r.platformId, r.platformName, r.title, r.year, r.coverUrl, v.region, v.variant, v.latestRevision ? 1 : 0,
        r.kind ?? 'game', a.latestUpdate ? 1 : 0, a.allDlc ? 1 : 0, JSON.stringify(a.dlc), now, now);
    const id = Number(res.lastInsertRowid);
    this.addRequestEvent(id, 'requested', { actorId: r.userId });
    return this.request(id)!;
  }

  request(id: number): GameRequest | null {
    const r = this.db.prepare(`${REQUEST_SELECT} WHERE r.id = ?`).get(id) as Row | undefined;
    return r ? toRequest(r) : null;
  }

  // The open request for that version (the default one when none is given)
  openRequestFor(
    igdbId: number,
    platformId: number,
    version: { region: string; variant: string } = { region: '', variant: '' },
    kind: RequestKind = 'game',
  ): GameRequest | null {
    const statuses = kind === 'addons' ? OPEN_ADDON_STATUSES : OPEN_STATUSES;
    const r = this.db
      .prepare(
        `${REQUEST_SELECT} WHERE r.igdb_id = ? AND r.platform_id = ? AND r.region = ? AND r.variant = ? AND r.kind = ? AND r.status IN (${statuses.map(() => '?').join(',')})`,
      )
      .get(igdbId, platformId, version.region, version.variant, kind, ...statuses) as Row | undefined;
    return r ? toRequest(r) : null;
  }

  openRequestsForGames(igdbIds: number[]): GameRequest[] {
    if (igdbIds.length === 0) return [];
    return (
      this.db
        .prepare(`${REQUEST_SELECT} WHERE r.kind = 'game' AND r.igdb_id IN (${igdbIds.map(() => '?').join(',')}) AND r.status IN (${OPEN_STATUSES.map(() => '?').join(',')})`)
        .all(...igdbIds, ...OPEN_STATUSES) as Row[]
    ).map(toRequest);
  }

  listRequests(filter: { userId?: number; statuses?: RequestStatus[] } = {}): GameRequest[] {
    const where: string[] = [];
    const args: Array<string | number> = [];
    if (filter.userId !== undefined) {
      where.push('r.user_id = ?');
      args.push(filter.userId);
    }
    if (filter.statuses?.length) {
      where.push(`r.status IN (${filter.statuses.map(() => '?').join(',')})`);
      args.push(...filter.statuses);
    }
    const sql = `${REQUEST_SELECT}${where.length ? ` WHERE ${where.join(' AND ')}` : ''}
      ORDER BY CASE r.status WHEN 'pending' THEN 0 ELSE 1 END, r.created_at DESC LIMIT 500`;
    return (this.db.prepare(sql).all(...args) as Row[]).map(toRequest);
  }

  // Requests that count against the limit: everything not declined, since `since`
  countRecentRequests(userId: number, since: Date): number {
    const r = this.db
      .prepare(`SELECT COUNT(*) AS n FROM requests WHERE user_id = ? AND created_at >= ? AND status <> 'declined'`)
      .get(userId, since.toISOString()) as { n: number };
    return Number(r.n);
  }

  updateRequest(
    id: number,
    patch: Partial<Pick<GameRequest, 'status' | 'retroarrGameId' | 'release' | 'note' | 'error' | 'decidedBy' | 'decidedAt' | 'availableAt' | 'rommId'>>,
  ): GameRequest | null {
    const columns: Record<string, string> = {
      status: 'status',
      retroarrGameId: 'retroarr_game_id',
      release: 'release',
      note: 'note',
      error: 'error',
      decidedBy: 'decided_by',
      decidedAt: 'decided_at',
      availableAt: 'available_at',
      rommId: 'romm_id',
    };
    const sets: string[] = ['updated_at = ?'];
    const args: Array<string | number | null> = [this.ts()];
    for (const [key, value] of Object.entries(patch)) {
      if (value === undefined) continue;
      sets.push(`${columns[key]} = ?`);
      args.push(value as string | number | null);
    }
    const before = this.request(id);
    this.db.prepare(`UPDATE requests SET ${sets.join(', ')} WHERE id = ?`).run(...args, id);
    const after = this.request(id);
    // The timeline: every status change, a grab (a new release while downloading), RomM picking it up
    if (before && after) {
      if (patch.status !== undefined && patch.status !== before.status) {
        const decided = patch.status === 'approved' || patch.status === 'declined';
        this.addRequestEvent(id, patch.status, {
          release: patch.status === 'downloading' ? after.release : null,
          error: patch.error ?? null,
          note: decided ? (patch.note ?? null) : null,
          actorId: decided ? (patch.decidedBy ?? null) : null,
        });
      } else if (patch.release && patch.release !== before.release) {
        this.addRequestEvent(id, 'grabbed', { release: patch.release });
      } else if (patch.error && patch.error !== before.error) {
        this.addRequestEvent(id, after.status, { error: patch.error });
      }
      if (patch.rommId && !before.rommId) this.addRequestEvent(id, 'in_romm');
    }
    return after;
  }

  addRequestEvent(requestId: number, kind: RequestEventKind, e: { release?: string | null; error?: string | null; note?: string | null; actorId?: number | null } = {}): void {
    this.db
      .prepare('INSERT INTO request_events (request_id, at, kind, release, error, note, actor_id) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(requestId, this.ts(), kind, e.release ?? null, e.error ?? null, e.note ?? null, e.actorId ?? null);
  }

  requestEvents(requestId: number): RequestEvent[] {
    return (
      this.db
        .prepare('SELECT e.*, u.username FROM request_events e LEFT JOIN users u ON u.id = e.actor_id WHERE e.request_id = ? ORDER BY e.id')
        .all(requestId) as Row[]
    ).map((r) => ({
      at: String(r.at),
      kind: String(r.kind) as RequestEventKind,
      release: r.release == null ? null : String(r.release),
      error: r.error == null ? null : String(r.error),
      note: r.note == null ? null : String(r.note),
      actor: r.username == null ? null : String(r.username),
    }));
  }

  deleteRequest(id: number): void {
    this.db.prepare('DELETE FROM requests WHERE id = ?').run(id);
  }

  // ---- issues ----

  createIssue(i: { requestId: number; userId: number; kind: IssueKind; message: string | null }): Issue {
    const now = this.ts();
    const res = this.db
      .prepare(`INSERT INTO issues (request_id, user_id, kind, message, status, created_at, updated_at) VALUES (?, ?, ?, ?, 'open', ?, ?)`)
      .run(i.requestId, i.userId, i.kind, i.message, now, now);
    return this.issue(Number(res.lastInsertRowid))!;
  }

  issue(id: number): Issue | null {
    const r = this.db.prepare(`${ISSUE_SELECT} WHERE i.id = ?`).get(id) as Row | undefined;
    return r ? toIssue(r) : null;
  }

  unresolvedIssueFor(requestId: number): Issue | null {
    const r = this.db.prepare(`${ISSUE_SELECT} WHERE i.request_id = ? AND i.status IN ('open', 'replacing')`).get(requestId) as Row | undefined;
    return r ? toIssue(r) : null;
  }

  listIssues(filter: { userId?: number; statuses?: IssueStatus[] } = {}): Issue[] {
    const where: string[] = [];
    const args: Array<string | number> = [];
    if (filter.userId !== undefined) {
      where.push('i.user_id = ?');
      args.push(filter.userId);
    }
    if (filter.statuses?.length) {
      where.push(`i.status IN (${filter.statuses.map(() => '?').join(',')})`);
      args.push(...filter.statuses);
    }
    const sql = `${ISSUE_SELECT}${where.length ? ` WHERE ${where.join(' AND ')}` : ''}
      ORDER BY CASE i.status WHEN 'open' THEN 0 WHEN 'replacing' THEN 1 ELSE 2 END, i.created_at DESC LIMIT 500`;
    return (this.db.prepare(sql).all(...args) as Row[]).map(toIssue);
  }

  updateIssue(id: number, patch: Partial<Pick<Issue, 'status' | 'resolution' | 'replacementRelease' | 'resolvedBy' | 'resolvedAt'>>): Issue | null {
    const columns: Record<string, string> = {
      status: 'status',
      resolution: 'resolution',
      replacementRelease: 'replacement_release',
      resolvedBy: 'resolved_by',
      resolvedAt: 'resolved_at',
    };
    const sets: string[] = ['updated_at = ?'];
    const args: Array<string | number | null> = [this.ts()];
    for (const [key, value] of Object.entries(patch)) {
      if (value === undefined) continue;
      sets.push(`${columns[key]} = ?`);
      args.push(value as string | number | null);
    }
    this.db.prepare(`UPDATE issues SET ${sets.join(', ')} WHERE id = ?`).run(...args, id);
    return this.issue(id);
  }
}
