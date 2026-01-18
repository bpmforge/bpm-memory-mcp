import { randomUUID } from 'crypto';
import type { DatabaseConnection } from '../storage/database.js';
import type { Entity, EntityType } from '../types.js';

interface EntityRow {
  id: string;
  type: string;
  name: string;
  properties: string | null;
  project_id: string;
  valid_from: number;
  valid_to: number | null;
  created_at: number;
}

export interface EntityCreateInput {
  type: EntityType;
  name: string;
  properties?: Record<string, unknown>;
  projectId: string;
  validFrom?: Date;
}

/**
 * Entity Repository - Knowledge graph entity management
 */
export class EntityRepository {
  constructor(private db: DatabaseConnection) {}

  /**
   * Create a new entity
   */
  createEntity(input: EntityCreateInput): Entity {
    const now = Math.floor(Date.now() / 1000);
    const id = randomUUID();
    const validFrom = input.validFrom
      ? Math.floor(input.validFrom.getTime() / 1000)
      : now;

    this.db.instance
      .prepare(
        `INSERT INTO entities (id, type, name, properties, project_id, valid_from, valid_to, created_at)
         VALUES (?, ?, ?, ?, ?, ?, NULL, ?)`
      )
      .run(
        id,
        input.type,
        input.name,
        input.properties ? JSON.stringify(input.properties) : null,
        input.projectId,
        validFrom,
        now
      );

    return {
      id,
      type: input.type,
      name: input.name,
      properties: input.properties ?? {},
      projectId: input.projectId,
      validFrom: new Date(validFrom * 1000),
      validTo: null,
    };
  }

  /**
   * Find entity by ID
   */
  findById(id: string, projectId: string): Entity | null {
    const row = this.db.instance
      .prepare('SELECT * FROM entities WHERE id = ? AND project_id = ?')
      .get(id, projectId) as EntityRow | undefined;

    return row ? this.rowToEntity(row) : null;
  }

  /**
   * Find entity by name (case-insensitive)
   */
  findByName(name: string, projectId: string): Entity | null {
    const row = this.db.instance
      .prepare(
        `SELECT * FROM entities
         WHERE LOWER(name) = LOWER(?)
           AND project_id = ?
           AND valid_to IS NULL
         ORDER BY created_at DESC
         LIMIT 1`
      )
      .get(name, projectId) as EntityRow | undefined;

    return row ? this.rowToEntity(row) : null;
  }

  /**
   * Find entities by type
   */
  findByType(
    type: EntityType,
    projectId: string,
    options: { includeExpired?: boolean; limit?: number } = {}
  ): Entity[] {
    let sql = 'SELECT * FROM entities WHERE type = ? AND project_id = ?';
    const params: unknown[] = [type, projectId];

    if (!options.includeExpired) {
      sql += ' AND valid_to IS NULL';
    }

    sql += ' ORDER BY created_at DESC';

    if (options.limit) {
      sql += ' LIMIT ?';
      params.push(options.limit);
    }

    const rows = this.db.instance.prepare(sql).all(...params) as EntityRow[];
    return rows.map((row) => this.rowToEntity(row));
  }

  /**
   * Search entities by name pattern
   */
  searchByName(
    pattern: string,
    projectId: string,
    options: { type?: EntityType; limit?: number } = {}
  ): Entity[] {
    let sql = `
      SELECT * FROM entities
      WHERE project_id = ?
        AND valid_to IS NULL
        AND name LIKE ?
    `;
    const params: unknown[] = [projectId, `%${pattern}%`];

    if (options.type) {
      sql += ' AND type = ?';
      params.push(options.type);
    }

    sql += ' ORDER BY name ASC';

    if (options.limit) {
      sql += ' LIMIT ?';
      params.push(options.limit);
    }

    const rows = this.db.instance.prepare(sql).all(...params) as EntityRow[];
    return rows.map((row) => this.rowToEntity(row));
  }

  /**
   * Update entity properties
   */
  updateProperties(
    id: string,
    projectId: string,
    properties: Record<string, unknown>
  ): boolean {
    const result = this.db.instance
      .prepare(
        `UPDATE entities
         SET properties = ?
         WHERE id = ? AND project_id = ?`
      )
      .run(JSON.stringify(properties), id, projectId);

    return result.changes > 0;
  }

  /**
   * Mark entity as expired (bi-temporal end)
   */
  expireEntity(id: string, projectId: string, validTo?: Date): boolean {
    const expireTime = validTo
      ? Math.floor(validTo.getTime() / 1000)
      : Math.floor(Date.now() / 1000);

    const result = this.db.instance
      .prepare(
        `UPDATE entities
         SET valid_to = ?
         WHERE id = ? AND project_id = ? AND valid_to IS NULL`
      )
      .run(expireTime, id, projectId);

    return result.changes > 0;
  }

  /**
   * Get entity history (all versions including expired)
   */
  getHistory(name: string, projectId: string): Entity[] {
    const rows = this.db.instance
      .prepare(
        `SELECT * FROM entities
         WHERE LOWER(name) = LOWER(?)
           AND project_id = ?
         ORDER BY valid_from DESC`
      )
      .all(name, projectId) as EntityRow[];

    return rows.map((row) => this.rowToEntity(row));
  }

  /**
   * Count entities by project
   */
  countByProject(projectId: string): Record<EntityType, number> {
    const rows = this.db.instance
      .prepare(
        `SELECT type, COUNT(*) as count
         FROM entities
         WHERE project_id = ? AND valid_to IS NULL
         GROUP BY type`
      )
      .all(projectId) as Array<{ type: string; count: number }>;

    const result: Record<string, number> = {
      file: 0,
      function: 0,
      type: 0,
      decision: 0,
      error: 0,
    };

    for (const row of rows) {
      result[row.type] = row.count;
    }

    return result as Record<EntityType, number>;
  }

  /**
   * Convert database row to Entity object
   */
  private rowToEntity(row: EntityRow): Entity {
    return {
      id: row.id,
      type: row.type as EntityType,
      name: row.name,
      properties: row.properties ? JSON.parse(row.properties) : {},
      projectId: row.project_id,
      validFrom: new Date(row.valid_from * 1000),
      validTo: row.valid_to ? new Date(row.valid_to * 1000) : null,
    };
  }
}
