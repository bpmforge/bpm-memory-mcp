import type { DatabaseConnection } from '../storage/database.js';
import type { MemoryLink, MemoryVisibility } from '../types.js';
import { MemoryLinkRepository } from '../storage/links.js';
import { buildVisibilityClause, canReadMemory, type ReaderContext } from '../fleet/visibility.js';

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
  // V13 columns (fleet scopes — T11.4), present via SELECT * queries below
  visibility?: string | null;
  writer_agent_id?: string | null;
  writer_team_id?: string | null;
  restricted_readers?: string | null;
}

/** Narrows a fetched row to the fields canReadMemory needs. */
function visibilityFieldsOf(row: {
  visibility?: string | null;
  writer_agent_id?: string | null;
  writer_team_id?: string | null;
  restricted_readers?: string | null;
}) {
  return {
    visibility: (row.visibility ?? 'global') as MemoryVisibility,
    writerAgentId: row.writer_agent_id ?? null,
    writerTeamId: row.writer_team_id ?? null,
    restrictedReaders: row.restricted_readers
      ? (JSON.parse(row.restricted_readers) as string[])
      : null,
  };
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
   * Get graph statistics. Aggregate counts (totalMemories, linkDensity, etc.)
   * are not visibility-scoped — they reveal existence/shape only, not
   * content. mostConnected DOES expose content, so it's filtered per
   * canReadMemory (T11.4).
   */
  getStats(projectId: string, reader: ReaderContext = {}): MemoryGraphStats {
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
        `SELECT m.id, m.content, COUNT(ml.id) as lc,
                m.visibility, m.writer_agent_id, m.writer_team_id, m.restricted_readers
         FROM memories m
         LEFT JOIN memory_links ml ON ml.source_id = m.id OR ml.target_id = m.id
         WHERE m.project_id = ? AND m.deleted_at IS NULL AND m.superseded_by IS NULL
         GROUP BY m.id
         HAVING lc > 0
         ORDER BY lc DESC
         LIMIT 5`
      )
      .all(projectId) as Array<{
      id: string;
      content: string;
      lc: number;
      visibility: string | null;
      writer_agent_id: string | null;
      writer_team_id: string | null;
      restricted_readers: string | null;
    }>;

    const totalMemories = memCount.c;
    const totalLinks = linkCount.c;
    const linkedMemories = linkedCount.c;

    return {
      totalMemories,
      totalLinks,
      linkedMemories,
      orphanMemories: totalMemories - linkedMemories,
      linkDensity: totalMemories > 0 ? Math.round((linkedMemories / totalMemories) * 100) / 100 : 0,
      averageLinksPerMemory:
        totalMemories > 0 ? Math.round((totalLinks / totalMemories) * 100) / 100 : 0,
      linksByType,
      contradictionCount: linksByType['contradicts'] ?? 0,
      mostConnected: mostConnectedRows
        .filter((r) => canReadMemory(visibilityFieldsOf(r), reader))
        .map((r) => ({
          id: r.id,
          content: r.content.length > 80 ? r.content.substring(0, 80) + '...' : r.content,
          linkCount: r.lc,
        })),
    };
  }

  /**
   * Find all contradictions. Both sides of a pair must be readable by the
   * given reader (T11.4) — a contradiction with one hidden side would leak
   * "content this reader can't see exists and conflicts with X".
   */
  findContradictions(projectId: string, reader: ReaderContext = {}): ContradictionPair[] {
    const rows = this.db.instance
      .prepare(
        `SELECT
           ml.id as link_id, ml.created_at as link_created,
           ms.id as src_id, ms.content as src_content, ms.type as src_type,
           ms.visibility as src_visibility, ms.writer_agent_id as src_writer_agent_id,
           ms.writer_team_id as src_writer_team_id, ms.restricted_readers as src_restricted_readers,
           mt.id as tgt_id, mt.content as tgt_content, mt.type as tgt_type,
           mt.visibility as tgt_visibility, mt.writer_agent_id as tgt_writer_agent_id,
           mt.writer_team_id as tgt_writer_team_id, mt.restricted_readers as tgt_restricted_readers
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
      src_visibility: string | null;
      src_writer_agent_id: string | null;
      src_writer_team_id: string | null;
      src_restricted_readers: string | null;
      tgt_id: string;
      tgt_content: string;
      tgt_type: string;
      tgt_visibility: string | null;
      tgt_writer_agent_id: string | null;
      tgt_writer_team_id: string | null;
      tgt_restricted_readers: string | null;
    }>;

    return rows
      .filter(
        (r) =>
          canReadMemory(
            visibilityFieldsOf({
              visibility: r.src_visibility,
              writer_agent_id: r.src_writer_agent_id,
              writer_team_id: r.src_writer_team_id,
              restricted_readers: r.src_restricted_readers,
            }),
            reader
          ) &&
          canReadMemory(
            visibilityFieldsOf({
              visibility: r.tgt_visibility,
              writer_agent_id: r.tgt_writer_agent_id,
              writer_team_id: r.tgt_writer_team_id,
              restricted_readers: r.tgt_restricted_readers,
            }),
            reader
          )
      )
      .map((r) => ({
        linkId: r.link_id,
        source: { id: r.src_id, content: r.src_content, type: r.src_type },
        target: { id: r.tgt_id, content: r.tgt_content, type: r.tgt_type },
        createdAt: new Date(r.link_created * 1000),
      }));
  }

  /**
   * Find decision/derivation chain starting from a memory. If the seed
   * itself isn't readable by `reader`, returns an empty chain (same shape
   * as "not found") rather than leaking its content (T11.4). Traversal
   * skips — and does not expand through — any hop the reader can't read.
   */
  findChain(
    startId: string,
    projectId: string,
    options: {
      linkTypes?: string[];
      maxLength?: number;
      direction?: 'forward' | 'backward' | 'both';
    } = {},
    reader: ReaderContext = {}
  ): MemoryChain {
    const linkTypes = options.linkTypes ?? ['extends', 'derived_from', 'supports'];
    const maxLength = options.maxLength ?? 10;
    const direction = options.direction ?? 'both';

    const startRow = this.db.instance
      .prepare('SELECT * FROM memories WHERE id = ? AND project_id = ?')
      .get(startId, projectId) as MemoryRow | undefined;

    if (!startRow || !canReadMemory(visibilityFieldsOf(startRow), reader)) {
      return { startId, nodes: [], length: 0 };
    }

    const nodes: MemoryChain['nodes'] = [
      {
        id: startRow.id,
        content: startRow.content,
        type: startRow.type,
        linkType: 'start',
        createdAt: new Date(startRow.created_at * 1000),
      },
    ];

    const visited = new Set<string>([startId]);
    const queue: Array<{ id: string; depth: number }> = [{ id: startId, depth: 0 }];

    while (queue.length > 0 && nodes.length < maxLength) {
      const current = queue.shift()!;
      if (current.depth >= maxLength - 1) continue;

      const placeholders = linkTypes.map(() => '?').join(',');
      let sql: string;
      let params: unknown[];

      const visCols = `m.visibility, m.writer_agent_id, m.writer_team_id, m.restricted_readers`;

      if (direction === 'forward') {
        sql = `
          SELECT ml.link_type, ml.target_id as conn_id, m.content, m.type, m.created_at, ${visCols}
          FROM memory_links ml
          JOIN memories m ON ml.target_id = m.id
          WHERE ml.source_id = ? AND m.project_id = ? AND m.deleted_at IS NULL
            AND ml.link_type IN (${placeholders})
        `;
        params = [current.id, projectId, ...linkTypes];
      } else if (direction === 'backward') {
        sql = `
          SELECT ml.link_type, ml.source_id as conn_id, m.content, m.type, m.created_at, ${visCols}
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
                 m.content, m.type, m.created_at, ${visCols}
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
        visibility: string | null;
        writer_agent_id: string | null;
        writer_team_id: string | null;
        restricted_readers: string | null;
      }>;

      for (const row of rows) {
        if (visited.has(row.conn_id)) continue;
        visited.add(row.conn_id);
        if (!canReadMemory(visibilityFieldsOf(row), reader)) continue;

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
   * Find cluster around a memory. If the center itself isn't readable by
   * `reader`, returns an empty cluster (same shape as "not found") rather
   * than leaking centerContent (T11.4); unreadable members are dropped.
   */
  findCluster(
    centerId: string,
    projectId: string,
    options: { maxSize?: number; maxDepth?: number } = {},
    reader: ReaderContext = {}
  ): MemoryCluster {
    const maxSize = options.maxSize ?? 15;
    const maxDepth = options.maxDepth ?? 2;

    const centerRow = this.db.instance
      .prepare('SELECT * FROM memories WHERE id = ? AND project_id = ?')
      .get(centerId, projectId) as MemoryRow | undefined;

    if (!centerRow || !canReadMemory(visibilityFieldsOf(centerRow), reader)) {
      return { centerId, centerContent: '', members: [], size: 0 };
    }

    const linkedIds = this.linkRepo.findLinkedMemoryIds(centerId, maxDepth);
    const members: MemoryCluster['members'] = [];

    for (const { memoryId, distance } of linkedIds.slice(0, maxSize)) {
      const row = this.db.instance
        .prepare('SELECT * FROM memories WHERE id = ? AND project_id = ? AND deleted_at IS NULL')
        .get(memoryId, projectId) as MemoryRow | undefined;

      if (!row || !canReadMemory(visibilityFieldsOf(row), reader)) continue;

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
      centerContent:
        centerRow.content.length > 80
          ? centerRow.content.substring(0, 80) + '...'
          : centerRow.content,
      members,
      size: members.length + 1,
    };
  }

  /**
   * Find orphan memories (no links)
   */
  findOrphans(
    projectId: string,
    limit: number = 15,
    reader: ReaderContext = {}
  ): Array<{
    id: string;
    content: string;
    type: string;
    createdAt: Date;
  }> {
    const visibilityClause = buildVisibilityClause(reader, 'm');
    const rows = this.db.instance
      .prepare(
        `SELECT m.* FROM memories m
         WHERE m.project_id = ? AND m.deleted_at IS NULL AND m.superseded_by IS NULL
           AND NOT EXISTS (
             SELECT 1 FROM memory_links ml WHERE ml.source_id = m.id OR ml.target_id = m.id
           )
           AND ${visibilityClause.sql}
         ORDER BY m.created_at DESC
         LIMIT ?`
      )
      .all(projectId, ...visibilityClause.params, limit) as MemoryRow[];

    return rows.map((r) => ({
      id: r.id,
      content: r.content.length > 80 ? r.content.substring(0, 80) + '...' : r.content,
      type: r.type,
      createdAt: new Date(r.created_at * 1000),
    }));
  }
}
