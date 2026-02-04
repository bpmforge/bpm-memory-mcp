import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { randomUUID } from 'crypto';
import { MemoryGraphService } from '../../mcp/memory-server/src/graph/memory-graph.js';
import { MemoryLinkRepository } from '../../mcp/memory-server/src/storage/links.js';
import { MIGRATIONS, CURRENT_VERSION } from '../../mcp/memory-server/src/storage/schema.js';
import { MemoryLinkType } from '../../mcp/memory-server/src/types.js';
import type { DatabaseConnection } from '../../mcp/memory-server/src/storage/database.js';

// ============================================================================
// Test Setup
// ============================================================================

function createTestDb(): DatabaseConnection {
  const db = new Database(':memory:');

  for (const migration of MIGRATIONS) {
    if (migration.version <= CURRENT_VERSION) {
      const statements = migration.up.split(';').filter((s) => s.trim());
      for (const stmt of statements) {
        if (stmt.trim()) {
          try {
            db.exec(stmt);
          } catch (e) {
            // Ignore
          }
        }
      }
    }
  }

  db.exec(
    `INSERT OR REPLACE INTO schema_version (version, applied_at) VALUES (${CURRENT_VERSION}, ${Date.now()})`
  );

  return {
    instance: db,
    transaction: <T>(fn: () => T) => db.transaction(fn)(),
    close: () => db.close(),
  };
}

const PROJECT_ID = 'test-project';

// ============================================================================
// MemoryGraphService Tests
// ============================================================================

describe('MemoryGraphService', () => {
  let db: DatabaseConnection;
  let graphService: MemoryGraphService;
  let linkRepo: MemoryLinkRepository;
  let memoryIds: string[];

  beforeEach(() => {
    db = createTestDb();
    graphService = new MemoryGraphService(db);
    linkRepo = new MemoryLinkRepository(db);
    memoryIds = [];

    // Create test memories
    const now = Math.floor(Date.now() / 1000);
    for (let i = 0; i < 5; i++) {
      const id = randomUUID();
      memoryIds.push(id);
      db.instance
        .prepare(
          `INSERT INTO memories (id, content, type, confidence, project_id, content_hash, created_at, accessed_at)
           VALUES (?, ?, 'fact', 1.0, ?, ?, ?, ?)`
        )
        .run(id, `Memory content ${i}`, PROJECT_ID, `hash-${id}`, now, now);
    }
  });

  afterEach(() => {
    db.close();
  });

  describe('getStats', () => {
    it('should return correct stats for empty project', () => {
      const stats = graphService.getStats('empty-project');

      expect(stats.totalMemories).toBe(0);
      expect(stats.totalLinks).toBe(0);
      expect(stats.linkDensity).toBe(0);
    });

    it('should return correct stats with memories and links', () => {
      // Create some links
      linkRepo.createLink({
        sourceId: memoryIds[0]!,
        targetId: memoryIds[1]!,
        linkType: MemoryLinkType.RELATES_TO,
      });

      linkRepo.createLink({
        sourceId: memoryIds[1]!,
        targetId: memoryIds[2]!,
        linkType: MemoryLinkType.EXTENDS,
      });

      const stats = graphService.getStats(PROJECT_ID);

      expect(stats.totalMemories).toBe(5);
      expect(stats.totalLinks).toBe(2);
      expect(stats.linkedMemories).toBe(3);
      expect(stats.orphanMemories).toBe(2);
      expect(stats.linksByType['relates_to']).toBe(1);
      expect(stats.linksByType['extends']).toBe(1);
    });

    it('should count contradictions', () => {
      linkRepo.createLink({
        sourceId: memoryIds[0]!,
        targetId: memoryIds[1]!,
        linkType: MemoryLinkType.CONTRADICTS,
      });

      const stats = graphService.getStats(PROJECT_ID);

      expect(stats.contradictionCount).toBe(1);
    });
  });

  describe('findContradictions', () => {
    it('should return empty array when no contradictions', () => {
      const contradictions = graphService.findContradictions(PROJECT_ID);
      expect(contradictions.length).toBe(0);
    });

    it('should find contradiction pairs', () => {
      linkRepo.createLink({
        sourceId: memoryIds[0]!,
        targetId: memoryIds[1]!,
        linkType: MemoryLinkType.CONTRADICTS,
      });

      linkRepo.createLink({
        sourceId: memoryIds[2]!,
        targetId: memoryIds[3]!,
        linkType: MemoryLinkType.CONTRADICTS,
      });

      const contradictions = graphService.findContradictions(PROJECT_ID);

      expect(contradictions.length).toBe(2);
      expect(contradictions[0]?.source.id).toBeDefined();
      expect(contradictions[0]?.target.id).toBeDefined();
    });
  });

  describe('findChain', () => {
    it('should return single node for memory with no links', () => {
      const chain = graphService.findChain(memoryIds[0]!, PROJECT_ID);

      expect(chain.length).toBe(1);
      expect(chain.nodes[0]?.id).toBe(memoryIds[0]);
    });

    it('should trace chain through extends links', () => {
      // Create chain: 0 -> 1 -> 2
      linkRepo.createLink({
        sourceId: memoryIds[0]!,
        targetId: memoryIds[1]!,
        linkType: MemoryLinkType.EXTENDS,
      });

      linkRepo.createLink({
        sourceId: memoryIds[1]!,
        targetId: memoryIds[2]!,
        linkType: MemoryLinkType.EXTENDS,
      });

      const chain = graphService.findChain(memoryIds[0]!, PROJECT_ID, {
        linkTypes: ['extends'],
        direction: 'forward',
      });

      expect(chain.length).toBe(3);
    });

    it('should respect maxLength', () => {
      // Create long chain
      for (let i = 0; i < 4; i++) {
        linkRepo.createLink({
          sourceId: memoryIds[i]!,
          targetId: memoryIds[i + 1]!,
          linkType: MemoryLinkType.EXTENDS,
        });
      }

      const chain = graphService.findChain(memoryIds[0]!, PROJECT_ID, {
        linkTypes: ['extends'],
        maxLength: 3,
      });

      expect(chain.length).toBeLessThanOrEqual(3);
    });
  });

  describe('findCluster', () => {
    it('should return empty cluster for non-existent memory', () => {
      const cluster = graphService.findCluster(randomUUID(), PROJECT_ID);

      expect(cluster.size).toBe(0);
      expect(cluster.members.length).toBe(0);
    });

    it('should find connected memories in cluster', () => {
      // Create hub: 0 connected to 1, 2, 3
      linkRepo.createLink({
        sourceId: memoryIds[0]!,
        targetId: memoryIds[1]!,
        linkType: MemoryLinkType.RELATES_TO,
      });

      linkRepo.createLink({
        sourceId: memoryIds[0]!,
        targetId: memoryIds[2]!,
        linkType: MemoryLinkType.SUPPORTS,
      });

      linkRepo.createLink({
        sourceId: memoryIds[0]!,
        targetId: memoryIds[3]!,
        linkType: MemoryLinkType.EXTENDS,
      });

      const cluster = graphService.findCluster(memoryIds[0]!, PROJECT_ID);

      expect(cluster.centerId).toBe(memoryIds[0]);
      expect(cluster.members.length).toBe(3);
      expect(cluster.size).toBe(4); // center + 3 members
    });
  });

  describe('findOrphans', () => {
    it('should find memories with no links', () => {
      // Link only 0 and 1
      linkRepo.createLink({
        sourceId: memoryIds[0]!,
        targetId: memoryIds[1]!,
        linkType: MemoryLinkType.RELATES_TO,
      });

      const orphans = graphService.findOrphans(PROJECT_ID);

      // Memories 2, 3, 4 should be orphans
      expect(orphans.length).toBe(3);
      const orphanIds = orphans.map((o) => o.id);
      expect(orphanIds).toContain(memoryIds[2]);
      expect(orphanIds).toContain(memoryIds[3]);
      expect(orphanIds).toContain(memoryIds[4]);
    });

    it('should return empty array when all memories are linked', () => {
      // Link all memories in a chain
      for (let i = 0; i < 4; i++) {
        linkRepo.createLink({
          sourceId: memoryIds[i]!,
          targetId: memoryIds[i + 1]!,
          linkType: MemoryLinkType.RELATES_TO,
        });
      }

      const orphans = graphService.findOrphans(PROJECT_ID);
      expect(orphans.length).toBe(0);
    });
  });
});
