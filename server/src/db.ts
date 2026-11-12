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
