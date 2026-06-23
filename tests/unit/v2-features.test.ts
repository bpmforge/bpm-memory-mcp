import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { MemoryRepository } from '../../mcp/memory-server/src/storage/repository.js';
import { MIGRATIONS } from '../../mcp/memory-server/src/storage/schema.js';
import { detectLanguage } from '../../mcp/memory-server/src/language/detector.js';
import { parseCodeContext } from '../../mcp/memory-server/src/language/context.js';
import { FeedbackType, SymbolType } from '../../mcp/memory-server/src/types.js';

// Create a mock DatabaseConnection interface with all migrations applied
function createTestDb(): {
  instance: Database.Database;
  close: () => void;
  transaction: <T>(fn: () => T) => T;
} {
  const db = new Database(':memory:');
  for (const migration of MIGRATIONS) {
    db.exec(migration.up);
  }
  return {
    instance: db,
    close: () => db.close(),
    transaction: <T>(fn: () => T): T => db.transaction(fn)(),
  };
}

describe('V2 Features', () => {
  describe('Language Detection', () => {
    it('should detect TypeScript from .ts extension', () => {
      expect(detectLanguage('src/index.ts:42')).toBe('typescript');
      expect(detectLanguage('components/App.tsx:100')).toBe('typescript');
    });

    it('should detect JavaScript from .js extension', () => {
      expect(detectLanguage('lib/utils.js:15')).toBe('javascript');
      expect(detectLanguage('components/Button.jsx:50')).toBe('javascript');
    });

    it('should detect Python from .py extension', () => {
      expect(detectLanguage('main.py:1')).toBe('python');
    });

    it('should detect Rust from .rs extension', () => {
      expect(detectLanguage('src/lib.rs:100')).toBe('rust');
    });

    it('should detect Go from .go extension', () => {
      expect(detectLanguage('main.go:25')).toBe('go');
    });

    it('should detect shell from .sh extension', () => {
      expect(detectLanguage('scripts/deploy.sh:10')).toBe('shell');
    });

    it('should return null for unknown extensions', () => {
      expect(detectLanguage('data.xyz:1')).toBeNull();
    });

    it('should return null for null/undefined input', () => {
      expect(detectLanguage(null)).toBeNull();
      expect(detectLanguage(undefined)).toBeNull();
    });

    it('should return null for malformed citations', () => {
      expect(detectLanguage('no-colon-here')).toBeNull();
    });
  });

  describe('Code Context Parsing', () => {
    it('should parse simple file:line citation', () => {
      const context = parseCodeContext('src/index.ts:42');
      expect(context).not.toBeNull();
      expect(context!.filePath).toBe('src/index.ts');
      expect(context!.startLine).toBe(42);
      expect(context!.endLine).toBeUndefined();
    });

    it('should parse file:start-end citation', () => {
      const context = parseCodeContext('src/utils.ts:10-25');
      expect(context).not.toBeNull();
      expect(context!.filePath).toBe('src/utils.ts');
      expect(context!.startLine).toBe(10);
      expect(context!.endLine).toBe(25);
    });

    it('should parse citation with symbol name', () => {
      const context = parseCodeContext('src/api.ts:100:handleRequest');
      expect(context).not.toBeNull();
      expect(context!.filePath).toBe('src/api.ts');
      expect(context!.startLine).toBe(100);
      expect(context!.symbolName).toBe('handleRequest');
    });

    it('should return null for invalid input', () => {
      expect(parseCodeContext(null)).toBeNull();
      expect(parseCodeContext(undefined)).toBeNull();
      expect(parseCodeContext('')).toBeNull();
    });
  });

  describe('Memory Versioning', () => {
    let db: { instance: Database.Database; close: () => void };
    let repo: MemoryRepository;

    beforeEach(() => {
      db = createTestDb();
      repo = new MemoryRepository(db as any);
    });

    afterEach(() => {
      db.close();
    });

    it('should create memory with version 1', () => {
      const memory = repo.createMemory({
        content: 'Initial content',
        projectId: 'test-proj',
      });

      expect(memory.version).toBe(1);
      expect(memory.supersedesId).toBeNull();
      expect(memory.supersededBy).toBeNull();
    });

    it('should create superseding memory with incremented version', () => {
      const original = repo.createMemory({
        content: 'Original content',
        projectId: 'test-proj',
      });

      const updated = repo.createSupersedingMemory(original.id, 'test-proj', 'Updated content');

      expect(updated.version).toBe(2);
      expect(updated.supersedesId).toBe(original.id);
      expect(updated.content).toBe('Updated content');
    });

    it('should mark original as superseded', () => {
      const original = repo.createMemory({
        content: 'Original content',
        projectId: 'test-proj',
      });

      const updated = repo.createSupersedingMemory(original.id, 'test-proj', 'Updated content');

      const refreshed = repo.findById(original.id, 'test-proj');
      expect(refreshed!.supersededBy).toBe(updated.id);
      expect(refreshed!.supersededAt).not.toBeNull();
    });

    it('should retrieve version history', () => {
      const v1 = repo.createMemory({
        content: 'Version 1',
        projectId: 'test-proj',
      });

      const v2 = repo.createSupersedingMemory(v1.id, 'test-proj', 'Version 2');
      const v3 = repo.createSupersedingMemory(v2.id, 'test-proj', 'Version 3');

      const history = repo.getVersionHistory(v3.id, 'test-proj');

      expect(history.length).toBe(3);
      expect(history[0]!.content).toBe('Version 3');
      expect(history[1]!.content).toBe('Version 2');
      expect(history[2]!.content).toBe('Version 1');
    });

    it('should get latest version in chain', () => {
      const v1 = repo.createMemory({
        content: 'Version 1',
        projectId: 'test-proj',
      });

      repo.createSupersedingMemory(v1.id, 'test-proj', 'Version 2');
      const v3 = repo.createSupersedingMemory(v1.id, 'test-proj', 'Version 3 from v1');

      // Latest should work from any point in chain
      const latestFromV1 = repo.getLatestVersion(v1.id, 'test-proj');
      expect(latestFromV1).not.toBeNull();
      expect(latestFromV1!.supersededBy).toBeNull();
    });

    it('resolves full history from any id in the chain (memory_history contract)', () => {
      // Mirrors the memory_history tool: getVersionHistory anchors on the head,
      // so the tool first resolves any id to its latest version.
      const v1 = repo.createMemory({ content: 'Version 1', projectId: 'test-proj' });
      const v2 = repo.createSupersedingMemory(v1.id, 'test-proj', 'Version 2');
      repo.createSupersedingMemory(v2.id, 'test-proj', 'Version 3');

      const head = repo.getLatestVersion(v1.id, 'test-proj'); // passed an OLD id
      const history = repo.getVersionHistory(head!.id, 'test-proj');

      expect(history.map((m) => m.content)).toEqual(['Version 3', 'Version 2', 'Version 1']);
      expect(history[0]!.supersededBy).toBeNull(); // newest is the head
    });
  });

  describe('Feedback System', () => {
    let db: { instance: Database.Database; close: () => void };
    let repo: MemoryRepository;

    beforeEach(() => {
      db = createTestDb();
      repo = new MemoryRepository(db as any);
    });

    afterEach(() => {
      db.close();
    });

    it('should record helpful feedback and increase confidence', () => {
      const memory = repo.createMemory({
        content: 'Helpful memory',
        confidence: 0.8,
        projectId: 'test-proj',
      });

      repo.recordFeedback(memory.id, 'test-proj', FeedbackType.HELPFUL);

      const updated = repo.findById(memory.id, 'test-proj');
      expect(updated!.confidence).toBeCloseTo(0.85, 2);
    });

    it('should record wrong feedback and decrease confidence', () => {
      const memory = repo.createMemory({
        content: 'Wrong memory',
        confidence: 0.8,
        projectId: 'test-proj',
      });

      repo.recordFeedback(memory.id, 'test-proj', FeedbackType.WRONG);

      const updated = repo.findById(memory.id, 'test-proj');
      expect(updated!.confidence).toBeCloseTo(0.6, 2);
      expect(updated!.flaggedAt).not.toBeNull();
    });

    it('should record outdated feedback and flag memory', () => {
      const memory = repo.createMemory({
        content: 'Outdated memory',
        confidence: 1.0,
        projectId: 'test-proj',
      });

      repo.recordFeedback(memory.id, 'test-proj', FeedbackType.OUTDATED);

      const updated = repo.findById(memory.id, 'test-proj');
      expect(updated!.confidence).toBeCloseTo(0.7, 2);
      expect(updated!.flaggedAt).not.toBeNull();
    });

    it('should bound confidence between 0.1 and 1.0', () => {
      const memory = repo.createMemory({
        content: 'Test memory',
        confidence: 0.15,
        projectId: 'test-proj',
      });

      // Multiple wrong feedbacks should hit floor
      repo.recordFeedback(memory.id, 'test-proj', FeedbackType.WRONG);

      const updated = repo.findById(memory.id, 'test-proj');
      expect(updated!.confidence).toBeGreaterThanOrEqual(0.1);
    });

    it('should store feedback record', () => {
      const memory = repo.createMemory({
        content: 'Test memory',
        projectId: 'test-proj',
      });

      const feedback = repo.recordFeedback(memory.id, 'test-proj', FeedbackType.HELPFUL);

      expect(feedback.id).toBeDefined();
      expect(feedback.memoryId).toBe(memory.id);
      expect(feedback.feedbackType).toBe(FeedbackType.HELPFUL);

      const history = repo.getFeedback(memory.id);
      expect(history.length).toBe(1);
    });
  });

  describe('Staleness Flags', () => {
    let db: { instance: Database.Database; close: () => void };
    let repo: MemoryRepository;

    beforeEach(() => {
      db = createTestDb();
      repo = new MemoryRepository(db as any);
    });

    afterEach(() => {
      db.close();
    });

    it('should flag memory as stale', () => {
      const memory = repo.createMemory({
        content: 'Stale memory',
        projectId: 'test-proj',
      });

      repo.flagAsStale(memory.id, 'test-proj', 'Source file deleted');

      const updated = repo.findById(memory.id, 'test-proj');
      expect(updated!.flaggedAt).not.toBeNull();
      expect(updated!.flaggedReason).toBe('Source file deleted');
    });

    it('should clear stale flag', () => {
      const memory = repo.createMemory({
        content: 'Stale memory',
        projectId: 'test-proj',
      });

      repo.flagAsStale(memory.id, 'test-proj', 'Test reason');
      repo.clearStaleFlag(memory.id, 'test-proj');

      const updated = repo.findById(memory.id, 'test-proj');
      expect(updated!.flaggedAt).toBeNull();
      expect(updated!.flaggedReason).toBeNull();
    });

    it('should exclude stale memories by default in findByProject', () => {
      repo.createMemory({
        content: 'Active memory',
        projectId: 'test-proj',
      });

      const staleMemory = repo.createMemory({
        content: 'Stale memory',
        projectId: 'test-proj',
      });

      repo.flagAsStale(staleMemory.id, 'test-proj', 'Test');

      const active = repo.findByProject('test-proj');
      expect(active.length).toBe(1);
      expect(active[0]!.content).toBe('Active memory');
    });

    it('should include stale memories when specified', () => {
      repo.createMemory({
        content: 'Active memory',
        projectId: 'test-proj',
      });

      const staleMemory = repo.createMemory({
        content: 'Stale memory',
        projectId: 'test-proj',
      });

      repo.flagAsStale(staleMemory.id, 'test-proj', 'Test');

      const all = repo.findByProject('test-proj', { includeStale: true });
      expect(all.length).toBe(2);
    });
  });

  describe('Language Auto-Detection on Create', () => {
    let db: { instance: Database.Database; close: () => void };
    let repo: MemoryRepository;

    beforeEach(() => {
      db = createTestDb();
      repo = new MemoryRepository(db as any);
    });

    afterEach(() => {
      db.close();
    });

    it('should auto-detect language from TypeScript citation', () => {
      const memory = repo.createMemory({
        content: 'Auth uses JWT tokens',
        citation: 'src/auth/handler.ts:42',
        projectId: 'test-proj',
      });

      expect(memory.language).toBe('typescript');
    });

    it('should auto-detect language from Python citation', () => {
      const memory = repo.createMemory({
        content: 'Uses Django ORM',
        citation: 'app/models.py:100',
        projectId: 'test-proj',
      });

      expect(memory.language).toBe('python');
    });

    it('should allow explicit language override', () => {
      const memory = repo.createMemory({
        content: 'Config documentation',
        citation: 'README.md:50',
        language: 'other',
        projectId: 'test-proj',
      });

      expect(memory.language).toBe('other');
    });

    it('should preserve null language when no citation', () => {
      const memory = repo.createMemory({
        content: 'No citation memory',
        projectId: 'test-proj',
      });

      expect(memory.language).toBeNull();
    });
  });
});
