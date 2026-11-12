import type { Db } from './db.js';

export type RequestStatus = 'pending' | 'approved' | 'searching' | 'downloading' | 'available' | 'declined' | 'failed';
export const OPEN_STATUSES: RequestStatus[] = ['pending', 'approved', 'searching', 'downloading', 'available'];
// Handed to RetroArr and not finished: the poller follows these
export const TRACKED_STATUSES: RequestStatus[] = ['approved', 'searching', 'downloading'];

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
  note: string | null;
  error: string | null;
  decidedBy: number | null;
  decidedAt: string | null;
  availableAt: string | null;
  createdAt: string;
  updatedAt: string;
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
  note: r.note == null ? null : String(r.note),
  error: r.error == null ? null : String(r.error),
  decidedBy: r.decided_by == null ? null : Number(r.decided_by),
  decidedAt: r.decided_at == null ? null : String(r.decided_at),
  availableAt: r.available_at == null ? null : String(r.available_at),
  createdAt: String(r.created_at),
  updatedAt: String(r.updated_at),
});

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

  createRequest(r: { userId: number; igdbId: number; platformId: number; platformName: string; title: string; year: number | null; coverUrl: string | null }): GameRequest {
    const now = this.ts();
    const res = this.db
      .prepare(
        `INSERT INTO requests (user_id, igdb_id, platform_id, platform_name, title, year, cover_url, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)`,
      )
      .run(r.userId, r.igdbId, r.platformId, r.platformName, r.title, r.year, r.coverUrl, now, now);
    return this.request(Number(res.lastInsertRowid))!;
  }

  request(id: number): GameRequest | null {
    const r = this.db.prepare(`${REQUEST_SELECT} WHERE r.id = ?`).get(id) as Row | undefined;
    return r ? toRequest(r) : null;
  }

  openRequestFor(igdbId: number, platformId: number): GameRequest | null {
    const r = this.db
      .prepare(`${REQUEST_SELECT} WHERE r.igdb_id = ? AND r.platform_id = ? AND r.status IN (${OPEN_STATUSES.map(() => '?').join(',')})`)
      .get(igdbId, platformId, ...OPEN_STATUSES) as Row | undefined;
    return r ? toRequest(r) : null;
  }

  openRequestsForGames(igdbIds: number[]): GameRequest[] {
    if (igdbIds.length === 0) return [];
    return (
      this.db
        .prepare(`${REQUEST_SELECT} WHERE r.igdb_id IN (${igdbIds.map(() => '?').join(',')}) AND r.status IN (${OPEN_STATUSES.map(() => '?').join(',')})`)
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
    patch: Partial<Pick<GameRequest, 'status' | 'retroarrGameId' | 'note' | 'error' | 'decidedBy' | 'decidedAt' | 'availableAt'>>,
  ): GameRequest | null {
    const columns: Record<string, string> = {
      status: 'status',
      retroarrGameId: 'retroarr_game_id',
      note: 'note',
      error: 'error',
      decidedBy: 'decided_by',
      decidedAt: 'decided_at',
      availableAt: 'available_at',
    };
    const sets: string[] = ['updated_at = ?'];
    const args: Array<string | number | null> = [this.ts()];
    for (const [key, value] of Object.entries(patch)) {
      if (value === undefined) continue;
      sets.push(`${columns[key]} = ?`);
      args.push(value as string | number | null);
    }
    this.db.prepare(`UPDATE requests SET ${sets.join(', ')} WHERE id = ?`).run(...args, id);
    return this.request(id);
  }

  deleteRequest(id: number): void {
    this.db.prepare('DELETE FROM requests WHERE id = ?').run(id);
  }
}
