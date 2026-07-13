import type { DatabaseConnection } from '../storage/database.js';
import type { MemoryLink, MemoryVisibility, Volatility } from '../types.js';
import { MemoryLinkRepository } from '../storage/links.js';
import { buildVisibilityClause, canReadMemory, type ReaderContext } from '../fleet/visibility.js';
import { volatilityMultiplier } from '../search/volatility-staleness.js';

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
 * One node in a graph_expand chain (T11.5). depth 0 = an RRF seed;
 * depth 1-2 = reached by hopping a typed link from a shallower node.
 */
export interface GraphExpandNode {
  id: string;
  content: string;
  type: string;
  linkType: string;
  depth: number;
  createdAt: Date;
}

/** Which side of a `contradicts` pair the graph_expand chain judges as current. */
export interface SupersessionVerdict {
  winnerId: string | null;
  reason: 'superseded_version' | 'fresher' | 'higher_confidence' | 'unresolved';
}

/** A `contradicts` edge touching the chain, with both sides + a verdict (T11.5). */
export interface ChainContradiction {
  linkId: string;
  a: { id: string; content: string; type: string };
  b: { id: string; content: string; type: string };
  verdict: SupersessionVerdict;
}

export interface GraphExpandResult {
  nodes: GraphExpandNode[];
  contradictions: ChainContradiction[];
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
   * graph_expand chain recall (T11.5). Starting from a set of RRF seed
   * memories (the caller's already-ranked top-K search hits), hops up to
   * `maxHops` (capped at 2) over typed "chain" links — default
   * derived_from/supports/extends, i.e. the link types that carry a
   * cause→fix→principle narrative, as opposed to relates_to (too weak to
   * chain) or contradicts (handled separately below). A single `visited`
   * set shared across every seed's BFS makes the traversal dedupe- and
   * cycle-safe: no node is fetched or expanded twice, regardless of how
   * many seeds reach it or whether the link graph loops back on itself.
   *
   * A hop is dropped, and not expanded through, when: the reader can't see
   * it (T11.4), it's quarantined (T11.3 — graph_expand must not become a
   * side-channel around quarantine's recall exclusion), or it's gone fully
   * stale (T11.2's volatility multiplier has decayed to its floor — today
   * only an unverified 'volatile' memory past its 30-day window).
   *
   * Nodes are returned in "ordered chain" order: shallowest (closest to a
   * seed) first, then by creation time — a stable, deterministic order that
   * reads as root-cause-first without requiring semantic link subtypes the
   * schema doesn't have.
   */
  expandChain(
    seedIds: string[],
    projectId: string,
    options: { linkTypes?: string[]; maxHops?: number } = {},
    reader: ReaderContext = {}
  ): GraphExpandResult {
    const linkTypes = options.linkTypes ?? ['derived_from', 'supports', 'extends'];
    const maxHops = Math.max(0, Math.min(options.maxHops ?? 2, 2));
    const now = new Date();

    const nodeMap = new Map<string, GraphExpandNode>();
    const visited = new Set<string>();
    const queue: Array<{ id: string; depth: number }> = [];

    for (const seedId of seedIds) {
      if (visited.has(seedId)) continue;
      visited.add(seedId);

      const row = this.db.instance
        .prepare(
          `SELECT * FROM memories
           WHERE id = ? AND project_id = ? AND deleted_at IS NULL AND quarantined_at IS NULL`
        )
        .get(seedId, projectId) as MemoryRow | undefined;

      if (!row || !canReadMemory(visibilityFieldsOf(row), reader)) continue;

      nodeMap.set(row.id, {
        id: row.id,
        content: row.content,
        type: row.type,
        linkType: 'seed',
        depth: 0,
        createdAt: new Date(row.created_at * 1000),
      });
      queue.push({ id: row.id, depth: 0 });
    }

    const placeholders = linkTypes.map(() => '?').join(',');
    const visCols = `m.visibility, m.writer_agent_id, m.writer_team_id, m.restricted_readers`;

    while (queue.length > 0) {
      const current = queue.shift()!;
      if (current.depth >= maxHops) continue;

      const rows = this.db.instance
        .prepare(
          `SELECT ml.link_type,
                  CASE WHEN ml.source_id = ? THEN ml.target_id ELSE ml.source_id END as conn_id,
                  m.content, m.type, m.created_at, m.volatility, m.verified_at, ${visCols}
           FROM memory_links ml
           JOIN memories m ON m.id = CASE WHEN ml.source_id = ? THEN ml.target_id ELSE ml.source_id END
           WHERE (ml.source_id = ? OR ml.target_id = ?)
             AND m.project_id = ? AND m.deleted_at IS NULL AND m.quarantined_at IS NULL
             AND ml.link_type IN (${placeholders})`
        )
        .all(current.id, current.id, current.id, current.id, projectId, ...linkTypes) as Array<{
        conn_id: string;
        link_type: string;
        content: string;
        type: string;
        created_at: number;
        volatility: string | null;
        verified_at: number | null;
        visibility: string | null;
        writer_agent_id: string | null;
        writer_team_id: string | null;
        restricted_readers: string | null;
      }>;

      for (const row of rows) {
        if (visited.has(row.conn_id)) continue;
        visited.add(row.conn_id);

        if (!canReadMemory(visibilityFieldsOf(row), reader)) continue;

        const stale =
          volatilityMultiplier(
            {
              volatility: (row.volatility as Volatility) ?? 'slow',
              verifiedAt: row.verified_at ? new Date(row.verified_at * 1000) : null,
              createdAt: new Date(row.created_at * 1000),
            },
            now
          ) <= 0;
        if (stale) continue;

        const depth = current.depth + 1;
        nodeMap.set(row.conn_id, {
          id: row.conn_id,
          content: row.content,
          type: row.type,
          linkType: row.link_type,
          depth,
          createdAt: new Date(row.created_at * 1000),
        });
        queue.push({ id: row.conn_id, depth });
      }
    }

    const nodes = [...nodeMap.values()].sort(
      (a, b) => a.depth - b.depth || a.createdAt.getTime() - b.createdAt.getTime()
    );

    return {
      nodes,
      contradictions: this.findChainContradictions([...nodeMap.keys()], projectId, reader, now),
    };
  }

  /**
   * `contradicts` edges touching any node reached by expandChain, both
   * sides + a supersession verdict (T11.5). Mirrors findContradictions'
   * both-sides-readable rule (T11.4) so a contradiction never leaks a side
   * the reader can't otherwise see.
   */
  private findChainContradictions(
    nodeIds: string[],
    projectId: string,
    reader: ReaderContext,
    now: Date
  ): ChainContradiction[] {
    if (nodeIds.length === 0) return [];

    const placeholders = nodeIds.map(() => '?').join(',');
    const rows = this.db.instance
      .prepare(
        `SELECT
           ml.id as link_id,
           ms.id as a_id, ms.content as a_content, ms.type as a_type, ms.confidence as a_confidence,
           ms.volatility as a_volatility, ms.verified_at as a_verified_at, ms.created_at as a_created_at,
           ms.superseded_by as a_superseded_by,
           ms.visibility as a_visibility, ms.writer_agent_id as a_writer_agent_id,
           ms.writer_team_id as a_writer_team_id, ms.restricted_readers as a_restricted_readers,
           mt.id as b_id, mt.content as b_content, mt.type as b_type, mt.confidence as b_confidence,
           mt.volatility as b_volatility, mt.verified_at as b_verified_at, mt.created_at as b_created_at,
           mt.superseded_by as b_superseded_by,
           mt.visibility as b_visibility, mt.writer_agent_id as b_writer_agent_id,
           mt.writer_team_id as b_writer_team_id, mt.restricted_readers as b_restricted_readers
         FROM memory_links ml
         JOIN memories ms ON ml.source_id = ms.id
         JOIN memories mt ON ml.target_id = mt.id
         WHERE ml.link_type = 'contradicts'
           AND ms.project_id = ? AND ms.deleted_at IS NULL AND ms.quarantined_at IS NULL
           AND mt.deleted_at IS NULL AND mt.quarantined_at IS NULL
           AND (ml.source_id IN (${placeholders}) OR ml.target_id IN (${placeholders}))`
      )
      .all(projectId, ...nodeIds, ...nodeIds) as Array<{
      link_id: string;
      a_id: string;
      a_content: string;
      a_type: string;
      a_confidence: number;
      a_volatility: string | null;
      a_verified_at: number | null;
      a_created_at: number;
      a_superseded_by: string | null;
      a_visibility: string | null;
      a_writer_agent_id: string | null;
      a_writer_team_id: string | null;
      a_restricted_readers: string | null;
      b_id: string;
      b_content: string;
      b_type: string;
      b_confidence: number;
      b_volatility: string | null;
      b_verified_at: number | null;
      b_created_at: number;
      b_superseded_by: string | null;
      b_visibility: string | null;
      b_writer_agent_id: string | null;
      b_writer_team_id: string | null;
      b_restricted_readers: string | null;
    }>;

    const out: ChainContradiction[] = [];
    for (const r of rows) {
      const aVis = visibilityFieldsOf({
        visibility: r.a_visibility,
        writer_agent_id: r.a_writer_agent_id,
        writer_team_id: r.a_writer_team_id,
        restricted_readers: r.a_restricted_readers,
      });
      const bVis = visibilityFieldsOf({
        visibility: r.b_visibility,
        writer_agent_id: r.b_writer_agent_id,
        writer_team_id: r.b_writer_team_id,
        restricted_readers: r.b_restricted_readers,
      });
      if (!canReadMemory(aVis, reader) || !canReadMemory(bVis, reader)) continue;

      const verdict = this.resolveSupersession(
        {
          id: r.a_id,
          confidence: r.a_confidence,
          supersededBy: r.a_superseded_by,
          volatility: (r.a_volatility as Volatility) ?? 'slow',
          verifiedAt: r.a_verified_at ? new Date(r.a_verified_at * 1000) : null,
          createdAt: new Date(r.a_created_at * 1000),
        },
        {
          id: r.b_id,
          confidence: r.b_confidence,
          supersededBy: r.b_superseded_by,
          volatility: (r.b_volatility as Volatility) ?? 'slow',
          verifiedAt: r.b_verified_at ? new Date(r.b_verified_at * 1000) : null,
          createdAt: new Date(r.b_created_at * 1000),
        },
        now
      );

      out.push({
        linkId: r.link_id,
        a: { id: r.a_id, content: r.a_content, type: r.a_type },
        b: { id: r.b_id, content: r.b_content, type: r.b_type },
        verdict,
      });
    }

    return out;
  }

  /**
   * Which side of a contradiction is current. An explicit version-supersede
   * pointer (memory versioning's supersededBy, distinct from the
   * `contradicts` link itself) is definitive when present; otherwise the
   * less-stale side wins (T11.2 volatility scoring), then higher
   * confidence; ties are reported 'unresolved' rather than guessed.
   */
  private resolveSupersession(
    a: {
      id: string;
      confidence: number;
      supersededBy: string | null;
      volatility: Volatility;
      verifiedAt: Date | null;
      createdAt: Date;
    },
    b: {
      id: string;
      confidence: number;
      supersededBy: string | null;
      volatility: Volatility;
      verifiedAt: Date | null;
      createdAt: Date;
    },
    now: Date
  ): SupersessionVerdict {
    if (a.supersededBy === b.id) return { winnerId: b.id, reason: 'superseded_version' };
    if (b.supersededBy === a.id) return { winnerId: a.id, reason: 'superseded_version' };

    const aFreshness = volatilityMultiplier(a, now);
    const bFreshness = volatilityMultiplier(b, now);
    if (aFreshness !== bFreshness) {
      return { winnerId: aFreshness > bFreshness ? a.id : b.id, reason: 'fresher' };
    }

    if (a.confidence !== b.confidence) {
      return { winnerId: a.confidence > b.confidence ? a.id : b.id, reason: 'higher_confidence' };
    }

    return { winnerId: null, reason: 'unresolved' };
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
