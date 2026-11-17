import type { Db } from './db.js';

// A game in a list or an import: enough to show a poster without asking IGDB
export interface GameRef {
  igdbId: number;
  title: string;
  year: number | null;
  coverUrl: string | null;
}

export interface List {
  id: number;
  name: string;
  description: string | null;
  source: string | null;
  featured: boolean;
  createdAt: string;
  updatedAt: string;
  itemCount: number;
}

export interface ListItem extends GameRef {
  platformId: number;
  position: number;
}

export type ImportStatus = 'matching' | 'review' | 'saved' | 'failed';
// matched: one confident candidate (chosen); uncertain: candidates to pick from; unmatched: nothing close
export type ImportItemState = 'pending' | 'matched' | 'uncertain' | 'unmatched';

export interface Import {
  id: number;
  createdBy: number | null;
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
  // The game it will be saved as; null = not chosen yet
  choice: GameRef | null;
  candidates: (GameRef & { similarity: number })[];
  skip: boolean;
}

type Row = Record<string, unknown>;
const json = <T>(v: unknown, fallback: T): T => {
  if (typeof v !== 'string') return fallback;
  try {
    return JSON.parse(v) as T;
  } catch {
    return fallback;
  }
};

const toList = (r: Row): List => ({
  id: Number(r.id),
  name: String(r.name),
  description: r.description == null ? null : String(r.description),
  source: r.source == null ? null : String(r.source),
  featured: r.featured === 1,
  createdAt: String(r.created_at),
  updatedAt: String(r.updated_at),
  itemCount: Number(r.item_count ?? 0),
});

const toImport = (r: Row): Import => ({
  id: Number(r.id),
  createdBy: r.created_by == null ? null : Number(r.created_by),
  listId: r.list_id == null ? null : Number(r.list_id),
  listName: String(r.list_name),
  platformId: Number(r.platform_id),
  source: String(r.source),
  status: String(r.status) as ImportStatus,
  total: Number(r.total),
  done: Number(r.done),
  error: r.error == null ? null : String(r.error),
  createdAt: String(r.created_at),
});

const LIST_SELECT = 'SELECT l.*, (SELECT COUNT(*) FROM list_items i WHERE i.list_id = l.id) AS item_count FROM lists l';

export class CollectionStore {
  constructor(
    private readonly db: Db,
    private readonly now: () => Date = () => new Date(),
  ) {}

  private ts(): string {
    return this.now().toISOString();
  }

  // ---- lists ----

  lists(): List[] {
    return (this.db.prepare(`${LIST_SELECT} ORDER BY l.featured DESC, l.name COLLATE NOCASE`).all() as Row[]).map(toList);
  }

  list(id: number): List | null {
    const r = this.db.prepare(`${LIST_SELECT} WHERE l.id = ?`).get(id) as Row | undefined;
    return r ? toList(r) : null;
  }

  createList(l: { name: string; description: string | null; source: string | null; createdBy: number }): List {
    const now = this.ts();
    const res = this.db
      .prepare('INSERT INTO lists (name, description, source, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(l.name, l.description, l.source, l.createdBy, now, now);
    return this.list(Number(res.lastInsertRowid))!;
  }

  updateList(id: number, patch: { name?: string; description?: string | null; featured?: boolean }): List | null {
    const sets = ['updated_at = ?'];
    const args: Array<string | number | null> = [this.ts()];
    if (patch.name !== undefined) {
      sets.push('name = ?');
      args.push(patch.name);
    }
    if (patch.description !== undefined) {
      sets.push('description = ?');
      args.push(patch.description);
    }
    if (patch.featured !== undefined) {
      sets.push('featured = ?');
      args.push(patch.featured ? 1 : 0);
    }
    this.db.prepare(`UPDATE lists SET ${sets.join(', ')} WHERE id = ?`).run(...args, id);
    return this.list(id);
  }

  deleteList(id: number): void {
    this.db.prepare('DELETE FROM lists WHERE id = ?').run(id);
  }

  items(listId: number): ListItem[] {
    return (this.db.prepare('SELECT * FROM list_items WHERE list_id = ? ORDER BY position, title COLLATE NOCASE').all(listId) as Row[]).map((r) => ({
      igdbId: Number(r.igdb_id),
      platformId: Number(r.platform_id),
      title: String(r.title),
      year: r.year == null ? null : Number(r.year),
      coverUrl: r.cover_url == null ? null : String(r.cover_url),
      position: Number(r.position),
    }));
  }

  // Adds games at the end; a game already on the list for that platform stays where it is. Returns how many were new.
  addItems(listId: number, items: (GameRef & { platformId: number })[]): number {
    const max = this.db.prepare('SELECT COALESCE(MAX(position), 0) AS p FROM list_items WHERE list_id = ?').get(listId) as { p: number };
    let position = Number(max.p);
    const insert = this.db.prepare(
      'INSERT OR IGNORE INTO list_items (list_id, igdb_id, platform_id, title, year, cover_url, position) VALUES (?, ?, ?, ?, ?, ?, ?)',
    );
    let added = 0;
    this.db.exec('BEGIN');
    try {
      for (const i of items) added += Number(insert.run(listId, i.igdbId, i.platformId, i.title, i.year, i.coverUrl, ++position).changes);
      this.db.prepare('UPDATE lists SET updated_at = ? WHERE id = ?').run(this.ts(), listId);
      this.db.exec('COMMIT');
    } catch (err) {
      this.db.exec('ROLLBACK');
      throw err;
    }
    return added;
  }

  removeItem(listId: number, igdbId: number, platformId: number): void {
    this.db.prepare('DELETE FROM list_items WHERE list_id = ? AND igdb_id = ? AND platform_id = ?').run(listId, igdbId, platformId);
  }

  // ---- series pinned to Discover ----

  featuredSeries(): { franchiseId: number; name: string }[] {
    return (this.db.prepare('SELECT * FROM featured_series ORDER BY created_at DESC').all() as Row[]).map((r) => ({ franchiseId: Number(r.franchise_id), name: String(r.name) }));
  }

  setFeaturedSeries(franchiseId: number, name: string, featured: boolean): void {
    if (featured) this.db.prepare('INSERT OR REPLACE INTO featured_series (franchise_id, name, created_at) VALUES (?, ?, ?)').run(franchiseId, name, this.ts());
    else this.db.prepare('DELETE FROM featured_series WHERE franchise_id = ?').run(franchiseId);
  }

  // ---- imports ----

  createImport(i: { createdBy: number; listId: number | null; listName: string; platformId: number; source: string; titles: { raw: string; title: string }[] }): Import {
    const now = this.ts();
    this.db.exec('BEGIN');
    try {
      const res = this.db
        .prepare("INSERT INTO imports (created_by, list_id, list_name, platform_id, source, status, total, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 'matching', ?, ?, ?)")
        .run(i.createdBy, i.listId, i.listName, i.platformId, i.source, i.titles.length, now, now);
      const id = Number(res.lastInsertRowid);
      const insert = this.db.prepare("INSERT INTO import_items (import_id, idx, raw, title, state) VALUES (?, ?, ?, ?, 'pending')");
      i.titles.forEach((t, idx) => insert.run(id, idx, t.raw, t.title));
      this.db.exec('COMMIT');
      return this.import(id)!;
    } catch (err) {
      this.db.exec('ROLLBACK');
      throw err;
    }
  }

  import(id: number): Import | null {
    const r = this.db.prepare('SELECT * FROM imports WHERE id = ?').get(id) as Row | undefined;
    return r ? toImport(r) : null;
  }

  imports(): Import[] {
    return (this.db.prepare('SELECT * FROM imports ORDER BY created_at DESC LIMIT 50').all() as Row[]).map(toImport);
  }

  importsMatching(): Import[] {
    return (this.db.prepare("SELECT * FROM imports WHERE status = 'matching'").all() as Row[]).map(toImport);
  }

  updateImport(id: number, patch: Partial<Pick<Import, 'status' | 'done' | 'error' | 'listId'>>): void {
    const columns: Record<string, string> = { status: 'status', done: 'done', error: 'error', listId: 'list_id' };
    const sets = ['updated_at = ?'];
    const args: Array<string | number | null> = [this.ts()];
    for (const [k, v] of Object.entries(patch)) {
      if (v === undefined) continue;
      sets.push(`${columns[k]} = ?`);
      args.push(v as string | number | null);
    }
    this.db.prepare(`UPDATE imports SET ${sets.join(', ')} WHERE id = ?`).run(...args, id);
  }

  // Saved imports older than the date: their games are in their list already. Returns how many went.
  pruneSavedImports(before: Date): number {
    return Number(this.db.prepare("DELETE FROM imports WHERE status = 'saved' AND updated_at < ?").run(before.toISOString()).changes);
  }

  deleteImport(id: number): void {
    this.db.prepare('DELETE FROM imports WHERE id = ?').run(id);
  }

  importItems(importId: number, state?: ImportItemState): ImportItem[] {
    const rows = (state
      ? this.db.prepare('SELECT * FROM import_items WHERE import_id = ? AND state = ? ORDER BY idx').all(importId, state)
      : this.db.prepare('SELECT * FROM import_items WHERE import_id = ? ORDER BY idx').all(importId)) as Row[];
    return rows.map((r) => ({
      idx: Number(r.idx),
      raw: String(r.raw),
      title: String(r.title),
      state: String(r.state) as ImportItemState,
      choice: json<GameRef | null>(r.choice, null),
      candidates: json<(GameRef & { similarity: number })[]>(r.candidates, []),
      skip: r.skip === 1,
    }));
  }

  setImportItem(importId: number, idx: number, patch: { state?: ImportItemState; choice?: GameRef | null; candidates?: unknown[]; skip?: boolean }): void {
    const sets: string[] = [];
    const args: Array<string | number | null> = [];
    if (patch.state !== undefined) {
      sets.push('state = ?');
      args.push(patch.state);
    }
    if (patch.choice !== undefined) {
      sets.push('choice = ?');
      args.push(patch.choice ? JSON.stringify(patch.choice) : null);
    }
    if (patch.candidates !== undefined) {
      sets.push('candidates = ?');
      args.push(JSON.stringify(patch.candidates));
    }
    if (patch.skip !== undefined) {
      sets.push('skip = ?');
      args.push(patch.skip ? 1 : 0);
    }
    if (sets.length === 0) return;
    this.db.prepare(`UPDATE import_items SET ${sets.join(', ')} WHERE import_id = ? AND idx = ?`).run(...args, importId, idx);
  }
}
