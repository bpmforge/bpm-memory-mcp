import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import {
  resolveMemoryRoot,
  listProjectDbs,
  verifySnapshot,
  runSnapshot,
} from '../../mcp/memory-server/src/backup/snapshot.js';

// RC-2: bpm-memory-mcp previously had no backup logic of its own — only a
// manual `cli export` that dumps one project's rows to JSON, dropping
// indexes/FTS/embeddings and any restore path. These tests cover the new
// raw-file snapshot (full db.backup() copy + PRAGMA integrity_check).

describe('resolveMemoryRoot', () => {
  it('defaults to homedir()/.claude-memory when no override is given', () => {
    const root = resolveMemoryRoot();
    expect(root.endsWith('.claude-memory')).toBe(true);
  });

  it('honors an explicit override', () => {
    expect(resolveMemoryRoot('/custom/memory/root')).toBe(resolve('/custom/memory/root'));
  });
});

describe('listProjectDbs', () => {
  let tmp: string;
  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'snapshot-list-test-'));
  });
  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  it('returns empty when the memory root does not exist', () => {
    expect(listProjectDbs(join(tmp, 'nope'))).toEqual([]);
  });

  it('finds memory.db under each project subdirectory', () => {
    mkdirSync(join(tmp, 'project-A'), { recursive: true });
    mkdirSync(join(tmp, 'project-B'), { recursive: true });
    writeFileSync(join(tmp, 'project-A', 'memory.db'), 'fake');
    writeFileSync(join(tmp, 'project-B', 'memory.db'), 'fake');

    const found = listProjectDbs(tmp);
    expect(found).toEqual(
      expect.arrayContaining([
        { projectId: 'project-A', dbPath: join(tmp, 'project-A', 'memory.db') },
        { projectId: 'project-B', dbPath: join(tmp, 'project-B', 'memory.db') },
      ])
    );
    expect(found.length).toBe(2);
  });

  it('skips subdirs without a memory.db', () => {
    mkdirSync(join(tmp, 'no-db-here'), { recursive: true });
    expect(listProjectDbs(tmp)).toEqual([]);
  });

  it('skips files at the memory root (only walks subdirs)', () => {
    writeFileSync(join(tmp, 'orphan.db'), 'fake');
    expect(listProjectDbs(tmp)).toEqual([]);
  });
});

describe('verifySnapshot', () => {
  let tmp: string;
  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'snapshot-verify-test-'));
  });
  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  it('returns ok for a clean SQLite file', () => {
    const dbPath = join(tmp, 'good.db');
    const db = new Database(dbPath);
    db.exec("CREATE TABLE t (id INTEGER PRIMARY KEY, val TEXT); INSERT INTO t (val) VALUES ('hi')");
    db.close();

    expect(verifySnapshot(dbPath).ok).toBe(true);
  });

  it('returns not-ok for a non-SQLite file (corrupt header)', () => {
    const fakePath = join(tmp, 'fake.db');
    writeFileSync(fakePath, 'not a real SQLite file');
    const result = verifySnapshot(fakePath);
    expect(result.ok).toBe(false);
    expect(result.error).toBeTruthy();
  });

  it('returns not-ok when the file does not exist', () => {
    const result = verifySnapshot(join(tmp, 'missing.db'));
    expect(result.ok).toBe(false);
  });
});

describe('runSnapshot', () => {
  let tmp: string;
  let memoryRoot: string;
  let destDir: string;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'snapshot-run-test-'));
    memoryRoot = join(tmp, 'claude-memory');
    destDir = join(tmp, 'snapshot-out');
    mkdirSync(join(memoryRoot, 'proj-1'), { recursive: true });
    mkdirSync(join(memoryRoot, 'proj-2'), { recursive: true });

    const db1 = new Database(join(memoryRoot, 'proj-1', 'memory.db'));
    db1.exec(
      "CREATE TABLE memories (id INTEGER PRIMARY KEY, content TEXT); INSERT INTO memories (content) VALUES ('canary-1')"
    );
    db1.close();

    const db2 = new Database(join(memoryRoot, 'proj-2', 'memory.db'));
    db2.exec(
      "CREATE TABLE memories (id INTEGER PRIMARY KEY, content TEXT); INSERT INTO memories (content) VALUES ('canary-2')"
    );
    db2.close();
  });
  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  it('returns empty result when the memory root has no projects', async () => {
    const emptyRoot = join(tmp, 'empty');
    const result = await runSnapshot(emptyRoot, destDir);
    expect(result.files).toEqual([]);
    expect(result.totalBytes).toBe(0);
  });

  it('snapshots every project DB, verified, with real bytes', async () => {
    const result = await runSnapshot(memoryRoot, destDir);

    expect(result.files.length).toBe(2);
    for (const f of result.files) {
      expect(f.ok, `project ${f.projectId} failed: ${f.error}`).toBe(true);
      expect(f.verified).toBe(true);
      expect(f.bytes).toBeGreaterThan(0);
    }
    expect(result.totalBytes).toBeGreaterThan(0);
  });

  it('lands snapshot files at <destDir>/<projectId>/memory.db', async () => {
    await runSnapshot(memoryRoot, destDir);
    expect(existsSync(join(destDir, 'proj-1', 'memory.db'))).toBe(true);
    expect(existsSync(join(destDir, 'proj-2', 'memory.db'))).toBe(true);
  });

  it('round-trips actual row content through the snapshot (restore-drill proof)', async () => {
    await runSnapshot(memoryRoot, destDir);

    const restored1 = new Database(join(destDir, 'proj-1', 'memory.db'), { readonly: true });
    const row1 = restored1.prepare('SELECT content FROM memories').get() as { content: string };
    restored1.close();
    expect(row1.content).toBe('canary-1');

    const restored2 = new Database(join(destDir, 'proj-2', 'memory.db'), { readonly: true });
    const row2 = restored2.prepare('SELECT content FROM memories').get() as { content: string };
    restored2.close();
    expect(row2.content).toBe('canary-2');
  });

  it('does not touch the source DBs (read-only, non-destructive)', async () => {
    const before = readdirSync(join(memoryRoot, 'proj-1'));
    await runSnapshot(memoryRoot, destDir);
    const after = readdirSync(join(memoryRoot, 'proj-1'));
    expect(after).toEqual(before);

    const src = new Database(join(memoryRoot, 'proj-1', 'memory.db'), { readonly: true });
    const row = src.prepare('SELECT content FROM memories').get() as { content: string };
    src.close();
    expect(row.content).toBe('canary-1');
  });

  it('records a failed project without aborting the rest of the run', async () => {
    // Corrupt proj-2's DB so its backup fails integrity_check, proj-1 must still succeed.
    writeFileSync(join(memoryRoot, 'proj-2', 'memory.db'), 'not a real sqlite file');

    const result = await runSnapshot(memoryRoot, destDir);
    const proj1 = result.files.find((f) => f.projectId === 'proj-1');
    const proj2 = result.files.find((f) => f.projectId === 'proj-2');

    expect(proj1?.ok).toBe(true);
    expect(proj2?.ok).toBe(false);
  });
});
