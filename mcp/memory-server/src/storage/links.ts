import { randomUUID } from 'crypto';
import type { DatabaseConnection } from './database.js';
import type { MemoryLink, MemoryLinkCreateInput, MemoryLinkType, Memory } from '../types.js';

/**
 * Database row type for memory_links table
 */
interface MemoryLinkRow {
  id: string;
  source_id: string;
  target_id: string;
  link_type: string;
  strength: number;
  bidirectional: number;
  created_at: number;
  created_by: string;
}

/**
 * Memory Link Repository - CRUD operations for Zettelkasten-style memory links
 */
export class MemoryLinkRepository {
  constructor(private db: DatabaseConnection) {}

  /**
   * Create a new link between two memories
   */
  createLink(input: MemoryLinkCreateInput): MemoryLink {
    const now = Math.floor(Date.now() / 1000);
    const id = randomUUID();

    this.db.instance
      .prepare(
        `INSERT INTO memory_links (
          id, source_id, target_id, link_type, strength, bidirectional, created_at, created_by
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        id,
        input.sourceId,
        input.targetId,
        input.linkType,
        input.strength ?? 1.0,
        input.bidirectional ? 1 : 0,
        now,
        input.createdBy ?? 'claude'
      );

    return {
      id,
      sourceId: input.sourceId,
      targetId: input.targetId,
      linkType: input.linkType,
      strength: input.strength ?? 1.0,
      bidirectional: input.bidirectional ?? false,
      createdAt: new Date(now * 1000),
      createdBy: input.createdBy ?? 'claude',
    };
  }

  /**
   * Find all links for a given memory (both as source and target)
   */
  findLinks(memoryId: string): MemoryLink[] {
    const rows = this.db.instance
      .prepare(
        `SELECT * FROM memory_links
         WHERE source_id = ? OR target_id = ?
         ORDER BY created_at DESC`
      )
      .all(memoryId, memoryId) as MemoryLinkRow[];

    return rows.map((row) => this.rowToLink(row));
  }

  /**
   * Find links where memory is the source
   */
  findOutgoingLinks(memoryId: string): MemoryLink[] {
    const rows = this.db.instance
      .prepare(
        `SELECT * FROM memory_links
         WHERE source_id = ?
         ORDER BY strength DESC, created_at DESC`
      )
      .all(memoryId) as MemoryLinkRow[];

    return rows.map((row) => this.rowToLink(row));
  }

  /**
   * Find links where memory is the target
   */
  findIncomingLinks(memoryId: string): MemoryLink[] {
    const rows = this.db.instance
      .prepare(
        `SELECT * FROM memory_links
         WHERE target_id = ?
         ORDER BY strength DESC, created_at DESC`
      )
      .all(memoryId) as MemoryLinkRow[];

    return rows.map((row) => this.rowToLink(row));
  }

  /**
   * Find linked memory IDs with traversal up to specified depth
   * Returns memory IDs connected to the seed memory, with their link distance
   */
  findLinkedMemoryIds(
    seedId: string,
    depth: number = 2
  ): Array<{ memoryId: string; distance: number; linkStrength: number }> {
    const visited = new Map<string, { distance: number; linkStrength: number }>();
    const queue: Array<{ id: string; distance: number; strength: number }> = [
      { id: seedId, distance: 0, strength: 1.0 },
    ];

    while (queue.length > 0) {
      const current = queue.shift()!;

      if (visited.has(current.id)) {
        continue;
      }

      visited.set(current.id, {
        distance: current.distance,
        linkStrength: current.strength,
      });

      // Stop traversing if we've reached max depth
      if (current.distance >= depth) {
        continue;
      }

      // Get all connected memories
      const links = this.findLinks(current.id);
      for (const link of links) {
        const connectedId = link.sourceId === current.id ? link.targetId : link.sourceId;

        // For non-bidirectional links, only follow in the correct direction
        if (!link.bidirectional && link.targetId === current.id && link.sourceId !== seedId) {
          continue;
        }

        if (!visited.has(connectedId)) {
          queue.push({
            id: connectedId,
            distance: current.distance + 1,
            strength: current.strength * link.strength,
          });
        }
      }
    }

    // Remove the seed itself and return results
    visited.delete(seedId);

    return Array.from(visited.entries())
      .map(([memoryId, { distance, linkStrength }]) => ({
        memoryId,
        distance,
        linkStrength,
      }))
      .sort((a, b) => {
        // Sort by distance first, then by link strength
        if (a.distance !== b.distance) {
          return a.distance - b.distance;
        }
        return b.linkStrength - a.linkStrength;
      });
  }

  /**
   * Delete a link by ID
   */
  deleteLink(linkId: string): boolean {
    const result = this.db.instance
      .prepare('DELETE FROM memory_links WHERE id = ?')
      .run(linkId);

    return result.changes > 0;
  }

  /**
   * Delete all links for a memory (when memory is deleted)
   */
  deleteLinksForMemory(memoryId: string): number {
    const result = this.db.instance
      .prepare('DELETE FROM memory_links WHERE source_id = ? OR target_id = ?')
      .run(memoryId, memoryId);

    return result.changes;
  }

  /**
   * Find all contradiction links in a project
   * Returns links of type 'contradicts' for potential review
   */
  findContradictions(projectId: string): MemoryLink[] {
    const rows = this.db.instance
      .prepare(
        `SELECT ml.* FROM memory_links ml
         JOIN memories m ON ml.source_id = m.id
         WHERE m.project_id = ?
           AND ml.link_type = 'contradicts'
         ORDER BY ml.created_at DESC`
      )
      .all(projectId) as MemoryLinkRow[];

    return rows.map((row) => this.rowToLink(row));
  }

  /**
   * Find link between two specific memories
   */
  findLinkBetween(sourceId: string, targetId: string): MemoryLink | null {
    const row = this.db.instance
      .prepare(
        `SELECT * FROM memory_links
         WHERE (source_id = ? AND target_id = ?)
            OR (source_id = ? AND target_id = ? AND bidirectional = 1)
         LIMIT 1`
      )
      .get(sourceId, targetId, targetId, sourceId) as MemoryLinkRow | undefined;

    return row ? this.rowToLink(row) : null;
  }

  /**
   * Update link strength
   */
  updateLinkStrength(linkId: string, strength: number): boolean {
    const result = this.db.instance
      .prepare('UPDATE memory_links SET strength = ? WHERE id = ?')
      .run(Math.max(0, Math.min(1, strength)), linkId);

    return result.changes > 0;
  }

  /**
   * Get link count for a memory (useful for link density scoring)
   */
  getLinkCount(memoryId: string): number {
    const result = this.db.instance
      .prepare(
        `SELECT COUNT(*) as count FROM memory_links
         WHERE source_id = ? OR target_id = ?`
      )
      .get(memoryId, memoryId) as { count: number };

    return result.count;
  }

  /**
   * Get incoming link count (for link density scoring)
   */
  getIncomingLinkCount(memoryId: string): number {
    const result = this.db.instance
      .prepare('SELECT COUNT(*) as count FROM memory_links WHERE target_id = ?')
      .get(memoryId) as { count: number };

    return result.count;
  }

  /**
   * Find memories with no links (orphans)
   */
  findOrphanMemories(projectId: string): string[] {
    const rows = this.db.instance
      .prepare(
        `SELECT m.id FROM memories m
         WHERE m.project_id = ?
           AND m.deleted_at IS NULL
           AND NOT EXISTS (
             SELECT 1 FROM memory_links ml
             WHERE ml.source_id = m.id OR ml.target_id = m.id
           )
         ORDER BY m.created_at DESC`
      )
      .all(projectId) as Array<{ id: string }>;

    return rows.map((r) => r.id);
  }

  /**
   * Convert database row to MemoryLink object
   */
  private rowToLink(row: MemoryLinkRow): MemoryLink {
    return {
      id: row.id,
      sourceId: row.source_id,
      targetId: row.target_id,
      linkType: row.link_type as MemoryLinkType,
      strength: row.strength,
      bidirectional: row.bidirectional === 1,
      createdAt: new Date(row.created_at * 1000),
      createdBy: row.created_by as 'user' | 'claude' | 'system',
    };
  }
}
