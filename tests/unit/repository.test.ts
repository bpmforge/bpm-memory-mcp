import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { MemoryRepository } from '../../mcp/memory-server/src/storage/repository.js';
import { MIGRATIONS } from '../../mcp/memory-server/src/storage/schema.js';
import type { MemoryType } from '../../mcp/memory-server/src/types.js';

// Create a mock DatabaseConnection interface with all migrations applied
function createTestDb(): { instance: Database.Database; close: () => void } {
  const db = new Database(':memory:');
  // Apply all migrations in order
  for (const migration of MIGRATIONS) {
    db.exec(migration.up);
  }
  return {
    instance: db,
    close: () => db.close(),
  };
}

describe('MemoryRepository', () => {
  let db: { instance: Database.Database; close: () => void };
  let repo: MemoryRepository;

  beforeEach(() => {
    db = createTestDb();
    repo = new MemoryRepository(db as any);
  });

  afterEach(() => {
    db.close();
  });

  describe('createMemory', () => {
    it('should create a memory with all fields', () => {
      const memory = repo.createMemory({
        content: 'Test memory content',
        type: 'fact',
        confidence: 0.9,
        citation: 'test.ts:42',
        projectId: 'test-project',
      });

      expect(memory.id).toBeDefined();
      expect(memory.content).toBe('Test memory content');
      expect(memory.type).toBe('fact');
      expect(memory.confidence).toBe(0.9);
      expect(memory.citation).toBe('test.ts:42');
      expect(memory.projectId).toBe('test-project');
      expect(memory.accessCount).toBe(0);
    });

    it('should use default values', () => {
      const memory = repo.createMemory({
        content: 'Test content',
        projectId: 'test-project',
      });

      expect(memory.type).toBe('fact');
      expect(memory.confidence).toBe(1.0);
      expect(memory.citation).toBeNull();
    });

    it('should store embedding as BLOB', () => {
      const embedding = new Float32Array([0.1, 0.2, 0.3, 0.4]);

      const memory = repo.createMemory(
        {
          content: 'Test content',
          projectId: 'test-project',
        },
        embedding
      );

      expect(memory.embedding).toBeDefined();
      expect(memory.embedding!.length).toBe(4);
      expect(memory.embedding![0]).toBeCloseTo(0.1, 5);
    });

    it('should generate unique content hash', () => {
      const memory1 = repo.createMemory({
        content: 'First content',
        projectId: 'test-project',
      });

      const memory2 = repo.createMemory({
        content: 'Second content',
        projectId: 'test-project',
      });

      expect(memory1.contentHash).not.toBe(memory2.contentHash);
    });

    it('should generate same hash for same content', () => {
      const content = 'Same content';

      const hash1 = repo.createMemory({
        content,
        projectId: 'project-1',
      }).contentHash;

      const hash2 = repo.createMemory({
        content,
        projectId: 'project-2',
      }).contentHash;

      expect(hash1).toBe(hash2);
    });
  });

  describe('findById', () => {
    it('should find memory by ID', () => {
      const created = repo.createMemory({
        content: 'Find me',
        projectId: 'test-project',
      });

      const found = repo.findById(created.id, 'test-project');

      expect(found).not.toBeNull();
      expect(found!.content).toBe('Find me');
    });

    it('should return null for non-existent ID', () => {
      const found = repo.findById('non-existent', 'test-project');
      expect(found).toBeNull();
    });

    it('should enforce project isolation', () => {
      const created = repo.createMemory({
        content: 'Project A memory',
        projectId: 'project-a',
      });

      // Should not find with wrong project
      const found = repo.findById(created.id, 'project-b');
      expect(found).toBeNull();
    });
  });

  describe('findByProject', () => {
    beforeEach(() => {
      repo.createMemory({ content: 'Fact 1', type: 'fact', projectId: 'proj-a' });
      repo.createMemory({ content: 'Fact 2', type: 'fact', projectId: 'proj-a' });
      repo.createMemory({ content: 'Error 1', type: 'error', projectId: 'proj-a' });
      repo.createMemory({ content: 'Other project', type: 'fact', projectId: 'proj-b' });
    });

    it('should find all memories for project', () => {
      const memories = repo.findByProject('proj-a');
      expect(memories.length).toBe(3);
    });

    it('should filter by type', () => {
      const facts = repo.findByProject('proj-a', { type: 'fact' });
      expect(facts.length).toBe(2);
      expect(facts.every((m) => m.type === 'fact')).toBe(true);
    });

    it('should respect limit', () => {
      const limited = repo.findByProject('proj-a', { limit: 2 });
      expect(limited.length).toBe(2);
    });

    it('should filter by minimum confidence', () => {
      repo.createMemory({
        content: 'Low confidence',
        type: 'fact',
        confidence: 0.3,
        projectId: 'proj-a',
      });

      const highConfidence = repo.findByProject('proj-a', { minConfidence: 0.5 });
      expect(highConfidence.every((m) => m.confidence >= 0.5)).toBe(true);
    });

    it('should exclude deleted by default', () => {
      const memory = repo.createMemory({
        content: 'Will delete',
        projectId: 'proj-a',
      });
      repo.softDelete(memory.id, 'proj-a', 'test');

      const memories = repo.findByProject('proj-a');
      expect(memories.find((m) => m.id === memory.id)).toBeUndefined();
    });

    it('should include deleted when specified', () => {
      const memory = repo.createMemory({
        content: 'Will delete',
        projectId: 'proj-a',
      });
      repo.softDelete(memory.id, 'proj-a', 'test');

      const memories = repo.findByProject('proj-a', { includeDeleted: true });
      expect(memories.find((m) => m.id === memory.id)).toBeDefined();
    });
  });

  describe('findWithEmbeddings', () => {
    it('should only return memories with embeddings', () => {
      repo.createMemory(
        { content: 'With embedding', projectId: 'proj' },
        new Float32Array([0.1, 0.2])
      );
      repo.createMemory({ content: 'Without embedding', projectId: 'proj' });

      const results = repo.findWithEmbeddings('proj');

      expect(results.length).toBe(1);
      expect(results[0]!.content).toBe('With embedding');
    });

    it('should exclude deleted memories', () => {
      const memory = repo.createMemory(
        { content: 'Will delete', projectId: 'proj' },
        new Float32Array([0.1, 0.2])
      );
      repo.softDelete(memory.id, 'proj', 'test');

      const results = repo.findWithEmbeddings('proj');
      expect(results.length).toBe(0);
    });
  });

  describe('softDelete', () => {
    it('should soft delete a memory', () => {
      const memory = repo.createMemory({
        content: 'Delete me',
        projectId: 'proj',
      });

      const result = repo.softDelete(memory.id, 'proj', 'Outdated information');

      expect(result).toBe(true);

      const found = repo.findByProject('proj', { includeDeleted: true }).find(
        (m) => m.id === memory.id
      );
      expect(found!.deletedAt).not.toBeNull();
      expect(found!.deleteReason).toBe('Outdated information');
    });

    it('should return false for non-existent ID', () => {
      const result = repo.softDelete('non-existent', 'proj', 'test');
      expect(result).toBe(false);
    });

    it('should return false for already deleted', () => {
      const memory = repo.createMemory({
        content: 'Delete me',
        projectId: 'proj',
      });

      repo.softDelete(memory.id, 'proj', 'First delete');
      const result = repo.softDelete(memory.id, 'proj', 'Second delete');

      expect(result).toBe(false);
    });

    it('should enforce project isolation', () => {
      const memory = repo.createMemory({
        content: 'Project A',
        projectId: 'proj-a',
      });

      const result = repo.softDelete(memory.id, 'proj-b', 'Wrong project');
      expect(result).toBe(false);
    });
  });

  describe('updateContent', () => {
    it('should update content', () => {
      const memory = repo.createMemory({
        content: 'Original content',
        projectId: 'proj',
      });

      const result = repo.updateContent(memory.id, 'proj', 'Updated content');

      expect(result).toBe(true);

      const found = repo.findById(memory.id, 'proj');
      expect(found!.content).toBe('Updated content');
    });

    it('should update embedding', () => {
      const memory = repo.createMemory(
        { content: 'Original', projectId: 'proj' },
        new Float32Array([0.1, 0.2])
      );

      const newEmbedding = new Float32Array([0.3, 0.4, 0.5]);
      repo.updateContent(memory.id, 'proj', 'Updated', newEmbedding);

      const found = repo.findById(memory.id, 'proj');
      expect(found!.embedding!.length).toBe(3);
    });

    it('should update content hash', () => {
      const memory = repo.createMemory({
        content: 'Original',
        projectId: 'proj',
      });
      const originalHash = memory.contentHash;

      repo.updateContent(memory.id, 'proj', 'Different content');

      const found = repo.findById(memory.id, 'proj');
      expect(found!.contentHash).not.toBe(originalHash);
    });

    it('should not update deleted memory', () => {
      const memory = repo.createMemory({
        content: 'Original',
        projectId: 'proj',
      });
      repo.softDelete(memory.id, 'proj', 'test');

      const result = repo.updateContent(memory.id, 'proj', 'Updated');
      expect(result).toBe(false);
    });
  });

  describe('updateAccessStats', () => {
    it('should increment access count', () => {
      const memory = repo.createMemory({
        content: 'Track access',
        projectId: 'proj',
      });

      expect(memory.accessCount).toBe(0);

      repo.updateAccessStats(memory.id);
      repo.updateAccessStats(memory.id);
      repo.updateAccessStats(memory.id);

      const found = repo.findById(memory.id, 'proj');
      expect(found!.accessCount).toBe(3);
    });

    it('should update accessed_at timestamp', () => {
      const memory = repo.createMemory({
        content: 'Track time',
        projectId: 'proj',
      });
      const originalTime = memory.accessedAt;

      // Wait a bit to ensure timestamp changes
      const waitTime = new Promise((resolve) => setTimeout(resolve, 1100));
      return waitTime.then(() => {
        repo.updateAccessStats(memory.id);
        const found = repo.findById(memory.id, 'proj');
        expect(found!.accessedAt.getTime()).toBeGreaterThan(originalTime.getTime());
      });
    });
  });

  describe('isDuplicate', () => {
    it('should detect duplicate content', () => {
      repo.createMemory({
        content: 'Unique content',
        projectId: 'proj',
      });

      expect(repo.isDuplicateContent('Unique content', 'proj')).toBe(true);
      expect(repo.isDuplicateContent('Different content', 'proj')).toBe(false);
    });

    it('should not detect deleted as duplicate', () => {
      const memory = repo.createMemory({
        content: 'Will delete',
        projectId: 'proj',
      });
      repo.softDelete(memory.id, 'proj', 'test');

      expect(repo.isDuplicateContent('Will delete', 'proj')).toBe(false);
    });

    it('should respect project isolation', () => {
      repo.createMemory({
        content: 'Same content',
        projectId: 'proj-a',
      });

      expect(repo.isDuplicateContent('Same content', 'proj-a')).toBe(true);
      expect(repo.isDuplicateContent('Same content', 'proj-b')).toBe(false);
    });
  });

  describe('countByProject', () => {
    it('should count memories', () => {
      repo.createMemory({ content: '1', projectId: 'proj' });
      repo.createMemory({ content: '2', projectId: 'proj' });
      repo.createMemory({ content: '3', projectId: 'proj' });

      expect(repo.countByProject('proj')).toBe(3);
    });

    it('should exclude deleted by default', () => {
      const memory = repo.createMemory({ content: '1', projectId: 'proj' });
      repo.createMemory({ content: '2', projectId: 'proj' });
      repo.softDelete(memory.id, 'proj', 'test');

      expect(repo.countByProject('proj')).toBe(1);
    });

    it('should include deleted when specified', () => {
      const memory = repo.createMemory({ content: '1', projectId: 'proj' });
      repo.createMemory({ content: '2', projectId: 'proj' });
      repo.softDelete(memory.id, 'proj', 'test');

      expect(repo.countByProject('proj', true)).toBe(2);
    });
  });

  describe('countByType', () => {
    it('should count by type', () => {
      repo.createMemory({ content: '1', type: 'fact', projectId: 'proj' });
      repo.createMemory({ content: '2', type: 'fact', projectId: 'proj' });
      repo.createMemory({ content: '3', type: 'error', projectId: 'proj' });
      repo.createMemory({ content: '4', type: 'decision', projectId: 'proj' });

      const counts = repo.countByType('proj');

      expect(counts.fact).toBe(2);
      expect(counts.error).toBe(1);
      expect(counts.decision).toBe(1);
      expect(counts.pattern).toBe(0);
      expect(counts.preference).toBe(0);
    });
  });
});
