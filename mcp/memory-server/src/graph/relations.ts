import { randomUUID } from 'crypto';
import type { DatabaseConnection } from '../storage/database.js';
import type { Relation, RelationType } from '../types.js';

interface RelationRow {
  id: string;
  source_id: string;
  target_id: string;
  type: string;
  properties: string | null;
  project_id: string;
  valid_from: number;
  valid_to: number | null;
  created_at: number;
}

export interface RelationCreateInput {
  sourceId: string;
  targetId: string;
  type: RelationType;
  properties?: Record<string, unknown>;
  projectId: string;
  validFrom?: Date;
}

/**
 * Relation Repository - Knowledge graph relationship management
 */
export class RelationRepository {
  constructor(private db: DatabaseConnection) {}

  /**
   * Create a new relation between entities
   */
  createRelation(input: RelationCreateInput): Relation {
    const now = Math.floor(Date.now() / 1000);
    const id = randomUUID();
    const validFrom = input.validFrom
      ? Math.floor(input.validFrom.getTime() / 1000)
      : now;

    this.db.instance
      .prepare(
        `INSERT INTO relations (id, source_id, target_id, type, properties, project_id, valid_from, valid_to, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?)`
      )
      .run(
        id,
        input.sourceId,
        input.targetId,
        input.type,
        input.properties ? JSON.stringify(input.properties) : null,
        input.projectId,
        validFrom,
        now
      );

    return {
      id,
      sourceId: input.sourceId,
      targetId: input.targetId,
      type: input.type,
      properties: input.properties ?? {},
      projectId: input.projectId,
      validFrom: new Date(validFrom * 1000),
      validTo: null,
    };
  }

  /**
   * Find relation by ID
   */
  findById(id: string, projectId: string): Relation | null {
    const row = this.db.instance
      .prepare('SELECT * FROM relations WHERE id = ? AND project_id = ?')
      .get(id, projectId) as RelationRow | undefined;

    return row ? this.rowToRelation(row) : null;
  }

  /**
   * Find relations from an entity (outgoing)
   */
  findFromEntity(
    entityId: string,
    projectId: string,
    options: { type?: RelationType; includeExpired?: boolean } = {}
  ): Relation[] {
    let sql = 'SELECT * FROM relations WHERE source_id = ? AND project_id = ?';
    const params: unknown[] = [entityId, projectId];

    if (!options.includeExpired) {
      sql += ' AND valid_to IS NULL';
    }

    if (options.type) {
      sql += ' AND type = ?';
      params.push(options.type);
    }

    sql += ' ORDER BY created_at DESC';

    const rows = this.db.instance.prepare(sql).all(...params) as RelationRow[];
    return rows.map((row) => this.rowToRelation(row));
  }

  /**
   * Find relations to an entity (incoming)
   */
  findToEntity(
    entityId: string,
    projectId: string,
    options: { type?: RelationType; includeExpired?: boolean } = {}
  ): Relation[] {
    let sql = 'SELECT * FROM relations WHERE target_id = ? AND project_id = ?';
    const params: unknown[] = [entityId, projectId];

    if (!options.includeExpired) {
      sql += ' AND valid_to IS NULL';
    }

    if (options.type) {
      sql += ' AND type = ?';
      params.push(options.type);
    }

    sql += ' ORDER BY created_at DESC';

    const rows = this.db.instance.prepare(sql).all(...params) as RelationRow[];
    return rows.map((row) => this.rowToRelation(row));
  }

  /**
   * Find all relations for an entity (bidirectional)
   */
  findRelations(
    entityId: string,
    projectId: string,
    direction: 'outgoing' | 'incoming' | 'both' = 'both'
  ): Relation[] {
    if (direction === 'outgoing') {
      return this.findFromEntity(entityId, projectId);
    }
    if (direction === 'incoming') {
      return this.findToEntity(entityId, projectId);
    }

    // Both directions
    const rows = this.db.instance
      .prepare(
        `SELECT * FROM relations
         WHERE (source_id = ? OR target_id = ?)
           AND project_id = ?
           AND valid_to IS NULL
         ORDER BY created_at DESC`
      )
      .all(entityId, entityId, projectId) as RelationRow[];

    return rows.map((row) => this.rowToRelation(row));
  }

  /**
   * Find specific relation between two entities
   */
  findBetween(
    sourceId: string,
    targetId: string,
    projectId: string,
    type?: RelationType
  ): Relation | null {
    let sql = `
      SELECT * FROM relations
      WHERE source_id = ?
        AND target_id = ?
        AND project_id = ?
        AND valid_to IS NULL
    `;
    const params: unknown[] = [sourceId, targetId, projectId];

    if (type) {
      sql += ' AND type = ?';
      params.push(type);
    }

    sql += ' LIMIT 1';

    const row = this.db.instance.prepare(sql).get(...params) as
      | RelationRow
      | undefined;
    return row ? this.rowToRelation(row) : null;
  }

  /**
   * Update relation properties
   */
  updateProperties(
    id: string,
    projectId: string,
    properties: Record<string, unknown>
  ): boolean {
    const result = this.db.instance
      .prepare(
        `UPDATE relations
         SET properties = ?
         WHERE id = ? AND project_id = ?`
      )
      .run(JSON.stringify(properties), id, projectId);

    return result.changes > 0;
  }

  /**
   * Mark relation as expired (bi-temporal end)
   */
  expireRelation(id: string, projectId: string, validTo?: Date): boolean {
    const expireTime = validTo
      ? Math.floor(validTo.getTime() / 1000)
      : Math.floor(Date.now() / 1000);

    const result = this.db.instance
      .prepare(
        `UPDATE relations
         SET valid_to = ?
         WHERE id = ? AND project_id = ? AND valid_to IS NULL`
      )
      .run(expireTime, id, projectId);

    return result.changes > 0;
  }

  /**
   * Get connected entity IDs up to a depth
   */
  getConnectedIds(
    entityId: string,
    projectId: string,
    depth: number = 2
  ): Set<string> {
    const visited = new Set<string>();
    const queue: Array<{ id: string; level: number }> = [
      { id: entityId, level: 0 },
    ];

    while (queue.length > 0) {
      const current = queue.shift()!;
      if (visited.has(current.id) || current.level > depth) {
        continue;
      }

      visited.add(current.id);

      if (current.level < depth) {
        const relations = this.findRelations(current.id, projectId);
        for (const rel of relations) {
          const nextId =
            rel.sourceId === current.id ? rel.targetId : rel.sourceId;
          if (!visited.has(nextId)) {
            queue.push({ id: nextId, level: current.level + 1 });
          }
        }
      }
    }

    return visited;
  }

  /**
   * Count relations by project
   */
  countByProject(projectId: string): Record<RelationType, number> {
    const rows = this.db.instance
      .prepare(
        `SELECT type, COUNT(*) as count
         FROM relations
         WHERE project_id = ? AND valid_to IS NULL
         GROUP BY type`
      )
      .all(projectId) as Array<{ type: string; count: number }>;

    const result: Record<string, number> = {
      implements: 0,
      depends_on: 0,
      satisfies: 0,
      calls: 0,
      contradicts: 0,
      supersedes: 0,
    };

    for (const row of rows) {
      result[row.type] = row.count;
    }

    return result as Record<RelationType, number>;
  }

  /**
   * Convert database row to Relation object
   */
  private rowToRelation(row: RelationRow): Relation {
    return {
      id: row.id,
      sourceId: row.source_id,
      targetId: row.target_id,
      type: row.type as RelationType,
      properties: row.properties ? JSON.parse(row.properties) : {},
      projectId: row.project_id,
      validFrom: new Date(row.valid_from * 1000),
      validTo: row.valid_to ? new Date(row.valid_to * 1000) : null,
    };
  }
}
