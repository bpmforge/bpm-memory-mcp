import { createHash, randomUUID } from 'crypto';
import type { DatabaseConnection } from './database.js';
import type { Memory, MemoryCreateInput, MemoryType } from '../types.js';

/**
 * Memory Repository - CRUD operations with project isolation
 */
export class MemoryRepository {
  constructor(private db: DatabaseConnection) {}

  /**
   * Create a new memory entry
   */
  createMemory(input: MemoryCreateInput, embedding: Float32Array | null = null): Memory {
    const now = Math.floor(Date.now() / 1000);
    const id = randomUUID();
    const contentHash = this.hashContent(input.content);

    this.db.instance
      .prepare(
        `INSERT INTO memories (
          id, content, embedding, type, confidence, citation,
          project_id, content_hash, created_at, accessed_at, access_count
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)`
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
        now
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
    };
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
    } = {}
  ): Memory[] {
    let sql = 'SELECT * FROM memories WHERE project_id = ?';
    const params: unknown[] = [projectId];

    if (!options.includeDeleted) {
      sql += ' AND deleted_at IS NULL';
    }

    if (options.type) {
      sql += ' AND type = ?';
      params.push(options.type);
    }

    if (options.minConfidence !== undefined) {
      sql += ' AND confidence >= ?';
      params.push(options.minConfidence);
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
    };
  }
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
}
