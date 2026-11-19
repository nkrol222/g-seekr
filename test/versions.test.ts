import { describe, expect, it } from 'vitest';
import { openDb } from '../server/src/db.js';
import { entryMatches, parseVersion, versionLabel } from '../server/src/versions.js';

describe('versions', () => {
  it('reads a version from a request body', () => {
    expect(parseVersion(undefined)).toEqual({ region: '', variant: '', latestRevision: false });
    expect(parseVersion({ region: ' europe ', variant: 'en-translation', latestRevision: true })).toEqual({ region: 'Europe', variant: 'en-translation', latestRevision: true });
    expect(parseVersion({ region: 'Atlantis' })).toMatch(/Unknown region/);
    expect(parseVersion({ variant: 'hack' })).toBe('Unknown version.');
  });

  it('labels a version', () => {
    expect(versionLabel({ region: '', variant: '' })).toBe('');
    expect(versionLabel({ region: 'Japan', variant: 'en-translation', latestRevision: true })).toBe('Japan · English translation · latest revision');
  });

  it('matches library entries by variant, then region', () => {
    const any = { region: '', variant: '' as const };
    expect(entryMatches(any, { region: 'Japan', variant: '' })).toBe(true);
    expect(entryMatches(any, { region: 'Japan', variant: 'en-translation' })).toBe(false);
    expect(entryMatches({ region: 'Europe', variant: '' }, { region: 'USA, Europe' })).toBe(true);
    expect(entryMatches({ region: 'USA', variant: '' }, { region: 'US' })).toBe(true);
    expect(entryMatches({ region: 'Japan', variant: '' }, { region: null })).toBe(false);
  });

  it('allows one open request per version', () => {
    const db = openDb(':memory:');
    const insert = db.prepare(
      "INSERT INTO requests (user_id, igdb_id, platform_id, title, platform_name, status, created_at, updated_at, region, variant) VALUES (1, 1020, 41, 't', 'p', 'pending', 'x', 'x', ?, ?)",
    );
    db.prepare("INSERT INTO users (id, jellyfin_id, username, is_admin, created_at) VALUES (1, 'j', 'u', 0, 'x')").run();
    insert.run('', '');
    insert.run('Japan', '');
    insert.run('Japan', 'en-translation');
    expect(() => insert.run('Japan', '')).toThrow(/UNIQUE/);
  });
});
