import type { DatabaseConnection } from '../storage/database.js';
import type { Memory, MemoryLinkType } from '../types.js';
import { cosineSimilarity } from '../search/vector.js';

/**
 * Result of contradiction detection
 */
export interface ContradictionResult {
  memoryId: string;
  content: string;
  similarity: number;
  reason: 'negation' | 'value_conflict' | 'high_similarity';
  suggestedAction: 'review' | 'link_as_contradicts' | 'update';
}

/**
 * Negation patterns that may indicate contradiction
 */
const NEGATION_PATTERNS = [
  /\bnot\b/i,
  /\bnever\b/i,
  /\bdon'?t\b/i,
  /\bdoesn'?t\b/i,
  /\bwon'?t\b/i,
  /\bcan'?t\b/i,
  /\bshouldn'?t\b/i,
  /\bisn'?t\b/i,
  /\baren'?t\b/i,
  /\bwasn'?t\b/i,
  /\bweren'?t\b/i,
  /\bno\s+longer\b/i,
  /\binstead\s+of\b/i,
  /\brather\s+than\b/i,
  /\bopposite\b/i,
  /\bcontrary\b/i,
  /\bincorrect\b/i,
  /\bwrong\b/i,
  /\bfalse\b/i,
  /\bdeprecated\b/i,
  /\bobsolete\b/i,
  /\boutdated\b/i,
];

/**
 * Value extraction patterns for detecting conflicting values
 */
const VALUE_PATTERNS = [
  // "X is Y" patterns
  /\b(\w+(?:\s+\w+)?)\s+(?:is|are|was|were|should\s+be|must\s+be)\s+([^,.]+)/gi,
  // "use X" patterns
  /\buse\s+(\w+(?:\s+\w+)?)/gi,
  // "X = Y" patterns
  /\b(\w+)\s*[=:]\s*([^,.\n]+)/gi,
];

/**
 * Database row type for memory queries
 */
interface MemoryRow {
  id: string;
  content: string;
  embedding: Buffer | null;
  type: string;
  confidence: number;
  project_id: string;
}

/**
 * Contradiction Detector - Identifies potential conflicts between memories
 */
export class ContradictionDetector {
  constructor(private db: DatabaseConnection) {}

  /**
   * Detect potential contradictions when storing new content
   *
   * @param content - The new content being stored
   * @param embedding - The embedding of the new content
   * @param projectId - Project to search within
   * @returns Array of potential contradictions with suggested actions
   */
  async detectOnStore(
    content: string,
    embedding: Float32Array,
    projectId: string
  ): Promise<ContradictionResult[]> {
    const contradictions: ContradictionResult[] = [];

    // Get all memories with embeddings for this project
    const rows = this.db.instance
      .prepare(
        `SELECT id, content, embedding, type, confidence, project_id
         FROM memories
         WHERE project_id = ?
           AND deleted_at IS NULL
           AND superseded_by IS NULL
           AND embedding IS NOT NULL`
      )
      .all(projectId) as MemoryRow[];

    // Check each existing memory
    for (const row of rows) {
      if (!row.embedding) continue;

      const existingEmbedding = new Float32Array(row.embedding.buffer);
      const similarity = cosineSimilarity(embedding, existingEmbedding);

      // High similarity threshold for potential contradiction
      if (similarity < 0.75) continue;

      // Check for negation patterns
      const contentHasNegation = this.hasNegationPattern(content);
      const existingHasNegation = this.hasNegationPattern(row.content);

      // If one has negation and the other doesn't, potential contradiction
      if (contentHasNegation !== existingHasNegation && similarity > 0.80) {
        contradictions.push({
          memoryId: row.id,
          content: row.content,
          similarity,
          reason: 'negation',
          suggestedAction: 'link_as_contradicts',
        });
        continue;
      }

      // Check for value conflicts
      const valueConflict = this.detectValueConflict(content, row.content);
      if (valueConflict) {
        contradictions.push({
          memoryId: row.id,
          content: row.content,
          similarity,
          reason: 'value_conflict',
          suggestedAction: 'update',
        });
        continue;
      }

      // Very high similarity might indicate duplicate or update needed
      if (similarity > 0.90) {
        contradictions.push({
          memoryId: row.id,
          content: row.content,
          similarity,
          reason: 'high_similarity',
          suggestedAction: 'review',
        });
      }
    }

    // Sort by similarity descending
    return contradictions.sort((a, b) => b.similarity - a.similarity);
  }

  /**
   * Check if content contains negation patterns
   */
  private hasNegationPattern(content: string): boolean {
    return NEGATION_PATTERNS.some((pattern) => pattern.test(content));
  }

  /**
   * Detect if two contents have conflicting values for the same subject
   */
  private detectValueConflict(content1: string, content2: string): boolean {
    const values1 = this.extractValues(content1);
    const values2 = this.extractValues(content2);

    // Check for conflicting values on the same subject
    for (const [subject1, value1] of values1) {
      for (const [subject2, value2] of values2) {
        // Normalize subjects for comparison
        const normalizedSubject1 = subject1.toLowerCase().trim();
        const normalizedSubject2 = subject2.toLowerCase().trim();

        if (normalizedSubject1 === normalizedSubject2) {
          const normalizedValue1 = value1.toLowerCase().trim();
          const normalizedValue2 = value2.toLowerCase().trim();

          // If same subject but different values, potential conflict
          if (normalizedValue1 !== normalizedValue2) {
            return true;
          }
        }
      }
    }

    return false;
  }

  /**
   * Extract subject-value pairs from content
   */
  private extractValues(content: string): Array<[string, string]> {
    const values: Array<[string, string]> = [];

    for (const pattern of VALUE_PATTERNS) {
      // Reset regex state
      pattern.lastIndex = 0;

      let match;
      while ((match = pattern.exec(content)) !== null) {
        if (match[1] && match[2]) {
          values.push([match[1], match[2]]);
        } else if (match[1]) {
          values.push([match[1], '']);
        }
      }
    }

    return values;
  }

  /**
   * Find all memories that potentially contradict a given memory
   */
  async findContradictions(
    memoryId: string,
    projectId: string
  ): Promise<ContradictionResult[]> {
    // Get the target memory
    const targetRow = this.db.instance
      .prepare(
        `SELECT id, content, embedding, type, confidence, project_id
         FROM memories
         WHERE id = ? AND project_id = ?`
      )
      .get(memoryId, projectId) as MemoryRow | undefined;

    if (!targetRow?.embedding) {
      return [];
    }

    const targetEmbedding = new Float32Array(targetRow.embedding.buffer);

    return this.detectOnStore(targetRow.content, targetEmbedding, projectId);
  }

  /**
   * Get statistics about contradictions in a project
   */
  getContradictionStats(projectId: string): {
    totalLinks: number;
    contradictionLinks: number;
    unresolvedCount: number;
  } {
    // Count contradiction links
    const contradictionLinks = this.db.instance
      .prepare(
        `SELECT COUNT(*) as count FROM memory_links ml
         JOIN memories m ON ml.source_id = m.id
         WHERE m.project_id = ?
           AND ml.link_type = 'contradicts'`
      )
      .get(projectId) as { count: number };

    // Count total links
    const totalLinks = this.db.instance
      .prepare(
        `SELECT COUNT(*) as count FROM memory_links ml
         JOIN memories m ON ml.source_id = m.id
         WHERE m.project_id = ?`
      )
      .get(projectId) as { count: number };

    // Count memories flagged due to contradictions that haven't been resolved
    const unresolvedCount = this.db.instance
      .prepare(
        `SELECT COUNT(*) as count FROM memories
         WHERE project_id = ?
           AND flagged_reason LIKE '%contradict%'
           AND superseded_by IS NULL
           AND deleted_at IS NULL`
      )
      .get(projectId) as { count: number };

    return {
      totalLinks: totalLinks.count,
      contradictionLinks: contradictionLinks.count,
      unresolvedCount: unresolvedCount.count,
    };
  }
}

export { ContradictionDetector as default };
