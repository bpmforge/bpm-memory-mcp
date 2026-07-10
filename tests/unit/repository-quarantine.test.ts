import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { MemoryRepository } from '../../mcp/memory-server/src/storage/repository.js';
import { MIGRATIONS } from '../../mcp/memory-server/src/storage/schema.js';

// Create a mock DatabaseConnection interface with all migrations applied
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

describe('MemoryRepository — quarantine + promotion (T11.3)', () => {
  let db: { instance: Database.Database; close: () => void };
  let repo: MemoryRepository;

  beforeEach(() => {
    db = createTestDb();
    repo = new MemoryRepository(db as any);
  });

  afterEach(() => {
    db.close();
  });

  it('createMemory({ quarantine: true }) sets quarantinedAt and leaves promotion fields null', () => {
    const before = Math.floor(Date.now() / 1000);
    const memory = repo.createMemory({
      content: 'FACT: the sky is plaid',
      type: 'fact' as any,
      projectId: 'test-project',
      quarantine: true,
    });

    expect(memory.quarantinedAt).not.toBeNull();
    expect(memory.quarantinedAt!.getTime() / 1000).toBeGreaterThanOrEqual(before - 1);
    expect(memory.promotedAt).toBeNull();
    expect(memory.promotionReason).toBeNull();
  });

  it('createMemory without quarantine defaults to trusted (quarantinedAt null)', () => {
    const memory = repo.createMemory({
      content: 'a normal fold',
      projectId: 'test-project',
    });

    expect(memory.quarantinedAt).toBeNull();
  });

  it('promoteFromQuarantine clears quarantinedAt and records reason + timestamp', () => {
    const memory = repo.createMemory({
      content: 'FACT: quarantined claim',
      projectId: 'test-project',
      quarantine: true,
    });

    const promoted = repo.promoteFromQuarantine(memory.id, 'test-project', 'corroboration');
    expect(promoted).toBe(true);

    const reloaded = repo.findById(memory.id, 'test-project')!;
    expect(reloaded.quarantinedAt).toBeNull();
    expect(reloaded.promotedAt).not.toBeNull();
    expect(reloaded.promotionReason).toBe('corroboration');
  });

  it('promoteFromQuarantine is a no-op (returns false) on a memory that was never quarantined', () => {
    const memory = repo.createMemory({
      content: 'a trusted fold',
      projectId: 'test-project',
    });

    const promoted = repo.promoteFromQuarantine(memory.id, 'test-project', 'human_touch');
    expect(promoted).toBe(false);

    const reloaded = repo.findById(memory.id, 'test-project')!;
    expect(reloaded.promotedAt).toBeNull();
    expect(reloaded.promotionReason).toBeNull();
  });

  it('promoteFromQuarantine respects project isolation (wrong projectId is a no-op)', () => {
    const memory = repo.createMemory({
      content: 'FACT: scoped claim',
      projectId: 'project-a',
      quarantine: true,
    });

    const promoted = repo.promoteFromQuarantine(memory.id, 'project-b', 'human_touch');
    expect(promoted).toBe(false);

    const reloaded = repo.findById(memory.id, 'project-a')!;
    expect(reloaded.quarantinedAt).not.toBeNull();
  });
});
