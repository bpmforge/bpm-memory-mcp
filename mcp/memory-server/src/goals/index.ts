import { randomUUID } from 'crypto';
import type { DatabaseConnection } from '../storage/database.js';
import type { GoalState, GoalCreateInput, GoalStatus, Memory } from '../types.js';
import { MemoryType } from '../types.js';

/**
 * Database row type for goal memories
 */
interface GoalMemoryRow {
  id: string;
  content: string;
  project_id: string;
  goal_status: string;
  goal_priority: number;
  parent_goal_id: string | null;
  created_at: number;
  accessed_at: number;
  deleted_at: number | null;
}

/**
 * Goal Repository - Manages session goals for drift prevention
 */
export class GoalRepository {
  constructor(private db: DatabaseConnection) {}

  /**
   * Create a new goal
   */
  createGoal(projectId: string, input: GoalCreateInput): GoalState {
    const now = Math.floor(Date.now() / 1000);
    const id = randomUUID();

    this.db.instance
      .prepare(
        `INSERT INTO memories (
          id, content, type, confidence, project_id, content_hash,
          created_at, accessed_at, access_count,
          goal_status, goal_priority, parent_goal_id
        ) VALUES (?, ?, ?, 1.0, ?, ?, ?, ?, 0, 'active', ?, ?)`
      )
      .run(
        id,
        input.content,
        MemoryType.GOAL,
        projectId,
        this.hashContent(input.content),
        now,
        now,
        input.priority ?? 3,
        input.parentGoalId ?? null
      );

    const result: GoalState = {
      id,
      content: input.content,
      priority: input.priority ?? 3,
      status: 'active' as GoalStatus,
      progressNotes: [],
      createdAt: new Date(now * 1000),
    };
    if (input.parentGoalId) result.parentGoalId = input.parentGoalId;
    return result;
  }

  /**
   * Get all active goals for a project, sorted by priority
   */
  getActiveGoals(projectId: string): GoalState[] {
    const rows = this.db.instance
      .prepare(
        `SELECT * FROM memories
         WHERE project_id = ?
           AND type = 'goal'
           AND goal_status = 'active'
           AND deleted_at IS NULL
         ORDER BY goal_priority ASC, created_at DESC`
      )
      .all(projectId) as GoalMemoryRow[];

    return rows.map((row) => this.rowToGoal(row));
  }

  /**
   * Get all goals for a project (including completed/abandoned)
   */
  getAllGoals(projectId: string): GoalState[] {
    const rows = this.db.instance
      .prepare(
        `SELECT * FROM memories
         WHERE project_id = ?
           AND type = 'goal'
           AND deleted_at IS NULL
         ORDER BY goal_status = 'active' DESC, goal_priority ASC, created_at DESC`
      )
      .all(projectId) as GoalMemoryRow[];

    return rows.map((row) => this.rowToGoal(row));
  }

  /**
   * Get a specific goal by ID
   */
  getGoal(goalId: string, projectId: string): GoalState | null {
    const row = this.db.instance
      .prepare(
        `SELECT * FROM memories
         WHERE id = ?
           AND project_id = ?
           AND type = 'goal'`
      )
      .get(goalId, projectId) as GoalMemoryRow | undefined;

    return row ? this.rowToGoal(row) : null;
  }

  /**
   * Mark a goal as completed
   */
  completeGoal(goalId: string, projectId: string, note?: string): boolean {
    const now = Math.floor(Date.now() / 1000);

    const result = this.db.instance
      .prepare(
        `UPDATE memories
         SET goal_status = 'completed', accessed_at = ?
         WHERE id = ? AND project_id = ? AND type = 'goal' AND goal_status = 'active'`
      )
      .run(now, goalId, projectId);

    if (result.changes > 0 && note) {
      // Store completion note as a linked memory
      this.addProgressNote(goalId, projectId, `Completed: ${note}`);
    }

    return result.changes > 0;
  }

  /**
   * Mark a goal as abandoned
   */
  abandonGoal(goalId: string, projectId: string, reason?: string): boolean {
    const now = Math.floor(Date.now() / 1000);

    const result = this.db.instance
      .prepare(
        `UPDATE memories
         SET goal_status = 'abandoned', accessed_at = ?
         WHERE id = ? AND project_id = ? AND type = 'goal' AND goal_status = 'active'`
      )
      .run(now, goalId, projectId);

    if (result.changes > 0 && reason) {
      this.addProgressNote(goalId, projectId, `Abandoned: ${reason}`);
    }

    return result.changes > 0;
  }

  /**
   * Update goal priority
   */
  updatePriority(goalId: string, projectId: string, priority: number): boolean {
    const result = this.db.instance
      .prepare(
        `UPDATE memories
         SET goal_priority = ?
         WHERE id = ? AND project_id = ? AND type = 'goal'`
      )
      .run(Math.max(1, Math.min(5, priority)), goalId, projectId);

    return result.changes > 0;
  }

  /**
   * Add a progress note to a goal
   */
  addProgressNote(goalId: string, projectId: string, note: string): void {
    const now = Math.floor(Date.now() / 1000);
    const noteId = randomUUID();

    // Store note as a fact memory linked to the goal
    this.db.instance
      .prepare(
        `INSERT INTO memories (
          id, content, type, confidence, project_id, content_hash,
          created_at, accessed_at, access_count, parent_goal_id
        ) VALUES (?, ?, 'fact', 1.0, ?, ?, ?, ?, 0, ?)`
      )
      .run(
        noteId,
        note,
        projectId,
        this.hashContent(note),
        now,
        now,
        goalId
      );
  }

  /**
   * Get progress notes for a goal
   */
  getProgressNotes(goalId: string, projectId: string): string[] {
    const rows = this.db.instance
      .prepare(
        `SELECT content FROM memories
         WHERE parent_goal_id = ?
           AND project_id = ?
           AND deleted_at IS NULL
         ORDER BY created_at ASC`
      )
      .all(goalId, projectId) as Array<{ content: string }>;

    return rows.map((r) => r.content);
  }

  /**
   * Count active goals
   */
  countActiveGoals(projectId: string): number {
    const result = this.db.instance
      .prepare(
        `SELECT COUNT(*) as count FROM memories
         WHERE project_id = ?
           AND type = 'goal'
           AND goal_status = 'active'
           AND deleted_at IS NULL`
      )
      .get(projectId) as { count: number };

    return result.count;
  }

  /**
   * Get child goals for a parent goal
   */
  getChildGoals(parentGoalId: string, projectId: string): GoalState[] {
    const rows = this.db.instance
      .prepare(
        `SELECT * FROM memories
         WHERE parent_goal_id = ?
           AND project_id = ?
           AND type = 'goal'
           AND deleted_at IS NULL
         ORDER BY goal_priority ASC`
      )
      .all(parentGoalId, projectId) as GoalMemoryRow[];

    return rows.map((row) => this.rowToGoal(row));
  }

  /**
   * Hash content for deduplication
   */
  private hashContent(content: string): string {
    const { createHash } = require('crypto');
    return createHash('sha256').update(content).digest('hex');
  }

  /**
   * Convert database row to GoalState
   */
  private rowToGoal(row: GoalMemoryRow): GoalState {
    const progressNotes = this.getProgressNotes(row.id, row.project_id);

    const result: GoalState = {
      id: row.id,
      content: row.content,
      priority: row.goal_priority,
      status: row.goal_status as GoalStatus,
      progressNotes,
      createdAt: new Date(row.created_at * 1000),
    };
    if (row.parent_goal_id) result.parentGoalId = row.parent_goal_id;
    return result;
  }
}


export { GoalRepository as default };
