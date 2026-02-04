import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { randomUUID } from 'crypto';
import { GoalRepository } from '../../mcp/memory-server/src/goals/index.js';
import { MemoryLinkRepository } from '../../mcp/memory-server/src/storage/links.js';
import { CheckpointRepository } from '../../mcp/memory-server/src/checkpoint/index.js';
import { ContradictionDetector } from '../../mcp/memory-server/src/validation/contradictions.js';
import { MIGRATIONS, CURRENT_VERSION } from '../../mcp/memory-server/src/storage/schema.js';
import type { DatabaseConnection } from '../../mcp/memory-server/src/storage/database.js';
import { MemoryLinkType } from '../../mcp/memory-server/src/types.js';

// ============================================================================
// Test Setup
// ============================================================================

function createTestDb(): DatabaseConnection {
  const db = new Database(':memory:');

  // Apply all migrations
  for (const migration of MIGRATIONS) {
    if (migration.version <= CURRENT_VERSION) {
      const statements = migration.up.split(';').filter(s => s.trim());
      for (const stmt of statements) {
        if (stmt.trim()) {
          try {
            db.exec(stmt);
          } catch (e) {
            // Ignore errors from statements that may already exist
          }
        }
      }
    }
  }

  // Track schema version
  db.exec(`INSERT OR REPLACE INTO schema_version (version, applied_at) VALUES (${CURRENT_VERSION}, ${Date.now()})`);

  return {
    instance: db,
    transaction: <T>(fn: () => T) => {
      return db.transaction(fn)();
    },
    close: () => db.close(),
  };
}

const PROJECT_ID = 'test-project';

// ============================================================================
// GoalRepository Tests
// ============================================================================

describe('GoalRepository', () => {
  let db: DatabaseConnection;
  let goalRepo: GoalRepository;

  beforeEach(() => {
    db = createTestDb();
    goalRepo = new GoalRepository(db);
  });

  afterEach(() => {
    db.close();
  });

  describe('createGoal', () => {
    it('should create a goal with default priority', () => {
      const goal = goalRepo.createGoal(PROJECT_ID, {
        content: 'Implement authentication',
      });

      expect(goal.id).toBeDefined();
      expect(goal.content).toBe('Implement authentication');
      expect(goal.priority).toBe(3); // default
      expect(goal.status).toBe('active');
    });

    it('should create a goal with custom priority', () => {
      const goal = goalRepo.createGoal(PROJECT_ID, {
        content: 'Critical bug fix',
        priority: 1,
      });

      expect(goal.priority).toBe(1);
    });
  });

  describe('getActiveGoals', () => {
    it('should return active goals sorted by priority', () => {
      goalRepo.createGoal(PROJECT_ID, { content: 'Low priority', priority: 5 });
      goalRepo.createGoal(PROJECT_ID, { content: 'High priority', priority: 1 });
      goalRepo.createGoal(PROJECT_ID, { content: 'Medium priority', priority: 3 });

      const goals = goalRepo.getActiveGoals(PROJECT_ID);

      expect(goals.length).toBe(3);
      expect(goals[0]!.priority).toBe(1);
      expect(goals[1]!.priority).toBe(3);
      expect(goals[2]!.priority).toBe(5);
    });

    it('should not return completed goals', () => {
      const goal = goalRepo.createGoal(PROJECT_ID, { content: 'Test' });
      goalRepo.completeGoal(goal.id, PROJECT_ID);

      const goals = goalRepo.getActiveGoals(PROJECT_ID);

      expect(goals.length).toBe(0);
    });
  });

  describe('completeGoal', () => {
    it('should mark goal as completed', () => {
      const goal = goalRepo.createGoal(PROJECT_ID, { content: 'Test' });
      const success = goalRepo.completeGoal(goal.id, PROJECT_ID, 'Done!');

      expect(success).toBe(true);

      const allGoals = goalRepo.getAllGoals(PROJECT_ID);
      const completed = allGoals.find(g => g.id === goal.id);
      expect(completed?.status).toBe('completed');
    });

    it('should return false for non-existent goal', () => {
      const success = goalRepo.completeGoal(randomUUID(), PROJECT_ID);
      expect(success).toBe(false);
    });
  });

  describe('abandonGoal', () => {
    it('should mark goal as abandoned', () => {
      const goal = goalRepo.createGoal(PROJECT_ID, { content: 'Test' });
      const success = goalRepo.abandonGoal(goal.id, PROJECT_ID, 'No longer needed');

      expect(success).toBe(true);

      const allGoals = goalRepo.getAllGoals(PROJECT_ID);
      const abandoned = allGoals.find(g => g.id === goal.id);
      expect(abandoned?.status).toBe('abandoned');
    });
  });

  describe('countActiveGoals', () => {
    it('should count only active goals', () => {
      goalRepo.createGoal(PROJECT_ID, { content: 'Active 1' });
      goalRepo.createGoal(PROJECT_ID, { content: 'Active 2' });
      const completed = goalRepo.createGoal(PROJECT_ID, { content: 'Completed' });
      goalRepo.completeGoal(completed.id, PROJECT_ID);

      expect(goalRepo.countActiveGoals(PROJECT_ID)).toBe(2);
    });
  });
});

// ============================================================================
// MemoryLinkRepository Tests
// ============================================================================

describe('MemoryLinkRepository', () => {
  let db: DatabaseConnection;
  let linkRepo: MemoryLinkRepository;
  let memoryId1: string;
  let memoryId2: string;
  let memoryId3: string;

  beforeEach(() => {
    db = createTestDb();
    linkRepo = new MemoryLinkRepository(db);

    // Create test memories
    const now = Math.floor(Date.now() / 1000);
    memoryId1 = randomUUID();
    memoryId2 = randomUUID();
    memoryId3 = randomUUID();

    const insertMemory = db.instance.prepare(`
      INSERT INTO memories (id, content, type, confidence, project_id, content_hash, created_at, accessed_at)
      VALUES (?, ?, 'fact', 1.0, ?, ?, ?, ?)
    `);

    insertMemory.run(memoryId1, 'Memory 1', PROJECT_ID, 'hash1', now, now);
    insertMemory.run(memoryId2, 'Memory 2', PROJECT_ID, 'hash2', now, now);
    insertMemory.run(memoryId3, 'Memory 3', PROJECT_ID, 'hash3', now, now);
  });

  afterEach(() => {
    db.close();
  });

  describe('createLink', () => {
    it('should create a link between memories', () => {
      const link = linkRepo.createLink({
        sourceId: memoryId1,
        targetId: memoryId2,
        linkType: MemoryLinkType.RELATES_TO,
      });

      expect(link.id).toBeDefined();
      expect(link.sourceId).toBe(memoryId1);
      expect(link.targetId).toBe(memoryId2);
      expect(link.linkType).toBe('relates_to');
      expect(link.strength).toBe(1.0);
      expect(link.bidirectional).toBe(false);
    });

    it('should create a bidirectional link', () => {
      const link = linkRepo.createLink({
        sourceId: memoryId1,
        targetId: memoryId2,
        linkType: MemoryLinkType.SUPPORTS,
        bidirectional: true,
      });

      expect(link.bidirectional).toBe(true);
    });

    it('should create a link with custom strength', () => {
      const link = linkRepo.createLink({
        sourceId: memoryId1,
        targetId: memoryId2,
        linkType: MemoryLinkType.CONTRADICTS,
        strength: 0.75,
      });

      expect(link.strength).toBe(0.75);
    });
  });

  describe('findLinks', () => {
    it('should find all links for a memory', () => {
      linkRepo.createLink({
        sourceId: memoryId1,
        targetId: memoryId2,
        linkType: MemoryLinkType.RELATES_TO,
      });

      linkRepo.createLink({
        sourceId: memoryId3,
        targetId: memoryId1,
        linkType: MemoryLinkType.EXTENDS,
      });

      const links = linkRepo.findLinks(memoryId1);

      expect(links.length).toBe(2);
    });
  });

  describe('findLinkedMemoryIds', () => {
    it('should find linked memories up to specified depth', () => {
      // Create chain: 1 -> 2 -> 3
      linkRepo.createLink({
        sourceId: memoryId1,
        targetId: memoryId2,
        linkType: MemoryLinkType.RELATES_TO,
      });

      linkRepo.createLink({
        sourceId: memoryId2,
        targetId: memoryId3,
        linkType: MemoryLinkType.RELATES_TO,
      });

      // Depth 1 should only find memory 2
      const depth1 = linkRepo.findLinkedMemoryIds(memoryId1, 1);
      expect(depth1.length).toBe(1);
      expect(depth1[0]!.memoryId).toBe(memoryId2);

      // Depth 2 should find both memory 2 and 3
      const depth2 = linkRepo.findLinkedMemoryIds(memoryId1, 2);
      expect(depth2.length).toBe(2);
    });

    it('should calculate link strength correctly for multi-hop', () => {
      linkRepo.createLink({
        sourceId: memoryId1,
        targetId: memoryId2,
        linkType: MemoryLinkType.RELATES_TO,
        strength: 0.8,
      });

      linkRepo.createLink({
        sourceId: memoryId2,
        targetId: memoryId3,
        linkType: MemoryLinkType.RELATES_TO,
        strength: 0.5,
      });

      const linked = linkRepo.findLinkedMemoryIds(memoryId1, 2);

      // memory2: distance 1, strength 0.8
      const mem2 = linked.find(l => l.memoryId === memoryId2);
      expect(mem2?.linkStrength).toBe(0.8);

      // memory3: distance 2, strength 0.8 * 0.5 = 0.4
      const mem3 = linked.find(l => l.memoryId === memoryId3);
      expect(mem3?.linkStrength).toBe(0.4);
    });
  });

  describe('deleteLink', () => {
    it('should delete a link', () => {
      const link = linkRepo.createLink({
        sourceId: memoryId1,
        targetId: memoryId2,
        linkType: MemoryLinkType.RELATES_TO,
      });

      const success = linkRepo.deleteLink(link.id);

      expect(success).toBe(true);
      expect(linkRepo.findLinks(memoryId1).length).toBe(0);
    });
  });

  describe('findContradictions', () => {
    it('should find contradiction links', () => {
      linkRepo.createLink({
        sourceId: memoryId1,
        targetId: memoryId2,
        linkType: MemoryLinkType.CONTRADICTS,
      });

      linkRepo.createLink({
        sourceId: memoryId1,
        targetId: memoryId3,
        linkType: MemoryLinkType.RELATES_TO,
      });

      const contradictions = linkRepo.findContradictions(PROJECT_ID);

      expect(contradictions.length).toBe(1);
      expect(contradictions[0]!.linkType).toBe('contradicts');
    });
  });

  describe('getLinkCount', () => {
    it('should count total links for a memory', () => {
      linkRepo.createLink({
        sourceId: memoryId1,
        targetId: memoryId2,
        linkType: MemoryLinkType.RELATES_TO,
      });

      linkRepo.createLink({
        sourceId: memoryId3,
        targetId: memoryId1,
        linkType: MemoryLinkType.EXTENDS,
      });

      expect(linkRepo.getLinkCount(memoryId1)).toBe(2);
    });
  });
});

// ============================================================================
// CheckpointRepository Tests
// ============================================================================

describe('CheckpointRepository', () => {
  let db: DatabaseConnection;
  let checkpointRepo: CheckpointRepository;

  beforeEach(() => {
    db = createTestDb();
    checkpointRepo = new CheckpointRepository(db);
  });

  afterEach(() => {
    db.close();
  });

  describe('saveCheckpoint', () => {
    it('should save a checkpoint', () => {
      const checkpoint = checkpointRepo.saveCheckpoint(PROJECT_ID, {
        taskId: 'auth-impl',
        phase: 'middleware',
        completedSteps: ['JWT setup', 'Token generation'],
        pendingSteps: ['Refresh flow', 'Error handling'],
        artifacts: ['src/auth/jwt.ts'],
      });

      expect(checkpoint.id).toBeDefined();
      expect(checkpoint.taskId).toBe('auth-impl');
      expect(checkpoint.phase).toBe('middleware');
      expect(checkpoint.completedSteps).toEqual(['JWT setup', 'Token generation']);
      expect(checkpoint.pendingSteps).toEqual(['Refresh flow', 'Error handling']);
      expect(checkpoint.artifacts).toEqual(['src/auth/jwt.ts']);
    });
  });

  describe('restoreCheckpoint', () => {
    it('should restore the latest checkpoint for a task', async () => {
      // Save multiple checkpoints with delay to ensure different timestamps (uses seconds)
      checkpointRepo.saveCheckpoint(PROJECT_ID, {
        taskId: 'auth-impl',
        phase: 'phase-1',
        completedSteps: ['step1'],
        pendingSteps: ['step2', 'step3'],
      });

      // Wait 1+ second to ensure different created_at timestamp (timestamp uses seconds)
      await new Promise(resolve => setTimeout(resolve, 1100));

      checkpointRepo.saveCheckpoint(PROJECT_ID, {
        taskId: 'auth-impl',
        phase: 'phase-2',
        completedSteps: ['step1', 'step2'],
        pendingSteps: ['step3'],
      });

      const restored = checkpointRepo.restoreCheckpoint(PROJECT_ID, 'auth-impl');

      expect(restored?.phase).toBe('phase-2');
      expect(restored?.completedSteps).toEqual(['step1', 'step2']);
    });

    it('should return null for non-existent task', () => {
      const restored = checkpointRepo.restoreCheckpoint(PROJECT_ID, 'non-existent');
      expect(restored).toBeNull();
    });
  });

  describe('listCheckpoints', () => {
    it('should list all checkpoints', () => {
      checkpointRepo.saveCheckpoint(PROJECT_ID, {
        taskId: 'task-1',
        phase: 'phase-1',
        completedSteps: [],
        pendingSteps: [],
      });

      checkpointRepo.saveCheckpoint(PROJECT_ID, {
        taskId: 'task-2',
        phase: 'phase-1',
        completedSteps: [],
        pendingSteps: [],
      });

      const checkpoints = checkpointRepo.listCheckpoints(PROJECT_ID);

      expect(checkpoints.length).toBe(2);
    });

    it('should filter by taskId', () => {
      checkpointRepo.saveCheckpoint(PROJECT_ID, {
        taskId: 'task-1',
        phase: 'phase-1',
        completedSteps: [],
        pendingSteps: [],
      });

      checkpointRepo.saveCheckpoint(PROJECT_ID, {
        taskId: 'task-2',
        phase: 'phase-1',
        completedSteps: [],
        pendingSteps: [],
      });

      const checkpoints = checkpointRepo.listCheckpoints(PROJECT_ID, { taskId: 'task-1' });

      expect(checkpoints.length).toBe(1);
      expect(checkpoints[0]!.taskId).toBe('task-1');
    });
  });

  describe('pruneCheckpoints', () => {
    it('should keep only recent checkpoints', () => {
      // Create 10 checkpoints for same task
      for (let i = 0; i < 10; i++) {
        checkpointRepo.saveCheckpoint(PROJECT_ID, {
          taskId: 'auth-impl',
          phase: `phase-${i}`,
          completedSteps: [],
          pendingSteps: [],
        });
      }

      const deleted = checkpointRepo.pruneCheckpoints(PROJECT_ID, 'auth-impl', 3);

      expect(deleted).toBe(7);
      expect(checkpointRepo.listCheckpoints(PROJECT_ID, { taskId: 'auth-impl' }).length).toBe(3);
    });
  });

  describe('getTasksWithCheckpoints', () => {
    it('should return unique task IDs', () => {
      checkpointRepo.saveCheckpoint(PROJECT_ID, {
        taskId: 'task-1',
        phase: 'phase-1',
        completedSteps: [],
        pendingSteps: [],
      });

      checkpointRepo.saveCheckpoint(PROJECT_ID, {
        taskId: 'task-1',
        phase: 'phase-2',
        completedSteps: [],
        pendingSteps: [],
      });

      checkpointRepo.saveCheckpoint(PROJECT_ID, {
        taskId: 'task-2',
        phase: 'phase-1',
        completedSteps: [],
        pendingSteps: [],
      });

      const taskIds = checkpointRepo.getTasksWithCheckpoints(PROJECT_ID);

      expect(taskIds.length).toBe(2);
      expect(taskIds).toContain('task-1');
      expect(taskIds).toContain('task-2');
    });
  });
});
