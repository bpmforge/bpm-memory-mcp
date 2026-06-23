/**
 * Memory Consolidation Engine (V10)
 *
 * Performs background memory maintenance:
 * - Merge near-duplicate memories
 * - Summarize clusters of related memories
 * - Decay confidence of unused memories
 * - Identify memories for review/pruning
 */

import type Database from 'better-sqlite3';
import { MemoryType } from '../types.js';

export interface ConsolidationResult {
  merged: Array<{
    keptId: string;
    mergedIds: string[];
    similarity: number;
  }>;
  decayed: Array<{
    id: string;
    oldConfidence: number;
    newConfidence: number;
    reason: string;
  }>;
  flaggedForReview: Array<{
    id: string;
    reason: string;
  }>;
  clusters: Array<{
    theme: string;
    memoryIds: string[];
    suggestedSummary: string;
  }>;
  stats: {
    totalProcessed: number;
    duplicatesFound: number;
    memoriesDecayed: number;
    clustersIdentified: number;
    processingTimeMs: number;
  };
}

export interface ConsolidationOptions {
  /** Minimum similarity threshold for duplicate detection (default: 0.85) */
  duplicateThreshold?: number;
  /** Days since last access before decay starts (default: 30) */
  decayAfterDays?: number;
  /** Decay rate per day after threshold (default: 0.01) */
  decayRate?: number;
  /** Minimum confidence before flagging for review (default: 0.3) */
  minConfidenceThreshold?: number;
  /** Minimum cluster size to suggest summarization (default: 3) */
  minClusterSize?: number;
  /** Whether to actually apply changes or just report (default: false) */
  dryRun?: boolean;
}

interface MemoryRecord {
  id: string;
  content: string;
  type: string;
  confidence: number;
  embedding: Buffer | null;
  lastAccessedAt: number;
  createdAt: number;
  accessCount: number;
}

/**
 * Memory Consolidation Service
 */
export class ConsolidationService {
  private db: Database.Database;

  constructor(db: Database.Database) {
    this.db = db;
  }

  /**
   * Run full consolidation process
   */
  async consolidate(
    projectId: string,
    options: ConsolidationOptions = {}
  ): Promise<ConsolidationResult> {
    const startTime = Date.now();

    // Apply defaults
    const duplicateThreshold = options.duplicateThreshold ?? 0.85;
    const decayAfterDays = options.decayAfterDays ?? 30;
    const decayRate = options.decayRate ?? 0.01;
    const minConfidenceThreshold = options.minConfidenceThreshold ?? 0.3;
    const minClusterSize = options.minClusterSize ?? 3;
    const dryRun = options.dryRun ?? false;

    const result: ConsolidationResult = {
      merged: [],
      decayed: [],
      flaggedForReview: [],
      clusters: [],
      stats: {
        totalProcessed: 0,
        duplicatesFound: 0,
        memoriesDecayed: 0,
        clustersIdentified: 0,
        processingTimeMs: 0,
      },
    };

    // Get all active memories
    const memories = this.getActiveMemories(projectId);
    result.stats.totalProcessed = memories.length;

    if (memories.length === 0) {
      result.stats.processingTimeMs = Date.now() - startTime;
      return result;
    }

    // 1. Find and merge duplicates
    const duplicates = this.findDuplicates(memories, duplicateThreshold);
    result.stats.duplicatesFound = duplicates.length;

    for (const dup of duplicates) {
      if (!dryRun) {
        this.mergeDuplicates(dup.keepId, dup.mergeIds, projectId);
      }
      result.merged.push({
        keptId: dup.keepId,
        mergedIds: dup.mergeIds,
        similarity: dup.similarity,
      });
    }

    // 2. Apply confidence decay
    const decayResults = this.applyConfidenceDecay(
      memories,
      decayAfterDays,
      decayRate,
      minConfidenceThreshold,
      dryRun
    );
    result.decayed = decayResults.decayed;
    result.flaggedForReview = decayResults.flagged;
    result.stats.memoriesDecayed = decayResults.decayed.length;

    // 3. Identify clusters for summarization
    const clusters = this.identifyClusters(memories, minClusterSize);
    result.clusters = clusters;
    result.stats.clustersIdentified = clusters.length;

    result.stats.processingTimeMs = Date.now() - startTime;
    return result;
  }

  /**
   * Get all active (non-deleted, non-superseded) memories
   */
  private getActiveMemories(projectId: string): MemoryRecord[] {
    const stmt = this.db.prepare(`
      SELECT
        id, content, type, confidence, embedding,
        accessed_at as lastAccessedAt,
        created_at as createdAt,
        access_count as accessCount
      FROM memories
      WHERE project_id = ?
        AND deleted_at IS NULL
        AND superseded_by IS NULL
      ORDER BY created_at DESC
    `);

    return stmt.all(projectId) as MemoryRecord[];
  }

  /**
   * Find duplicate memories based on embedding similarity
   */
  private findDuplicates(
    memories: MemoryRecord[],
    threshold: number
  ): Array<{ keepId: string; mergeIds: string[]; similarity: number }> {
    const duplicates: Array<{ keepId: string; mergeIds: string[]; similarity: number }> = [];
    const processed = new Set<string>();

    for (let i = 0; i < memories.length; i++) {
      const mem1 = memories[i];
      if (!mem1 || processed.has(mem1.id) || !mem1.embedding) continue;

      const similar: string[] = [];
      let maxSimilarity = 0;

      for (let j = i + 1; j < memories.length; j++) {
        const mem2 = memories[j];
        if (!mem2 || processed.has(mem2.id) || !mem2.embedding) continue;

        const similarity = this.cosineSimilarity(mem1.embedding, mem2.embedding);

        if (similarity >= threshold) {
          similar.push(mem2.id);
          processed.add(mem2.id);
          maxSimilarity = Math.max(maxSimilarity, similarity);
        }
      }

      if (similar.length > 0) {
        processed.add(mem1.id);
        // Keep the one with higher confidence
        const allIds = [mem1.id, ...similar];
        const sortedByConfidence = allIds
          .map((id) => {
            const mem = memories.find((m) => m.id === id);
            return { id, confidence: mem?.confidence ?? 0 };
          })
          .sort((a, b) => b.confidence - a.confidence);

        const keepId = sortedByConfidence[0]?.id;
        if (keepId) {
          duplicates.push({
            keepId,
            mergeIds: sortedByConfidence.slice(1).map((s) => s.id),
            similarity: maxSimilarity,
          });
        }
      }
    }

    return duplicates;
  }

  /**
   * Calculate cosine similarity between two embedding vectors
   */
  private cosineSimilarity(a: Buffer, b: Buffer): number {
    // Embeddings are stored as Float32Array in Buffer
    const vecA = new Float32Array(a.buffer, a.byteOffset, a.length / 4);
    const vecB = new Float32Array(b.buffer, b.byteOffset, b.length / 4);

    if (vecA.length !== vecB.length) return 0;

    let dotProduct = 0;
    let normA = 0;
    let normB = 0;

    for (let i = 0; i < vecA.length; i++) {
      const valA = vecA[i] ?? 0;
      const valB = vecB[i] ?? 0;
      dotProduct += valA * valB;
      normA += valA * valA;
      normB += valB * valB;
    }

    const magnitude = Math.sqrt(normA) * Math.sqrt(normB);
    return magnitude === 0 ? 0 : dotProduct / magnitude;
  }

  /**
   * Merge duplicate memories (soft-delete merged ones)
   */
  private mergeDuplicates(keepId: string, mergeIds: string[], projectId: string): void {
    const now = Date.now();
    const stmt = this.db.prepare(`
      UPDATE memories
      SET deleted_at = ?, deleted_reason = ?
      WHERE id = ? AND project_id = ?
    `);

    for (const mergeId of mergeIds) {
      stmt.run(now, `Merged with ${keepId} (duplicate)`, mergeId, projectId);
    }

    // Update the kept memory's access count to reflect merged memories
    const updateStmt = this.db.prepare(`
      UPDATE memories
      SET access_count = access_count + ?
      WHERE id = ? AND project_id = ?
    `);
    updateStmt.run(mergeIds.length, keepId, projectId);
  }

  /**
   * Apply confidence decay to unused memories
   */
  private applyConfidenceDecay(
    memories: MemoryRecord[],
    decayAfterDays: number,
    decayRate: number,
    minConfidence: number,
    dryRun: boolean
  ): {
    decayed: Array<{ id: string; oldConfidence: number; newConfidence: number; reason: string }>;
    flagged: Array<{ id: string; reason: string }>;
  } {
    const decayed: Array<{
      id: string;
      oldConfidence: number;
      newConfidence: number;
      reason: string;
    }> = [];
    const flagged: Array<{ id: string; reason: string }> = [];

    const now = Date.now();
    const msPerDay = 24 * 60 * 60 * 1000;

    // Type-specific decay multipliers (some types decay faster)
    const decayMultipliers: Record<string, number> = {
      [MemoryType.ERROR]: 1.5, // Errors decay faster (may become stale)
      [MemoryType.FACT]: 0.8, // Facts decay slower
      [MemoryType.DECISION]: 1.0, // Decisions decay normally
      [MemoryType.PATTERN]: 0.7, // Patterns are long-lived
      [MemoryType.PREFERENCE]: 0.5, // Preferences are very stable
    };

    for (const mem of memories) {
      const daysSinceAccess = (now - mem.lastAccessedAt) / msPerDay;

      if (daysSinceAccess > decayAfterDays) {
        const daysOverThreshold = daysSinceAccess - decayAfterDays;
        const multiplier = decayMultipliers[mem.type] ?? 1.0;
        const decay = daysOverThreshold * decayRate * multiplier;
        const newConfidence = Math.max(0.1, mem.confidence - decay);

        if (newConfidence < mem.confidence) {
          if (!dryRun) {
            this.updateConfidence(mem.id, newConfidence);
          }

          decayed.push({
            id: mem.id,
            oldConfidence: mem.confidence,
            newConfidence: Math.round(newConfidence * 100) / 100,
            reason: `${Math.round(daysSinceAccess)} days since last access`,
          });

          // Flag for review if below threshold
          if (newConfidence < minConfidence) {
            flagged.push({
              id: mem.id,
              reason: `Confidence dropped to ${Math.round(newConfidence * 100)}% - consider reviewing or deleting`,
            });
          }
        }
      }
    }

    return { decayed, flagged };
  }

  /**
   * Update a memory's confidence
   */
  private updateConfidence(id: string, confidence: number): void {
    const stmt = this.db.prepare(`
      UPDATE memories SET confidence = ? WHERE id = ?
    `);
    stmt.run(confidence, id);
  }

  /**
   * Identify clusters of related memories that could be summarized
   */
  private identifyClusters(
    memories: MemoryRecord[],
    minSize: number
  ): Array<{ theme: string; memoryIds: string[]; suggestedSummary: string }> {
    const clusters: Array<{ theme: string; memoryIds: string[]; suggestedSummary: string }> = [];

    // Group by type first
    const byType: Record<string, MemoryRecord[]> = {};
    for (const mem of memories) {
      if (!byType[mem.type]) byType[mem.type] = [];
      byType[mem.type]!.push(mem);
    }

    // For each type, find clusters of similar memories
    for (const [type, typeMemories] of Object.entries(byType)) {
      if (!typeMemories || typeMemories.length < minSize) continue;

      // Simple clustering: group memories with >0.7 similarity
      const used = new Set<string>();

      for (const mem of typeMemories) {
        if (used.has(mem.id) || !mem.embedding) continue;

        const cluster = [mem];
        used.add(mem.id);

        for (const other of typeMemories) {
          if (used.has(other.id) || !other.embedding) continue;

          const similarity = this.cosineSimilarity(mem.embedding, other.embedding);
          if (similarity >= 0.7) {
            cluster.push(other);
            used.add(other.id);
          }
        }

        if (cluster.length >= minSize) {
          // Extract common words for theme
          const words = cluster
            .flatMap((m) => m.content.toLowerCase().split(/\s+/))
            .filter((w) => w.length > 4);
          const wordCounts = new Map<string, number>();
          for (const w of words) {
            wordCounts.set(w, (wordCounts.get(w) ?? 0) + 1);
          }
          const commonWords = [...wordCounts.entries()]
            .filter(([, count]) => count >= Math.ceil(cluster.length / 2))
            .sort((a, b) => b[1] - a[1])
            .slice(0, 3)
            .map(([word]) => word);

          const theme =
            commonWords.length > 0 ? `${type}: ${commonWords.join(', ')}` : `${type} cluster`;

          clusters.push({
            theme,
            memoryIds: cluster.map((m) => m.id),
            suggestedSummary: `Consider summarizing ${cluster.length} ${type} memories about: ${commonWords.join(', ') || 'related topics'}`,
          });
        }
      }
    }

    return clusters;
  }
}
