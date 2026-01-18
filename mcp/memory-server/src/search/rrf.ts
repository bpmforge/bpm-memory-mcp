import type { MemorySearchResult } from '../types.js';

/**
 * Reciprocal Rank Fusion (RRF)
 * Combines results from multiple search methods
 */

const DEFAULT_K = 60; // Standard RRF constant

/**
 * Combine vector and BM25 results using RRF
 */
export function rrfFusion(
  vectorResults: MemorySearchResult[],
  bm25Results: MemorySearchResult[],
  options: {
    k?: number;
    vectorWeight?: number;
    bm25Weight?: number;
    limit?: number;
  } = {}
): MemorySearchResult[] {
  const k = options.k ?? DEFAULT_K;
  const vectorWeight = options.vectorWeight ?? 0.5;
  const bm25Weight = options.bm25Weight ?? 0.5;
  const limit = options.limit ?? 10;

  // Build rank maps
  const vectorRanks = new Map<string, number>();
  const bm25Ranks = new Map<string, number>();

  vectorResults.forEach((r, i) => vectorRanks.set(r.memory.id, i + 1));
  bm25Results.forEach((r, i) => bm25Ranks.set(r.memory.id, i + 1));

  // Get all unique memory IDs
  const allIds = new Set([
    ...vectorResults.map((r) => r.memory.id),
    ...bm25Results.map((r) => r.memory.id),
  ]);

  // Build memory lookup
  const memoryLookup = new Map<string, MemorySearchResult>();
  for (const r of [...vectorResults, ...bm25Results]) {
    if (!memoryLookup.has(r.memory.id)) {
      memoryLookup.set(r.memory.id, r);
    }
  }

  // Calculate RRF scores
  const rrfScores: Array<{ id: string; score: number; result: MemorySearchResult }> = [];

  for (const id of allIds) {
    const result = memoryLookup.get(id);
    if (!result) continue;

    const vectorRank = vectorRanks.get(id);
    const bm25Rank = bm25Ranks.get(id);

    // RRF formula: 1 / (k + rank)
    // If not in results, use a large rank (effectively 0 contribution)
    const vectorScore = vectorRank ? vectorWeight / (k + vectorRank) : 0;
    const bm25Score = bm25Rank ? bm25Weight / (k + bm25Rank) : 0;

    const combinedScore = vectorScore + bm25Score;

    const fusedResult: MemorySearchResult = {
      memory: result.memory,
      relevance: combinedScore,
    };
    if (result.vectorScore !== undefined) fusedResult.vectorScore = result.vectorScore;
    if (result.bm25Score !== undefined) fusedResult.bm25Score = result.bm25Score;

    rrfScores.push({
      id,
      score: combinedScore,
      result: fusedResult,
    });
  }

  // Sort by RRF score and return top results
  return rrfScores
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((s) => s.result);
}

/**
 * Simple interleaving for when one source is unavailable
 */
export function interleave(
  primary: MemorySearchResult[],
  secondary: MemorySearchResult[],
  limit: number = 10
): MemorySearchResult[] {
  const seen = new Set<string>();
  const results: MemorySearchResult[] = [];

  const maxLength = Math.max(primary.length, secondary.length);

  for (let i = 0; i < maxLength && results.length < limit; i++) {
    // Take from primary
    if (i < primary.length) {
      const p = primary[i]!;
      if (!seen.has(p.memory.id)) {
        seen.add(p.memory.id);
        results.push(p);
      }
    }

    // Take from secondary
    if (results.length < limit && i < secondary.length) {
      const s = secondary[i]!;
      if (!seen.has(s.memory.id)) {
        seen.add(s.memory.id);
        results.push(s);
      }
    }
  }

  return results;
}
