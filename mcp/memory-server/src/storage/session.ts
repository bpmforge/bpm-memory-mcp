import { randomUUID } from 'crypto';
import type { DatabaseConnection } from './database.js';
import type { Session, WorkingMemory, CoreMemory } from '../types.js';
import { CoreMemoryRepository } from './core_memory.js';

interface SessionRow {
  id: string;
  project_id: string;
  state: Buffer;
  summary: string | null;
  created_at: number;
  resumed_at: number | null;
}

interface SerializedState {
  workingMemory: WorkingMemory;
  coreMemorySnapshot: CoreMemory;
  conversationSummary: string;
}

/**
 * Session Repository - Manages session persistence and restoration
 */
export class SessionRepository {
  private coreMemory: CoreMemoryRepository;

  constructor(private db: DatabaseConnection) {
    this.coreMemory = new CoreMemoryRepository(db);
  }

  /**
   * Save current session state
   */
  saveSession(
    projectId: string,
    workingMemory: WorkingMemory,
    summary: string
  ): string {
    const now = Math.floor(Date.now() / 1000);
    const id = randomUUID();

    // Get current core memory snapshot
    const coreMemorySnapshot = this.coreMemory.getCoreMemory(projectId);

    // Serialize state
    const state: SerializedState = {
      workingMemory,
      coreMemorySnapshot,
      conversationSummary: summary,
    };

    const stateBuffer = Buffer.from(JSON.stringify(state), 'utf-8');

    this.db.instance
      .prepare(
        `INSERT INTO sessions (id, project_id, state, summary, created_at)
         VALUES (?, ?, ?, ?, ?)`
      )
      .run(id, projectId, stateBuffer, summary, now);

    return id;
  }

  /**
   * Get the most recent session for a project
   */
  getLatestSession(projectId: string): Session | null {
    const row = this.db.instance
      .prepare(
        `SELECT * FROM sessions
         WHERE project_id = ?
         ORDER BY created_at DESC
         LIMIT 1`
      )
      .get(projectId) as SessionRow | undefined;

    return row ? this.rowToSession(row) : null;
  }

  /**
   * Get a specific session by ID
   */
  getSession(sessionId: string, projectId: string): Session | null {
    const row = this.db.instance
      .prepare('SELECT * FROM sessions WHERE id = ? AND project_id = ?')
      .get(sessionId, projectId) as SessionRow | undefined;

    return row ? this.rowToSession(row) : null;
  }

  /**
   * List recent sessions for a project
   */
  listSessions(
    projectId: string,
    options: { limit?: number } = {}
  ): Array<{
    id: string;
    summary: string | null;
    createdAt: Date;
    resumedAt: Date | null;
  }> {
    const limit = options.limit ?? 10;

    const rows = this.db.instance
      .prepare(
        `SELECT id, summary, created_at, resumed_at
         FROM sessions
         WHERE project_id = ?
         ORDER BY created_at DESC
         LIMIT ?`
      )
      .all(projectId, limit) as Array<{
      id: string;
      summary: string | null;
      created_at: number;
      resumed_at: number | null;
    }>;

    return rows.map((row) => ({
      id: row.id,
      summary: row.summary,
      createdAt: new Date(row.created_at * 1000),
      resumedAt: row.resumed_at ? new Date(row.resumed_at * 1000) : null,
    }));
  }

  /**
   * Mark a session as resumed
   */
  markResumed(sessionId: string): void {
    const now = Math.floor(Date.now() / 1000);

    this.db.instance
      .prepare('UPDATE sessions SET resumed_at = ? WHERE id = ?')
      .run(now, sessionId);
  }

  /**
   * Delete old sessions (keep only recent N)
   */
  pruneOldSessions(projectId: string, keepCount: number = 10): number {
    // Get IDs of sessions to keep
    const keepIds = this.db.instance
      .prepare(
        `SELECT id FROM sessions
         WHERE project_id = ?
         ORDER BY created_at DESC
         LIMIT ?`
      )
      .all(projectId, keepCount) as Array<{ id: string }>;

    if (keepIds.length === 0) return 0;

    const keepSet = new Set(keepIds.map((r) => r.id));

    // Delete sessions not in the keep set
    const allIds = this.db.instance
      .prepare('SELECT id FROM sessions WHERE project_id = ?')
      .all(projectId) as Array<{ id: string }>;

    let deleted = 0;
    for (const { id } of allIds) {
      if (!keepSet.has(id)) {
        this.db.instance.prepare('DELETE FROM sessions WHERE id = ?').run(id);
        deleted++;
      }
    }

    return deleted;
  }

  /**
   * Create default working memory
   */
  createDefaultWorkingMemory(): WorkingMemory {
    return {
      currentTask: null,
      recentToolCalls: [],
      scratchpad: '',
    };
  }

  /**
   * Convert database row to Session object
   */
  private rowToSession(row: SessionRow): Session {
    const state = JSON.parse(row.state.toString('utf-8')) as SerializedState;

    return {
      id: row.id,
      projectId: row.project_id,
      workingMemory: state.workingMemory,
      coreMemorySnapshot: state.coreMemorySnapshot,
      conversationSummary: state.conversationSummary,
      createdAt: new Date(row.created_at * 1000),
      resumedAt: row.resumed_at ? new Date(row.resumed_at * 1000) : null,
    };
  }
}
