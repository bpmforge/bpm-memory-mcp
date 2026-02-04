import type { DatabaseConnection } from '../storage/database.js';
import type { Memory, MemorySearchResult, MemoryType, Language } from '../types.js';

/**
 * BM25 search using SQLite FTS5
 */
export class BM25Search {
  constructor(private db: DatabaseConnection) {}

  /**
   * Search memories using BM25 ranking
   */
  search(
    query: string,
    projectId: string,
    options: {
      limit?: number;
      type?: MemoryType;
      minConfidence?: number;
      // V2 filters
      language?: Language;
      includeStale?: boolean;
      includeSuperseded?: boolean;
    } = {}
  ): MemorySearchResult[] {
    const limit = options.limit ?? 10;

    // Build FTS5 query - escape special characters
    const ftsQuery = this.buildFtsQuery(query);

    let sql = `
      SELECT
        m.*,
        bm25(memories_fts) as bm25_score
      FROM memories m
      JOIN memories_fts ON m.rowid = memories_fts.rowid
      WHERE memories_fts MATCH ?
        AND m.project_id = ?
        AND m.deleted_at IS NULL
    `;

    const params: unknown[] = [ftsQuery, projectId];

    // V2: Exclude superseded by default
    if (!options.includeSuperseded) {
      sql += ' AND m.superseded_by IS NULL';
    }

    // V2: Exclude stale by default
    if (!options.includeStale) {
      sql += ' AND m.flagged_at IS NULL';
    }

    if (options.type) {
      sql += ' AND m.type = ?';
      params.push(options.type);
    }

    if (options.minConfidence !== undefined) {
      sql += ' AND m.confidence >= ?';
      params.push(options.minConfidence);
    }

    // V2: Language filter
    if (options.language) {
      sql += ' AND m.language = ?';
      params.push(options.language);
    }

    sql += ' ORDER BY bm25_score LIMIT ?';
    params.push(limit);

    try {
      const rows = this.db.instance.prepare(sql).all(...params) as Array<
        MemoryRow & { bm25_score: number }
      >;

      return rows.map((row) => ({
        memory: this.rowToMemory(row),
        relevance: this.normalizeBm25Score(row.bm25_score),
        bm25Score: row.bm25_score,
      }));
    } catch (error) {
      // FTS query might fail if query is empty or malformed
      console.error('BM25 search failed:', error);
      return [];
    }
  }

  /**
   * Build FTS5 query string from user query
   * Handles special characters and creates prefix matching
   */
  private buildFtsQuery(query: string): string {
    // Remove FTS5 special characters
    const cleaned = query
      .replace(/['"(){}[\]^~*:]/g, ' ')
      .trim()
      .split(/\s+/)
      .filter((term) => term.length > 0)
      .map((term) => `"${term}"*`) // Prefix matching with quotes
      .join(' OR ');

    return cleaned || '""'; // Empty query fallback
  }

  /**
   * Normalize BM25 score to 0-1 range
   * BM25 returns negative scores where lower (more negative) is better
   */
  private normalizeBm25Score(score: number): number {
    // BM25 in FTS5 returns negative values, closer to 0 is better
    // Normalize to 0-1 where 1 is best
    return Math.exp(score); // e^score gives us 0-1 range for typical values
  }

  private rowToMemory(row: MemoryRow): Memory {
    return {
      id: row.id,
      content: row.content,
      embedding: row.embedding ? new Float32Array(row.embedding.buffer) : null,
      type: row.type as MemoryType,
      confidence: row.confidence,
      citation: row.citation,
      projectId: row.project_id,
      contentHash: row.content_hash,
      createdAt: new Date(row.created_at * 1000),
      accessedAt: new Date(row.accessed_at * 1000),
      accessCount: row.access_count,
      deletedAt: row.deleted_at ? new Date(row.deleted_at * 1000) : null,
      deleteReason: row.deleted_reason,
      // V2 fields - use defaults for BM25 search results
      language: (row.language as Memory['language']) ?? null,
      codeContext: row.code_context ? JSON.parse(row.code_context) : null,
      version: row.version ?? 1,
      supersedesId: row.supersedes_id ?? null,
      supersededBy: row.superseded_by ?? null,
      supersededAt: row.superseded_at ? new Date(row.superseded_at * 1000) : null,
      flaggedAt: row.flagged_at ? new Date(row.flagged_at * 1000) : null,
      flaggedReason: row.flagged_reason ?? null,
      embeddingModel: row.embedding_model ?? null,
      // V3 fields
      goalStatus: (row.goal_status as Memory['goalStatus']) ?? null,
      goalPriority: row.goal_priority ?? null,
      parentGoalId: row.parent_goal_id ?? null,
      checkpointData: row.checkpoint_data ? JSON.parse(row.checkpoint_data) : null,
    };
  }
}

interface MemoryRow {
  id: string;
  content: string;
  embedding: Buffer | null;
  type: string;
  confidence: number;
  citation: string | null;
  project_id: string;
  content_hash: string;
  created_at: number;
  accessed_at: number;
  access_count: number;
  deleted_at: number | null;
  deleted_reason: string | null;
  // V2 columns
  language?: string | null;
  code_context?: string | null;
  version?: number | null;
  supersedes_id?: string | null;
  superseded_by?: string | null;
  superseded_at?: number | null;
  flagged_at?: number | null;
  flagged_reason?: string | null;
  embedding_model?: string | null;
  // V3 columns
  goal_status?: string | null;
  goal_priority?: number | null;
  parent_goal_id?: string | null;
  checkpoint_data?: string | null;
}
