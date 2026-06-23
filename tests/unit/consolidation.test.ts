import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { ConsolidationService } from '../../mcp/memory-server/src/consolidation/index.js';
import { MemoryRepository } from '../../mcp/memory-server/src/storage/repository.js';
import { MIGRATIONS } from '../../mcp/memory-server/src/storage/schema.js';

// Mirrors repository.test.ts: in-memory DB with all migrations applied.
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
const DAY = 24 * 60 * 60 * 1000;

describe('ConsolidationService', () => {
  let db: { instance: Database.Database; close: () => void; transaction: <T>(fn: () => T) => T };
  let repo: MemoryRepository;
  let service: ConsolidationService;
  const PROJECT = 'nursery-tracker';

  beforeEach(() => {
    db = createTestDb();
    repo = new MemoryRepository(db as any);
    service = new ConsolidationService(db.instance);
  });
  afterEach(() => db.close());

  // Helper: insert a memory, then optionally backdate its accessed_at.
  function seed(
    content: string,
    opts: {
      type?: string;
      confidence?: number;
      embedding?: Float32Array;
      accessedDaysAgo?: number;
    } = {}
  ): string {
    const m = repo.createMemory(
      {
        content,
        type: (opts.type ?? 'fact') as any,
        confidence: opts.confidence ?? 1.0,
        projectId: PROJECT,
      },
      opts.embedding ?? null
    );
    if (opts.accessedDaysAgo != null) {
      db.instance
        .prepare('UPDATE memories SET accessed_at = ? WHERE id = ?')
        .run(Date.now() - opts.accessedDaysAgo * DAY, m.id);
    }
    return m.id;
  }

  const active = (id: string): boolean =>
    !!db.instance.prepare('SELECT 1 FROM memories WHERE id = ? AND deleted_at IS NULL').get(id);
  const row = (id: string): any =>
    db.instance.prepare('SELECT * FROM memories WHERE id = ?').get(id);

  // --- Regression guard: the engine references real schema columns -----------
  // Pre-fix these threw `no such column: last_accessed_at` / `delete_reason`,
  // so memory_consolidate never ran. Keep this test as the canary.
  describe('runs against the real schema', () => {
    it('does not throw on an empty project', async () => {
      const result = await service.consolidate(PROJECT);
      expect(result.stats.totalProcessed).toBe(0);
      expect(result.merged).toEqual([]);
      expect(result.decayed).toEqual([]);
      expect(result.clusters).toEqual([]);
    });

    it('does not throw when merging + decaying real rows', async () => {
      seed('a', { embedding: vec([1, 0]) });
      seed('b', { embedding: vec([1, 0]), accessedDaysAgo: 100 });
      await expect(service.consolidate(PROJECT)).resolves.toBeDefined();
    });
  });

  // --- Duplicate merge -------------------------------------------------------
  describe('duplicate merge', () => {
    it('soft-deletes the lower-confidence duplicate and bumps the keeper', async () => {
      const keep = seed('parcel locker A', { embedding: vec([1, 0]), confidence: 0.9 });
      const drop = seed('parcel locker A (dup)', { embedding: vec([1, 0]), confidence: 0.4 });

      const result = await service.consolidate(PROJECT, { duplicateThreshold: 0.85 });

      expect(result.stats.duplicatesFound).toBe(1);
      expect(result.merged[0]!.keptId).toBe(keep);
      expect(result.merged[0]!.mergedIds).toContain(drop);
      expect(active(keep)).toBe(true);
      expect(active(drop)).toBe(false);
      expect(row(drop).deleted_reason).toContain(`Merged with ${keep}`);
      expect(row(keep).access_count).toBe(1); // bumped by mergedIds.length
    });

    it('dryRun reports the merge but writes nothing', async () => {
      const keep = seed('x', { embedding: vec([1, 0]), confidence: 0.9 });
      const drop = seed('x2', { embedding: vec([1, 0]), confidence: 0.4 });

      const result = await service.consolidate(PROJECT, { duplicateThreshold: 0.85, dryRun: true });

      expect(result.merged).toHaveLength(1);
      expect(active(keep)).toBe(true);
      expect(active(drop)).toBe(true); // unchanged
    });

    it('leaves dissimilar memories alone', async () => {
      const a = seed('alpha', { embedding: vec([1, 0]) });
      const b = seed('beta', { embedding: vec([0, 1]) }); // orthogonal → sim 0
      const result = await service.consolidate(PROJECT, { duplicateThreshold: 0.85 });
      expect(result.stats.duplicatesFound).toBe(0);
      expect(active(a)).toBe(true);
      expect(active(b)).toBe(true);
    });
  });

  // --- Confidence decay ------------------------------------------------------
  describe('confidence decay', () => {
    it('decays a stale memory using the type multiplier', async () => {
      // fact multiplier 0.8; 100 days, threshold 30 → 70 over; 70*0.01*0.8 = 0.56
      const id = seed('stale fact', { type: 'fact', confidence: 1.0, accessedDaysAgo: 100 });
      const result = await service.consolidate(PROJECT, { decayAfterDays: 30, decayRate: 0.01 });

      const d = result.decayed.find((x) => x.id === id);
      expect(d).toBeDefined();
      expect(d!.newConfidence).toBeCloseTo(0.44, 2);
      expect(row(id).confidence).toBeCloseTo(0.44, 2);
    });

    it('does not decay a recently-accessed memory', async () => {
      const id = seed('fresh', { confidence: 1.0, accessedDaysAgo: 1 });
      const result = await service.consolidate(PROJECT, { decayAfterDays: 30 });
      expect(result.decayed.find((x) => x.id === id)).toBeUndefined();
      expect(row(id).confidence).toBe(1.0);
    });

    it('floors confidence at 0.1 and flags below the review threshold', async () => {
      const id = seed('almost gone', { type: 'fact', confidence: 0.3, accessedDaysAgo: 100 });
      const result = await service.consolidate(PROJECT, {
        decayAfterDays: 30,
        decayRate: 0.01,
        minConfidenceThreshold: 0.3,
      });
      expect(row(id).confidence).toBeCloseTo(0.1, 5); // max(0.1, 0.3-0.56)
      expect(result.flaggedForReview.some((f) => f.id === id)).toBe(true);
    });

    it('dryRun does not write decayed confidence', async () => {
      const id = seed('stale', { confidence: 1.0, accessedDaysAgo: 100 });
      const result = await service.consolidate(PROJECT, { decayAfterDays: 30, dryRun: true });
      expect(result.decayed.some((x) => x.id === id)).toBe(true);
      expect(row(id).confidence).toBe(1.0);
    });
  });

  // --- Cluster identification (advisory; no writes) --------------------------
  describe('cluster identification', () => {
    it('groups same-type similar memories into a themed cluster', async () => {
      // duplicateThreshold high so they are not merged first — isolate clustering.
      seed('seedling nursery tracker alpha', { type: 'pattern', embedding: vec([1, 0]) });
      seed('seedling nursery tracker beta', { type: 'pattern', embedding: vec([1, 0]) });
      seed('seedling nursery tracker gamma', { type: 'pattern', embedding: vec([1, 0]) });

      const result = await service.consolidate(PROJECT, {
        duplicateThreshold: 2,
        minClusterSize: 3,
      });

      expect(result.stats.clustersIdentified).toBe(1);
      const cluster = result.clusters[0]!;
      expect(cluster.memoryIds).toHaveLength(3);
      expect(cluster.theme.toLowerCase()).toContain('seedling');
      expect(cluster.suggestedSummary).toContain('3');
    });

    it('does not cluster below minClusterSize', async () => {
      seed('one', { type: 'pattern', embedding: vec([1, 0]) });
      seed('two', { type: 'pattern', embedding: vec([1, 0]) });
      const result = await service.consolidate(PROJECT, {
        duplicateThreshold: 2,
        minClusterSize: 3,
      });
      expect(result.stats.clustersIdentified).toBe(0);
    });
  });
});
