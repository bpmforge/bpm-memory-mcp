import type { DatabaseConnection } from '../storage/database.js';
import type { Memory, MemoryType, MemorySearchResult, SearchResponse, SearchOptions } from '../types.js';
import type { EmbeddingService } from '../embeddings/index.js';
import { VectorSearch } from './vector.js';
import { BM25Search } from './bm25.js';
import { rrfFusion, interleave } from './rrf.js';

export { VectorSearch, cosineSimilarity, normalizeVector } from './vector.js';
export { BM25Search } from './bm25.js';
export { rrfFusion, interleave } from './rrf.js';

/**
 * Hybrid search service combining vector and BM25 search
 */
export class HybridSearch {
  private vectorSearch: VectorSearch;
  private bm25Search: BM25Search;

  constructor(
    private db: DatabaseConnection,
    private embeddings: EmbeddingService,
    private config: {
      vectorWeight?: number;
      bm25Weight?: number;
      rrfK?: number;
    } = {}
  ) {
    this.vectorSearch = new VectorSearch();
    this.bm25Search = new BM25Search(db);
  }

  /**
   * Perform hybrid search combining vector and BM25 results
   */
  async search(query: string, options: SearchOptions): Promise<SearchResponse> {
    const startTime = Date.now();
    const limit = options.limit ?? 10;

    // Run both searches in parallel
    const [vectorResults, bm25Results] = await Promise.all([
      this.vectorSearchMemories(query, options),
      this.bm25SearchMemories(query, options),
    ]);

    // Combine results using RRF
    let fusedResults: MemorySearchResult[];

    if (vectorResults.length === 0 && bm25Results.length === 0) {
      fusedResults = [];
    } else if (vectorResults.length === 0) {
      // Vector search unavailable - use BM25 only
      fusedResults = bm25Results.slice(0, limit);
    } else if (bm25Results.length === 0) {
      // BM25 returned nothing - use vector only
      fusedResults = vectorResults.slice(0, limit);
    } else {
      // Full hybrid search
      fusedResults = rrfFusion(vectorResults, bm25Results, {
        k: this.config.rrfK ?? 60,
        vectorWeight: this.config.vectorWeight ?? 0.5,
        bm25Weight: this.config.bm25Weight ?? 0.5,
        limit,
      });
    }

    const latencyMs = Date.now() - startTime;

    return {
      memories: fusedResults,
      searchStats: {
        vectorMatches: vectorResults.length,
        bm25Matches: bm25Results.length,
        fusedResults: fusedResults.length,
        latencyMs,
      },
    };
  }

  /**
   * Vector search with embedding generation
   */
  private async vectorSearchMemories(
    query: string,
    options: SearchOptions
  ): Promise<MemorySearchResult[]> {
    // Generate query embedding
    const queryEmbedding = await this.embeddings.embed(query);
    if (!queryEmbedding) {
      return []; // Embedding service unavailable
    }

    // Build dynamic query
    let sql = `
      SELECT * FROM memories
      WHERE project_id = ?
        AND deleted_at IS NULL
        AND embedding IS NOT NULL
    `;
    const params: unknown[] = [options.projectId];

    if (options.type) {
      sql += ' AND type = ?';
      params.push(options.type);
    }
    if (options.minConfidence !== undefined) {
      sql += ' AND confidence >= ?';
      params.push(options.minConfidence);
    }

    const rows = this.db.instance.prepare(sql).all(...params) as MemoryRow[];
    const memories = rows.map((row) => this.rowToMemory(row));

    // Perform vector search
    return this.vectorSearch.search(queryEmbedding, memories, (options.limit ?? 10) * 2);
  }

  /**
   * BM25 keyword search
   */
  private bm25SearchMemories(
    query: string,
    options: SearchOptions
  ): MemorySearchResult[] {
    const bm25Options: { limit?: number; type?: MemoryType; minConfidence?: number } = {
      limit: (options.limit ?? 10) * 2,
    };
    if (options.type) bm25Options.type = options.type;
    if (options.minConfidence !== undefined) bm25Options.minConfidence = options.minConfidence;

    return this.bm25Search.search(query, options.projectId, bm25Options);
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
}
