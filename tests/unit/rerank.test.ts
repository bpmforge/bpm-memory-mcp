import { describe, it, expect } from 'vitest';
import { rerankResults, filterByRecency, filterByConfidence, boostByType, diversifyResults } from '../../mcp/memory-server/src/search/rerank.js';
import type { Memory, MemorySearchResult, MemoryType } from '../../mcp/memory-server/src/types.js';

function createMockMemory(
  id: string,
  options: {
    type?: MemoryType;
    confidence?: number;
    accessCount?: number;
    accessedAt?: Date;
  } = {}
): Memory {
  return {
    id,
    content: `Content for ${id}`,
    embedding: null,
    type: options.type ?? 'fact',
    confidence: options.confidence ?? 1.0,
    citation: null,
    projectId: 'test-project',
    contentHash: `hash-${id}`,
    createdAt: new Date(),
    accessedAt: options.accessedAt ?? new Date(),
    accessCount: options.accessCount ?? 0,
    deletedAt: null,
    deleteReason: null,
  };
}

function createResult(memory: Memory, relevance: number): MemorySearchResult {
  return { memory, relevance };
}

describe('Re-ranking', () => {
  describe('Type-aware recency decay', () => {
    it('should apply strong decay to error memories', () => {
      const now = new Date();
      const oneWeekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

      const recentError = createResult(
        createMockMemory('recent-error', { type: 'error', accessedAt: now }),
        0.8
      );
      const oldError = createResult(
        createMockMemory('old-error', { type: 'error', accessedAt: oneWeekAgo }),
        0.8
      );

      const reranked = rerankResults([recentError, oldError], { recencyWeight: 0.5, now });

      // Recent error should rank higher than old error due to recency decay
      expect(reranked[0]!.memory.id).toBe('recent-error');
    });

    it('should apply minimal decay to fact memories', () => {
      const now = new Date();
      const oneMonthAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

      const recentFact = createResult(
        createMockMemory('recent-fact', { type: 'fact', accessedAt: now }),
        0.6
      );
      const oldFact = createResult(
        createMockMemory('old-fact', { type: 'fact', accessedAt: oneMonthAgo }),
        0.9
      );

      // Use low recency weight to let base score dominate for facts
      const reranked = rerankResults([recentFact, oldFact], { recencyWeight: 0.1, now });

      // Old fact with higher base relevance should still rank higher
      // because facts have minimal recency decay (0.9 factor)
      expect(reranked[0]!.memory.id).toBe('old-fact');
    });

    it('should apply moderate decay to decision memories', () => {
      const now = new Date();
      const twoWeeksAgo = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000);

      const results = [
        createResult(
          createMockMemory('recent-decision', { type: 'decision', accessedAt: now }),
          0.75
        ),
        createResult(
          createMockMemory('old-decision', { type: 'decision', accessedAt: twoWeeksAgo }),
          0.8
        ),
      ];

      const reranked = rerankResults(results, { recencyWeight: 0.2, now });

      // Both should be present with adjusted scores
      expect(reranked.length).toBe(2);
    });
  });

  describe('Confidence boosting', () => {
    it('should boost high-confidence memories', () => {
      const results = [
        createResult(createMockMemory('low-conf', { confidence: 0.3 }), 0.85),
        createResult(createMockMemory('high-conf', { confidence: 1.0 }), 0.8),
      ];

      // High confidence weight should boost high-conf memory
      const reranked = rerankResults(results, { confidenceWeight: 0.5 });

      // High confidence should be boosted to rank higher
      expect(reranked[0]!.memory.id).toBe('high-conf');
    });

    it('should respect base relevance when confidence weight is zero', () => {
      const results = [
        createResult(createMockMemory('low-conf', { confidence: 0.5 }), 0.9),
        createResult(createMockMemory('high-conf', { confidence: 1.0 }), 0.7),
      ];

      // Zero confidence weight means base relevance dominates
      const reranked = rerankResults(results, { confidenceWeight: 0, recencyWeight: 0, accessWeight: 0 });

      // Original order by relevance preserved
      expect(reranked[0]!.memory.id).toBe('low-conf');
    });
  });

  describe('Access frequency boosting', () => {
    it('should boost frequently accessed memories', () => {
      const results = [
        createResult(createMockMemory('rarely-accessed', { accessCount: 1 }), 0.8),
        createResult(createMockMemory('frequently-accessed', { accessCount: 500 }), 0.75),
      ];

      // High access weight should boost frequently accessed
      const reranked = rerankResults(results, { accessWeight: 0.4 });

      // Frequently accessed should be boosted
      expect(reranked[0]!.memory.id).toBe('frequently-accessed');
    });

    it('should apply logarithmic scaling to access count', () => {
      const results = [
        createResult(createMockMemory('moderate', { accessCount: 10 }), 0.8),
        createResult(createMockMemory('extreme', { accessCount: 10000 }), 0.75),
      ];

      const reranked = rerankResults(results, { accessWeight: 0.1 });

      // Both should be present - log scaling prevents extreme domination
      expect(reranked.length).toBe(2);
    });
  });

  describe('Combined factors', () => {
    it('should combine all factors', () => {
      const now = new Date();
      const oneWeekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

      const results = [
        createResult(
          createMockMemory('balanced', {
            type: 'fact',
            confidence: 0.8,
            accessCount: 50,
            accessedAt: oneWeekAgo,
          }),
          0.85
        ),
        createResult(
          createMockMemory('recent-popular', {
            type: 'error',
            confidence: 0.6,
            accessCount: 100,
            accessedAt: now,
          }),
          0.8
        ),
      ];

      const reranked = rerankResults(results, {
        recencyWeight: 0.2,
        confidenceWeight: 0.3,
        accessWeight: 0.1,
        now,
      });

      // Both should be scored with all factors
      expect(reranked.length).toBe(2);
      // Scores should be modified from original
      expect(reranked[0]!.relevance).not.toBe(0.85);
    });
  });

  describe('Edge cases', () => {
    it('should handle empty results', () => {
      const reranked = rerankResults([]);
      expect(reranked).toEqual([]);
    });

    it('should handle single result', () => {
      const results = [createResult(createMockMemory('single'), 0.9)];
      const reranked = rerankResults(results);

      expect(reranked.length).toBe(1);
    });

    it('should handle zero access count', () => {
      const results = [createResult(createMockMemory('zero-access', { accessCount: 0 }), 0.9)];

      const reranked = rerankResults(results, { accessWeight: 0.1 });

      expect(reranked.length).toBe(1);
    });

    it('should handle very old memories', () => {
      const now = new Date();
      const veryOld = new Date('2020-01-01');
      const results = [
        createResult(createMockMemory('ancient', { type: 'error', accessedAt: veryOld }), 0.9),
      ];

      const reranked = rerankResults(results, { recencyWeight: 0.3, now });

      // Should still return result, just with lower score due to recency decay
      expect(reranked.length).toBe(1);
      expect(reranked[0]!.relevance).toBeLessThan(0.9);
    });

    it('should preserve memory object in results', () => {
      const memory = createMockMemory('test', {
        type: 'decision',
        confidence: 0.75,
        accessCount: 42,
      });
      const results = [createResult(memory, 0.9)];

      const reranked = rerankResults(results, {
        recencyWeight: 0.2,
        confidenceWeight: 0.3,
        accessWeight: 0.1,
      });

      expect(reranked[0]!.memory.id).toBe('test');
      expect(reranked[0]!.memory.type).toBe('decision');
      expect(reranked[0]!.memory.confidence).toBe(0.75);
      expect(reranked[0]!.memory.accessCount).toBe(42);
    });
  });

  describe('Filter functions', () => {
    it('should filter by recency', () => {
      const now = new Date();
      const recent = new Date(now.getTime() - 5 * 24 * 60 * 60 * 1000); // 5 days ago
      const old = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000); // 30 days ago

      const results = [
        createResult(createMockMemory('recent', { accessedAt: recent }), 0.8),
        createResult(createMockMemory('old', { accessedAt: old }), 0.9),
      ];

      const filtered = filterByRecency(results, 7, now); // Max 7 days

      expect(filtered.length).toBe(1);
      expect(filtered[0]!.memory.id).toBe('recent');
    });

    it('should filter by confidence', () => {
      const results = [
        createResult(createMockMemory('high', { confidence: 0.9 }), 0.8),
        createResult(createMockMemory('low', { confidence: 0.3 }), 0.9),
      ];

      const filtered = filterByConfidence(results, 0.5);

      expect(filtered.length).toBe(1);
      expect(filtered[0]!.memory.id).toBe('high');
    });

    it('should boost by type', () => {
      const results = [
        createResult(createMockMemory('error-mem', { type: 'error' }), 0.5),
        createResult(createMockMemory('fact-mem', { type: 'fact' }), 0.8),
      ];

      const boosted = boostByType(results, ['error'], 2.0);

      // Error should now have higher relevance
      expect(boosted.find(r => r.memory.id === 'error-mem')!.relevance).toBe(1.0);
      expect(boosted.find(r => r.memory.id === 'fact-mem')!.relevance).toBe(0.8);
    });

    it('should diversify results by type', () => {
      const results = [
        createResult(createMockMemory('fact1', { type: 'fact' }), 0.9),
        createResult(createMockMemory('fact2', { type: 'fact' }), 0.85),
        createResult(createMockMemory('fact3', { type: 'fact' }), 0.8),
        createResult(createMockMemory('fact4', { type: 'fact' }), 0.75),
        createResult(createMockMemory('error1', { type: 'error' }), 0.7),
      ];

      const diversified = diversifyResults(results, 2); // Max 2 per type

      expect(diversified.length).toBe(3); // 2 facts + 1 error
      expect(diversified.filter(r => r.memory.type === 'fact').length).toBe(2);
    });
  });
});
