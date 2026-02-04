import type { MemorySearchResult, MemoryType, MemoryLink } from '../types.js';

export interface RerankOptions {
  recencyWeight?: number;
  confidenceWeight?: number;
  accessWeight?: number;
  linkDensityWeight?: number;
  now?: Date;
}

/**
 * Weight for link density factor in reranking
 */
const DEFAULT_LINK_DENSITY_WEIGHT = 0.15;

/**
 * Type-specific recency decay factors
 * ERROR: Strong decay (errors become less relevant quickly)
 * DECISION: Moderate decay (decisions may be superseded)
 * PATTERN: Weak decay (patterns remain relevant)
 * FACT: Very weak decay (facts persist)
 * PREFERENCE: Moderate decay (preferences can change)
 * GOAL: Moderate decay (goals may become outdated)
 * CHECKPOINT: Strong decay (checkpoints are time-sensitive)
 */
const RECENCY_DECAY_FACTORS: Record<MemoryType, number> = {
  error: 0.1, // 10% relevance after ~30 days
  decision: 0.3, // 30% relevance after ~30 days
  pattern: 0.7, // 70% relevance after ~30 days
  fact: 0.9, // 90% relevance after ~30 days (almost no decay)
  preference: 0.4, // 40% relevance after ~30 days
  goal: 0.3, // 30% relevance after ~30 days (goals can change)
  checkpoint: 0.05, // 5% relevance after ~30 days (checkpoints are very time-sensitive)
};

/**
 * Re-rank search results based on multiple factors
 */
export function rerankResults(
  results: MemorySearchResult[],
  options: RerankOptions = {}
): MemorySearchResult[] {
  const {
    recencyWeight = 0.2,
    confidenceWeight = 0.3,
    accessWeight = 0.1,
    now = new Date(),
  } = options;

  // Base relevance weight is remaining
  const baseWeight = 1 - recencyWeight - confidenceWeight - accessWeight;

  const scored = results.map((result) => {
    const memory = result.memory;

    // Calculate recency score with type-specific decay
    const recencyScore = calculateRecencyScore(
      memory.accessedAt,
      memory.type,
      now
    );

    // Confidence boost (already 0-1)
    const confidenceScore = memory.confidence;

    // Access frequency boost (log-scaled to prevent domination)
    const accessScore = calculateAccessScore(memory.accessCount);

    // Combine scores
    const finalScore =
      baseWeight * result.relevance +
      recencyWeight * recencyScore +
      confidenceWeight * confidenceScore +
      accessWeight * accessScore;

    return {
      ...result,
      relevance: finalScore,
      _debug: {
        baseScore: result.relevance,
        recencyScore,
        confidenceScore,
        accessScore,
        finalScore,
      },
    };
  });

  // Sort by final score descending
  return scored.sort((a, b) => b.relevance - a.relevance);
}

/**
 * Calculate recency score with type-specific decay
 */
function calculateRecencyScore(
  accessedAt: Date,
  type: MemoryType,
  now: Date
): number {
  const ageMs = now.getTime() - accessedAt.getTime();
  const ageDays = ageMs / (1000 * 60 * 60 * 24);

  // Get decay factor for this memory type
  const decayFactor = RECENCY_DECAY_FACTORS[type];

  // Exponential decay: score = e^(-age * decay_rate)
  // Adjust decay rate based on factor (higher factor = slower decay)
  const decayRate = (1 - decayFactor) / 30; // Calibrated for 30-day half-life
  const score = Math.exp(-ageDays * decayRate);

  return Math.max(0, Math.min(1, score));
}

/**
 * Calculate access frequency score (log-scaled)
 */
function calculateAccessScore(accessCount: number): number {
  // Log scale to prevent frequently accessed memories from dominating
  // log2(count + 1) normalized to 0-1 range (assumes max ~1000 accesses)
  const logScore = Math.log2(accessCount + 1);
  return Math.min(1, logScore / 10); // 2^10 = 1024
}

/**
 * Calculate link density score based on incoming links
 * More linked memories are considered more important/central
 */
export function calculateLinkDensityScore(
  memoryId: string,
  linkCountMap: Map<string, number>
): number {
  const incomingLinks = linkCountMap.get(memoryId) ?? 0;
  // Normalize: 5+ incoming links = maximum score
  return Math.min(1, incomingLinks / 5);
}

/**
 * Re-rank with link density awareness
 */
export function rerankWithLinkDensity(
  results: MemorySearchResult[],
  linkCountMap: Map<string, number>,
  options: RerankOptions = {}
): MemorySearchResult[] {
  const linkDensityWeight = options.linkDensityWeight ?? DEFAULT_LINK_DENSITY_WEIGHT;

  const scored = results.map((result) => {
    const linkScore = calculateLinkDensityScore(result.memory.id, linkCountMap);

    // Apply link density boost
    const boostedRelevance = result.relevance * (1 + linkScore * linkDensityWeight);

    return {
      ...result,
      relevance: boostedRelevance,
    };
  });

  return scored.sort((a, b) => b.relevance - a.relevance);
}

/**
 * Apply recency filter - remove memories older than threshold
 */
export function filterByRecency(
  results: MemorySearchResult[],
  maxAgeDays: number,
  now: Date = new Date()
): MemorySearchResult[] {
  const maxAgeMs = maxAgeDays * 24 * 60 * 60 * 1000;
  const cutoff = now.getTime() - maxAgeMs;

  return results.filter((r) => r.memory.accessedAt.getTime() >= cutoff);
}

/**
 * Apply confidence threshold filter
 */
export function filterByConfidence(
  results: MemorySearchResult[],
  minConfidence: number
): MemorySearchResult[] {
  return results.filter((r) => r.memory.confidence >= minConfidence);
}

/**
 * Boost results matching specific types
 */
export function boostByType(
  results: MemorySearchResult[],
  boostTypes: MemoryType[],
  boostFactor: number = 1.5
): MemorySearchResult[] {
  return results.map((r) => ({
    ...r,
    relevance: boostTypes.includes(r.memory.type)
      ? r.relevance * boostFactor
      : r.relevance,
  }));
}

/**
 * Diversity-aware re-ranking to avoid type clustering
 */
export function diversifyResults(
  results: MemorySearchResult[],
  maxPerType: number = 3
): MemorySearchResult[] {
  const typeCounts: Record<string, number> = {};
  const diversified: MemorySearchResult[] = [];

  for (const result of results) {
    const type = result.memory.type;
    const count = typeCounts[type] ?? 0;

    if (count < maxPerType) {
      diversified.push(result);
      typeCounts[type] = count + 1;
    }
  }

  return diversified;
}
