import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

export type Db = DatabaseSync;

// Each entry runs once, in order; PRAGMA user_version records how far a database has got.
// Append only: never edit a migration that has shipped.
const MIGRATIONS: string[] = [
  `
  CREATE TABLE users (
    id INTEGER PRIMARY KEY,
    jellyfin_id TEXT NOT NULL UNIQUE,
    username TEXT NOT NULL,
    is_admin INTEGER NOT NULL DEFAULT 0,
    jellyfin_admin INTEGER NOT NULL DEFAULT 0,
    auto_approve INTEGER NOT NULL DEFAULT 0,
    request_limit INTEGER,
    created_at TEXT NOT NULL,
    last_login_at TEXT
  );
  CREATE TABLE sessions (
    id_hash TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TEXT NOT NULL,
    expires_at TEXT NOT NULL
  );
  CREATE INDEX ix_sessions_user ON sessions(user_id);
  CREATE TABLE requests (
    id INTEGER PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    igdb_id INTEGER NOT NULL,
    platform_id INTEGER NOT NULL,
    platform_name TEXT NOT NULL,
    title TEXT NOT NULL,
    year INTEGER,
    cover_url TEXT,
    status TEXT NOT NULL,
    retroarr_game_id INTEGER,
    note TEXT,
    error TEXT,
    decided_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    decided_at TEXT,
    available_at TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE INDEX ix_requests_user ON requests(user_id, created_at);
  CREATE INDEX ix_requests_status ON requests(status);
  -- one open request per game and platform; declined and failed ones don't block a new one
  CREATE UNIQUE INDEX ux_requests_open ON requests(igdb_id, platform_id)
    WHERE status IN ('pending', 'approved', 'searching', 'downloading', 'available');
  `,
  // 2: the release RetroArr grabbed for a request (from its webhooks)
  `
  ALTER TABLE requests ADD COLUMN release TEXT;
  `,
  // 3: problems reported with a game that's ready to play, and what an admin did about them
  `
  CREATE TABLE issues (
    id INTEGER PRIMARY KEY,
    request_id INTEGER NOT NULL REFERENCES requests(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    kind TEXT NOT NULL,
    message TEXT,
    status TEXT NOT NULL,
    resolution TEXT,
    replacement_release TEXT,
    resolved_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    resolved_at TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE INDEX ix_issues_status ON issues(status, created_at);
  -- one unresolved report per request
  CREATE UNIQUE INDEX ux_issues_unresolved ON issues(request_id) WHERE status IN ('open', 'replacing');
  `,
  // 4: each user's Discover / Browse / search filters, as JSON
  `
  ALTER TABLE users ADD COLUMN filters TEXT;
  `,
  // 5: what drives recommendations: likes, "not interested", and each user's link to their RomM account
  `
  CREATE TABLE likes (
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    igdb_id INTEGER NOT NULL,
    title TEXT NOT NULL,
    created_at TEXT NOT NULL,
    PRIMARY KEY (user_id, igdb_id)
  );
  CREATE TABLE dismissed (
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    igdb_id INTEGER NOT NULL,
    created_at TEXT NOT NULL,
    PRIMARY KEY (user_id, igdb_id)
  );
  -- A RomM client token the user made (read scopes), to read their own play history
  CREATE TABLE romm_links (
    user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    token TEXT NOT NULL,
    romm_username TEXT NOT NULL,
    linked_at TEXT NOT NULL,
    last_error TEXT
  );
  `,
  // 6: collections: lists admins curate or import (a game on a platform per entry), series pinned to Discover,
  // and imports waiting for review
  `
  CREATE TABLE lists (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT,
    source TEXT,
    featured INTEGER NOT NULL DEFAULT 0,
    created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE TABLE list_items (
    list_id INTEGER NOT NULL REFERENCES lists(id) ON DELETE CASCADE,
    igdb_id INTEGER NOT NULL,
    platform_id INTEGER NOT NULL,
    title TEXT NOT NULL,
    year INTEGER,
    cover_url TEXT,
    position INTEGER NOT NULL,
    PRIMARY KEY (list_id, igdb_id, platform_id)
  );
  CREATE TABLE featured_series (
    franchise_id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
  CREATE TABLE imports (
    id INTEGER PRIMARY KEY,
    created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    list_id INTEGER REFERENCES lists(id) ON DELETE SET NULL,
    list_name TEXT NOT NULL,
    platform_id INTEGER NOT NULL,
    source TEXT NOT NULL,
    status TEXT NOT NULL,
    total INTEGER NOT NULL,
    done INTEGER NOT NULL DEFAULT 0,
    error TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE TABLE import_items (
    import_id INTEGER NOT NULL REFERENCES imports(id) ON DELETE CASCADE,
    idx INTEGER NOT NULL,
    raw TEXT NOT NULL,
    title TEXT NOT NULL,
    state TEXT NOT NULL,
    choice TEXT,
    candidates TEXT,
    skip INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (import_id, idx)
  );
  `,
  // 7: the timed jobs' history and intervals (Tasks page)
  `
  CREATE TABLE tasks (
    key TEXT PRIMARY KEY,
    interval_seconds INTEGER,
    last_started TEXT,
    last_finished TEXT,
    last_duration_ms INTEGER,
    last_outcome TEXT,
    last_message TEXT
  );
  `,
  // 8: the game in RomM, once RetroArr's RomM sync has seen it there ("Play in RomM" opens it)
  `
  ALTER TABLE requests ADD COLUMN romm_id INTEGER;
  `,
  // 9: what happened to each request, for its timeline
  `
  CREATE TABLE request_events (
    id INTEGER PRIMARY KEY,
    request_id INTEGER NOT NULL REFERENCES requests(id) ON DELETE CASCADE,
    at TEXT NOT NULL,
    kind TEXT NOT NULL,
    release TEXT,
    error TEXT,
    note TEXT,
    actor_id INTEGER REFERENCES users(id) ON DELETE SET NULL
  );
  CREATE INDEX request_events_request ON request_events(request_id, id);
  `,
  // 10: IGDB's answers, kept six hours (lists, game pages, series) when g-seekr asks IGDB itself
  `
  CREATE TABLE igdb_cache (
    key TEXT PRIMARY KEY,
    at INTEGER NOT NULL,
    value TEXT NOT NULL
  );
  CREATE INDEX igdb_cache_at ON igdb_cache(at);
  `,
  // 11: which version a request is for (a region, the English translation, the latest revision); one open request per
  // game, platform and version
  `
  ALTER TABLE requests ADD COLUMN region TEXT NOT NULL DEFAULT '';
  ALTER TABLE requests ADD COLUMN variant TEXT NOT NULL DEFAULT '';
  ALTER TABLE requests ADD COLUMN latest_revision INTEGER NOT NULL DEFAULT 0;
  DROP INDEX ux_requests_open;
  CREATE UNIQUE INDEX ux_requests_open ON requests(igdb_id, platform_id, region, variant)
    WHERE status IN ('pending', 'approved', 'searching', 'downloading', 'available');
  `,
  // 12: updates and DLC. A game request can ask for them too; an add-on request asks for them for a game the library
  // has. One open request of each kind per game, platform and version; an add-on request is done once it is in.
  `
  ALTER TABLE requests ADD COLUMN kind TEXT NOT NULL DEFAULT 'game';
  ALTER TABLE requests ADD COLUMN latest_update INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE requests ADD COLUMN all_dlc INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE requests ADD COLUMN dlc TEXT NOT NULL DEFAULT '[]';
  DROP INDEX ux_requests_open;
  CREATE UNIQUE INDEX ux_requests_open ON requests(igdb_id, platform_id, region, variant)
    WHERE kind = 'game' AND status IN ('pending', 'approved', 'searching', 'downloading', 'available');
  CREATE UNIQUE INDEX ux_requests_addons_open ON requests(igdb_id, platform_id, region, variant)
    WHERE kind = 'addons' AND status IN ('pending', 'approved', 'searching', 'downloading');
  `,
  // 13: ROM hacks: a request of kind 'hack' names the hack in variant ('hack:<id>'); one open request per hack
  `
  CREATE UNIQUE INDEX ux_requests_hack_open ON requests(variant)
    WHERE kind = 'hack' AND status IN ('pending', 'approved', 'searching', 'downloading');
  `,
];

export function openDb(path: string): Db {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
  migrate(db);
  return db;
}

export function migrate(db: Db): void {
  const row = db.prepare('PRAGMA user_version').get() as { user_version: number };
  for (let v = row.user_version; v < MIGRATIONS.length; v++) {
    db.exec('BEGIN');
    try {
      db.exec(MIGRATIONS[v]!);
      db.exec(`PRAGMA user_version = ${v + 1}`);
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
  }
}
