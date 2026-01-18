import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { existsSync, unlinkSync, mkdirSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

// Test utilities - create in-memory or temp databases
function createTestDb(): Database.Database {
  return new Database(':memory:');
}

function createTempDbPath(): string {
  const testDir = join(tmpdir(), 'claude-memory-test');
  if (!existsSync(testDir)) {
    mkdirSync(testDir, { recursive: true });
  }
  return join(testDir, `test-${Date.now()}.db`);
}

describe('Database Connection', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = createTestDb();
  });

  afterEach(() => {
    if (db?.open) {
      db.close();
    }
  });

  it('should create an in-memory database', () => {
    expect(db.open).toBe(true);
  });

  it('should support WAL mode', () => {
    // In-memory databases don't support WAL, but file-based do
    const tempPath = createTempDbPath();
    const fileDb = new Database(tempPath);

    fileDb.pragma('journal_mode = WAL');
    const result = fileDb.pragma('journal_mode') as Array<{ journal_mode: string }>;

    expect(result[0]?.journal_mode).toBe('wal');

    fileDb.close();
    // Clean up WAL files
    if (existsSync(tempPath)) unlinkSync(tempPath);
    if (existsSync(`${tempPath}-wal`)) unlinkSync(`${tempPath}-wal`);
    if (existsSync(`${tempPath}-shm`)) unlinkSync(`${tempPath}-shm`);
  });

  it('should execute queries', () => {
    db.exec('CREATE TABLE test (id INTEGER PRIMARY KEY, value TEXT)');
    db.prepare('INSERT INTO test (value) VALUES (?)').run('hello');

    const row = db.prepare('SELECT * FROM test WHERE id = 1').get() as { id: number; value: string };

    expect(row.id).toBe(1);
    expect(row.value).toBe('hello');
  });

  it('should support transactions', () => {
    db.exec('CREATE TABLE test (id INTEGER PRIMARY KEY, value TEXT)');

    const insertMany = db.transaction((items: string[]) => {
      const stmt = db.prepare('INSERT INTO test (value) VALUES (?)');
      for (const item of items) {
        stmt.run(item);
      }
    });

    insertMany(['a', 'b', 'c']);

    const count = db.prepare('SELECT COUNT(*) as count FROM test').get() as { count: number };
    expect(count.count).toBe(3);
  });

  it('should rollback on transaction error', () => {
    db.exec('CREATE TABLE test (id INTEGER PRIMARY KEY, value TEXT UNIQUE)');

    const insertWithDupe = db.transaction(() => {
      db.prepare('INSERT INTO test (value) VALUES (?)').run('first');
      db.prepare('INSERT INTO test (value) VALUES (?)').run('first'); // Dupe - will fail
    });

    expect(() => insertWithDupe()).toThrow();

    const count = db.prepare('SELECT COUNT(*) as count FROM test').get() as { count: number };
    expect(count.count).toBe(0); // Transaction rolled back
  });

  it('should handle concurrent reads', () => {
    db.exec('CREATE TABLE test (id INTEGER PRIMARY KEY, value INTEGER)');
    db.prepare('INSERT INTO test (value) VALUES (?)').run(42);

    // Simulate concurrent reads
    const results: number[] = [];
    for (let i = 0; i < 100; i++) {
      const row = db.prepare('SELECT value FROM test WHERE id = 1').get() as { value: number };
      results.push(row.value);
    }

    expect(results.every((v) => v === 42)).toBe(true);
  });
});

describe('Schema Creation', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = createTestDb();
  });

  afterEach(() => {
    if (db?.open) {
      db.close();
    }
  });

  it('should create memories table', () => {
    db.exec(`
      CREATE TABLE memories (
        id TEXT PRIMARY KEY,
        content TEXT NOT NULL,
        embedding BLOB,
        type TEXT NOT NULL CHECK (type IN ('fact', 'pattern', 'decision', 'error', 'preference')),
        confidence REAL NOT NULL DEFAULT 1.0,
        citation TEXT,
        project_id TEXT NOT NULL,
        content_hash TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        accessed_at INTEGER NOT NULL,
        access_count INTEGER NOT NULL DEFAULT 0,
        deleted_at INTEGER,
        deleted_reason TEXT
      )
    `);

    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='memories'")
      .get();

    expect(tables).toBeDefined();
  });

  it('should enforce type constraint', () => {
    db.exec(`
      CREATE TABLE memories (
        id TEXT PRIMARY KEY,
        content TEXT NOT NULL,
        type TEXT NOT NULL CHECK (type IN ('fact', 'pattern', 'decision', 'error', 'preference')),
        project_id TEXT NOT NULL,
        content_hash TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        accessed_at INTEGER NOT NULL
      )
    `);

    const stmt = db.prepare(
      `INSERT INTO memories (id, content, type, project_id, content_hash, created_at, accessed_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    );

    // Valid type should work
    expect(() => stmt.run('1', 'test', 'fact', 'proj', 'hash', 123, 123)).not.toThrow();

    // Invalid type should fail
    expect(() => stmt.run('2', 'test', 'invalid', 'proj', 'hash', 123, 123)).toThrow();
  });

  it('should enforce confidence constraint', () => {
    db.exec(`
      CREATE TABLE memories (
        id TEXT PRIMARY KEY,
        confidence REAL NOT NULL CHECK (confidence >= 0.0 AND confidence <= 1.0)
      )
    `);

    const stmt = db.prepare('INSERT INTO memories (id, confidence) VALUES (?, ?)');

    // Valid confidence should work
    expect(() => stmt.run('1', 0.5)).not.toThrow();
    expect(() => stmt.run('2', 0.0)).not.toThrow();
    expect(() => stmt.run('3', 1.0)).not.toThrow();

    // Invalid confidence should fail
    expect(() => stmt.run('4', -0.1)).toThrow();
    expect(() => stmt.run('5', 1.1)).toThrow();
  });

  it('should create FTS5 virtual table', () => {
    db.exec(`
      CREATE TABLE memories (
        id TEXT PRIMARY KEY,
        content TEXT NOT NULL
      )
    `);

    db.exec(`
      CREATE VIRTUAL TABLE memories_fts USING fts5(
        content,
        content='memories',
        content_rowid='rowid'
      )
    `);

    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='memories_fts'")
      .get();

    expect(tables).toBeDefined();
  });

  it('should support BLOB storage for embeddings', () => {
    db.exec(`
      CREATE TABLE memories (
        id TEXT PRIMARY KEY,
        embedding BLOB
      )
    `);

    // Create a test embedding
    const embedding = new Float32Array([0.1, 0.2, 0.3, 0.4]);
    const buffer = Buffer.from(embedding.buffer);

    db.prepare('INSERT INTO memories (id, embedding) VALUES (?, ?)').run('1', buffer);

    const row = db.prepare('SELECT embedding FROM memories WHERE id = ?').get('1') as {
      embedding: Buffer;
    };

    const retrieved = new Float32Array(row.embedding.buffer);

    expect(retrieved.length).toBe(4);
    expect(retrieved[0]).toBeCloseTo(0.1, 5);
    expect(retrieved[3]).toBeCloseTo(0.4, 5);
  });
});

describe('Index Performance', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = createTestDb();
    db.exec(`
      CREATE TABLE memories (
        id TEXT PRIMARY KEY,
        content TEXT NOT NULL,
        project_id TEXT NOT NULL,
        type TEXT NOT NULL,
        accessed_at INTEGER NOT NULL,
        deleted_at INTEGER
      )
    `);
  });

  afterEach(() => {
    if (db?.open) {
      db.close();
    }
  });

  it('should use project_id index', () => {
    db.exec('CREATE INDEX idx_memories_project ON memories(project_id)');

    // Insert test data
    const stmt = db.prepare(
      'INSERT INTO memories (id, content, project_id, type, accessed_at) VALUES (?, ?, ?, ?, ?)'
    );
    for (let i = 0; i < 100; i++) {
      stmt.run(`id-${i}`, `content-${i}`, i % 10 === 0 ? 'project-a' : 'project-b', 'fact', i);
    }

    // Query plan should use index
    const plan = db.prepare('EXPLAIN QUERY PLAN SELECT * FROM memories WHERE project_id = ?').all('project-a');

    // The plan should mention the index
    const planText = JSON.stringify(plan);
    expect(planText.includes('idx_memories_project') || planText.includes('SEARCH')).toBe(true);
  });
});
