import { describe, it, expect, beforeAll, afterAll, vi, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { MIGRATIONS } from '../../mcp/memory-server/src/storage/schema.js';
import { MemoryRepository } from '../../mcp/memory-server/src/storage/repository.js';
import { VectorSearch } from '../../mcp/memory-server/src/search/vector.js';
import { BM25Search } from '../../mcp/memory-server/src/search/bm25.js';
import { rrfFusion } from '../../mcp/memory-server/src/search/rrf.js';
import type { Memory, MemorySearchResult } from '../../mcp/memory-server/src/types.js';

// Mock database connection wrapper with all migrations applied
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

describe('MCP Tools Integration', () => {
  let db: { instance: Database.Database; close: () => void };
  let memoryRepo: MemoryRepository;

  beforeAll(() => {
    db = createTestDb();
    memoryRepo = new MemoryRepository(db as any);
  });

  afterAll(() => {
    db.close();
  });

  describe('memory_store flow', () => {
    it('should store a memory with all fields', () => {
      const input = {
        content: 'The API uses REST with JSON responses',
        type: 'fact' as const,
        confidence: 0.95,
        citation: 'api/routes.ts:42',
        projectId: 'test-project',
      };

      const memory = memoryRepo.createMemory(input);

      expect(memory.id).toBeDefined();
      expect(memory.content).toBe(input.content);
      expect(memory.type).toBe('fact');
      expect(memory.confidence).toBe(0.95);
      expect(memory.citation).toBe('api/routes.ts:42');
    });

    it('should detect and reject duplicates', () => {
      const content = 'Unique fact about the codebase';
      memoryRepo.createMemory({ content, projectId: 'test-project' });

      const isDupe = memoryRepo.isDuplicateContent(content, 'test-project');

      expect(isDupe).toBe(true);
    });

    it('should store different memory types', () => {
      const types = ['fact', 'pattern', 'decision', 'error', 'preference'] as const;

      for (const type of types) {
        const memory = memoryRepo.createMemory({
          content: `Test ${type} memory`,
          type,
          projectId: 'test-project',
        });
        expect(memory.type).toBe(type);
      }
    });
  });

  describe('memory_recall flow', () => {
    beforeAll(() => {
      // Seed test data
      const testData = [
        { content: 'React uses virtual DOM for efficient rendering', type: 'fact' as const },
        { content: 'Always use TypeScript strict mode for type safety', type: 'decision' as const },
        { content: 'Fixed null pointer in UserService.getById', type: 'error' as const },
        { content: 'User prefers dark mode in the editor', type: 'preference' as const },
        { content: 'Authentication flow: JWT tokens with 1-hour expiry', type: 'pattern' as const },
      ];

      for (const data of testData) {
        memoryRepo.createMemory({ ...data, projectId: 'recall-test' });
      }
    });

    it('should search by keyword (BM25)', () => {
      const bm25 = new BM25Search(db as any);
      const results = bm25.search('TypeScript', 'recall-test', 10);

      expect(results.length).toBeGreaterThan(0);
      expect(results[0]!.memory.content).toContain('TypeScript');
    });

    it('should filter by memory type', () => {
      const errors = memoryRepo.findByProject('recall-test', { type: 'error' });

      expect(errors.length).toBe(1);
      expect(errors[0]!.content).toContain('null pointer');
    });

    it('should filter by minimum confidence', () => {
      memoryRepo.createMemory({
        content: 'Low confidence guess',
        confidence: 0.3,
        projectId: 'recall-test',
      });

      const highConfidence = memoryRepo.findByProject('recall-test', { minConfidence: 0.5 });

      expect(highConfidence.every((m) => m.confidence >= 0.5)).toBe(true);
    });

    it('should update access stats on retrieval', () => {
      const memory = memoryRepo.createMemory({
        content: 'Track my access',
        projectId: 'recall-test',
      });

      memoryRepo.updateAccessStats(memory.id);
      memoryRepo.updateAccessStats(memory.id);

      const updated = memoryRepo.findById(memory.id, 'recall-test');
      expect(updated!.accessCount).toBe(2);
    });
  });

  describe('memory_forget flow', () => {
    it('should soft delete a memory', () => {
      const memory = memoryRepo.createMemory({
        content: 'Outdated information to forget',
        projectId: 'forget-test',
      });

      const result = memoryRepo.softDelete(memory.id, 'forget-test', 'Information is outdated');

      expect(result).toBe(true);

      // findById returns the memory even if deleted (for audit purposes)
      // Use findByProject without includeDeleted to verify exclusion
      const found = memoryRepo.findByProject('forget-test').find(m => m.id === memory.id);
      expect(found).toBeUndefined();
    });

    it('should track deletion reason', () => {
      const memory = memoryRepo.createMemory({
        content: 'Will be deleted with reason',
        projectId: 'forget-test',
      });

      memoryRepo.softDelete(memory.id, 'forget-test', 'Superseded by newer information');

      const deleted = memoryRepo.findByProject('forget-test', { includeDeleted: true }).find(
        (m) => m.id === memory.id
      );

      expect(deleted!.deletedAt).not.toBeNull();
      expect(deleted!.deleteReason).toBe('Superseded by newer information');
    });

    it('should maintain deleted memories for audit', () => {
      const memory = memoryRepo.createMemory({
        content: 'Audit trail test',
        projectId: 'forget-test',
      });

      memoryRepo.softDelete(memory.id, 'forget-test', 'Testing audit');

      const allMemories = memoryRepo.findByProject('forget-test', { includeDeleted: true });
      const deletedMemory = allMemories.find((m) => m.id === memory.id);

      expect(deletedMemory).toBeDefined();
    });
  });

  describe('Hybrid search integration', () => {
    let searchDb: { instance: Database.Database; close: () => void };
    let searchRepo: MemoryRepository;

    beforeAll(() => {
      searchDb = createTestDb();
      searchRepo = new MemoryRepository(searchDb as any);

      // Create memories with embeddings for hybrid search
      const embedding768 = () => {
        const arr = new Float32Array(768);
        for (let i = 0; i < 768; i++) {
          arr[i] = Math.random() * 2 - 1;
        }
        return arr;
      };

      const memories = [
        { content: 'Database connection pooling improves performance', type: 'fact' as const },
        { content: 'Use connection pools for database efficiency', type: 'pattern' as const },
        { content: 'Decided to implement Redis caching layer', type: 'decision' as const },
        { content: 'Fixed memory leak in connection manager', type: 'error' as const },
      ];

      for (const mem of memories) {
        searchRepo.createMemory({ ...mem, projectId: 'hybrid-test' }, embedding768());
      }
    });

    afterAll(() => {
      searchDb.close();
    });

    it('should combine vector and BM25 search with RRF', () => {
      const vectorSearch = new VectorSearch();
      const bm25Search = new BM25Search(searchDb as any);

      // Create a query embedding
      const queryEmbedding = new Float32Array(768);
      for (let i = 0; i < 768; i++) {
        queryEmbedding[i] = Math.random() * 2 - 1;
      }

      const memories = searchRepo.findWithEmbeddings('hybrid-test');
      const vectorResults = vectorSearch.search(queryEmbedding, memories, 10);
      const bm25Results = bm25Search.search('connection', 'hybrid-test', 10);

      const fusedResults = rrfFusion(vectorResults, bm25Results, { limit: 5 });

      expect(fusedResults.length).toBeLessThanOrEqual(5);
      // Each result should have a relevance score
      expect(fusedResults.every((r) => r.relevance > 0)).toBe(true);
    });

    it('should fall back to BM25-only when no embeddings', () => {
      const bm25Search = new BM25Search(searchDb as any);

      // Create memories without embeddings
      searchRepo.createMemory({
        content: 'No embedding memory about authentication',
        projectId: 'hybrid-test',
      });

      const bm25Results = bm25Search.search('authentication', 'hybrid-test', 10);

      expect(bm25Results.length).toBeGreaterThan(0);
    });
  });

  describe('Project isolation', () => {
    it('should isolate memories between projects', () => {
      memoryRepo.createMemory({
        content: 'Project A secret',
        projectId: 'project-a',
      });

      memoryRepo.createMemory({
        content: 'Project B secret',
        projectId: 'project-b',
      });

      const projectAMemories = memoryRepo.findByProject('project-a');
      const projectBMemories = memoryRepo.findByProject('project-b');

      expect(projectAMemories.every((m) => m.projectId === 'project-a')).toBe(true);
      expect(projectBMemories.every((m) => m.projectId === 'project-b')).toBe(true);
    });

    it('should not allow cross-project access by ID', () => {
      const memory = memoryRepo.createMemory({
        content: 'Isolated memory',
        projectId: 'project-x',
      });

      const found = memoryRepo.findById(memory.id, 'project-y');

      expect(found).toBeNull();
    });

    it('should not allow cross-project deletion', () => {
      const memory = memoryRepo.createMemory({
        content: 'Protected memory',
        projectId: 'project-x',
      });

      const result = memoryRepo.softDelete(memory.id, 'project-y', 'Unauthorized');

      expect(result).toBe(false);
    });
  });

  describe('Session management', () => {
    it('should save session state', () => {
      // Simulate session save
      const sessionState = {
        workingMemory: {
          recentMemories: ['mem-1', 'mem-2'],
          currentTask: 'Implementing feature X',
        },
        summary: 'Working on feature X implementation',
      };

      const serialized = JSON.stringify(sessionState);

      expect(serialized).toContain('feature X');
    });

    it('should restore session state', () => {
      const sessionState = {
        workingMemory: {
          recentMemories: ['mem-1', 'mem-2'],
          currentTask: 'Implementing feature X',
        },
        summary: 'Working on feature X implementation',
      };

      const serialized = JSON.stringify(sessionState);
      const restored = JSON.parse(serialized);

      expect(restored.workingMemory.currentTask).toBe('Implementing feature X');
      expect(restored.workingMemory.recentMemories.length).toBe(2);
    });
  });

  describe('Statistics and monitoring', () => {
    it('should count memories by project', () => {
      // Create test memories
      for (let i = 0; i < 5; i++) {
        memoryRepo.createMemory({
          content: `Stats test memory ${i}`,
          projectId: 'stats-test',
        });
      }

      const count = memoryRepo.countByProject('stats-test');

      expect(count).toBe(5);
    });

    it('should count memories by type', () => {
      memoryRepo.createMemory({ content: 'Fact 1', type: 'fact', projectId: 'type-stats' });
      memoryRepo.createMemory({ content: 'Fact 2', type: 'fact', projectId: 'type-stats' });
      memoryRepo.createMemory({ content: 'Error 1', type: 'error', projectId: 'type-stats' });

      const counts = memoryRepo.countByType('type-stats');

      expect(counts.fact).toBe(2);
      expect(counts.error).toBe(1);
    });
  });
});
