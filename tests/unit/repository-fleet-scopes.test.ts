import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { MemoryRepository } from '../../mcp/memory-server/src/storage/repository.js';
import { MIGRATIONS } from '../../mcp/memory-server/src/storage/schema.js';

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

describe('MemoryRepository — fleet scopes (T11.4)', () => {
  let db: { instance: Database.Database; close: () => void };
  let repo: MemoryRepository;

  beforeEach(() => {
    db = createTestDb();
    repo = new MemoryRepository(db as any);
  });

  afterEach(() => {
    db.close();
  });

  it('createMemory without visibility defaults to global (pre-T11.4 behavior preserved)', () => {
    const memory = repo.createMemory({
      content: 'an ordinary memory nobody scoped',
      projectId: 'test-project',
    });

    expect(memory.visibility).toBe('global');
    expect(memory.writerAgentId).toBeNull();
    expect(memory.writerTeamId).toBeNull();
    expect(memory.provenance).toBeNull();
    expect(memory.restrictedReaders).toBeNull();
  });

  it('createMemory persists an explicit agent_local visibility + writer identity', () => {
    const memory = repo.createMemory({
      content: 'scratch note',
      projectId: 'test-project',
      visibility: 'agent_local',
      writerAgentId: 'agent-1',
    });

    expect(memory.visibility).toBe('agent_local');
    expect(memory.writerAgentId).toBe('agent-1');

    const reloaded = repo.findById(memory.id, 'test-project');
    expect(reloaded?.visibility).toBe('agent_local');
    expect(reloaded?.writerAgentId).toBe('agent-1');
  });

  it('createMemory persists team visibility + writerTeamId + provenance', () => {
    const memory = repo.createMemory({
      content: 'team runbook entry',
      projectId: 'test-project',
      visibility: 'team',
      writerAgentId: 'agent-1',
      writerTeamId: 'team-a',
      provenance: 'runbook sync 2026-07-10',
    });

    const reloaded = repo.findById(memory.id, 'test-project');
    expect(reloaded?.visibility).toBe('team');
    expect(reloaded?.writerTeamId).toBe('team-a');
    expect(reloaded?.provenance).toBe('runbook sync 2026-07-10');
  });

  it('createMemory persists restricted visibility + restrictedReaders as a real array after round-trip', () => {
    const memory = repo.createMemory({
      content: 'need-to-know note',
      projectId: 'test-project',
      visibility: 'restricted',
      writerAgentId: 'agent-1',
      provenance: 'need-to-know',
      restrictedReaders: ['agent-a', 'agent-b'],
    });

    expect(memory.restrictedReaders).toEqual(['agent-a', 'agent-b']);

    const reloaded = repo.findById(memory.id, 'test-project');
    expect(reloaded?.restrictedReaders).toEqual(['agent-a', 'agent-b']);
  });

  it('the visibility CHECK constraint rejects an invalid value at the SQL layer', () => {
    expect(() =>
      db.instance
        .prepare(
          `INSERT INTO memories (id, content, type, confidence, project_id, content_hash, created_at, accessed_at, access_count, version, visibility)
           VALUES ('bad-id', 'x', 'fact', 1.0, 'test-project', 'hash', 0, 0, 0, 1, 'not_a_real_tier')`
        )
        .run()
    ).toThrow();
  });

  describe('createSupersedingMemory inherits fleet-scope fields (T11.4 review fix)', () => {
    it('a global memory supersession stays global (no-op regression check)', () => {
      const original = repo.createMemory({
        content: 'ordinary global note',
        projectId: 'test-project',
      });

      const superseded = repo.createSupersedingMemory(
        original.id,
        'test-project',
        'ordinary global note, corrected'
      );

      expect(superseded.visibility).toBe('global');
    });

    it('an agent_local memory supersession keeps visibility + writerAgentId — does NOT declassify to global', () => {
      const original = repo.createMemory({
        content: 'scratch note',
        projectId: 'test-project',
        visibility: 'agent_local',
        writerAgentId: 'agent-1',
      });

      const superseded = repo.createSupersedingMemory(
        original.id,
        'test-project',
        'scratch note, corrected'
      );

      expect(superseded.visibility).toBe('agent_local');
      expect(superseded.writerAgentId).toBe('agent-1');
    });

    it('a team memory supersession keeps visibility + writerTeamId + provenance — does NOT declassify to global', () => {
      const original = repo.createMemory({
        content: 'team runbook entry',
        projectId: 'test-project',
        visibility: 'team',
        writerAgentId: 'agent-1',
        writerTeamId: 'team-a',
        provenance: 'runbook sync 2026-07-10',
      });

      const superseded = repo.createSupersedingMemory(
        original.id,
        'test-project',
        'team runbook entry, corrected'
      );

      expect(superseded.visibility).toBe('team');
      expect(superseded.writerTeamId).toBe('team-a');
      expect(superseded.provenance).toBe('runbook sync 2026-07-10');
    });

    it('a restricted memory supersession keeps visibility + restrictedReaders — does NOT declassify to global', () => {
      const original = repo.createMemory({
        content: 'need-to-know note',
        projectId: 'test-project',
        visibility: 'restricted',
        writerAgentId: 'agent-1',
        provenance: 'need-to-know',
        restrictedReaders: ['agent-a', 'agent-b'],
      });

      const superseded = repo.createSupersedingMemory(
        original.id,
        'test-project',
        'need-to-know note, corrected'
      );

      expect(superseded.visibility).toBe('restricted');
      expect(superseded.writerAgentId).toBe('agent-1');
      expect(superseded.provenance).toBe('need-to-know');
      expect(superseded.restrictedReaders).toEqual(['agent-a', 'agent-b']);

      const reloaded = repo.findById(superseded.id, 'test-project');
      expect(reloaded?.visibility).toBe('restricted');
      expect(reloaded?.restrictedReaders).toEqual(['agent-a', 'agent-b']);
    });
  });
});
