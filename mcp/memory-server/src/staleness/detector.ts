import { existsSync, readFileSync } from 'fs';
import { resolve } from 'path';
import { createHash } from 'crypto';
import type { DatabaseConnection } from '../storage/database.js';
import type { Memory, MemoryType, CodeContext } from '../types.js';
import { parseCodeContext } from '../language/context.js';

/**
 * Memory row from database
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
  // V12 columns
  quarantined_at?: number | null;
  promoted_at?: number | null;
  promotion_reason?: string | null;
}

/**
 * Staleness detector for identifying memories that may be outdated
 */
export class StalenessDetector {
  constructor(private db: DatabaseConnection) {}

  /**
   * Detect memories not accessed in recent sessions
   */
  detectAccessStale(projectId: string, sessionThreshold: number = 10): Memory[] {
    // Get current session number
    const sessionRow = this.db.instance
      .prepare(`SELECT MAX(session_number) as max_session FROM sessions WHERE project_id = ?`)
      .get(projectId) as { max_session: number | null } | undefined;

    const currentSession = sessionRow?.max_session ?? 0;
    if (currentSession < sessionThreshold) {
      // Not enough sessions to detect staleness
      return [];
    }

    // Find threshold timestamp - when the Nth session ago started
    const thresholdRow = this.db.instance
      .prepare(
        `SELECT created_at FROM sessions
         WHERE project_id = ? AND session_number IS NOT NULL
         ORDER BY session_number DESC
         LIMIT 1 OFFSET ?`
      )
      .get(projectId, sessionThreshold - 1) as { created_at: number } | undefined;

    if (!thresholdRow) {
      return [];
    }

    // Find memories not accessed since that session
    const rows = this.db.instance
      .prepare(
        `SELECT * FROM memories
         WHERE project_id = ?
           AND deleted_at IS NULL
           AND flagged_at IS NULL
           AND superseded_by IS NULL
           AND accessed_at < ?`
      )
      .all(projectId, thresholdRow.created_at) as MemoryRow[];

    return rows.map((row) => this.rowToMemory(row));
  }

  /**
   * Detect memories whose citation files no longer exist
   */
  detectSourceMissing(projectId: string, projectRoot: string): Memory[] {
    // Get memories with citations
    const rows = this.db.instance
      .prepare(
        `SELECT * FROM memories
         WHERE project_id = ?
           AND citation IS NOT NULL
           AND deleted_at IS NULL
           AND flagged_at IS NULL
           AND superseded_by IS NULL`
      )
      .all(projectId) as MemoryRow[];

    return rows
      .filter((row) => {
        const context = parseCodeContext(row.citation);
        if (!context) return false;

        const fullPath = resolve(projectRoot, context.filePath);
        return !existsSync(fullPath);
      })
      .map((row) => this.rowToMemory(row));
  }

  /**
   * Detect memories with low confidence that may need review
   */
  detectLowConfidence(projectId: string, threshold: number = 0.5): Memory[] {
    const rows = this.db.instance
      .prepare(
        `SELECT * FROM memories
         WHERE project_id = ?
           AND confidence < ?
           AND deleted_at IS NULL
           AND flagged_at IS NULL
           AND superseded_by IS NULL
         ORDER BY confidence ASC`
      )
      .all(projectId, threshold) as MemoryRow[];

    return rows.map((row) => this.rowToMemory(row));
  }

  /**
   * Detect memories whose source file content has changed
   * Compares stored sourceHash with current file hash
   */
  detectContentChanged(projectId: string, projectRoot: string): Memory[] {
    // Get memories with code context that have source hashes
    const rows = this.db.instance
      .prepare(
        `SELECT * FROM memories
         WHERE project_id = ?
           AND code_context IS NOT NULL
           AND deleted_at IS NULL
           AND flagged_at IS NULL
           AND superseded_by IS NULL`
      )
      .all(projectId) as MemoryRow[];

    return rows
      .filter((row) => {
        if (!row.code_context) return false;

        const codeContext: CodeContext = JSON.parse(row.code_context);
        if (!codeContext.sourceHash) return false;

        const fullPath = resolve(projectRoot, codeContext.filePath);
        if (!existsSync(fullPath)) return false; // Missing files handled separately

        try {
          const currentHash = this.computeFileHash(fullPath);
          return currentHash !== codeContext.sourceHash;
        } catch {
          return false; // Unable to read file
        }
      })
      .map((row) => this.rowToMemory(row));
  }

  /**
   * Compute SHA-256 hash of file content
   */
  computeFileHash(filePath: string): string {
    const content = readFileSync(filePath, 'utf-8');
    return createHash('sha256').update(content).digest('hex');
  }

  /**
   * Flag a memory as stale
   */
  flagAsStale(memoryId: string, projectId: string, reason: string): boolean {
    const result = this.db.instance
      .prepare(
        `UPDATE memories
         SET flagged_at = ?, flagged_reason = ?
         WHERE id = ? AND project_id = ? AND deleted_at IS NULL AND flagged_at IS NULL`
      )
      .run(Math.floor(Date.now() / 1000), reason, memoryId, projectId);

    return result.changes > 0;
  }

  /**
   * Clear stale flag from a memory
   */
  clearStaleFlag(memoryId: string, projectId: string): boolean {
    const result = this.db.instance
      .prepare(
        `UPDATE memories
         SET flagged_at = NULL, flagged_reason = NULL
         WHERE id = ? AND project_id = ? AND flagged_at IS NOT NULL`
      )
      .run(memoryId, projectId);

    return result.changes > 0;
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
      // V12 fields
      quarantinedAt: row.quarantined_at ? new Date(row.quarantined_at * 1000) : null,
      promotedAt: row.promoted_at ? new Date(row.promoted_at * 1000) : null,
      promotionReason: (row.promotion_reason as Memory['promotionReason']) ?? null,
    };
  }
}
