import { createHash, randomUUID } from 'crypto';
import type { DatabaseConnection } from './database.js';
import { cosineSimilarity } from '../search/vector.js';
import type {
  Memory,
  MemoryCreateInput,
  MemoryType,
  MemoryFeedback,
  FeedbackType,
  Language,
  CodeContext,
} from '../types.js';
import {
  detectLanguage,
  parseCodeContext,
  serializeCodeContext,
  deserializeCodeContext,
  enrichWithSourceHash,
} from '../language/index.js';

/**
 * Confidence adjustment deltas for feedback
 */
const CONFIDENCE_DELTAS: Record<FeedbackType, number> = {
  helpful: 0.05,
  wrong: -0.2,
  outdated: -0.3,
  duplicate: 0,
};

/**
 * Memory Repository - CRUD operations with project isolation
 */
export class MemoryRepository {
  constructor(private db: DatabaseConnection) {}

  /**
   * Create a new memory entry
   * Uses transaction to ensure atomicity when superseding memories
   */
  createMemory(
    input: MemoryCreateInput,
    embedding: Float32Array | null = null,
    projectRoot?: string
  ): Memory {
    const now = Math.floor(Date.now() / 1000);
    const id = randomUUID();
    const contentHash = this.hashContent(input.content);

    // V2: Auto-detect language and parse code context if not provided
    const language = input.language ?? detectLanguage(input.citation) ?? null;
    let codeContext = input.codeContext ?? parseCodeContext(input.citation) ?? null;

    // Enrich with sourceHash if projectRoot provided
    if (codeContext && projectRoot) {
      codeContext = enrichWithSourceHash(codeContext, projectRoot);
    }

    const codeContextJson = codeContext ? serializeCodeContext(codeContext) : null;

    // Wrap in transaction to ensure atomicity of UPDATE + INSERT for supersession
    return this.db.transaction(() => {
      // V2: Handle versioning for superseding memories
      let version = 1;
      if (input.supersedesId) {
        const oldMemory = this.findById(input.supersedesId, input.projectId);
        if (oldMemory) {
          version = oldMemory.version + 1;
          // Mark old memory as superseded
          this.db.instance
            .prepare(
              `UPDATE memories SET superseded_by = ?, superseded_at = ? WHERE id = ? AND project_id = ?`
            )
            .run(id, now, input.supersedesId, input.projectId);
        }
      }

      this.db.instance
        .prepare(
          `INSERT INTO memories (
            id, content, embedding, type, confidence, citation,
            project_id, content_hash, created_at, accessed_at, access_count,
            language, code_context, version, supersedes_id
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?)`
        )
        .run(
          id,
          input.content,
          embedding ? Buffer.from(embedding.buffer) : null,
          input.type ?? 'fact',
          input.confidence ?? 1.0,
          input.citation ?? null,
          input.projectId,
          contentHash,
          now,
          now,
          language,
          codeContextJson,
          version,
          input.supersedesId ?? null
        );

      return {
        id,
        content: input.content,
        embedding,
        type: (input.type ?? 'fact') as MemoryType,
        confidence: input.confidence ?? 1.0,
        citation: input.citation ?? null,
        projectId: input.projectId,
        contentHash,
        createdAt: new Date(now * 1000),
        accessedAt: new Date(now * 1000),
        accessCount: 0,
        deletedAt: null,
        deleteReason: null,
        // V2 fields
        language,
        codeContext,
        version,
        supersedesId: input.supersedesId ?? null,
        supersededBy: null,
        supersededAt: null,
        flaggedAt: null,
        flaggedReason: null,
        embeddingModel: null,
        // V3 fields
        goalStatus: null,
        goalPriority: null,
        parentGoalId: null,
        checkpointData: null,
        // V9 fields (fact store — populated via UPDATE after creation for fact_store tool)
        sourceUrl: null,
        sourceTitle: null,
        sourceType: null,
        directQuote: null,
        domainTags: null,
        staleAfterDays: null,
        lastVerified: null,
        usedIn: null,
        extractedBy: null,
        // V11 fields — not set by this INSERT, so these mirror the column
        // defaults (volatility NOT NULL DEFAULT 'slow', verified_at NULL).
        volatility: 'slow',
        verifiedAt: null,
      };
    });
  }

  /**
   * Find memory by ID with project isolation
   */
  findById(id: string, projectId: string): Memory | null {
    const row = this.db.instance
      .prepare(`SELECT * FROM memories WHERE id = ? AND project_id = ?`)
      .get(id, projectId) as MemoryRow | undefined;

    return row ? this.rowToMemory(row) : null;
  }

  /**
   * Find memories by project with optional filters
   */
  findByProject(
    projectId: string,
    options: {
      type?: MemoryType;
      limit?: number;
      includeDeleted?: boolean;
      minConfidence?: number;
      // V2 filters
      language?: Language;
      includeStale?: boolean;
      includeSuperseded?: boolean;
    } = {}
  ): Memory[] {
    let sql = 'SELECT * FROM memories WHERE project_id = ?';
    const params: unknown[] = [projectId];

    if (!options.includeDeleted) {
      sql += ' AND deleted_at IS NULL';
    }

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

    sql += ' ORDER BY accessed_at DESC';

    if (options.limit) {
      sql += ' LIMIT ?';
      params.push(options.limit);
    }

    const rows = this.db.instance.prepare(sql).all(...params) as MemoryRow[];
    return rows.map((row) => this.rowToMemory(row));
  }

  /**
   * Find all memories with embeddings for vector search
   */
  findWithEmbeddings(projectId: string): Memory[] {
    const rows = this.db.instance
      .prepare(
        `SELECT * FROM memories
         WHERE project_id = ?
           AND deleted_at IS NULL
           AND embedding IS NOT NULL`
      )
      .all(projectId) as MemoryRow[];

    return rows.map((row) => this.rowToMemory(row));
  }

  /**
   * Find semantically similar memories above a cosine-similarity threshold.
   * Used for near-duplicate detection on store.
   */
  findSemanticallySimilar(
    embedding: Float32Array,
    projectId: string,
    threshold: number = 0.88,
    limit: number = 5
  ): Array<{ memory: Memory; similarity: number }> {
    const candidates = this.findWithEmbeddings(projectId);
    const scored = candidates
      .map((memory) => ({
        memory,
        similarity: memory.embedding ? cosineSimilarity(embedding, memory.embedding) : 0,
      }))
      .filter(({ similarity }) => similarity >= threshold)
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, limit);
    return scored;
  }

  /**
   * Set a memory's confidence to an absolute value.
   * Used to soft-deprecate near-duplicate memories when a newer version arrives.
   */
  setConfidence(id: string, projectId: string, confidence: number): boolean {
    const clamped = Math.max(0.1, Math.min(1.0, confidence));
    const result = this.db.instance
      .prepare(
        `UPDATE memories SET confidence = ? WHERE id = ? AND project_id = ? AND deleted_at IS NULL`
      )
      .run(clamped, id, projectId);
    return result.changes > 0;
  }

  /**
   * Soft delete a memory with reason tracking
   */
  softDelete(id: string, projectId: string, reason: string): boolean {
    const now = Math.floor(Date.now() / 1000);
    const result = this.db.instance
      .prepare(
        `UPDATE memories
         SET deleted_at = ?, deleted_reason = ?
         WHERE id = ? AND project_id = ? AND deleted_at IS NULL`
      )
      .run(now, reason, id, projectId);

    return result.changes > 0;
  }

  /**
   * Update memory content and re-embed
   */
  updateContent(
    id: string,
    projectId: string,
    content: string,
    embedding: Float32Array | null = null
  ): boolean {
    const now = Math.floor(Date.now() / 1000);
    const contentHash = this.hashContent(content);

    const result = this.db.instance
      .prepare(
        `UPDATE memories
         SET content = ?, embedding = ?, content_hash = ?, accessed_at = ?
         WHERE id = ? AND project_id = ? AND deleted_at IS NULL`
      )
      .run(
        content,
        embedding ? Buffer.from(embedding.buffer) : null,
        contentHash,
        now,
        id,
        projectId
      );

    return result.changes > 0;
  }

  /**
   * Update access statistics
   */
  updateAccessStats(id: string): void {
    const now = Math.floor(Date.now() / 1000);
    this.db.instance
      .prepare(
        `UPDATE memories
         SET accessed_at = ?, access_count = access_count + 1
         WHERE id = ?`
      )
      .run(now, id);
  }

  /**
   * Check for duplicate by content hash
   */
  isDuplicate(contentHash: string, projectId: string): boolean {
    const row = this.db.instance
      .prepare(
        `SELECT 1 FROM memories
         WHERE content_hash = ? AND project_id = ? AND deleted_at IS NULL
         LIMIT 1`
      )
      .get(contentHash, projectId);

    return row !== undefined;
  }

  /**
   * Check duplicate by content
   */
  isDuplicateContent(content: string, projectId: string): boolean {
    return this.isDuplicate(this.hashContent(content), projectId);
  }

  /**
   * Count memories by project
   */
  countByProject(projectId: string, includeDeleted = false): number {
    let sql = 'SELECT COUNT(*) as count FROM memories WHERE project_id = ?';
    if (!includeDeleted) {
      sql += ' AND deleted_at IS NULL';
    }
    const result = this.db.instance.prepare(sql).get(projectId) as { count: number };
    return result.count;
  }

  /**
   * Get count of active (non-deleted) memories for quota enforcement
   */
  getMemoryCount(projectId: string): number {
    const row = this.db.instance
      .prepare('SELECT COUNT(*) as count FROM memories WHERE project_id = ? AND deleted_at IS NULL')
      .get(projectId) as { count: number };
    return row.count;
  }

  /**
   * Count memories by type
   */
  countByType(projectId: string): Record<MemoryType, number> {
    const rows = this.db.instance
      .prepare(
        `SELECT type, COUNT(*) as count
         FROM memories
         WHERE project_id = ? AND deleted_at IS NULL
         GROUP BY type`
      )
      .all(projectId) as Array<{ type: string; count: number }>;

    const result: Record<string, number> = {
      fact: 0,
      pattern: 0,
      decision: 0,
      error: 0,
      preference: 0,
    };

    for (const row of rows) {
      result[row.type] = row.count;
    }

    return result as Record<MemoryType, number>;
  }

  /**
   * Hash content for deduplication
   */
  private hashContent(content: string): string {
    return createHash('sha256').update(content).digest('hex');
  }

  /**
   * Convert database row to Memory object
   */
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
      language: row.language as Language | null,
      codeContext: deserializeCodeContext(row.code_context),
      version: row.version ?? 1,
      supersedesId: row.supersedes_id,
      supersededBy: row.superseded_by,
      supersededAt: row.superseded_at ? new Date(row.superseded_at * 1000) : null,
      flaggedAt: row.flagged_at ? new Date(row.flagged_at * 1000) : null,
      flaggedReason: row.flagged_reason,
      embeddingModel: row.embedding_model,
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

  // ========================================================================
  // V2: Versioning Methods
  // ========================================================================

  /**
   * Create a new version of an existing memory (superseding the old one)
   */
  createSupersedingMemory(
    oldId: string,
    projectId: string,
    newContent: string,
    embedding: Float32Array | null = null,
    language?: string,
    projectRoot?: string
  ): Memory {
    const oldMemory = this.findById(oldId, projectId);
    if (!oldMemory) {
      throw new Error(`Memory not found: ${oldId}`);
    }

    const input: MemoryCreateInput = {
      content: newContent,
      type: oldMemory.type,
      confidence: oldMemory.confidence,
      projectId,
      supersedesId: oldId,
    };
    // Only add optional fields if they have values
    if (oldMemory.citation) input.citation = oldMemory.citation;
    // Honor new language if provided, otherwise keep old language
    if (language) {
      input.language = language as Language;
    } else if (oldMemory.language) {
      input.language = oldMemory.language;
    }
    if (oldMemory.codeContext) input.codeContext = oldMemory.codeContext;

    return this.createMemory(input, embedding, projectRoot);
  }

  /**
   * Get the version history of a memory (most recent first)
   */
  getVersionHistory(id: string, projectId: string): Memory[] {
    const rows = this.db.instance
      .prepare(
        `WITH RECURSIVE version_chain AS (
          SELECT m.*, 0 as depth FROM memories m
          WHERE m.id = ? AND m.project_id = ? AND m.superseded_by IS NULL
          UNION ALL
          SELECT m.*, vc.depth + 1
          FROM memories m
          JOIN version_chain vc ON m.id = vc.supersedes_id
        )
        SELECT * FROM version_chain ORDER BY depth ASC`
      )
      .all(id, projectId) as MemoryRow[];

    return rows.map((row) => this.rowToMemory(row));
  }

  /**
   * Get the latest version of a memory (following supersession chain)
   */
  getLatestVersion(id: string, projectId: string): Memory | null {
    let current = this.findById(id, projectId);
    while (current?.supersededBy) {
      current = this.findById(current.supersededBy, projectId);
    }
    return current;
  }

  // ========================================================================
  // V2: Feedback Methods
  // ========================================================================

  /**
   * Record feedback on a memory and adjust confidence
   */
  recordFeedback(
    memoryId: string,
    projectId: string,
    feedbackType: FeedbackType,
    correction?: string,
    duplicateOf?: string
  ): MemoryFeedback {
    const now = Math.floor(Date.now() / 1000);
    const id = randomUUID();
    const delta = CONFIDENCE_DELTAS[feedbackType];

    // Insert feedback record
    this.db.instance
      .prepare(
        `INSERT INTO memory_feedback (
          id, memory_id, feedback_type, correction, duplicate_of, confidence_delta, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .run(id, memoryId, feedbackType, correction ?? null, duplicateOf ?? null, delta, now);

    // Adjust confidence with bounds [0.1, 1.0]
    this.db.instance
      .prepare(
        `UPDATE memories
         SET confidence = MAX(0.1, MIN(1.0, confidence + ?))
         WHERE id = ? AND project_id = ?`
      )
      .run(delta, memoryId, projectId);

    // Flag for review if wrong or outdated
    if (feedbackType === 'wrong' || feedbackType === 'outdated') {
      this.flagAsStale(memoryId, projectId, `feedback_${feedbackType}`);
    }

    return {
      id,
      memoryId,
      feedbackType,
      correction: correction ?? null,
      duplicateOf: duplicateOf ?? null,
      confidenceDelta: delta,
      createdAt: new Date(now * 1000),
    };
  }

  /**
   * Get feedback for a memory
   */
  getFeedback(memoryId: string): MemoryFeedback[] {
    const rows = this.db.instance
      .prepare(`SELECT * FROM memory_feedback WHERE memory_id = ? ORDER BY created_at DESC`)
      .all(memoryId) as FeedbackRow[];

    return rows.map((row) => ({
      id: row.id,
      memoryId: row.memory_id,
      feedbackType: row.feedback_type as FeedbackType,
      correction: row.correction,
      duplicateOf: row.duplicate_of,
      confidenceDelta: row.confidence_delta,
      createdAt: new Date(row.created_at * 1000),
    }));
  }

  // ========================================================================
  // V2: Staleness Methods
  // ========================================================================

  /**
   * Flag a memory as stale
   */
  flagAsStale(id: string, projectId: string, reason: string): boolean {
    const now = Math.floor(Date.now() / 1000);
    const result = this.db.instance
      .prepare(
        `UPDATE memories
         SET flagged_at = ?, flagged_reason = ?
         WHERE id = ? AND project_id = ? AND flagged_at IS NULL`
      )
      .run(now, reason, id, projectId);

    return result.changes > 0;
  }

  /**
   * Clear staleness flag
   */
  clearStaleFlag(id: string, projectId: string): boolean {
    const result = this.db.instance
      .prepare(
        `UPDATE memories
         SET flagged_at = NULL, flagged_reason = NULL
         WHERE id = ? AND project_id = ?`
      )
      .run(id, projectId);

    return result.changes > 0;
  }

  /**
   * Find stale memories by access (not accessed in recent sessions)
   */
  findAccessStale(projectId: string, sessionThreshold: number = 10): Memory[] {
    const rows = this.db.instance
      .prepare(
        `SELECT m.* FROM memories m
         WHERE m.project_id = ?
           AND m.deleted_at IS NULL
           AND m.flagged_at IS NULL
           AND m.superseded_by IS NULL
           AND m.accessed_at < (
             SELECT created_at FROM sessions
             WHERE project_id = ?
             ORDER BY session_number DESC
             LIMIT 1 OFFSET ?
           )`
      )
      .all(projectId, projectId, sessionThreshold) as MemoryRow[];

    return rows.map((row) => this.rowToMemory(row));
  }

  /**
   * Find memories with low confidence
   */
  findLowConfidence(projectId: string, threshold: number = 0.3): Memory[] {
    const rows = this.db.instance
      .prepare(
        `SELECT * FROM memories
         WHERE project_id = ?
           AND deleted_at IS NULL
           AND superseded_by IS NULL
           AND confidence < ?`
      )
      .all(projectId, threshold) as MemoryRow[];

    return rows.map((row) => this.rowToMemory(row));
  }
}

/**
 * Database row type for memory_feedback table
 */
interface FeedbackRow {
  id: string;
  memory_id: string;
  feedback_type: string;
  correction: string | null;
  duplicate_of: string | null;
  confidence_delta: number;
  created_at: number;
}

/**
 * Database row type for memories table
 */
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
  language: string | null;
  code_context: string | null;
  version: number | null;
  supersedes_id: string | null;
  superseded_by: string | null;
  superseded_at: number | null;
  flagged_at: number | null;
  flagged_reason: string | null;
  embedding_model: string | null;
  // V3 columns
  goal_status: string | null;
  goal_priority: number | null;
  parent_goal_id: string | null;
  checkpoint_data: string | null;
  // V9 columns
  source_url: string | null;
  source_title: string | null;
  source_type: string | null;
  direct_quote: string | null;
  domain_tags: string | null;
  stale_after_days: number | null;
  last_verified: number | null;
  used_in: string | null;
  extracted_by: string | null;
  // V11 columns
  volatility: string;
  verified_at: number | null;
}
