import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { randomUUID } from 'crypto';
import { MemoryGraphService } from '../../mcp/memory-server/src/graph/memory-graph.js';
import { MemoryLinkRepository } from '../../mcp/memory-server/src/storage/links.js';
import { MIGRATIONS, CURRENT_VERSION } from '../../mcp/memory-server/src/storage/schema.js';
import { MemoryLinkType } from '../../mcp/memory-server/src/types.js';
import type { DatabaseConnection } from '../../mcp/memory-server/src/storage/database.js';

// ============================================================================
// Test Setup
// ============================================================================

function createTestDb(): DatabaseConnection {
  const db = new Database(':memory:');

  for (const migration of MIGRATIONS) {
    if (migration.version <= CURRENT_VERSION) {
      const statements = migration.up.split(';').filter((s) => s.trim());
      for (const stmt of statements) {
        if (stmt.trim()) {
          try {
            db.exec(stmt);
          } catch (e) {
            // Ignore
          }
        }
      }
    }
  }

  db.exec(
    `INSERT OR REPLACE INTO schema_version (version, applied_at) VALUES (${CURRENT_VERSION}, ${Date.now()})`
  );

  return {
    instance: db,
    transaction: <T>(fn: () => T) => db.transaction(fn)(),
    close: () => db.close(),
  };
}

const PROJECT_ID = 'test-project';
const NOW_SECONDS = Math.floor(Date.now() / 1000);
const daysAgo = (n: number) => NOW_SECONDS - n * 86400;

interface MemoryOverrides {
  id: string;
  content: string;
  type: string;
  confidence: number;
  createdAt: number;
  volatility: 'static' | 'slow' | 'volatile';
  verifiedAt: number | null;
  quarantinedAt: number | null;
  supersededBy: string | null;
  visibility: 'global' | 'agent_local' | 'team' | 'restricted';
  writerAgentId: string | null;
  writerTeamId: string | null;
  restrictedReaders: string[] | null;
}

function insertMemory(db: DatabaseConnection, overrides: Partial<MemoryOverrides> = {}): string {
  const id = overrides.id ?? randomUUID();
  const createdAt = overrides.createdAt ?? NOW_SECONDS;

  db.instance
    .prepare(
      `INSERT INTO memories (id, content, type, confidence, project_id, content_hash, created_at, accessed_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      id,
      overrides.content ?? `Memory ${id}`,
      overrides.type ?? 'fact',
      overrides.confidence ?? 1.0,
      PROJECT_ID,
      `hash-${id}`,
      createdAt,
      createdAt
    );

  if (overrides.volatility !== undefined || overrides.verifiedAt !== undefined) {
    db.instance
      .prepare(`UPDATE memories SET volatility = ?, verified_at = ? WHERE id = ?`)
      .run(overrides.volatility ?? 'slow', overrides.verifiedAt ?? null, id);
  }
  if (overrides.quarantinedAt !== undefined) {
    db.instance
      .prepare(`UPDATE memories SET quarantined_at = ? WHERE id = ?`)
      .run(overrides.quarantinedAt, id);
  }
  if (overrides.supersededBy !== undefined) {
    db.instance
      .prepare(`UPDATE memories SET superseded_by = ? WHERE id = ?`)
      .run(overrides.supersededBy, id);
  }
  if (overrides.visibility !== undefined) {
    db.instance
      .prepare(
        `UPDATE memories SET visibility = ?, writer_agent_id = ?, writer_team_id = ?, restricted_readers = ? WHERE id = ?`
      )
      .run(
        overrides.visibility,
        overrides.writerAgentId ?? null,
        overrides.writerTeamId ?? null,
        overrides.restrictedReaders ? JSON.stringify(overrides.restrictedReaders) : null,
        id
      );
  }

  return id;
}

// ============================================================================
// expandChain (T11.5)
// ============================================================================

describe('MemoryGraphService.expandChain', () => {
  let db: DatabaseConnection;
  let graphService: MemoryGraphService;
  let linkRepo: MemoryLinkRepository;

  beforeEach(() => {
    db = createTestDb();
    graphService = new MemoryGraphService(db);
    linkRepo = new MemoryLinkRepository(db);
  });

  afterEach(() => {
    db.close();
  });

  it('returns just the seed when it has no links', () => {
    const seed = insertMemory(db, { content: 'lone seed' });

    const result = graphService.expandChain([seed], PROJECT_ID);

    expect(result.nodes).toHaveLength(1);
    expect(result.nodes[0]).toMatchObject({ id: seed, linkType: 'seed', depth: 0 });
  });

  it('hops up to 2 links deep through typed chain links', () => {
    const cause = insertMemory(db, { content: 'root cause', createdAt: daysAgo(3) });
    const fix = insertMemory(db, { content: 'the fix', createdAt: daysAgo(2) });
    const principle = insertMemory(db, { content: 'general principle', createdAt: daysAgo(1) });

    linkRepo.createLink({ sourceId: fix, targetId: cause, linkType: MemoryLinkType.DERIVED_FROM });
    linkRepo.createLink({ sourceId: fix, targetId: principle, linkType: MemoryLinkType.SUPPORTS });

    const result = graphService.expandChain([fix], PROJECT_ID);

    const ids = result.nodes.map((n) => n.id);
    expect(ids).toContain(cause);
    expect(ids).toContain(fix);
    expect(ids).toContain(principle);
    expect(result.nodes.find((n) => n.id === cause)?.depth).toBe(1);
    expect(result.nodes.find((n) => n.id === principle)?.depth).toBe(1);
  });

  it('does not expand past 2 hops', () => {
    const nodes = Array.from({ length: 4 }, (_, i) =>
      insertMemory(db, { content: `chain ${i}`, createdAt: daysAgo(4 - i) })
    );
    for (let i = 0; i < nodes.length - 1; i++) {
      linkRepo.createLink({
        sourceId: nodes[i]!,
        targetId: nodes[i + 1]!,
        linkType: MemoryLinkType.DERIVED_FROM,
      });
    }

    const result = graphService.expandChain([nodes[0]!], PROJECT_ID);
    const ids = new Set(result.nodes.map((n) => n.id));

    expect(ids.has(nodes[0]!)).toBe(true);
    expect(ids.has(nodes[1]!)).toBe(true);
    expect(ids.has(nodes[2]!)).toBe(true);
    expect(ids.has(nodes[3]!)).toBe(false); // 3 hops away — out of range
  });

  it('only traverses the configured (typed) link types', () => {
    const seed = insertMemory(db, { content: 'seed' });
    const weaklyRelated = insertMemory(db, { content: 'weakly related' });
    linkRepo.createLink({
      sourceId: seed,
      targetId: weaklyRelated,
      linkType: MemoryLinkType.RELATES_TO,
    });

    const result = graphService.expandChain([seed], PROJECT_ID);

    expect(result.nodes.map((n) => n.id)).toEqual([seed]);
  });

  it('dedupes a node reached from two different seeds', () => {
    const seedA = insertMemory(db, { content: 'seed A' });
    const seedB = insertMemory(db, { content: 'seed B' });
    const shared = insertMemory(db, { content: 'shared downstream' });
    linkRepo.createLink({ sourceId: seedA, targetId: shared, linkType: MemoryLinkType.SUPPORTS });
    linkRepo.createLink({ sourceId: seedB, targetId: shared, linkType: MemoryLinkType.SUPPORTS });

    const result = graphService.expandChain([seedA, seedB], PROJECT_ID);

    const sharedOccurrences = result.nodes.filter((n) => n.id === shared);
    expect(sharedOccurrences).toHaveLength(1);
  });

  it('is cycle-safe: a 3-node cycle terminates and visits each node once', () => {
    const a = insertMemory(db, { content: 'a' });
    const b = insertMemory(db, { content: 'b' });
    const c = insertMemory(db, { content: 'c' });
    linkRepo.createLink({ sourceId: a, targetId: b, linkType: MemoryLinkType.DERIVED_FROM });
    linkRepo.createLink({ sourceId: b, targetId: c, linkType: MemoryLinkType.DERIVED_FROM });
    linkRepo.createLink({ sourceId: c, targetId: a, linkType: MemoryLinkType.DERIVED_FROM });

    const result = graphService.expandChain([a], PROJECT_ID);

    const ids = result.nodes.map((n) => n.id);
    expect(new Set(ids).size).toBe(ids.length); // no duplicates
    expect(new Set(ids)).toEqual(new Set([a, b, c]));
  });

  it('is cycle-safe against a direct self-loop', () => {
    const seed = insertMemory(db, { content: 'self-linked' });
    linkRepo.createLink({ sourceId: seed, targetId: seed, linkType: MemoryLinkType.DERIVED_FROM });

    const result = graphService.expandChain([seed], PROJECT_ID);

    expect(result.nodes).toHaveLength(1);
    expect(result.nodes[0]?.id).toBe(seed);
  });

  it('excludes a volatile memory that has gone stale (unverified > 30 days)', () => {
    const seed = insertMemory(db, { content: 'seed' });
    const stale = insertMemory(db, {
      content: 'stale volatile fact',
      volatility: 'volatile',
      verifiedAt: daysAgo(45),
    });
    linkRepo.createLink({ sourceId: seed, targetId: stale, linkType: MemoryLinkType.SUPPORTS });

    const result = graphService.expandChain([seed], PROJECT_ID);

    expect(result.nodes.map((n) => n.id)).not.toContain(stale);
  });

  it('keeps a volatile memory that has been recently verified', () => {
    const seed = insertMemory(db, { content: 'seed' });
    const fresh = insertMemory(db, {
      content: 'recently verified volatile fact',
      volatility: 'volatile',
      verifiedAt: daysAgo(1),
    });
    linkRepo.createLink({ sourceId: seed, targetId: fresh, linkType: MemoryLinkType.SUPPORTS });

    const result = graphService.expandChain([seed], PROJECT_ID);

    expect(result.nodes.map((n) => n.id)).toContain(fresh);
  });

  it('excludes quarantined memories from hop expansion', () => {
    const seed = insertMemory(db, { content: 'seed' });
    const quarantined = insertMemory(db, {
      content: 'quarantined fact',
      quarantinedAt: NOW_SECONDS,
    });
    linkRepo.createLink({
      sourceId: seed,
      targetId: quarantined,
      linkType: MemoryLinkType.SUPPORTS,
    });

    const result = graphService.expandChain([seed], PROJECT_ID);

    expect(result.nodes.map((n) => n.id)).not.toContain(quarantined);
  });

  it('drops a seed the reader cannot see, and never traverses through it', () => {
    const seed = insertMemory(db, {
      content: 'team-only seed',
      visibility: 'team',
      writerTeamId: 'team-a',
    });
    const downstream = insertMemory(db, { content: 'downstream of hidden seed' });
    linkRepo.createLink({
      sourceId: seed,
      targetId: downstream,
      linkType: MemoryLinkType.SUPPORTS,
    });

    const result = graphService.expandChain([seed], PROJECT_ID, {}, {});

    expect(result.nodes).toHaveLength(0);
  });

  it('respects fleet visibility when hopping to a restricted node', () => {
    const seed = insertMemory(db, { content: 'seed' });
    const restricted = insertMemory(db, {
      content: 'restricted downstream',
      visibility: 'restricted',
      restrictedReaders: ['agent-x'],
    });
    linkRepo.createLink({
      sourceId: seed,
      targetId: restricted,
      linkType: MemoryLinkType.SUPPORTS,
    });

    const withoutAccess = graphService.expandChain([seed], PROJECT_ID, {}, {});
    expect(withoutAccess.nodes.map((n) => n.id)).not.toContain(restricted);

    const withAccess = graphService.expandChain([seed], PROJECT_ID, {}, { agentId: 'agent-x' });
    expect(withAccess.nodes.map((n) => n.id)).toContain(restricted);
  });

  it('orders nodes by hop depth first, then creation time', () => {
    const seed = insertMemory(db, { content: 'seed', createdAt: daysAgo(10) });
    const laterHop = insertMemory(db, { content: 'later hop', createdAt: daysAgo(1) });
    const earlierHop = insertMemory(db, { content: 'earlier hop', createdAt: daysAgo(5) });
    linkRepo.createLink({
      sourceId: seed,
      targetId: laterHop,
      linkType: MemoryLinkType.SUPPORTS,
    });
    linkRepo.createLink({
      sourceId: seed,
      targetId: earlierHop,
      linkType: MemoryLinkType.EXTENDS,
    });

    const result = graphService.expandChain([seed], PROJECT_ID);

    expect(result.nodes.map((n) => n.id)).toEqual([seed, earlierHop, laterHop]);
  });

  describe('contradictions', () => {
    it('returns both sides of a contradicts edge touching the chain', () => {
      const seed = insertMemory(db, { content: 'seed claim' });
      const conflicting = insertMemory(db, { content: 'conflicting claim' });
      const link = linkRepo.createLink({
        sourceId: seed,
        targetId: conflicting,
        linkType: MemoryLinkType.CONTRADICTS,
      });

      const result = graphService.expandChain([seed], PROJECT_ID);

      expect(result.contradictions).toHaveLength(1);
      expect(result.contradictions[0]).toMatchObject({
        linkId: link.id,
        a: { id: seed },
        b: { id: conflicting },
      });
    });

    it('verdict: an explicit version-supersede pointer wins over freshness/confidence', () => {
      const seed = insertMemory(db, { content: 'current version' });
      const old = insertMemory(db, { content: 'old version', supersededBy: seed });
      linkRepo.createLink({ sourceId: seed, targetId: old, linkType: MemoryLinkType.CONTRADICTS });

      const result = graphService.expandChain([seed], PROJECT_ID);

      expect(result.contradictions[0]?.verdict).toEqual({
        winnerId: seed,
        reason: 'superseded_version',
      });
    });

    it('verdict: the fresher (less-stale) side wins when there is no supersede pointer', () => {
      const fresh = insertMemory(db, { content: 'fresh claim', volatility: 'static' });
      const stale = insertMemory(db, {
        content: 'stale claim',
        volatility: 'volatile',
        verifiedAt: daysAgo(45),
      });
      linkRepo.createLink({
        sourceId: fresh,
        targetId: stale,
        linkType: MemoryLinkType.CONTRADICTS,
      });

      const result = graphService.expandChain([fresh], PROJECT_ID);

      expect(result.contradictions[0]?.verdict).toEqual({ winnerId: fresh, reason: 'fresher' });
    });

    it('verdict: higher confidence wins when freshness is tied', () => {
      const strong = insertMemory(db, { content: 'high confidence', confidence: 0.95 });
      const weak = insertMemory(db, { content: 'low confidence', confidence: 0.4 });
      linkRepo.createLink({
        sourceId: strong,
        targetId: weak,
        linkType: MemoryLinkType.CONTRADICTS,
      });

      const result = graphService.expandChain([strong], PROJECT_ID);

      expect(result.contradictions[0]?.verdict).toEqual({
        winnerId: strong,
        reason: 'higher_confidence',
      });
    });

    it('verdict: unresolved when freshness and confidence are tied', () => {
      const a = insertMemory(db, { content: 'claim a' });
      const b = insertMemory(db, { content: 'claim b' });
      linkRepo.createLink({ sourceId: a, targetId: b, linkType: MemoryLinkType.CONTRADICTS });

      const result = graphService.expandChain([a], PROJECT_ID);

      expect(result.contradictions[0]?.verdict).toEqual({ winnerId: null, reason: 'unresolved' });
    });

    it('drops a contradiction pair when either side is unreadable', () => {
      const seed = insertMemory(db, { content: 'seed claim' });
      const hidden = insertMemory(db, {
        content: 'hidden conflicting claim',
        visibility: 'restricted',
        restrictedReaders: ['agent-x'],
      });
      linkRepo.createLink({
        sourceId: seed,
        targetId: hidden,
        linkType: MemoryLinkType.CONTRADICTS,
      });

      const result = graphService.expandChain([seed], PROJECT_ID, {}, {});

      expect(result.contradictions).toHaveLength(0);
    });
  });
});
