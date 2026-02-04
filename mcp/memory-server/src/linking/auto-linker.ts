import type { DatabaseConnection } from '../storage/database.js';
import type { MemoryLink, Memory } from '../types.js';
import { MemoryLinkType } from '../types.js';
import { MemoryLinkRepository } from '../storage/links.js';

/**
 * Auto-link result for a newly stored memory
 */
export interface AutoLinkResult {
  createdLinks: MemoryLink[];
  suggestedLinks: Array<{
    targetId: string;
    targetContent: string;
    similarity: number;
    suggestedType: MemoryLinkType;
    reason: string;
  }>;
}

/**
 * Configuration for auto-linking behavior
 */
export interface AutoLinkConfig {
  /** Minimum similarity threshold for automatic linking (default: 0.75) */
  autoLinkThreshold: number;
  /** Minimum similarity for suggesting links (default: 0.60) */
  suggestLinkThreshold: number;
  /** Maximum number of auto-created links per memory (default: 3) */
  maxAutoLinks: number;
  /** Whether to create links automatically or just suggest (default: true) */
  enableAutoCreate: boolean;
}

const DEFAULT_CONFIG: AutoLinkConfig = {
  autoLinkThreshold: 0.75,
  suggestLinkThreshold: 0.60,
  maxAutoLinks: 3,
  enableAutoCreate: true,
};

/**
 * Memory row from database (for similarity search)
 */
interface MemoryRow {
  id: string;
  content: string;
  embedding: Buffer | null;
  type: string;
  project_id: string;
}

/**
 * AutoLinker - Automatically creates links between related memories
 *
 * When a new memory is stored, this service:
 * 1. Finds similar memories using embedding similarity
 * 2. Creates 'relates_to' links for highly similar memories
 * 3. Suggests links for moderately similar memories
 */
export class AutoLinker {
  private linkRepo: MemoryLinkRepository;
  private config: AutoLinkConfig;

  constructor(
    private db: DatabaseConnection,
    config: Partial<AutoLinkConfig> = {}
  ) {
    this.linkRepo = new MemoryLinkRepository(db);
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Process a newly stored memory and create/suggest links
   */
  async processNewMemory(
    memoryId: string,
    content: string,
    embedding: Float32Array | null,
    projectId: string
  ): Promise<AutoLinkResult> {
    const result: AutoLinkResult = {
      createdLinks: [],
      suggestedLinks: [],
    };

    if (!embedding) {
      return result;
    }

    // Find similar memories
    const similarMemories = this.findSimilarMemories(
      memoryId,
      embedding,
      projectId,
      this.config.maxAutoLinks + 5 // Get a few extra for suggestions
    );

    for (const similar of similarMemories) {
      // Check if link already exists
      const existingLink = this.linkRepo.findLinkBetween(memoryId, similar.id);
      if (existingLink) {
        continue;
      }

      // Determine link type based on memory types and content
      const linkType = this.determineLinkType(content, similar);

      if (similar.similarity >= this.config.autoLinkThreshold) {
        // Auto-create link for high similarity
        if (
          this.config.enableAutoCreate &&
          result.createdLinks.length < this.config.maxAutoLinks
        ) {
          const link = this.linkRepo.createLink({
            sourceId: memoryId,
            targetId: similar.id,
            linkType,
            strength: similar.similarity,
            bidirectional: true, // Similarity is bidirectional
            createdBy: 'system',
          });
          result.createdLinks.push(link);
        }
      } else if (similar.similarity >= this.config.suggestLinkThreshold) {
        // Suggest link for moderate similarity
        result.suggestedLinks.push({
          targetId: similar.id,
          targetContent: similar.content.substring(0, 100) + (similar.content.length > 100 ? '...' : ''),
          similarity: Math.round(similar.similarity * 100) / 100,
          suggestedType: linkType,
          reason: this.getSuggestionReason(content, similar),
        });
      }
    }

    return result;
  }

  /**
   * Find memories similar to the given embedding
   */
  private findSimilarMemories(
    excludeId: string,
    embedding: Float32Array,
    projectId: string,
    limit: number
  ): Array<{ id: string; content: string; type: string; similarity: number }> {
    // Get all memories with embeddings for this project
    const rows = this.db.instance
      .prepare(
        `SELECT id, content, embedding, type FROM memories
         WHERE project_id = ?
           AND id != ?
           AND deleted_at IS NULL
           AND superseded_by IS NULL
           AND embedding IS NOT NULL`
      )
      .all(projectId, excludeId) as MemoryRow[];

    // Calculate similarities
    const similarities: Array<{ id: string; content: string; type: string; similarity: number }> = [];

    for (const row of rows) {
      if (!row.embedding) continue;

      const otherEmbedding = new Float32Array(row.embedding.buffer);
      const similarity = this.cosineSimilarity(embedding, otherEmbedding);

      if (similarity >= this.config.suggestLinkThreshold) {
        similarities.push({
          id: row.id,
          content: row.content,
          type: row.type,
          similarity,
        });
      }
    }

    // Sort by similarity and return top results
    return similarities
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, limit);
  }

  /**
   * Calculate cosine similarity between two embeddings
   */
  private cosineSimilarity(a: Float32Array, b: Float32Array): number {
    if (a.length !== b.length) return 0;

    let dotProduct = 0;
    let normA = 0;
    let normB = 0;

    for (let i = 0; i < a.length; i++) {
      dotProduct += a[i]! * b[i]!;
      normA += a[i]! * a[i]!;
      normB += b[i]! * b[i]!;
    }

    const denominator = Math.sqrt(normA) * Math.sqrt(normB);
    return denominator === 0 ? 0 : dotProduct / denominator;
  }

  /**
   * Determine the appropriate link type based on memory content and types
   */
  private determineLinkType(
    sourceContent: string,
    target: { content: string; type: string }
  ): MemoryLinkType {
    const sourceLower = sourceContent.toLowerCase();
    const targetLower = target.content.toLowerCase();

    // Check for contradiction patterns
    const negationPatterns = [
      /\bnot\b.*\b(should|use|do|is|was|are|were)\b/,
      /\b(don't|doesn't|didn't|won't|shouldn't|can't|cannot)\b/,
      /\bnever\b/,
      /\bavoid\b/,
      /\binstead of\b/,
    ];

    for (const pattern of negationPatterns) {
      if (pattern.test(sourceLower) !== pattern.test(targetLower)) {
        return MemoryLinkType.CONTRADICTS;
      }
    }

    // Check for extension/derivation patterns
    if (
      sourceLower.includes('based on') ||
      sourceLower.includes('following up') ||
      sourceLower.includes('building on')
    ) {
      return MemoryLinkType.EXTENDS;
    }

    if (
      sourceLower.includes('derived from') ||
      sourceLower.includes('came from')
    ) {
      return MemoryLinkType.DERIVED_FROM;
    }

    // Check for support patterns
    if (
      sourceLower.includes('confirms') ||
      sourceLower.includes('supports') ||
      sourceLower.includes('validates') ||
      sourceLower.includes('agrees with')
    ) {
      return MemoryLinkType.SUPPORTS;
    }

    // Default to relates_to for similar content
    return MemoryLinkType.RELATES_TO;
  }

  /**
   * Generate a human-readable reason for why a link is suggested
   */
  private getSuggestionReason(
    sourceContent: string,
    target: { content: string; type: string; similarity: number }
  ): string {
    const similarityPercent = Math.round(target.similarity * 100);

    // Extract shared keywords
    const sourceWords = new Set(
      sourceContent
        .toLowerCase()
        .replace(/[^\w\s]/g, '')
        .split(/\s+/)
        .filter((w) => w.length > 3)
    );

    const targetWords = target.content
      .toLowerCase()
      .replace(/[^\w\s]/g, '')
      .split(/\s+/)
      .filter((w) => w.length > 3);

    const sharedWords = targetWords.filter((w) => sourceWords.has(w));
    const topShared = sharedWords.slice(0, 3);

    if (topShared.length > 0) {
      return `${similarityPercent}% similar, shared topics: ${topShared.join(', ')}`;
    }

    return `${similarityPercent}% semantic similarity`;
  }

  /**
   * Get link density statistics for a project
   */
  getLinkDensityStats(projectId: string): {
    totalMemories: number;
    linkedMemories: number;
    orphanMemories: number;
    averageLinksPerMemory: number;
    linkDensity: number;
  } {
    const memoryCountRow = this.db.instance
      .prepare(
        `SELECT COUNT(*) as count FROM memories
         WHERE project_id = ? AND deleted_at IS NULL AND superseded_by IS NULL`
      )
      .get(projectId) as { count: number };

    const totalMemories = memoryCountRow.count;

    const linkedCountRow = this.db.instance
      .prepare(
        `SELECT COUNT(DISTINCT m.id) as count FROM memories m
         JOIN memory_links ml ON ml.source_id = m.id OR ml.target_id = m.id
         WHERE m.project_id = ? AND m.deleted_at IS NULL AND m.superseded_by IS NULL`
      )
      .get(projectId) as { count: number };

    const linkedMemories = linkedCountRow.count;
    const orphanMemories = totalMemories - linkedMemories;

    const totalLinksRow = this.db.instance
      .prepare(
        `SELECT COUNT(*) as count FROM memory_links ml
         JOIN memories m ON ml.source_id = m.id
         WHERE m.project_id = ?`
      )
      .get(projectId) as { count: number };

    const averageLinksPerMemory =
      totalMemories > 0 ? totalLinksRow.count / totalMemories : 0;

    const linkDensity = totalMemories > 0 ? linkedMemories / totalMemories : 0;

    return {
      totalMemories,
      linkedMemories,
      orphanMemories,
      averageLinksPerMemory: Math.round(averageLinksPerMemory * 100) / 100,
      linkDensity: Math.round(linkDensity * 100) / 100,
    };
  }
}
