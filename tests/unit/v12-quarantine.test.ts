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
// V12 — quarantine scope + promotion (T11.3)
// ============================================================================

describe('V12 migration — quarantine + promotion fields', () => {
  let db: DatabaseConnection;

  beforeEach(() => {
    db = createTestDb();
  });

  afterEach(() => {
    db.close();
  });

  it('CURRENT_VERSION is 12', () => {
    expect(CURRENT_VERSION).toBe(12);
  });

  it('applies cleanly on top of a fresh V11 database', () => {
    for (const migration of MIGRATIONS) {
      if (migration.version <= 11) db.instance.exec(migration.up);
    }
    db.instance.exec(
      `INSERT OR REPLACE INTO schema_version (version, applied_at) VALUES (11, ${Date.now()})`
    );

    expect(() => runMigrations(db)).not.toThrow();
    const version = db.instance
      .prepare('SELECT MAX(version) as version FROM schema_version')
      .get() as { version: number };
    expect(version.version).toBe(12);
  });

  it('new rows default to un-quarantined (quarantined_at NULL)', () => {
    runMigrations(db);
    const id = insertMemory(db);
    const row = db.instance
      .prepare('SELECT quarantined_at, promoted_at, promotion_reason FROM memories WHERE id = ?')
      .get(id) as {
      quarantined_at: number | null;
      promoted_at: number | null;
      promotion_reason: string | null;
    };
    expect(row.quarantined_at).toBeNull();
    expect(row.promoted_at).toBeNull();
    expect(row.promotion_reason).toBeNull();
  });

  it('rejects a promotion_reason value outside corroboration|human_touch', () => {
    runMigrations(db);
    const id = randomUUID();
    const now = Math.floor(Date.now() / 1000);
    expect(() =>
      db.instance
        .prepare(
          `INSERT INTO memories (id, content, type, project_id, content_hash, created_at, accessed_at, promotion_reason)
           VALUES (?, 'x', 'fact', ?, 'h', ?, ?, 'nonsense')`
        )
        .run(id, PROJECT_ID, now, now)
    ).toThrow();
  });

  it('accepts each of corroboration, human_touch, and NULL for promotion_reason', () => {
    runMigrations(db);
    for (const reason of ['corroboration', 'human_touch', null]) {
      const id = randomUUID();
      const now = Math.floor(Date.now() / 1000);
      expect(() =>
        db.instance
          .prepare(
            `INSERT INTO memories (id, content, type, project_id, content_hash, created_at, accessed_at, promotion_reason)
             VALUES (?, 'x', 'fact', ?, ?, ?, ?, ?)`
          )
          .run(id, PROJECT_ID, `h-${id}`, now, now, reason)
      ).not.toThrow();
    }
  });

  it('down-migration drops the new index without error (columns stay — SQLite limitation)', () => {
    runMigrations(db);
    insertMemory(db);
    expect(() => rollbackTo(db, 11)).not.toThrow();
    const indexes = db.instance
      .prepare("SELECT name FROM sqlite_master WHERE type='index' AND name LIKE 'idx_memories_%'")
      .all() as { name: string }[];
    expect(indexes.some((i) => i.name === 'idx_memories_quarantine')).toBe(false);
  });
});
