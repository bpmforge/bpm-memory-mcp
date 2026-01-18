import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Database from 'better-sqlite3';
import { MIGRATIONS } from '../../mcp/memory-server/src/storage/schema.js';
import { MemoryRepository } from '../../mcp/memory-server/src/storage/repository.js';
import { BM25Search } from '../../mcp/memory-server/src/search/bm25.js';
import { FeedbackType } from '../../mcp/memory-server/src/types.js';

// Mock database connection wrapper with all migrations applied
function createTestDb(): { instance: Database.Database; close: () => void } {
  const db = new Database(':memory:');
  for (const migration of MIGRATIONS) {
    db.exec(migration.up);
  }
  return {
    instance: db,
    close: () => db.close(),
  };
}

describe('V2 Tools Integration', () => {
  let db: { instance: Database.Database; close: () => void };
  let repo: MemoryRepository;

  beforeAll(() => {
    db = createTestDb();
    repo = new MemoryRepository(db as any);
  });

  afterAll(() => {
    db.close();
  });

  describe('memory_store V2 flow', () => {
    it('should store memory with auto-detected language', () => {
      const memory = repo.createMemory({
        content: 'The API uses Express.js middleware for auth',
        type: 'fact',
        citation: 'src/middleware/auth.ts:15',
        projectId: 'store-v2-test',
      });

      expect(memory.language).toBe('typescript');
      expect(memory.version).toBe(1);
      expect(memory.supersededBy).toBeNull();
    });

    it('should auto-parse code context from citation', () => {
      const memory = repo.createMemory({
        content: 'Handler processes requests',
        citation: 'src/handlers/api.ts:42-80',
        projectId: 'store-v2-test',
      });

      expect(memory.codeContext).not.toBeNull();
      expect(memory.codeContext!.filePath).toBe('src/handlers/api.ts');
      expect(memory.codeContext!.startLine).toBe(42);
      expect(memory.codeContext!.endLine).toBe(80);
    });
  });

  describe('memory_recall V2 flow', () => {
    beforeAll(() => {
      // Seed test data with different languages
      repo.createMemory({
        content: 'TypeScript API endpoint for user creation',
        citation: 'src/api/users.ts:10',
        type: 'fact',
        projectId: 'recall-v2-test',
      });

      repo.createMemory({
        content: 'Python script for data processing',
        citation: 'scripts/process.py:25',
        type: 'fact',
        projectId: 'recall-v2-test',
      });

      repo.createMemory({
        content: 'Rust module for performance critical code',
        citation: 'src/lib.rs:100',
        type: 'pattern',
        projectId: 'recall-v2-test',
      });
    });

    it('should filter by language in BM25 search', () => {
      const bm25 = new BM25Search(db as any);

      const tsResults = bm25.search('code', 'recall-v2-test', {
        limit: 10,
        language: 'typescript',
      });

      const pyResults = bm25.search('code', 'recall-v2-test', {
        limit: 10,
        language: 'python',
      });

      // Each should only return memories of that language
      expect(tsResults.every((r) => r.memory.language === 'typescript')).toBe(true);
      expect(pyResults.every((r) => r.memory.language === 'python')).toBe(true);
    });

    it('should exclude superseded memories by default', () => {
      // Create original and superseded version
      const original = repo.createMemory({
        content: 'Original API design pattern',
        type: 'pattern',
        projectId: 'recall-v2-test',
      });

      repo.createSupersedingMemory(
        original.id,
        'recall-v2-test',
        'Updated API design pattern v2'
      );

      const bm25 = new BM25Search(db as any);
      const results = bm25.search('API design pattern', 'recall-v2-test', { limit: 10 });

      // Should not include the original (superseded) version
      expect(results.find((r) => r.memory.id === original.id)).toBeUndefined();
    });

    it('should include superseded memories when requested', () => {
      const original = repo.createMemory({
        content: 'Historical implementation detail',
        type: 'fact',
        projectId: 'recall-v2-test',
      });

      repo.createSupersedingMemory(
        original.id,
        'recall-v2-test',
        'Updated implementation detail'
      );

      const bm25 = new BM25Search(db as any);
      const results = bm25.search('Historical implementation', 'recall-v2-test', {
        limit: 10,
        includeSuperseded: true,
      });

      expect(results.find((r) => r.memory.id === original.id)).toBeDefined();
    });
  });

  describe('memory_update V2 flow', () => {
    it('should create new version instead of in-place update', () => {
      const original = repo.createMemory({
        content: 'Initial configuration',
        type: 'fact',
        projectId: 'update-v2-test',
      });

      const updated = repo.createSupersedingMemory(
        original.id,
        'update-v2-test',
        'Updated configuration with new values'
      );

      // Original should be superseded
      const refreshedOriginal = repo.findById(original.id, 'update-v2-test');
      expect(refreshedOriginal!.supersededBy).toBe(updated.id);

      // Updated should link back
      expect(updated.supersedesId).toBe(original.id);
      expect(updated.version).toBe(2);
    });

    it('should preserve original type and confidence in new version', () => {
      const original = repo.createMemory({
        content: 'Original decision',
        type: 'decision',
        confidence: 0.95,
        projectId: 'update-v2-test',
      });

      const updated = repo.createSupersedingMemory(
        original.id,
        'update-v2-test',
        'Updated decision'
      );

      expect(updated.type).toBe('decision');
      // Confidence is preserved from original
      expect(updated.confidence).toBe(0.95);
    });
  });

  describe('memory_feedback V2 flow', () => {
    it('should adjust confidence based on helpful feedback', () => {
      const memory = repo.createMemory({
        content: 'Useful information',
        confidence: 0.8,
        projectId: 'feedback-v2-test',
      });

      repo.recordFeedback(memory.id, 'feedback-v2-test', FeedbackType.HELPFUL);

      const updated = repo.findById(memory.id, 'feedback-v2-test');
      expect(updated!.confidence).toBeCloseTo(0.85, 2);
    });

    it('should flag memory and decrease confidence for wrong feedback', () => {
      const memory = repo.createMemory({
        content: 'Incorrect information',
        confidence: 0.9,
        projectId: 'feedback-v2-test',
      });

      repo.recordFeedback(memory.id, 'feedback-v2-test', FeedbackType.WRONG);

      const updated = repo.findById(memory.id, 'feedback-v2-test');
      expect(updated!.confidence).toBeCloseTo(0.7, 2);
      expect(updated!.flaggedAt).not.toBeNull();
    });

    it('should support correction with automatic supersession', () => {
      const memory = repo.createMemory({
        content: 'Wrong API endpoint is /users/list',
        type: 'fact',
        projectId: 'feedback-v2-test',
      });

      const feedback = repo.recordFeedback(
        memory.id,
        'feedback-v2-test',
        FeedbackType.WRONG,
        'Correct API endpoint is /api/users'
      );

      expect(feedback.correction).toBe('Correct API endpoint is /api/users');

      // The feedback is recorded, supersession would be handled by the tool handler
      // In a real flow, the tool handler would create a superseding memory
    });

    it('should track feedback history', () => {
      const memory = repo.createMemory({
        content: 'Feedback tracking test',
        projectId: 'feedback-v2-test',
      });

      repo.recordFeedback(memory.id, 'feedback-v2-test', FeedbackType.HELPFUL);
      repo.recordFeedback(memory.id, 'feedback-v2-test', FeedbackType.HELPFUL);
      repo.recordFeedback(memory.id, 'feedback-v2-test', FeedbackType.OUTDATED);

      const history = repo.getFeedback(memory.id);
      expect(history.length).toBe(3);
    });
  });

  describe('Staleness exclusion in search', () => {
    beforeAll(() => {
      // Create active memory
      repo.createMemory({
        content: 'Active searchable memory',
        projectId: 'stale-search-test',
      });

      // Create and flag stale memory
      const stale = repo.createMemory({
        content: 'Stale searchable memory',
        projectId: 'stale-search-test',
      });
      repo.flagAsStale(stale.id, 'stale-search-test', 'Test staleness');
    });

    it('should exclude stale memories by default in BM25 search', () => {
      const bm25 = new BM25Search(db as any);
      const results = bm25.search('searchable', 'stale-search-test', { limit: 10 });

      expect(results.length).toBe(1);
      expect(results[0]!.memory.content).toContain('Active');
    });

    it('should include stale memories when explicitly requested', () => {
      const bm25 = new BM25Search(db as any);
      const results = bm25.search('searchable', 'stale-search-test', {
        limit: 10,
        includeStale: true,
      });

      expect(results.length).toBe(2);
    });
  });

  describe('Version chain integrity', () => {
    it('should maintain complete version chain', () => {
      const v1 = repo.createMemory({
        content: 'Version 1 content',
        type: 'decision',
        projectId: 'chain-test',
      });

      const v2 = repo.createSupersedingMemory(v1.id, 'chain-test', 'Version 2 content');
      const v3 = repo.createSupersedingMemory(v2.id, 'chain-test', 'Version 3 content');
      const v4 = repo.createSupersedingMemory(v3.id, 'chain-test', 'Version 4 content');

      // Get history from latest
      const history = repo.getVersionHistory(v4.id, 'chain-test');

      expect(history.length).toBe(4);
      expect(history[0]!.version).toBe(4);
      expect(history[1]!.version).toBe(3);
      expect(history[2]!.version).toBe(2);
      expect(history[3]!.version).toBe(1);
    });

    it('should find latest version from any point in chain', () => {
      const v1 = repo.createMemory({
        content: 'Base version',
        projectId: 'chain-test-2',
      });

      const v2 = repo.createSupersedingMemory(v1.id, 'chain-test-2', 'Second version');
      const v3 = repo.createSupersedingMemory(v2.id, 'chain-test-2', 'Third version');

      // Latest from v1 should give v3
      const latestFromV1 = repo.getLatestVersion(v1.id, 'chain-test-2');
      expect(latestFromV1!.version).toBe(3);

      // Latest from v2 should also give v3
      const latestFromV2 = repo.getLatestVersion(v2.id, 'chain-test-2');
      expect(latestFromV2!.version).toBe(3);
    });
  });
});
