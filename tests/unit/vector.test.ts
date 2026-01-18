import { describe, it, expect } from 'vitest';
import { cosineSimilarity, normalizeVector, VectorSearch } from '../../mcp/memory-server/src/search/vector.js';
import type { Memory, MemorySearchResult } from '../../mcp/memory-server/src/types.js';

describe('Cosine Similarity', () => {
  it('should return 1 for identical vectors', () => {
    const a = new Float32Array([1, 0, 0]);
    const b = new Float32Array([1, 0, 0]);

    expect(cosineSimilarity(a, b)).toBeCloseTo(1.0, 5);
  });

  it('should return -1 for opposite vectors', () => {
    const a = new Float32Array([1, 0, 0]);
    const b = new Float32Array([-1, 0, 0]);

    expect(cosineSimilarity(a, b)).toBeCloseTo(-1.0, 5);
  });

  it('should return 0 for orthogonal vectors', () => {
    const a = new Float32Array([1, 0, 0]);
    const b = new Float32Array([0, 1, 0]);

    expect(cosineSimilarity(a, b)).toBeCloseTo(0.0, 5);
  });

  it('should handle non-unit vectors', () => {
    const a = new Float32Array([2, 0, 0]);
    const b = new Float32Array([4, 0, 0]);

    // Same direction = cosine similarity of 1
    expect(cosineSimilarity(a, b)).toBeCloseTo(1.0, 5);
  });

  it('should handle high-dimensional vectors', () => {
    const dim = 768; // Common embedding dimension
    const a = new Float32Array(dim);
    const b = new Float32Array(dim);

    // Create similar but not identical vectors
    for (let i = 0; i < dim; i++) {
      a[i] = Math.random();
      b[i] = a[i]! + (Math.random() - 0.5) * 0.1; // Slight variation
    }

    const similarity = cosineSimilarity(a, b);

    // Should be high but not 1
    expect(similarity).toBeGreaterThan(0.9);
    expect(similarity).toBeLessThan(1.0);
  });

  it('should throw for mismatched dimensions', () => {
    const a = new Float32Array([1, 0, 0]);
    const b = new Float32Array([1, 0]);

    expect(() => cosineSimilarity(a, b)).toThrow('Vector dimension mismatch');
  });

  it('should handle zero vectors', () => {
    const a = new Float32Array([0, 0, 0]);
    const b = new Float32Array([1, 0, 0]);

    expect(cosineSimilarity(a, b)).toBe(0);
  });

  it('should be symmetric', () => {
    const a = new Float32Array([1, 2, 3]);
    const b = new Float32Array([4, 5, 6]);

    expect(cosineSimilarity(a, b)).toBeCloseTo(cosineSimilarity(b, a), 10);
  });
});

describe('Vector Normalization', () => {
  it('should normalize vector to unit length', () => {
    const v = new Float32Array([3, 4, 0]);
    const normalized = normalizeVector(v);

    // Calculate magnitude
    const magnitude = Math.sqrt(
      normalized[0]! ** 2 + normalized[1]! ** 2 + normalized[2]! ** 2
    );

    expect(magnitude).toBeCloseTo(1.0, 5);
  });

  it('should preserve direction', () => {
    const v = new Float32Array([2, 0, 0]);
    const normalized = normalizeVector(v);

    expect(normalized[0]).toBeCloseTo(1.0, 5);
    expect(normalized[1]).toBeCloseTo(0.0, 5);
    expect(normalized[2]).toBeCloseTo(0.0, 5);
  });

  it('should handle zero vector', () => {
    const v = new Float32Array([0, 0, 0]);
    const normalized = normalizeVector(v);

    // Zero vector should remain zero
    expect(normalized[0]).toBe(0);
    expect(normalized[1]).toBe(0);
    expect(normalized[2]).toBe(0);
  });

  it('should handle high-dimensional vectors', () => {
    const dim = 768;
    const v = new Float32Array(dim);
    for (let i = 0; i < dim; i++) {
      v[i] = Math.random();
    }

    const normalized = normalizeVector(v);

    // Calculate magnitude
    let magnitude = 0;
    for (let i = 0; i < dim; i++) {
      magnitude += normalized[i]! ** 2;
    }
    magnitude = Math.sqrt(magnitude);

    expect(magnitude).toBeCloseTo(1.0, 4);
  });
});

describe('VectorSearch', () => {
  function createMockMemory(id: string, embedding: Float32Array): Memory {
    return {
      id,
      content: `Content for ${id}`,
      embedding,
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

  it('should return results sorted by similarity', () => {
    const search = new VectorSearch();

    const queryEmbedding = new Float32Array([1, 0, 0]);

    const memories: Memory[] = [
      createMockMemory('far', new Float32Array([0, 1, 0])), // Orthogonal
      createMockMemory('close', new Float32Array([0.9, 0.1, 0])), // Similar
      createMockMemory('closest', new Float32Array([1, 0, 0])), // Identical
    ];

    const results = search.search(queryEmbedding, memories, 10);

    expect(results[0]!.memory.id).toBe('closest');
    expect(results[1]!.memory.id).toBe('close');
    expect(results[2]!.memory.id).toBe('far');
  });

  it('should respect limit parameter', () => {
    const search = new VectorSearch();
    const queryEmbedding = new Float32Array([1, 0, 0]);

    const memories: Memory[] = [];
    for (let i = 0; i < 20; i++) {
      memories.push(
        createMockMemory(`mem-${i}`, new Float32Array([Math.random(), Math.random(), Math.random()]))
      );
    }

    const results = search.search(queryEmbedding, memories, 5);

    expect(results.length).toBe(5);
  });

  it('should skip memories without embeddings', () => {
    const search = new VectorSearch();
    const queryEmbedding = new Float32Array([1, 0, 0]);

    const memories: Memory[] = [
      createMockMemory('with-embedding', new Float32Array([1, 0, 0])),
      { ...createMockMemory('without-embedding', new Float32Array([1, 0, 0])), embedding: null },
    ];

    const results = search.search(queryEmbedding, memories, 10);

    expect(results.length).toBe(1);
    expect(results[0]!.memory.id).toBe('with-embedding');
  });

  it('should include vectorScore in results', () => {
    const search = new VectorSearch();
    const queryEmbedding = new Float32Array([1, 0, 0]);

    const memories: Memory[] = [
      createMockMemory('test', new Float32Array([1, 0, 0])),
    ];

    const results = search.search(queryEmbedding, memories, 10);

    expect(results[0]!.vectorScore).toBeDefined();
    expect(results[0]!.vectorScore).toBeCloseTo(1.0, 5);
  });

  it('should handle empty memories array', () => {
    const search = new VectorSearch();
    const queryEmbedding = new Float32Array([1, 0, 0]);

    const results = search.search(queryEmbedding, [], 10);

    expect(results).toEqual([]);
  });

  it('should handle large datasets efficiently', () => {
    const search = new VectorSearch();
    const dim = 768;
    const queryEmbedding = new Float32Array(dim);
    for (let i = 0; i < dim; i++) {
      queryEmbedding[i] = Math.random();
    }

    const memories: Memory[] = [];
    for (let i = 0; i < 1000; i++) {
      const embedding = new Float32Array(dim);
      for (let j = 0; j < dim; j++) {
        embedding[j] = Math.random();
      }
      memories.push(createMockMemory(`mem-${i}`, embedding));
    }

    const startTime = performance.now();
    const results = search.search(queryEmbedding, memories, 10);
    const endTime = performance.now();

    expect(results.length).toBe(10);
    expect(endTime - startTime).toBeLessThan(100); // Should complete in <100ms
  });
});
