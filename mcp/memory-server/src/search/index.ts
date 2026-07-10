import type { DatabaseConnection } from '../storage/database.js';
import type {
  Memory,
  MemoryType,
  MemorySearchResult,
  SearchResponse,
  SearchOptions,
} from '../types.js';
import type { EmbeddingService } from '../embeddings/index.js';
import { VectorSearch } from './vector.js';
import { BM25Search } from './bm25.js';
import { rrfFusion, rrfFusionWithLinks, interleave } from './rrf.js';
import { applyVolatilityStaleness } from './volatility-staleness.js';
import { MemoryLinkRepository } from '../storage/links.js';

export { VectorSearch, cosineSimilarity, normalizeVector } from './vector.js';
export { BM25Search } from './bm25.js';
export { rrfFusion, rrfFusionWithLinks, interleave } from './rrf.js';
export { volatilityMultiplier, applyVolatilityStaleness } from './volatility-staleness.js';
export {
  rerankResults,
  rerankWithLinkDensity,
  calculateLinkDensityScore,
  filterByRecency,
  filterByConfidence,
  boostByType,
  diversifyResults,
} from './rerank.js';

/**
 * Hybrid search service combining vector, BM25, and link-based search
 */
export class HybridSearch {
  private vectorSearch: VectorSearch;
  private bm25Search: BM25Search;
  private linkRepository: MemoryLinkRepository;

  constructor(
    private db: DatabaseConnection,
    private embeddings: EmbeddingService,
    private config: {
      vectorWeight?: number;
      bm25Weight?: number;
      linkWeight?: number;
      rrfK?: number;
      enableLinkSearch?: boolean;
    } = {}
  ) {
    this.vectorSearch = new VectorSearch();
    this.bm25Search = new BM25Search(db);
    this.linkRepository = new MemoryLinkRepository(db);
  }

  /**
   * Perform hybrid search combining vector, BM25, and link-based results
   */
  async search(query: string, options: SearchOptions): Promise<SearchResponse> {
    const startTime = Date.now();
    const limit = options.limit ?? 10;
    // T11.2: fuse/gather a wider candidate window than the final page so the
    // volatility staleness penalty (applied below) can displace staled-out
    // memories with fresher ones instead of merely burying them in-place.
    const candidateLimit = limit * 3;
    const enableLinks = this.config.enableLinkSearch ?? true;

    // Run vector and BM25 searches in parallel
    const [vectorResults, bm25Results] = await Promise.all([
      this.vectorSearchMemories(query, options),
      this.bm25SearchMemories(query, options),
    ]);

    // Get seed memory IDs from initial results for link traversal
    let linkResults: MemorySearchResult[] = [];
    if (enableLinks && (vectorResults.length > 0 || bm25Results.length > 0)) {
      // Use top results as seeds for link traversal
      const seedIds = [
        ...vectorResults.slice(0, 5).map((r) => r.memory.id),
        ...bm25Results.slice(0, 5).map((r) => r.memory.id),
      ];
      const uniqueSeedIds = [...new Set(seedIds)];
      linkResults = this.linkSearchMemories(uniqueSeedIds, options);
    }

    // Combine results using RRF
    let fusedResults: MemorySearchResult[];

    if (vectorResults.length === 0 && bm25Results.length === 0) {
      fusedResults = [];
    } else if (vectorResults.length === 0 && bm25Results.length === 0 && linkResults.length > 0) {
      // Only link results available
      fusedResults = linkResults.slice(0, candidateLimit);
    } else if (linkResults.length > 0) {
      // Full three-way fusion with links
      fusedResults = rrfFusionWithLinks(vectorResults, bm25Results, linkResults, {
        k: this.config.rrfK ?? 60,
        vectorWeight: this.config.vectorWeight ?? 0.35,
        bm25Weight: this.config.bm25Weight ?? 0.35,
        linkWeight: this.config.linkWeight ?? 0.3,
        limit: candidateLimit,
      });
    } else if (vectorResults.length === 0) {
      // Vector search unavailable - use BM25 only
      fusedResults = bm25Results.slice(0, candidateLimit);
    } else if (bm25Results.length === 0) {
      // BM25 returned nothing - use vector only
      fusedResults = vectorResults.slice(0, candidateLimit);
    } else {
      // Two-way hybrid search (no link results)
      fusedResults = rrfFusion(vectorResults, bm25Results, {
        k: this.config.rrfK ?? 60,
        vectorWeight: this.config.vectorWeight ?? 0.5,
        bm25Weight: this.config.bm25Weight ?? 0.5,
        limit: candidateLimit,
      });
    }

    // T11.2: fold the volatility-scaled staleness penalty into the final
    // score, then truncate to the page the caller actually asked for.
    fusedResults = applyVolatilityStaleness(fusedResults).slice(0, limit);

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

    // V2: Exclude superseded by default
    if (!options.includeSuperseded) {
      sql += ' AND superseded_by IS NULL';
    }

    // V2: Exclude stale by default
    if (!options.includeStale) {
      sql += ' AND flagged_at IS NULL';
    }

    if (options.type) {
      sql += ' AND type = ?';
      params.push(options.type);
    }
    if (options.minConfidence !== undefined) {
      sql += ' AND confidence >= ?';
      params.push(options.minConfidence);
    }

    // V2: Language filter
    if (options.language) {
      sql += ' AND language = ?';
      params.push(options.language);
    }

    const rows = this.db.instance.prepare(sql).all(...params) as MemoryRow[];
    const memories = rows.map((row) => this.rowToMemory(row));

    // Perform vector search
    return this.vectorSearch.search(queryEmbedding, memories, (options.limit ?? 10) * 2);
  }

  /**
   * BM25 keyword search
   */
  private bm25SearchMemories(query: string, options: SearchOptions): MemorySearchResult[] {
    const bm25Options: { limit?: number; type?: MemoryType; minConfidence?: number } = {
      limit: (options.limit ?? 10) * 2,
    };
    if (options.type) bm25Options.type = options.type;
    if (options.minConfidence !== undefined) bm25Options.minConfidence = options.minConfidence;

    return this.bm25Search.search(query, options.projectId, bm25Options);
  }

  /**
   * Link-based search: traverse links from seed memories
   * Returns memories connected to seeds, scored by link strength and distance
   */
  private linkSearchMemories(
    seedMemoryIds: string[],
    options: SearchOptions
  ): MemorySearchResult[] {
    const DISTANCE_DECAY = 0.5; // Score halves with each hop
    const MAX_DEPTH = 2;

    const seenIds = new Set(seedMemoryIds);
    const linkedMemories: Array<{ memory: Memory; score: number }> = [];

    for (const seedId of seedMemoryIds) {
      const linkedIds = this.linkRepository.findLinkedMemoryIds(seedId, MAX_DEPTH);

      for (const { memoryId, distance, linkStrength } of linkedIds) {
        // Skip if already processed or is a seed
        if (seenIds.has(memoryId)) continue;
        seenIds.add(memoryId);

        // Fetch memory
        const row = this.db.instance
          .prepare(
            `SELECT * FROM memories
             WHERE id = ? AND project_id = ? AND deleted_at IS NULL`
          )
          .get(memoryId, options.projectId) as MemoryRow | undefined;

        if (!row) continue;

        const memory = this.rowToMemory(row);

        // Apply filters
        if (options.type && memory.type !== options.type) continue;
        if (options.minConfidence !== undefined && memory.confidence < options.minConfidence)
          continue;
        if (!options.includeSuperseded && memory.supersededBy) continue;
        if (!options.includeStale && memory.flaggedAt) continue;
        if (options.language && memory.language !== options.language) continue;

        // Calculate score: linkStrength * distance_decay^distance
        const score = linkStrength * Math.pow(DISTANCE_DECAY, distance);

        linkedMemories.push({ memory, score });
      }
    }

    // Sort by score descending
    linkedMemories.sort((a, b) => b.score - a.score);

    // Convert to MemorySearchResult
    return linkedMemories.slice(0, (options.limit ?? 10) * 2).map(({ memory, score }) => ({
      memory,
      relevance: score,
    }));
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
      // V2 fields
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
      // V9 fields (fact store)
      sourceUrl: row.source_url ?? null,
      sourceTitle: row.source_title ?? null,
      sourceType: (row.source_type as Memory['sourceType']) ?? null,
      directQuote: row.direct_quote ?? null,
      domainTags: row.domain_tags ? JSON.parse(row.domain_tags) : null,
      staleAfterDays: row.stale_after_days ?? null,
      lastVerified: row.last_verified ? new Date(row.last_verified * 1000) : null,
      usedIn: row.used_in ? JSON.parse(row.used_in) : null,
      extractedBy: row.extracted_by ?? null,
      // V11 fields
      volatility: (row.volatility as Memory['volatility']) ?? 'slow',
      verifiedAt: row.verified_at ? new Date(row.verified_at * 1000) : null,
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
  // V9 columns
  source_url?: string | null;
  source_title?: string | null;
  source_type?: string | null;
  direct_quote?: string | null;
  domain_tags?: string | null;
  stale_after_days?: number | null;
  last_verified?: number | null;
  used_in?: string | null;
  extracted_by?: string | null;
  // V11 columns
  volatility?: string | null;
  verified_at?: number | null;
}
