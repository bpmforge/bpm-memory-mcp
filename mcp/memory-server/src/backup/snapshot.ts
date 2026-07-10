import Database from 'better-sqlite3';
import { existsSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

/**
 * RC-2: raw-file DB snapshots, complementing `memory-cli export` (which only
 * dumps one project's rows to JSON — no indexes/FTS/embeddings, and no way to
 * restore in one step). A snapshot is a full `db.backup()` copy of every
 * project's memory.db, independent of whatever external process (e.g. jarvis's
 * nightly sqlite-backup.service.ts) may also be backing this directory up —
 * useful standalone for quarterly restore drills or a pre-migration safety net.
 */

export interface SnapshotFileResult {
  projectId: string;
  bytes: number;
  ok: boolean;
  verified?: boolean;
  error?: string;
}

export interface SnapshotResult {
  memoryRoot: string;
  destDir: string;
  files: SnapshotFileResult[];
  totalBytes: number;
}

/** Resolves the claude-memory root: explicit override wins, else homedir()/.claude-memory. */
export function resolveMemoryRoot(override?: string): string {
  return resolve(override || join(homedir(), '.claude-memory'));
}

/** List every project under memoryRoot that has a memory.db file. */
export function listProjectDbs(memoryRoot: string): Array<{ projectId: string; dbPath: string }> {
  if (!existsSync(memoryRoot)) return [];
  const out: Array<{ projectId: string; dbPath: string }> = [];
  for (const entry of readdirSync(memoryRoot, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const dbPath = join(memoryRoot, entry.name, 'memory.db');
    if (existsSync(dbPath)) {
      out.push({ projectId: entry.name, dbPath });
    }
  }
  return out;
}

/**
 * Verify a snapshot file is structurally sound via PRAGMA integrity_check.
 * A snapshot no one has verified is not a backup, it's a hope.
 */
export function verifySnapshot(destPath: string): { ok: boolean; error?: string } {
  let db: Database.Database | null = null;
  try {
    db = new Database(destPath, { readonly: true });
    const row = db.prepare('PRAGMA integrity_check').get() as
      { integrity_check: string } | undefined;
    const result = row?.integrity_check ?? '<no result>';
    if (result === 'ok') return { ok: true };
    return { ok: false, error: `integrity_check returned: ${result.slice(0, 200)}` };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  } finally {
    db?.close();
  }
}

/**
 * Snapshot every project's memory.db from memoryRoot into
 * `<destDir>/<projectId>/memory.db`, via SQLite's online BACKUP API
 * (non-locking — safe to run against live DBs) with integrity verification.
 */
export async function runSnapshot(memoryRoot: string, destDir: string): Promise<SnapshotResult> {
  mkdirSync(destDir, { recursive: true });
  const result: SnapshotResult = { memoryRoot, destDir, files: [], totalBytes: 0 };

  for (const { projectId, dbPath } of listProjectDbs(memoryRoot)) {
    const destProjectDir = join(destDir, projectId);
    mkdirSync(destProjectDir, { recursive: true });
    const dest = join(destProjectDir, 'memory.db');

    let src: Database.Database | null = null;
    try {
      src = new Database(dbPath, { readonly: true });
      await src.backup(dest);
      const bytes = statSync(dest).size;

      const verification = verifySnapshot(dest);
      if (verification.ok) {
        result.files.push({ projectId, bytes, ok: true, verified: true });
        result.totalBytes += bytes;
      } else {
        result.files.push({
          projectId,
          bytes,
          ok: false,
          verified: false,
          error: `integrity check failed: ${verification.error}`,
        });
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      result.files.push({ projectId, bytes: 0, ok: false, error: msg });
    } finally {
      src?.close();
    }
  }

  return result;
}
