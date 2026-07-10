import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { ConsolidationScheduler } from '../../mcp/memory-server/src/consolidation/scheduler.js';
import { MemoryRepository } from '../../mcp/memory-server/src/storage/repository.js';
import { MIGRATIONS } from '../../mcp/memory-server/src/storage/schema.js';

function createTestDb(): {
  instance: Database.Database;
  close: () => void;
  transaction: <T>(fn: () => T) => T;
} {
  const db = new Database(':memory:');
  for (const migration of MIGRATIONS) db.exec(migration.up);
  return {
    instance: db,
    close: () => db.close(),
    transaction: <T>(fn: () => T): T => db.transaction(fn)(),
  };
}

const vec = (arr: number[]): Float32Array => Float32Array.from(arr);
const HOUR = 60 * 60 * 1000;

describe('ConsolidationScheduler', () => {
  let db: { instance: Database.Database; close: () => void; transaction: <T>(fn: () => T) => T };
  let repo: MemoryRepository;
  const PROJECT = 'nursery-tracker';

  // Every test's default logPath is redirected into a per-test scratch dir —
  // without this, tests that don't care about logging would silently write
  // into the real operator default (~/.claude-memory/logs).
  let scratchDir: string;
  let scratchLogPath: string;

  beforeEach(() => {
    db = createTestDb();
    repo = new MemoryRepository(db as any);
    scratchDir = mkdtempSync(join(tmpdir(), 'consolidation-scheduler-'));
    scratchLogPath = join(scratchDir, 'consolidation.log');
  });
  afterEach(() => {
    db.close();
    rmSync(scratchDir, { recursive: true, force: true });
  });

  const enabled = (overrides = {}) =>
    new ConsolidationScheduler(db.instance, {
      enabled: true,
      intervalMs: 24 * HOUR,
      options: { persistSummaries: true },
      logPath: scratchLogPath,
      ...overrides,
    });

  const seedCluster = () => {
    for (const tag of ['alpha', 'beta', 'gamma']) {
      repo.createMemory(
        { content: `seedling nursery tracker ${tag}`, type: 'pattern' as any, projectId: PROJECT },
        vec([1, 0])
      );
    }
  };

  const lastRunRow = (): any =>
    db.instance.prepare('SELECT * FROM consolidation_runs WHERE project_id = ?').get(PROJECT);

  it('does nothing when disabled', async () => {
    const scheduler = new ConsolidationScheduler(db.instance, {
      enabled: false,
      intervalMs: HOUR,
      options: {},
    });
    const outcome = await scheduler.maybeRun(PROJECT);
    expect(outcome).toEqual({ ran: false, reason: 'disabled' });
    expect(lastRunRow()).toBeUndefined(); // no state written
  });

  it('runs on first invocation and records the run', async () => {
    seedCluster();
    const outcome = await enabled().maybeRun(PROJECT);
    expect(outcome.ran).toBe(true);
    expect(outcome.reason).toBe('ok');
    expect(outcome.summariesPersisted).toBe(1); // episodic→semantic happened
    const row = lastRunRow();
    expect(row).toBeDefined();
    expect(row.last_run_at).toBeGreaterThan(0);
    expect(row.last_summary_count).toBe(1);
  });

  it('throttles a second run within the interval', async () => {
    seedCluster();
    const scheduler = enabled();
    const first = await scheduler.maybeRun(PROJECT);
    const second = await scheduler.maybeRun(PROJECT);
    expect(first.ran).toBe(true);
    expect(second).toEqual({ ran: false, reason: 'throttled' });
  });

  it('runs again once the interval has elapsed', async () => {
    seedCluster();
    const scheduler = enabled({ intervalMs: HOUR });
    await scheduler.maybeRun(PROJECT);
    // Backdate the recorded run beyond the interval.
    db.instance
      .prepare('UPDATE consolidation_runs SET last_run_at = ? WHERE project_id = ?')
      .run(Date.now() - 2 * HOUR, PROJECT);
    const again = await scheduler.maybeRun(PROJECT);
    expect(again.ran).toBe(true);
  });

  it('runs cleanly on an empty project (no throw, zero work)', async () => {
    const outcome = await enabled().maybeRun(PROJECT);
    expect(outcome.ran).toBe(true);
    expect(outcome.summariesPersisted).toBe(0);
    expect(outcome.merged).toBe(0);
  });

  describe('fromEnv', () => {
    const KEY = 'CLAUDE_MEMORY_SLEEP_CONSOLIDATION';
    const HOURS = 'CLAUDE_MEMORY_CONSOLIDATION_INTERVAL_HOURS';
    const LOG_PATH_KEY = 'CLAUDE_MEMORY_CONSOLIDATION_LOG_PATH';
    let fromEnvLogDir: string;
    afterEach(() => {
      delete process.env[KEY];
      delete process.env[HOURS];
      delete process.env[LOG_PATH_KEY];
      if (fromEnvLogDir) rmSync(fromEnvLogDir, { recursive: true, force: true });
    });

    it('is disabled unless the flag is exactly "true"', async () => {
      const outcome = await ConsolidationScheduler.fromEnv(db.instance).maybeRun(PROJECT);
      expect(outcome.reason).toBe('disabled');
    });

    it('enables when the flag is set, honors a custom interval, and respects a log path override', async () => {
      // Redirect off the real default (~/.claude-memory/logs) so this test can't
      // write into the operator's real home directory.
      fromEnvLogDir = mkdtempSync(join(tmpdir(), 'consolidation-fromenv-'));
      process.env[LOG_PATH_KEY] = join(fromEnvLogDir, 'consolidation.log');
      process.env[KEY] = 'true';
      process.env[HOURS] = '1';
      seedCluster();
      const scheduler = ConsolidationScheduler.fromEnv(db.instance);
      const first = await scheduler.maybeRun(PROJECT);
      expect(first.ran).toBe(true);
      // Within 1h → throttled.
      const second = await scheduler.maybeRun(PROJECT);
      expect(second.reason).toBe('throttled');

      const lines = readFileSync(process.env[LOG_PATH_KEY]!, 'utf8').trim().split('\n');
      expect(lines).toHaveLength(1); // only the real run logs, not the throttle
    });
  });

  describe('run log (T2.1)', () => {
    let dir: string;
    afterEach(() => {
      if (dir) rmSync(dir, { recursive: true, force: true });
    });

    const readLines = (logPath: string): any[] =>
      existsSync(logPath)
        ? readFileSync(logPath, 'utf8')
            .trim()
            .split('\n')
            .filter(Boolean)
            .map((l) => JSON.parse(l))
        : [];

    it('appends a summary line for a real run, not for throttled/disabled calls', async () => {
      dir = mkdtempSync(join(tmpdir(), 'consolidation-scheduler-'));
      const logPath = join(dir, 'consolidation.log');
      seedCluster();
      const scheduler = enabled({ logPath });

      await scheduler.maybeRun(PROJECT); // ran
      await scheduler.maybeRun(PROJECT); // throttled — no line

      const lines = readLines(logPath);
      expect(lines).toHaveLength(1);
      expect(lines[0]).toMatchObject({ projectId: PROJECT, ran: true, reason: 'ok' });
    });

    it('does not write a log line while disabled', async () => {
      dir = mkdtempSync(join(tmpdir(), 'consolidation-scheduler-'));
      const logPath = join(dir, 'consolidation.log');
      const scheduler = new ConsolidationScheduler(db.instance, {
        enabled: false,
        intervalMs: HOUR,
        options: {},
        logPath,
      });
      await scheduler.maybeRun(PROJECT);
      expect(existsSync(logPath)).toBe(false);
    });

    // Simulates the acceptance bar ("3 consecutive daily logged runs") deterministically —
    // real wall-clock days aren't achievable in a test, so this backdates last_run_at by
    // >24h between each call, exactly like the "runs again once interval elapsed" test above.
    it('logs 3 consecutive daily-throttled runs as 3 distinct lines', async () => {
      dir = mkdtempSync(join(tmpdir(), 'consolidation-scheduler-'));
      const logPath = join(dir, 'consolidation.log');
      const DAY = 24 * HOUR;
      seedCluster();
      const scheduler = enabled({ intervalMs: DAY, logPath });

      const outcomes = [];
      for (let day = 0; day < 3; day++) {
        if (day > 0) {
          db.instance
            .prepare('UPDATE consolidation_runs SET last_run_at = ? WHERE project_id = ?')
            .run(Date.now() - (DAY + HOUR), PROJECT);
        }
        outcomes.push(await scheduler.maybeRun(PROJECT));
      }

      expect(outcomes.every((o) => o.ran === true)).toBe(true);
      const lines = readLines(logPath);
      expect(lines).toHaveLength(3);
      expect(lines.every((l) => l.reason === 'ok')).toBe(true);
    });
  });
});
