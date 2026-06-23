import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
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

  beforeEach(() => {
    db = createTestDb();
    repo = new MemoryRepository(db as any);
  });
  afterEach(() => db.close());

  const enabled = (overrides = {}) =>
    new ConsolidationScheduler(db.instance, {
      enabled: true,
      intervalMs: 24 * HOUR,
      options: { persistSummaries: true },
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
    afterEach(() => {
      delete process.env[KEY];
      delete process.env[HOURS];
    });

    it('is disabled unless the flag is exactly "true"', async () => {
      const outcome = await ConsolidationScheduler.fromEnv(db.instance).maybeRun(PROJECT);
      expect(outcome.reason).toBe('disabled');
    });

    it('enables when the flag is set and honors a custom interval', async () => {
      process.env[KEY] = 'true';
      process.env[HOURS] = '1';
      seedCluster();
      const scheduler = ConsolidationScheduler.fromEnv(db.instance);
      const first = await scheduler.maybeRun(PROJECT);
      expect(first.ran).toBe(true);
      // Within 1h → throttled.
      const second = await scheduler.maybeRun(PROJECT);
      expect(second.reason).toBe('throttled');
    });
  });
});
