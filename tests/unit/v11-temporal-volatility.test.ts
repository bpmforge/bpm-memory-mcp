import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { randomUUID } from 'crypto';
import { MIGRATIONS, CURRENT_VERSION } from '../../mcp/memory-server/src/storage/schema.js';
import { runMigrations, rollbackTo } from '../../mcp/memory-server/src/storage/migrations.js';
import type { DatabaseConnection } from '../../mcp/memory-server/src/storage/database.js';

// ============================================================================
// Test Setup
// ============================================================================

function createTestDb(): DatabaseConnection {
  const db = new Database(':memory:');
  const conn: DatabaseConnection = {
    instance: db,
    transaction: <T>(fn: () => T) => db.transaction(fn)(),
    exec: (sql: string) => db.exec(sql),
    prepare: (sql: string) => db.prepare(sql),
    close: () => db.close(),
  };
  return conn;
}

const PROJECT_ID = 'test-project';

function insertMemory(db: DatabaseConnection, overrides: Partial<{ id: string }> = {}): string {
  const id = overrides.id ?? randomUUID();
  const now = Math.floor(Date.now() / 1000);
  db.instance
    .prepare(
      `INSERT INTO memories (id, content, type, project_id, content_hash, created_at, accessed_at)
       VALUES (?, 'test content', 'fact', ?, ?, ?, ?)`
    )
    .run(id, PROJECT_ID, `hash-${id}`, now, now);
  return id;
}

// ============================================================================
// V11 — temporal validity + volatility-scaled staleness on memories
// ============================================================================

describe('V11 migration — memories temporal + volatility fields', () => {
  let db: DatabaseConnection;

  beforeEach(() => {
    db = createTestDb();
  });

  afterEach(() => {
    db.close();
  });

  it('CURRENT_VERSION is 11', () => {
    expect(CURRENT_VERSION).toBe(11);
  });

  it('applies cleanly on top of a fresh V10 database via runMigrations', () => {
    expect(() => runMigrations(db)).not.toThrow();
    const version = db.instance
      .prepare('SELECT MAX(version) as version FROM schema_version')
      .get() as { version: number };
    expect(version.version).toBe(11);
  });

  it('new rows default volatility to "slow"', () => {
    runMigrations(db);
    const id = insertMemory(db);
    const row = db.instance.prepare('SELECT volatility FROM memories WHERE id = ?').get(id) as {
      volatility: string;
    };
    expect(row.volatility).toBe('slow');
  });

  it('backfills valid_from from created_at for pre-existing rows on migration', () => {
    // Apply only V1..V10, insert a row, THEN run V11 — simulates an existing DB upgrading.
    for (const migration of MIGRATIONS) {
      if (migration.version <= 10) db.instance.exec(migration.up);
    }
    db.instance.exec(
      `INSERT OR REPLACE INTO schema_version (version, applied_at) VALUES (10, ${Date.now()})`
    );
    const id = insertMemory(db);

    runMigrations(db);

    const row = db.instance
      .prepare('SELECT created_at, valid_from, valid_to, verified_at FROM memories WHERE id = ?')
      .get(id) as {
      created_at: number;
      valid_from: number;
      valid_to: number | null;
      verified_at: number | null;
    };
    expect(row.valid_from).toBe(row.created_at);
    expect(row.valid_to).toBeNull();
    expect(row.verified_at).toBeNull(); // never verified — not backfilled to a fake timestamp
  });

  it('rejects a volatility value outside static|slow|volatile', () => {
    runMigrations(db);
    const id = randomUUID();
    const now = Math.floor(Date.now() / 1000);
    expect(() =>
      db.instance
        .prepare(
          `INSERT INTO memories (id, content, type, project_id, content_hash, created_at, accessed_at, volatility)
           VALUES (?, 'x', 'fact', ?, 'h', ?, ?, 'nonsense')`
        )
        .run(id, PROJECT_ID, now, now)
    ).toThrow();
  });

  it('accepts each of static, slow, volatile', () => {
    runMigrations(db);
    for (const v of ['static', 'slow', 'volatile']) {
      const id = randomUUID();
      const now = Math.floor(Date.now() / 1000);
      expect(() =>
        db.instance
          .prepare(
            `INSERT INTO memories (id, content, type, project_id, content_hash, created_at, accessed_at, volatility)
             VALUES (?, 'x', 'fact', ?, ?, ?, ?, ?)`
          )
          .run(id, PROJECT_ID, `h-${id}`, now, now, v)
      ).not.toThrow();
    }
  });

  it('down-migration drops the new indexes without error (columns stay — SQLite limitation)', () => {
    runMigrations(db);
    insertMemory(db);
    expect(() => rollbackTo(db, 10)).not.toThrow();
    const indexes = db.instance
      .prepare("SELECT name FROM sqlite_master WHERE type='index' AND name LIKE 'idx_memories_%'")
      .all() as { name: string }[];
    expect(indexes.some((i) => i.name === 'idx_memories_temporal')).toBe(false);
    expect(indexes.some((i) => i.name === 'idx_memories_volatility')).toBe(false);
  });
});
