import type { Memory, MemorySearchResult } from '../types.js';

/**
 * Vector search using cosine similarity
 */
export class VectorSearch {
  /**
   * Search memories using cosine similarity
   */
  search(
    queryEmbedding: Float32Array,
    memories: Memory[],
    limit: number = 10
  ): MemorySearchResult[] {
    const results: MemorySearchResult[] = [];

    for (const memory of memories) {
      if (!memory.embedding) continue;

      const score = cosineSimilarity(queryEmbedding, memory.embedding);

      results.push({
        memory,
        relevance: score,
        vectorScore: score,
      });
    }

    // Sort by score descending and take top-k
    return results.sort((a, b) => b.relevance - a.relevance).slice(0, limit);
  }
}

/**
 * Compute cosine similarity between two vectors
 * Returns value between -1 and 1 (1 = identical)
 */
export function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  if (a.length !== b.length) {
    throw new Error(`Vector dimension mismatch: ${a.length} vs ${b.length}`);
  }

  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    const aVal = a[i]!;
    const bVal = b[i]!;
    dotProduct += aVal * bVal;
    normA += aVal * aVal;
    normB += bVal * bVal;
  }

  const denominator = Math.sqrt(normA) * Math.sqrt(normB);
  if (denominator === 0) return 0;

  return dotProduct / denominator;
}

/**
 * Normalize a vector to unit length
 */
export function normalizeVector(v: Float32Array): Float32Array {
  let norm = 0;
  for (let i = 0; i < v.length; i++) {
    norm += v[i]! * v[i]!;
  }
  norm = Math.sqrt(norm);

  if (norm === 0) return v;

  const result = new Float32Array(v.length);
  for (let i = 0; i < v.length; i++) {
    result[i] = v[i]! / norm;
  }
  return result;
}
