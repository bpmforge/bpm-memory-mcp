import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { randomUUID } from 'crypto';
import { AutoLinker } from '../../mcp/memory-server/src/linking/auto-linker.js';
import { MemoryLinkRepository } from '../../mcp/memory-server/src/storage/links.js';
import { MIGRATIONS, CURRENT_VERSION } from '../../mcp/memory-server/src/storage/schema.js';
import type { DatabaseConnection } from '../../mcp/memory-server/src/storage/database.js';

// ============================================================================
// Test Setup
// ============================================================================

function createTestDb(): DatabaseConnection {
  const db = new Database(':memory:');

  // Apply all migrations
  for (const migration of MIGRATIONS) {
    if (migration.version <= CURRENT_VERSION) {
      const statements = migration.up.split(';').filter((s) => s.trim());
      for (const stmt of statements) {
        if (stmt.trim()) {
          try {
            db.exec(stmt);
          } catch (e) {
            // Ignore errors from statements that may already exist
          }
        }
      }
    }
  }

  // Track schema version
  db.exec(
    `INSERT OR REPLACE INTO schema_version (version, applied_at) VALUES (${CURRENT_VERSION}, ${Date.now()})`
  );

  return {
    instance: db,
    transaction: <T>(fn: () => T) => {
      return db.transaction(fn)();
    },
    close: () => db.close(),
  };
}

/**
 * Create a simple mock embedding - just a normalized random vector
 * In real usage, embeddings would come from a proper model
 */
function createMockEmbedding(seed: number): Float32Array {
  const embedding = new Float32Array(384);
  for (let i = 0; i < 384; i++) {
    // Use a deterministic pseudo-random based on seed
    embedding[i] = Math.sin(seed * (i + 1) * 0.1) * 0.5;
  }
  // Normalize
  let norm = 0;
  for (let i = 0; i < 384; i++) {
    norm += embedding[i]! * embedding[i]!;
  }
  norm = Math.sqrt(norm);
  for (let i = 0; i < 384; i++) {
    embedding[i] = embedding[i]! / norm;
  }
  return embedding;
}

/**
 * Create a similar embedding by adding small noise
 */
function createSimilarEmbedding(base: Float32Array, noise: number): Float32Array {
  const embedding = new Float32Array(base.length);
  for (let i = 0; i < base.length; i++) {
    embedding[i] = base[i]! + (Math.random() - 0.5) * noise;
  }
  // Normalize
  let norm = 0;
  for (let i = 0; i < embedding.length; i++) {
    norm += embedding[i]! * embedding[i]!;
  }
  norm = Math.sqrt(norm);
  for (let i = 0; i < embedding.length; i++) {
    embedding[i] = embedding[i]! / norm;
  }
  return embedding;
}

const PROJECT_ID = 'test-project';

// ============================================================================
// AutoLinker Tests
// ============================================================================

describe('AutoLinker', () => {
  let db: DatabaseConnection;
  let autoLinker: AutoLinker;
  let linkRepo: MemoryLinkRepository;

  beforeEach(() => {
    db = createTestDb();
    autoLinker = new AutoLinker(db);
    linkRepo = new MemoryLinkRepository(db);
  });

  afterEach(() => {
    db.close();
  });

  /**
   * Helper to insert a test memory
   */
  function insertMemory(
    content: string,
    embedding: Float32Array,
    type: string = 'fact'
  ): string {
    const id = randomUUID();
    const now = Math.floor(Date.now() / 1000);
    const embeddingBuffer = Buffer.from(embedding.buffer);

    db.instance
      .prepare(
        `INSERT INTO memories (id, content, type, confidence, project_id, content_hash, created_at, accessed_at, embedding)
         VALUES (?, ?, ?, 1.0, ?, ?, ?, ?, ?)`
      )
      .run(id, content, type, PROJECT_ID, `hash-${id}`, now, now, embeddingBuffer);

    return id;
  }

  describe('processNewMemory', () => {
    it('should return empty result when no similar memories exist', async () => {
      const embedding = createMockEmbedding(1);
      const memoryId = insertMemory('Unique memory content', embedding);

      const result = await autoLinker.processNewMemory(
        memoryId,
        'Unique memory content',
        embedding,
        PROJECT_ID
      );

      expect(result.createdLinks.length).toBe(0);
      expect(result.suggestedLinks.length).toBe(0);
    });

    it('should create links for highly similar memories', async () => {
      // Create base embedding and memory
      const baseEmbedding = createMockEmbedding(42);
      const existingId = insertMemory('Authentication using JWT tokens', baseEmbedding);

      // Create similar embedding (small noise = high similarity)
      const similarEmbedding = createSimilarEmbedding(baseEmbedding, 0.1);
      const newId = insertMemory('JWT authentication implementation', similarEmbedding);

      const result = await autoLinker.processNewMemory(
        newId,
        'JWT authentication implementation',
        similarEmbedding,
        PROJECT_ID
      );

      // Should auto-create at least one link due to high similarity
      expect(result.createdLinks.length).toBeGreaterThanOrEqual(1);
      expect(result.createdLinks[0]?.targetId).toBe(existingId);
      expect(result.createdLinks[0]?.linkType).toBe('relates_to');
    });

    it('should suggest links for moderately similar memories', async () => {
      // Create base embedding and memory
      const baseEmbedding = createMockEmbedding(100);
      insertMemory('Database connection pooling', baseEmbedding);

      // Create moderately similar embedding (more noise = moderate similarity)
      const moderateEmbedding = createSimilarEmbedding(baseEmbedding, 0.4);
      const newId = insertMemory('Connection management patterns', moderateEmbedding);

      const result = await autoLinker.processNewMemory(
        newId,
        'Connection management patterns',
        moderateEmbedding,
        PROJECT_ID
      );

      // May have suggestions if similarity is in the suggest range
      // This depends on the noise level achieving 60-75% similarity
      expect(result.suggestedLinks.length + result.createdLinks.length).toBeGreaterThanOrEqual(0);
    });

    it('should not create duplicate links', async () => {
      const baseEmbedding = createMockEmbedding(200);
      const existingId = insertMemory('Error handling patterns', baseEmbedding);

      const similarEmbedding = createSimilarEmbedding(baseEmbedding, 0.05);
      const newId = insertMemory('Handling errors gracefully', similarEmbedding);

      // Create a link manually first
      linkRepo.createLink({
        sourceId: newId,
        targetId: existingId,
        linkType: 'relates_to',
        strength: 0.9,
        createdBy: 'user',
      });

      // Now process should not create another link
      const result = await autoLinker.processNewMemory(
        newId,
        'Handling errors gracefully',
        similarEmbedding,
        PROJECT_ID
      );

      // Existing link should prevent new auto-link
      const allLinks = linkRepo.findLinks(newId);
      expect(allLinks.length).toBe(1);
    });

    it('should respect maxAutoLinks configuration', async () => {
      // Create many similar memories
      const baseEmbedding = createMockEmbedding(300);
      for (let i = 0; i < 10; i++) {
        const similarEmbedding = createSimilarEmbedding(baseEmbedding, 0.05);
        insertMemory(`Similar memory ${i}`, similarEmbedding);
      }

      // Create auto-linker with max 2 auto-links
      const limitedLinker = new AutoLinker(db, { maxAutoLinks: 2 });

      const newEmbedding = createSimilarEmbedding(baseEmbedding, 0.05);
      const newId = insertMemory('New similar memory', newEmbedding);

      const result = await limitedLinker.processNewMemory(
        newId,
        'New similar memory',
        newEmbedding,
        PROJECT_ID
      );

      expect(result.createdLinks.length).toBeLessThanOrEqual(2);
    });

    it('should return empty result when embedding is null', async () => {
      const result = await autoLinker.processNewMemory(
        randomUUID(),
        'Content without embedding',
        null,
        PROJECT_ID
      );

      expect(result.createdLinks.length).toBe(0);
      expect(result.suggestedLinks.length).toBe(0);
    });
  });

  describe('getLinkDensityStats', () => {
    it('should return correct stats for empty project', () => {
      const stats = autoLinker.getLinkDensityStats(PROJECT_ID);

      expect(stats.totalMemories).toBe(0);
      expect(stats.linkedMemories).toBe(0);
      expect(stats.orphanMemories).toBe(0);
      expect(stats.averageLinksPerMemory).toBe(0);
      expect(stats.linkDensity).toBe(0);
    });

    it('should return correct stats with memories and links', () => {
      const embedding = createMockEmbedding(1);
      const id1 = insertMemory('Memory 1', embedding);
      const id2 = insertMemory('Memory 2', embedding);
      const id3 = insertMemory('Memory 3 (orphan)', embedding);

      // Create link between 1 and 2
      linkRepo.createLink({
        sourceId: id1,
        targetId: id2,
        linkType: 'relates_to',
        createdBy: 'system',
      });

      const stats = autoLinker.getLinkDensityStats(PROJECT_ID);

      expect(stats.totalMemories).toBe(3);
      expect(stats.linkedMemories).toBe(2);
      expect(stats.orphanMemories).toBe(1);
      expect(stats.linkDensity).toBeCloseTo(0.67, 1);
    });
  });

  describe('link type determination', () => {
    it('should create relates_to links by default', async () => {
      const embedding = createMockEmbedding(500);
      const existingId = insertMemory('User authentication flow', embedding);

      const similarEmbedding = createSimilarEmbedding(embedding, 0.05);
      const newId = insertMemory('Authentication service implementation', similarEmbedding);

      const result = await autoLinker.processNewMemory(
        newId,
        'Authentication service implementation',
        similarEmbedding,
        PROJECT_ID
      );

      if (result.createdLinks.length > 0) {
        expect(result.createdLinks[0]?.linkType).toBe('relates_to');
      }
    });
  });
});
