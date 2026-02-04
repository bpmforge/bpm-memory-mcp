import { randomUUID } from 'crypto';
import type { DatabaseConnection } from '../storage/database.js';
import type { CheckpointState, CheckpointCreateInput } from '../types.js';
import { MemoryType } from '../types.js';

/**
 * Database row type for checkpoint memories
 */
interface CheckpointMemoryRow {
  id: string;
  content: string;
  project_id: string;
  checkpoint_data: string;
  created_at: number;
  accessed_at: number;
  deleted_at: number | null;
}

/**
 * Checkpoint Repository - Manages task state snapshots for resumption
 */
export class CheckpointRepository {
  constructor(private db: DatabaseConnection) {}

  /**
   * Save a checkpoint for a task
   */
  saveCheckpoint(projectId: string, input: CheckpointCreateInput): CheckpointState {
    const now = Math.floor(Date.now() / 1000);
    const id = randomUUID();

    const checkpointState: CheckpointState = {
      id,
      taskId: input.taskId,
      phase: input.phase,
      completedSteps: input.completedSteps,
      pendingSteps: input.pendingSteps,
      artifacts: input.artifacts ?? [],
      createdAt: new Date(now * 1000),
    };

    // Create a human-readable content summary
    const content = this.formatCheckpointContent(checkpointState);
    const checkpointData = JSON.stringify(checkpointState);

    this.db.instance
      .prepare(
        `INSERT INTO memories (
          id, content, type, confidence, project_id, content_hash,
          created_at, accessed_at, access_count, checkpoint_data
        ) VALUES (?, ?, ?, 1.0, ?, ?, ?, ?, 0, ?)`
      )
      .run(
        id,
        content,
        MemoryType.CHECKPOINT,
        projectId,
        this.hashContent(content),
        now,
        now,
        checkpointData
      );

    return checkpointState;
  }

  /**
   * Restore the most recent checkpoint for a task
   */
  restoreCheckpoint(projectId: string, taskId: string): CheckpointState | null {
    const row = this.db.instance
      .prepare(
        `SELECT * FROM memories
         WHERE project_id = ?
           AND type = 'checkpoint'
           AND checkpoint_data LIKE ?
           AND deleted_at IS NULL
         ORDER BY created_at DESC
         LIMIT 1`
      )
      .get(projectId, `%"taskId":"${taskId}"%`) as CheckpointMemoryRow | undefined;

    if (!row) {
      return null;
    }

    // Update access time
    const now = Math.floor(Date.now() / 1000);
    this.db.instance
      .prepare('UPDATE memories SET accessed_at = ?, access_count = access_count + 1 WHERE id = ?')
      .run(now, row.id);

    return this.rowToCheckpoint(row);
  }

  /**
   * List all checkpoints for a project
   */
  listCheckpoints(
    projectId: string,
    options: { limit?: number; taskId?: string } = {}
  ): CheckpointState[] {
    let sql = `
      SELECT * FROM memories
      WHERE project_id = ?
        AND type = 'checkpoint'
        AND deleted_at IS NULL
    `;
    const params: unknown[] = [projectId];

    if (options.taskId) {
      sql += ` AND checkpoint_data LIKE ?`;
      params.push(`%"taskId":"${options.taskId}"%`);
    }

    sql += ' ORDER BY created_at DESC';

    if (options.limit) {
      sql += ' LIMIT ?';
      params.push(options.limit);
    }

    const rows = this.db.instance.prepare(sql).all(...params) as CheckpointMemoryRow[];

    return rows.map((row) => this.rowToCheckpoint(row));
  }

  /**
   * Get a specific checkpoint by ID
   */
  getCheckpoint(checkpointId: string, projectId: string): CheckpointState | null {
    const row = this.db.instance
      .prepare(
        `SELECT * FROM memories
         WHERE id = ?
           AND project_id = ?
           AND type = 'checkpoint'`
      )
      .get(checkpointId, projectId) as CheckpointMemoryRow | undefined;

    return row ? this.rowToCheckpoint(row) : null;
  }

  /**
   * Delete a checkpoint
   */
  deleteCheckpoint(checkpointId: string, projectId: string): boolean {
    const now = Math.floor(Date.now() / 1000);

    const result = this.db.instance
      .prepare(
        `UPDATE memories
         SET deleted_at = ?, deleted_reason = 'checkpoint_deleted'
         WHERE id = ? AND project_id = ? AND type = 'checkpoint'`
      )
      .run(now, checkpointId, projectId);

    return result.changes > 0;
  }

  /**
   * Delete old checkpoints for a task (keep only recent N)
   */
  pruneCheckpoints(projectId: string, taskId: string, keepCount: number = 5): number {
    // Get IDs of checkpoints to keep
    const keepIds = this.db.instance
      .prepare(
        `SELECT id FROM memories
         WHERE project_id = ?
           AND type = 'checkpoint'
           AND checkpoint_data LIKE ?
           AND deleted_at IS NULL
         ORDER BY created_at DESC
         LIMIT ?`
      )
      .all(projectId, `%"taskId":"${taskId}"%`, keepCount) as Array<{ id: string }>;

    if (keepIds.length === 0) return 0;

    const keepSet = new Set(keepIds.map((r) => r.id));

    // Delete checkpoints not in the keep set
    const allIds = this.db.instance
      .prepare(
        `SELECT id FROM memories
         WHERE project_id = ?
           AND type = 'checkpoint'
           AND checkpoint_data LIKE ?
           AND deleted_at IS NULL`
      )
      .all(projectId, `%"taskId":"${taskId}"%`) as Array<{ id: string }>;

    const now = Math.floor(Date.now() / 1000);
    let deleted = 0;

    for (const { id } of allIds) {
      if (!keepSet.has(id)) {
        this.db.instance
          .prepare(
            `UPDATE memories
             SET deleted_at = ?, deleted_reason = 'checkpoint_pruned'
             WHERE id = ?`
          )
          .run(now, id);
        deleted++;
      }
    }

    return deleted;
  }

  /**
   * Get list of unique task IDs with checkpoints
   */
  getTasksWithCheckpoints(projectId: string): string[] {
    const rows = this.db.instance
      .prepare(
        `SELECT DISTINCT checkpoint_data FROM memories
         WHERE project_id = ?
           AND type = 'checkpoint'
           AND deleted_at IS NULL
         ORDER BY created_at DESC`
      )
      .all(projectId) as Array<{ checkpoint_data: string }>;

    const taskIds = new Set<string>();
    for (const row of rows) {
      try {
        const data = JSON.parse(row.checkpoint_data) as CheckpointState;
        taskIds.add(data.taskId);
      } catch {
        // Skip invalid JSON
      }
    }

    return Array.from(taskIds);
  }

  /**
   * Format checkpoint content for human readability
   */
  private formatCheckpointContent(checkpoint: CheckpointState): string {
    const completedSummary = checkpoint.completedSteps.slice(0, 3).join(', ');
    const pendingSummary = checkpoint.pendingSteps.slice(0, 3).join(', ');

    return `Checkpoint for "${checkpoint.taskId}" - Phase: ${checkpoint.phase}
Completed (${checkpoint.completedSteps.length}): ${completedSummary}${checkpoint.completedSteps.length > 3 ? '...' : ''}
Pending (${checkpoint.pendingSteps.length}): ${pendingSummary}${checkpoint.pendingSteps.length > 3 ? '...' : ''}
Artifacts: ${checkpoint.artifacts.length}`;
  }

  /**
   * Hash content for deduplication
   */
  private hashContent(content: string): string {
    const { createHash } = require('crypto');
    return createHash('sha256').update(content).digest('hex');
  }

  /**
   * Convert database row to CheckpointState
   */
  private rowToCheckpoint(row: CheckpointMemoryRow): CheckpointState {
    const data = JSON.parse(row.checkpoint_data) as CheckpointState;

    return {
      id: row.id,
      taskId: data.taskId,
      phase: data.phase,
      completedSteps: data.completedSteps,
      pendingSteps: data.pendingSteps,
      artifacts: data.artifacts,
      createdAt: new Date(row.created_at * 1000),
    };
  }
}

export { CheckpointRepository as default };
