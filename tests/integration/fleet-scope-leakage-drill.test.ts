import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Database from 'better-sqlite3';
import { MIGRATIONS } from '../../mcp/memory-server/src/storage/schema.js';
import { MemoryRepository } from '../../mcp/memory-server/src/storage/repository.js';
import { BM25Search } from '../../mcp/memory-server/src/search/bm25.js';
import { MemoryGraphService } from '../../mcp/memory-server/src/graph/memory-graph.js';
import { MemoryLinkRepository } from '../../mcp/memory-server/src/storage/links.js';
import { MemoryLinkType } from '../../mcp/memory-server/src/types.js';

/**
 * T11.4 leakage drill: for every fleet-visibility tier, plant a memory and
 * confirm it surfaces ONLY for readers actually entitled to see it and
 * NEVER for any other reader identity — 0/N cross-scope reads across every
 * content-returning query path (BM25Search, the same engine memory_recall
 * and fact_query route through via HybridSearch — see the T11.3 poisoning
 * drill for precedent — plus MemoryGraphService's chain/cluster/orphan/
 * contradiction traversal).
 */
function createTestDb(): {
  instance: Database.Database;
  close: () => void;
  transaction: <T>(fn: () => T) => T;
} {
  const db = new Database(':memory:');
  for (const migration of MIGRATIONS) {
    db.exec(migration.up);
  }
  return {
    instance: db,
    close: () => db.close(),
    transaction: <T>(fn: () => T): T => db.transaction(fn)(),
  };
}

describe('Fleet-scope leakage drill (T11.4)', () => {
  let db: { instance: Database.Database; close: () => void };
  let repo: MemoryRepository;
  let bm25: BM25Search;
  let graph: MemoryGraphService;
  let linkRepo: MemoryLinkRepository;
  const PROJECT_ID = 'fleet-scope-drill';

  const READERS = [
    { label: 'writer-agent', ctx: { agentId: 'agent-writer' } },
    { label: 'writer-team', ctx: { teamId: 'team-writer' } },
    { label: 'allowlisted-reader', ctx: { agentId: 'agent-allowlisted' } },
    { label: 'other-agent', ctx: { agentId: 'agent-other' } },
    { label: 'other-team', ctx: { teamId: 'team-other' } },
    { label: 'anonymous', ctx: {} },
  ];

  const planted: Array<{ label: string; id: string; claim: string; allowedLabels: string[] }> = [];

  beforeAll(() => {
    db = createTestDb();
    repo = new MemoryRepository(db as any);
    bm25 = new BM25Search(db as any);
    graph = new MemoryGraphService(db as any);
    linkRepo = new MemoryLinkRepository(db as any);

    const global = repo.createMemory({
      content: 'zylofram widgets ship with the blortex config preset',
      type: 'fact' as any,
      projectId: PROJECT_ID,
      visibility: 'global',
    });
    planted.push({
      label: 'global',
      id: global.id,
      claim: 'zylofram',
      allowedLabels: READERS.map((r) => r.label), // everyone
    });

    const agentLocal = repo.createMemory({
      content: 'quixnar internal scratch note about the flembotron rollout',
      type: 'fact' as any,
      projectId: PROJECT_ID,
      visibility: 'agent_local',
      writerAgentId: 'agent-writer',
    });
    planted.push({
      label: 'agent_local',
      id: agentLocal.id,
      claim: 'quixnar',
      allowedLabels: ['writer-agent'],
    });

    const team = repo.createMemory({
      content: 'plindarok deployment runbook for the frobnicate service',
      type: 'fact' as any,
      projectId: PROJECT_ID,
      visibility: 'team',
      writerAgentId: 'agent-writer',
      writerTeamId: 'team-writer',
      provenance: 'drill fixture',
    });
    planted.push({
      label: 'team',
      id: team.id,
      claim: 'plindarok',
      allowedLabels: ['writer-team'],
    });

    const restricted = repo.createMemory({
      content: 'gorvantek credential rotation schedule, need-to-know only',
      type: 'fact' as any,
      projectId: PROJECT_ID,
      visibility: 'restricted',
      writerAgentId: 'agent-writer',
      provenance: 'drill fixture',
      restrictedReaders: ['agent-allowlisted'],
    });
    planted.push({
      label: 'restricted',
      id: restricted.id,
      claim: 'gorvantek',
      allowedLabels: ['allowlisted-reader'],
    });
  });

  afterAll(() => {
    db.close();
  });

  it('BM25 recall (memory_recall / fact_query path): every reader sees exactly the memories their scope allows — 0 cross-scope reads', () => {
    let crossScopeReads = 0;
    let totalChecks = 0;

    for (const planted_ of planted) {
      for (const reader of READERS) {
        totalChecks++;
        const results = bm25.search(planted_.claim, PROJECT_ID, {
          readerAgentId: reader.ctx.agentId,
          readerTeamId: reader.ctx.teamId,
        });
        const found = results.some((r) => r.memory.id === planted_.id);
        const shouldSee = planted_.allowedLabels.includes(reader.label);

        expect(found).toBe(shouldSee);
        if (found && !shouldSee) crossScopeReads++;
      }
    }

    expect(crossScopeReads).toBe(0);
    expect(totalChecks).toBe(planted.length * READERS.length);
  });

  it('a reader with no identity at all only ever sees global-visibility memories', () => {
    for (const planted_ of planted) {
      const results = bm25.search(planted_.claim, PROJECT_ID, {});
      const found = results.some((r) => r.memory.id === planted_.id);
      expect(found).toBe(planted_.label === 'global');
    }
  });

  describe('graph traversal (memory_link find_chain / find_cluster / find_orphans / find_contradictions)', () => {
    let restrictedNeighborId: string;

    beforeAll(() => {
      // Link the restricted memory to a global one so traversal from the
      // global seed would surface the restricted memory's content if
      // enforcement were missing.
      const neighbor = repo.createMemory({
        content: 'gorvantek rotation is referenced from the ops handbook',
        type: 'fact' as any,
        projectId: PROJECT_ID,
        visibility: 'global',
      });
      restrictedNeighborId = neighbor.id;
      const restrictedMemory = planted.find((p) => p.label === 'restricted')!;
      linkRepo.createLink({
        sourceId: neighbor.id,
        targetId: restrictedMemory.id,
        linkType: MemoryLinkType.RELATES_TO,
        strength: 0.9,
        bidirectional: true,
        createdBy: 'system',
      });
    });

    it('find_chain from a global neighbor never surfaces the restricted memory to an unauthorized reader', () => {
      const restrictedMemory = planted.find((p) => p.label === 'restricted')!;

      const unauthorized = graph.findChain(
        restrictedNeighborId,
        PROJECT_ID,
        { linkTypes: ['relates_to'] },
        { agentId: 'agent-other' }
      );
      expect(unauthorized.nodes.some((n) => n.id === restrictedMemory.id)).toBe(false);

      const authorized = graph.findChain(
        restrictedNeighborId,
        PROJECT_ID,
        { linkTypes: ['relates_to'] },
        { agentId: 'agent-allowlisted' }
      );
      expect(authorized.nodes.some((n) => n.id === restrictedMemory.id)).toBe(true);
    });

    it('find_cluster around the restricted memory returns empty (not-found shape) for an unauthorized reader', () => {
      const restrictedMemory = planted.find((p) => p.label === 'restricted')!;

      const unauthorized = graph.findCluster(
        restrictedMemory.id,
        PROJECT_ID,
        {},
        { agentId: 'agent-other' }
      );
      expect(unauthorized.centerContent).toBe('');
      expect(unauthorized.members).toHaveLength(0);

      const authorized = graph.findCluster(
        restrictedMemory.id,
        PROJECT_ID,
        {},
        { agentId: 'agent-allowlisted' }
      );
      expect(authorized.centerContent).not.toBe('');
    });

    it('find_orphans never surfaces the agent_local memory to a reader other than its writer', () => {
      const agentLocalMemory = planted.find((p) => p.label === 'agent_local')!;

      const unauthorized = graph.findOrphans(PROJECT_ID, 50, { agentId: 'agent-other' });
      expect(unauthorized.some((o) => o.id === agentLocalMemory.id)).toBe(false);

      const authorized = graph.findOrphans(PROJECT_ID, 50, { agentId: 'agent-writer' });
      expect(authorized.some((o) => o.id === agentLocalMemory.id)).toBe(true);
    });

    it('find_contradictions drops a pair when either side is unreadable by the requesting reader', () => {
      const restrictedMemory = planted.find((p) => p.label === 'restricted')!;
      linkRepo.createLink({
        sourceId: restrictedNeighborId,
        targetId: restrictedMemory.id,
        linkType: MemoryLinkType.CONTRADICTS,
        strength: 0.5,
        bidirectional: false,
        createdBy: 'system',
      });

      const unauthorized = graph.findContradictions(PROJECT_ID, { agentId: 'agent-other' });
      expect(
        unauthorized.some(
          (c) => c.source.id === restrictedMemory.id || c.target.id === restrictedMemory.id
        )
      ).toBe(false);

      const authorized = graph.findContradictions(PROJECT_ID, { agentId: 'agent-allowlisted' });
      expect(
        authorized.some(
          (c) => c.source.id === restrictedMemory.id || c.target.id === restrictedMemory.id
        )
      ).toBe(true);
    });
  });
});
