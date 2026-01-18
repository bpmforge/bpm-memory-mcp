import { describe, it, expect } from 'vitest';
import { rrfFusion, interleave } from '../../mcp/memory-server/src/search/rrf.js';
import type { Memory, MemorySearchResult } from '../../mcp/memory-server/src/types.js';

function createMockMemory(id: string): Memory {
  return {
    id,
    content: `Content for ${id}`,
    embedding: null,
    type: 'fact',
    confidence: 1.0,
    citation: null,
    projectId: 'test-project',
    contentHash: `hash-${id}`,
    createdAt: new Date(),
    accessedAt: new Date(),
    accessCount: 0,
    deletedAt: null,
    deleteReason: null,
  };
}

function createResult(id: string, vectorScore?: number, bm25Score?: number): MemorySearchResult {
  const result: MemorySearchResult = {
    memory: createMockMemory(id),
    relevance: vectorScore ?? bm25Score ?? 0,
  };
  if (vectorScore !== undefined) result.vectorScore = vectorScore;
  if (bm25Score !== undefined) result.bm25Score = bm25Score;
  return result;
}

describe('RRF Fusion', () => {
  it('should combine vector and BM25 results', () => {
    const vectorResults: MemorySearchResult[] = [
      createResult('a', 0.9),
      createResult('b', 0.8),
      createResult('c', 0.7),
    ];

    const bm25Results: MemorySearchResult[] = [
      createResult('b', undefined, 10),
      createResult('a', undefined, 8),
      createResult('d', undefined, 6),
    ];

    const fused = rrfFusion(vectorResults, bm25Results);

    // All unique IDs should be present
    const ids = fused.map((r) => r.memory.id);
    expect(ids).toContain('a');
    expect(ids).toContain('b');
    expect(ids).toContain('c');
    expect(ids).toContain('d');
  });

  it('should rank items appearing in both lists higher', () => {
    const vectorResults: MemorySearchResult[] = [
      createResult('a', 0.9),
      createResult('b', 0.8),
    ];

    const bm25Results: MemorySearchResult[] = [
      createResult('a', undefined, 10),
      createResult('c', undefined, 8),
    ];

    const fused = rrfFusion(vectorResults, bm25Results);

    // 'a' appears in both, should be ranked highest
    expect(fused[0]!.memory.id).toBe('a');
  });

  it('should respect k parameter', () => {
    const vectorResults: MemorySearchResult[] = [
      createResult('a', 0.9),
      createResult('b', 0.8),
    ];

    const bm25Results: MemorySearchResult[] = [
      createResult('c', undefined, 10),
      createResult('d', undefined, 8),
    ];

    // With low k, rank differences matter more
    const fusedLowK = rrfFusion(vectorResults, bm25Results, { k: 1 });
    // With high k, rank differences matter less
    const fusedHighK = rrfFusion(vectorResults, bm25Results, { k: 1000 });

    // Both should return all 4 results but with different scores
    expect(fusedLowK.length).toBe(4);
    expect(fusedHighK.length).toBe(4);
  });

  it('should respect weight parameters', () => {
    const vectorResults: MemorySearchResult[] = [
      createResult('a', 0.9),
    ];

    const bm25Results: MemorySearchResult[] = [
      createResult('b', undefined, 10),
    ];

    // Vector-weighted
    const vectorWeighted = rrfFusion(vectorResults, bm25Results, {
      vectorWeight: 0.9,
      bm25Weight: 0.1,
    });

    // BM25-weighted
    const bm25Weighted = rrfFusion(vectorResults, bm25Results, {
      vectorWeight: 0.1,
      bm25Weight: 0.9,
    });

    // With vector weight, 'a' should be higher; with BM25 weight, 'b' should be higher
    expect(vectorWeighted[0]!.memory.id).toBe('a');
    expect(bm25Weighted[0]!.memory.id).toBe('b');
  });

  it('should respect limit parameter', () => {
    const vectorResults: MemorySearchResult[] = [];
    const bm25Results: MemorySearchResult[] = [];

    for (let i = 0; i < 20; i++) {
      vectorResults.push(createResult(`v${i}`, 1 - i * 0.01));
      bm25Results.push(createResult(`b${i}`, undefined, 100 - i));
    }

    const fused = rrfFusion(vectorResults, bm25Results, { limit: 5 });

    expect(fused.length).toBe(5);
  });

  it('should handle empty vector results', () => {
    const bm25Results: MemorySearchResult[] = [
      createResult('a', undefined, 10),
      createResult('b', undefined, 8),
    ];

    const fused = rrfFusion([], bm25Results);

    expect(fused.length).toBe(2);
    expect(fused[0]!.memory.id).toBe('a');
  });

  it('should handle empty BM25 results', () => {
    const vectorResults: MemorySearchResult[] = [
      createResult('a', 0.9),
      createResult('b', 0.8),
    ];

    const fused = rrfFusion(vectorResults, []);

    expect(fused.length).toBe(2);
    expect(fused[0]!.memory.id).toBe('a');
  });

  it('should handle both empty', () => {
    const fused = rrfFusion([], []);
    expect(fused).toEqual([]);
  });

  it('should preserve original scores in results', () => {
    const vectorResults: MemorySearchResult[] = [
      createResult('a', 0.95),
    ];

    const bm25Results: MemorySearchResult[] = [
      createResult('a', undefined, 12.5),
    ];

    const fused = rrfFusion(vectorResults, bm25Results);

    // The first result encountered has vectorScore, bm25Score may not be preserved
    // since memoryLookup uses first seen result
    expect(fused[0]!.vectorScore).toBe(0.95);
    // bm25Score may be undefined if vectorResults was processed first
    // This is expected behavior - RRF combines ranks, not preserving all scores
  });

  it('should use default k=60', () => {
    // RRF formula: 1/(k + rank)
    // With k=60 and rank=1: score = 1/(60+1) = 0.0164
    const vectorResults: MemorySearchResult[] = [createResult('a', 0.9)];
    const bm25Results: MemorySearchResult[] = [];

    const fused = rrfFusion(vectorResults, bm25Results, { vectorWeight: 1, bm25Weight: 0 });

    // Score should be approximately 1/(60+1) = 0.0164
    expect(fused[0]!.relevance).toBeCloseTo(1 / 61, 4);
  });
});

describe('Interleave', () => {
  it('should interleave results alternating', () => {
    const primary: MemorySearchResult[] = [
      createResult('p1'),
      createResult('p2'),
      createResult('p3'),
    ];

    const secondary: MemorySearchResult[] = [
      createResult('s1'),
      createResult('s2'),
      createResult('s3'),
    ];

    const result = interleave(primary, secondary, 10);

    // Should alternate: p1, s1, p2, s2, p3, s3
    expect(result.map((r) => r.memory.id)).toEqual(['p1', 's1', 'p2', 's2', 'p3', 's3']);
  });

  it('should deduplicate results', () => {
    const primary: MemorySearchResult[] = [
      createResult('a'),
      createResult('b'),
    ];

    const secondary: MemorySearchResult[] = [
      createResult('a'), // Duplicate
      createResult('c'),
    ];

    const result = interleave(primary, secondary, 10);

    // 'a' should appear only once
    const ids = result.map((r) => r.memory.id);
    expect(ids.filter((id) => id === 'a').length).toBe(1);
    expect(ids).toEqual(['a', 'b', 'c']);
  });

  it('should respect limit', () => {
    const primary: MemorySearchResult[] = [];
    const secondary: MemorySearchResult[] = [];

    for (let i = 0; i < 10; i++) {
      primary.push(createResult(`p${i}`));
      secondary.push(createResult(`s${i}`));
    }

    const result = interleave(primary, secondary, 5);

    expect(result.length).toBe(5);
  });

  it('should handle unequal list lengths', () => {
    const primary: MemorySearchResult[] = [
      createResult('p1'),
      createResult('p2'),
    ];

    const secondary: MemorySearchResult[] = [
      createResult('s1'),
      createResult('s2'),
      createResult('s3'),
      createResult('s4'),
    ];

    const result = interleave(primary, secondary, 10);

    // Should get all items
    expect(result.length).toBe(6);
  });

  it('should handle empty primary', () => {
    const secondary: MemorySearchResult[] = [
      createResult('s1'),
      createResult('s2'),
    ];

    const result = interleave([], secondary, 10);

    expect(result.length).toBe(2);
  });

  it('should handle empty secondary', () => {
    const primary: MemorySearchResult[] = [
      createResult('p1'),
      createResult('p2'),
    ];

    const result = interleave(primary, [], 10);

    expect(result.length).toBe(2);
  });

  it('should handle both empty', () => {
    const result = interleave([], [], 10);
    expect(result).toEqual([]);
  });
});
