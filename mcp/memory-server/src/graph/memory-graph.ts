import type { DatabaseConnection } from '../storage/database.js';
import type { MemoryLink } from '../types.js';
import { MemoryLinkRepository } from '../storage/links.js';

/**
 * Graph statistics for memory links
 */
export interface MemoryGraphStats {
  totalMemories: number;
  totalLinks: number;
  linkedMemories: number;
  orphanMemories: number;
  linkDensity: number;
  averageLinksPerMemory: number;
  linksByType: Record<string, number>;
  contradictionCount: number;
  mostConnected: Array<{
    id: string;
    content: string;
    linkCount: number;
  }>;
}

/**
 * A contradiction pair
 */
export interface ContradictionPair {
  linkId: string;
  source: { id: string; content: string; type: string };
  target: { id: string; content: string; type: string };
  createdAt: Date;
}

/**
 * A chain of memories
 */
export interface MemoryChain {
  startId: string;
  nodes: Array<{
    id: string;
    content: string;
    type: string;
    linkType: string;
    createdAt: Date;
  }>;
  length: number;
}

/**
 * A cluster of related memories
 */
export interface MemoryCluster {
  centerId: string;
  centerContent: string;
  members: Array<{
    id: string;
    content: string;
    distance: number;
    linkType: string;
  }>;
  size: number;
}

interface MemoryRow {
  id: string;
  content: string;
  type: string;
  confidence: number;
  created_at: number;
  project_id: string;
}

/**
 * MemoryGraphService - Graph queries on memory links
 */
export class MemoryGraphService {
  private linkRepo: MemoryLinkRepository;

  constructor(private db: DatabaseConnection) {
    this.linkRepo = new MemoryLinkRepository(db);
  }

  /**
   * Get graph statistics
   */
  getStats(projectId: string): MemoryGraphStats {
    const memCount = this.db.instance
      .prepare(
        `SELECT COUNT(*) as c FROM memories
         WHERE project_id = ? AND deleted_at IS NULL AND superseded_by IS NULL`
      )
      .get(projectId) as { c: number };

    const linkCount = this.db.instance
      .prepare(
        `SELECT COUNT(*) as c FROM memory_links ml
         JOIN memories m ON ml.source_id = m.id
         WHERE m.project_id = ?`
      )
      .get(projectId) as { c: number };

    const linkedCount = this.db.instance
      .prepare(
        `SELECT COUNT(DISTINCT m.id) as c FROM memories m
         JOIN memory_links ml ON ml.source_id = m.id OR ml.target_id = m.id
         WHERE m.project_id = ? AND m.deleted_at IS NULL`
      )
      .get(projectId) as { c: number };

    const linksByTypeRows = this.db.instance
      .prepare(
        `SELECT ml.link_type, COUNT(*) as c FROM memory_links ml
         JOIN memories m ON ml.source_id = m.id
         WHERE m.project_id = ?
         GROUP BY ml.link_type`
      )
      .all(projectId) as Array<{ link_type: string; c: number }>;

    const linksByType: Record<string, number> = {};
    for (const row of linksByTypeRows) {
      linksByType[row.link_type] = row.c;
    }

    const mostConnectedRows = this.db.instance
      .prepare(
        `SELECT m.id, m.content, COUNT(ml.id) as lc
         FROM memories m
         LEFT JOIN memory_links ml ON ml.source_id = m.id OR ml.target_id = m.id
         WHERE m.project_id = ? AND m.deleted_at IS NULL AND m.superseded_by IS NULL
         GROUP BY m.id
         HAVING lc > 0
         ORDER BY lc DESC
         LIMIT 5`
      )
      .all(projectId) as Array<{ id: string; content: string; lc: number }>;

    const totalMemories = memCount.c;
    const totalLinks = linkCount.c;
    const linkedMemories = linkedCount.c;

    return {
      totalMemories,
      totalLinks,
      linkedMemories,
      orphanMemories: totalMemories - linkedMemories,
      linkDensity: totalMemories > 0 ? Math.round((linkedMemories / totalMemories) * 100) / 100 : 0,
      averageLinksPerMemory: totalMemories > 0 ? Math.round((totalLinks / totalMemories) * 100) / 100 : 0,
      linksByType,
      contradictionCount: linksByType['contradicts'] ?? 0,
      mostConnected: mostConnectedRows.map((r) => ({
        id: r.id,
        content: r.content.length > 80 ? r.content.substring(0, 80) + '...' : r.content,
        linkCount: r.lc,
      })),
    };
  }

  /**
   * Find all contradictions
   */
  findContradictions(projectId: string): ContradictionPair[] {
    const rows = this.db.instance
      .prepare(
        `SELECT
           ml.id as link_id, ml.created_at as link_created,
           ms.id as src_id, ms.content as src_content, ms.type as src_type,
           mt.id as tgt_id, mt.content as tgt_content, mt.type as tgt_type
         FROM memory_links ml
         JOIN memories ms ON ml.source_id = ms.id
         JOIN memories mt ON ml.target_id = mt.id
         WHERE ms.project_id = ?
           AND ml.link_type = 'contradicts'
           AND ms.deleted_at IS NULL
           AND mt.deleted_at IS NULL
         ORDER BY ml.created_at DESC`
      )
      .all(projectId) as Array<{
        link_id: string;
        link_created: number;
        src_id: string;
        src_content: string;
        src_type: string;
        tgt_id: string;
        tgt_content: string;
        tgt_type: string;
      }>;

    return rows.map((r) => ({
      linkId: r.link_id,
      source: { id: r.src_id, content: r.src_content, type: r.src_type },
      target: { id: r.tgt_id, content: r.tgt_content, type: r.tgt_type },
      createdAt: new Date(r.link_created * 1000),
    }));
  }

  /**
   * Find decision/derivation chain starting from a memory
   */
  findChain(
    startId: string,
    projectId: string,
    options: {
      linkTypes?: string[];
      maxLength?: number;
      direction?: 'forward' | 'backward' | 'both';
    } = {}
  ): MemoryChain {
    const linkTypes = options.linkTypes ?? ['extends', 'derived_from', 'supports'];
    const maxLength = options.maxLength ?? 10;
    const direction = options.direction ?? 'both';

    const startRow = this.db.instance
      .prepare('SELECT * FROM memories WHERE id = ? AND project_id = ?')
      .get(startId, projectId) as MemoryRow | undefined;

    if (!startRow) {
      return { startId, nodes: [], length: 0 };
    }

    const nodes: MemoryChain['nodes'] = [{
      id: startRow.id,
      content: startRow.content,
      type: startRow.type,
      linkType: 'start',
      createdAt: new Date(startRow.created_at * 1000),
    }];

    const visited = new Set<string>([startId]);
    const queue: Array<{ id: string; depth: number }> = [{ id: startId, depth: 0 }];

    while (queue.length > 0 && nodes.length < maxLength) {
      const current = queue.shift()!;
      if (current.depth >= maxLength - 1) continue;

      const placeholders = linkTypes.map(() => '?').join(',');
      let sql: string;
      let params: unknown[];

      if (direction === 'forward') {
        sql = `
          SELECT ml.link_type, ml.target_id as conn_id, m.content, m.type, m.created_at
          FROM memory_links ml
          JOIN memories m ON ml.target_id = m.id
          WHERE ml.source_id = ? AND m.project_id = ? AND m.deleted_at IS NULL
            AND ml.link_type IN (${placeholders})
        `;
        params = [current.id, projectId, ...linkTypes];
      } else if (direction === 'backward') {
        sql = `
          SELECT ml.link_type, ml.source_id as conn_id, m.content, m.type, m.created_at
          FROM memory_links ml
          JOIN memories m ON ml.source_id = m.id
          WHERE ml.target_id = ? AND m.project_id = ? AND m.deleted_at IS NULL
            AND ml.link_type IN (${placeholders})
        `;
        params = [current.id, projectId, ...linkTypes];
      } else {
        sql = `
          SELECT ml.link_type,
                 CASE WHEN ml.source_id = ? THEN ml.target_id ELSE ml.source_id END as conn_id,
                 m.content, m.type, m.created_at
          FROM memory_links ml
          JOIN memories m ON m.id = CASE WHEN ml.source_id = ? THEN ml.target_id ELSE ml.source_id END
          WHERE (ml.source_id = ? OR ml.target_id = ?)
            AND m.project_id = ? AND m.deleted_at IS NULL
            AND ml.link_type IN (${placeholders})
        `;
        params = [current.id, current.id, current.id, current.id, projectId, ...linkTypes];
      }

      const rows = this.db.instance.prepare(sql).all(...params) as Array<{
        conn_id: string;
        link_type: string;
        content: string;
        type: string;
        created_at: number;
      }>;

      for (const row of rows) {
        if (visited.has(row.conn_id)) continue;
        visited.add(row.conn_id);

        nodes.push({
          id: row.conn_id,
          content: row.content,
          type: row.type,
          linkType: row.link_type,
          createdAt: new Date(row.created_at * 1000),
        });

        queue.push({ id: row.conn_id, depth: current.depth + 1 });
      }
    }

    nodes.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());

    return { startId, nodes, length: nodes.length };
  }

  /**
   * Find cluster around a memory
   */
  findCluster(
    centerId: string,
    projectId: string,
    options: { maxSize?: number; maxDepth?: number } = {}
  ): MemoryCluster {
    const maxSize = options.maxSize ?? 15;
    const maxDepth = options.maxDepth ?? 2;

    const centerRow = this.db.instance
      .prepare('SELECT * FROM memories WHERE id = ? AND project_id = ?')
      .get(centerId, projectId) as MemoryRow | undefined;

    if (!centerRow) {
      return { centerId, centerContent: '', members: [], size: 0 };
    }

    const linkedIds = this.linkRepo.findLinkedMemoryIds(centerId, maxDepth);
    const members: MemoryCluster['members'] = [];

    for (const { memoryId, distance } of linkedIds.slice(0, maxSize)) {
      const row = this.db.instance
        .prepare('SELECT * FROM memories WHERE id = ? AND project_id = ? AND deleted_at IS NULL')
        .get(memoryId, projectId) as MemoryRow | undefined;

      if (!row) continue;

      const link = this.db.instance
        .prepare(
          `SELECT link_type FROM memory_links
           WHERE (source_id = ? AND target_id = ?) OR (source_id = ? AND target_id = ?)
           LIMIT 1`
        )
        .get(centerId, memoryId, memoryId, centerId) as { link_type: string } | undefined;

      members.push({
        id: row.id,
        content: row.content.length > 80 ? row.content.substring(0, 80) + '...' : row.content,
        distance,
        linkType: link?.link_type ?? 'relates_to',
      });
    }

    return {
      centerId,
      centerContent: centerRow.content.length > 80 ? centerRow.content.substring(0, 80) + '...' : centerRow.content,
      members,
      size: members.length + 1,
    };
  }

  /**
   * Find orphan memories (no links)
   */
  findOrphans(projectId: string, limit: number = 15): Array<{
    id: string;
    content: string;
    type: string;
    createdAt: Date;
  }> {
    const rows = this.db.instance
      .prepare(
        `SELECT m.* FROM memories m
         WHERE m.project_id = ? AND m.deleted_at IS NULL AND m.superseded_by IS NULL
           AND NOT EXISTS (
             SELECT 1 FROM memory_links ml WHERE ml.source_id = m.id OR ml.target_id = m.id
           )
         ORDER BY m.created_at DESC
         LIMIT ?`
      )
      .all(projectId, limit) as MemoryRow[];

    return rows.map((r) => ({
      id: r.id,
      content: r.content.length > 80 ? r.content.substring(0, 80) + '...' : r.content,
      type: r.type,
      createdAt: new Date(r.created_at * 1000),
    }));
  }
}
