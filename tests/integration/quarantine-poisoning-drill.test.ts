import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Database from 'better-sqlite3';
import { MIGRATIONS } from '../../mcp/memory-server/src/storage/schema.js';
import { MemoryRepository } from '../../mcp/memory-server/src/storage/repository.js';
import { BM25Search } from '../../mcp/memory-server/src/search/bm25.js';
import {
  findCorroboratingMemory,
  buildCorroborationCandidates,
} from '../../mcp/memory-server/src/quarantine/index.js';

/**
 * T11.3 poisoning drill: a single-source, web-derived "fact" must never
 * reach a default recall/assembled-context result set. It only leaves
 * quarantine once a second, independent source corroborates it (or a human
 * explicitly touches it — covered in repository-quarantine.test.ts).
 *
 * Exercises the real recall path (BM25Search, which fact_query/memory_recall
 * both route through via HybridSearch) rather than re-testing the repository
 * in isolation.
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

describe('Quarantine poisoning drill (T11.3)', () => {
  let db: { instance: Database.Database; close: () => void };
  let repo: MemoryRepository;
  let bm25: BM25Search;
  const PROJECT_ID = 'poisoning-drill';
  const PLANTED_CLAIM = 'zorbnax config option must be set to plaidmode for the widget to load';

  beforeAll(() => {
    db = createTestDb();
    repo = new MemoryRepository(db as any);
    bm25 = new BM25Search(db as any);
  });

  afterAll(() => {
    db.close();
  });

  it('a single-source planted quarantined fact never reaches default recall', () => {
    const planted = repo.createMemory({
      content: `FACT: ${PLANTED_CLAIM}`,
      type: 'fact' as any,
      projectId: PROJECT_ID,
      citation: 'https://reddit.com/r/widgets/planted-post',
      quarantine: true,
    });

    // Default search (as memory_recall / fact_query call it): quarantine excluded.
    const defaultResults = bm25.search('zorbnax plaidmode', PROJECT_ID, {});
    expect(defaultResults.find((r) => r.memory.id === planted.id)).toBeUndefined();

    // Confirm it genuinely exists and matches — proves the absence above is
    // the quarantine filter, not an unrelated search miss.
    const withQuarantined = bm25.search('zorbnax plaidmode', PROJECT_ID, {
      includeQuarantined: true,
    });
    expect(withQuarantined.find((r) => r.memory.id === planted.id)).toBeDefined();

    // Repeat the default query a few times — never a flaky leak.
    for (let i = 0; i < 3; i++) {
      const repeat = bm25.search('zorbnax plaidmode', PROJECT_ID, {});
      expect(repeat.find((r) => r.memory.id === planted.id)).toBeUndefined();
    }
  });

  it('promotes and surfaces in default recall once a 2nd independent source corroborates', () => {
    const first = repo.createMemory({
      content: 'FACT: the launcher retries 3 times before failing',
      type: 'fact' as any,
      projectId: PROJECT_ID,
      citation: 'https://forum-a.example.com/thread/1',
      quarantine: true,
    });
    const second = repo.createMemory({
      content: 'FACT: the launcher retries three times before it gives up',
      type: 'fact' as any,
      projectId: PROJECT_ID,
      citation: 'https://forum-b.example.com/thread/9',
      quarantine: true,
    });

    // Simulates what fact_store's autoLinker similarity pass would find:
    // a high-similarity candidate from an independent source.
    const corroboratingId = findCorroboratingMemory(
      [{ memoryId: first.id, similarity: 0.9, sourceUrl: 'https://forum-a.example.com/thread/1' }],
      'https://forum-b.example.com/thread/9'
    );
    expect(corroboratingId).toBe(first.id);

    repo.promoteFromQuarantine(first.id, PROJECT_ID, 'corroboration');
    repo.promoteFromQuarantine(second.id, PROJECT_ID, 'corroboration');

    const defaultResults = bm25.search('launcher retries before', PROJECT_ID, {});
    expect(defaultResults.find((r) => r.memory.id === first.id)).toBeDefined();
    expect(defaultResults.find((r) => r.memory.id === second.id)).toBeDefined();
  });

  it('two different-source facts of opposite polarity never promote each other', () => {
    const claim = repo.createMemory({
      content: 'FACT: the launcher retries 3 times before failing',
      type: 'fact' as any,
      projectId: PROJECT_ID,
      citation: 'https://forum-a.example.com/thread/2',
      quarantine: true,
    });
    const rebuttal = repo.createMemory({
      content: 'FACT: the launcher does not retry, it fails immediately',
      type: 'fact' as any,
      projectId: PROJECT_ID,
      citation: 'https://forum-b.example.com/thread/10',
      quarantine: true,
    });

    // Mirrors what fact_store does with AutoLinker's output: high embedding
    // similarity (same topic) but linkType CONTRADICTS (opposite polarity).
    const sourceUrlById = new Map([[claim.id, 'https://forum-a.example.com/thread/2']]);
    const candidates = buildCorroborationCandidates(
      [{ targetId: claim.id, linkType: 'contradicts', strength: 0.92 }],
      sourceUrlById
    );
    const corroboratingId = findCorroboratingMemory(
      candidates,
      'https://forum-b.example.com/thread/10'
    );
    expect(corroboratingId).toBeNull();

    // Neither side gets promoted — both must remain excluded from default recall.
    const results = bm25.search('launcher retry fail', PROJECT_ID, {});
    expect(results.find((r) => r.memory.id === claim.id)).toBeUndefined();
    expect(results.find((r) => r.memory.id === rebuttal.id)).toBeUndefined();
  });
});
