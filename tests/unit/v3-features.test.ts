import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { rrfFusionWithLinks } from '../../mcp/memory-server/src/search/rrf.js';
import { calculateLinkDensityScore, rerankWithLinkDensity } from '../../mcp/memory-server/src/search/rerank.js';
import { calculateDriftIndicator, isContextRelevantToGoal } from '../../mcp/memory-server/src/goals/drift.js';
import type { Memory, MemorySearchResult, GoalState, GoalStatus } from '../../mcp/memory-server/src/types.js';

// ============================================================================
// Test Helpers
// ============================================================================

function createMockMemory(id: string, overrides: Partial<Memory> = {}): Memory {
  return {
    id,
    content: `Content for ${id}`,
    embedding: null,
    type: 'fact',
    confidence: 1.0,
    citation: null,
    projectId: 'test-project',
    contentHash: `hash-${id}`,
    createdAt: new Date(),
    accessedAt: new Date(),
    accessCount: 0,
    deletedAt: null,
    deleteReason: null,
    language: null,
    codeContext: null,
    version: 1,
    supersedesId: null,
    supersededBy: null,
    supersededAt: null,
    flaggedAt: null,
    flaggedReason: null,
    embeddingModel: null,
    goalStatus: null,
    goalPriority: null,
    parentGoalId: null,
    checkpointData: null,
    ...overrides,
  };
}

function createResult(id: string, relevance: number = 0.5): MemorySearchResult {
  return {
    memory: createMockMemory(id),
    relevance,
  };
}

function createMockGoal(id: string, content: string, priority: number = 3): GoalState {
  return {
    id,
    content,
    priority,
    status: 'active' as GoalStatus,
    progressNotes: [],
    createdAt: new Date(),
  };
}

// ============================================================================
// Three-Way RRF Fusion Tests
// ============================================================================

describe('rrfFusionWithLinks', () => {
  it('should combine vector, BM25, and link results', () => {
    const vectorResults: MemorySearchResult[] = [
      createResult('a', 0.9),
      createResult('b', 0.8),
    ];

    const bm25Results: MemorySearchResult[] = [
      createResult('b', 0.85),
      createResult('c', 0.7),
    ];

    const linkResults: MemorySearchResult[] = [
      createResult('c', 0.95),
      createResult('d', 0.6),
    ];

    const fused = rrfFusionWithLinks(vectorResults, bm25Results, linkResults);

    // All unique IDs should be present
    const ids = fused.map((r) => r.memory.id);
    expect(ids).toContain('a');
    expect(ids).toContain('b');
    expect(ids).toContain('c');
    expect(ids).toContain('d');
  });

  it('should rank items appearing in all three lists highest', () => {
    const vectorResults: MemorySearchResult[] = [
      createResult('a', 0.9),
      createResult('b', 0.8),
    ];

    const bm25Results: MemorySearchResult[] = [
      createResult('a', 0.85),
      createResult('c', 0.7),
    ];

    const linkResults: MemorySearchResult[] = [
      createResult('a', 0.95),
      createResult('d', 0.6),
    ];

    const fused = rrfFusionWithLinks(vectorResults, bm25Results, linkResults);

    // 'a' appears in all three, should be ranked highest
    expect(fused[0]!.memory.id).toBe('a');
  });

  it('should use default weights of 0.35, 0.35, 0.30', () => {
    const vectorResults: MemorySearchResult[] = [createResult('a')];
    const bm25Results: MemorySearchResult[] = [createResult('b')];
    const linkResults: MemorySearchResult[] = [createResult('c')];

    const fused = rrfFusionWithLinks(vectorResults, bm25Results, linkResults);

    // With equal ranks (all at position 1), scores should reflect weights
    // vector: 0.35 / (60 + 1) = 0.00574
    // bm25: 0.35 / (60 + 1) = 0.00574
    // link: 0.30 / (60 + 1) = 0.00492
    expect(fused[0]!.relevance).toBeGreaterThanOrEqual(fused[1]!.relevance);
    expect(fused[1]!.relevance).toBeGreaterThanOrEqual(fused[2]!.relevance);
  });

  it('should respect custom weights', () => {
    const vectorResults: MemorySearchResult[] = [createResult('v')];
    const bm25Results: MemorySearchResult[] = [createResult('b')];
    const linkResults: MemorySearchResult[] = [createResult('l')];

    // Heavily weight links
    const fused = rrfFusionWithLinks(vectorResults, bm25Results, linkResults, {
      vectorWeight: 0.1,
      bm25Weight: 0.1,
      linkWeight: 0.8,
    });

    // Link result should be ranked highest
    expect(fused[0]!.memory.id).toBe('l');
  });

  it('should respect limit parameter', () => {
    const vectorResults: MemorySearchResult[] = [];
    const bm25Results: MemorySearchResult[] = [];
    const linkResults: MemorySearchResult[] = [];

    for (let i = 0; i < 20; i++) {
      vectorResults.push(createResult(`v${i}`));
      bm25Results.push(createResult(`b${i}`));
      linkResults.push(createResult(`l${i}`));
    }

    const fused = rrfFusionWithLinks(vectorResults, bm25Results, linkResults, { limit: 5 });

    expect(fused.length).toBe(5);
  });

  it('should handle empty link results gracefully', () => {
    const vectorResults: MemorySearchResult[] = [createResult('a')];
    const bm25Results: MemorySearchResult[] = [createResult('b')];

    const fused = rrfFusionWithLinks(vectorResults, bm25Results, []);

    expect(fused.length).toBe(2);
  });
});

// ============================================================================
// Link Density Scoring Tests
// ============================================================================

describe('calculateLinkDensityScore', () => {
  it('should return 0 for memories with no links', () => {
    const linkCountMap = new Map<string, number>();
    linkCountMap.set('other', 5);

    const score = calculateLinkDensityScore('memory-1', linkCountMap);
    expect(score).toBe(0);
  });

  it('should return normalized score based on link count', () => {
    const linkCountMap = new Map<string, number>();
    linkCountMap.set('memory-1', 3);

    const score = calculateLinkDensityScore('memory-1', linkCountMap);
    // 3/5 = 0.6
    expect(score).toBe(0.6);
  });

  it('should cap score at 1.0 for 5+ links', () => {
    const linkCountMap = new Map<string, number>();
    linkCountMap.set('memory-1', 10);

    const score = calculateLinkDensityScore('memory-1', linkCountMap);
    expect(score).toBe(1);
  });
});

describe('rerankWithLinkDensity', () => {
  it('should boost results with higher link density', () => {
    const results: MemorySearchResult[] = [
      { memory: createMockMemory('low-links'), relevance: 0.5 },
      { memory: createMockMemory('high-links'), relevance: 0.49 }, // Close in base relevance
    ];

    const linkCountMap = new Map<string, number>();
    linkCountMap.set('low-links', 0);
    linkCountMap.set('high-links', 5); // Max links = max boost

    const reranked = rerankWithLinkDensity(results, linkCountMap, { linkDensityWeight: 0.2 });

    // high-links should now be ranked higher due to link boost
    // low-links: 0.5 * (1 + 0 * 0.2) = 0.5
    // high-links: 0.49 * (1 + 1 * 0.2) = 0.588
    expect(reranked[0]!.memory.id).toBe('high-links');
  });

  it('should respect linkDensityWeight option', () => {
    const results: MemorySearchResult[] = [
      { memory: createMockMemory('a'), relevance: 1.0 },
      { memory: createMockMemory('b'), relevance: 0.5 },
    ];

    const linkCountMap = new Map<string, number>();
    linkCountMap.set('a', 0);
    linkCountMap.set('b', 5); // max links

    // With low weight, original order should be preserved
    // a: 1.0 * (1 + 0 * 0.01) = 1.0
    // b: 0.5 * (1 + 1 * 0.01) = 0.505
    const lowWeight = rerankWithLinkDensity(results, linkCountMap, { linkDensityWeight: 0.01 });
    expect(lowWeight[0]!.memory.id).toBe('a');

    // With very high weight, b should be boosted significantly
    // a: 1.0 * (1 + 0 * 2.0) = 1.0
    // b: 0.5 * (1 + 1 * 2.0) = 1.5
    const highWeight = rerankWithLinkDensity(results, linkCountMap, { linkDensityWeight: 2.0 });
    expect(highWeight[0]!.memory.id).toBe('b');
  });
});

// ============================================================================
// Drift Detection Tests
// ============================================================================

describe('calculateDriftIndicator', () => {
  it('should return 0 for no active goals', () => {
    const result = calculateDriftIndicator([], 'any context', 0);

    expect(result.indicator).toBe(0);
    expect(result.isWarning).toBe(false);
    expect(result.activeGoalCount).toBe(0);
  });

  it('should return lower drift for relevant context than irrelevant', () => {
    const goals = [
      createMockGoal('1', 'Implement user authentication with JWT tokens'),
    ];

    // Context matches goal keywords
    const relevantResult = calculateDriftIndicator(
      goals,
      'Working on JWT authentication for users token implementation',
      0
    );

    // Context doesn't match
    const irrelevantResult = calculateDriftIndicator(
      goals,
      'Database schema optimization for reports',
      0
    );

    // Relevant context should have lower drift than irrelevant
    expect(relevantResult.indicator).toBeLessThan(irrelevantResult.indicator);
    expect(relevantResult.isWarning).toBe(false);
  });

  it('should return high drift for irrelevant context', () => {
    const goals = [
      createMockGoal('1', 'Implement user authentication with JWT tokens'),
    ];

    // Context is completely unrelated
    const result = calculateDriftIndicator(
      goals,
      'Refactoring database schema for product catalog',
      1800 // 30 minutes since last activity
    );

    expect(result.indicator).toBeGreaterThan(0.5);
  });

  it('should trigger warning when drift exceeds 0.7', () => {
    const goals = [
      createMockGoal('1', 'Fix critical security vulnerability'),
    ];

    const result = calculateDriftIndicator(
      goals,
      'Adding new UI animations and transitions',
      3600 // 1 hour since last activity
    );

    expect(result.isWarning).toBe(result.indicator > 0.7);
  });

  it('should include top goals in result', () => {
    const goals = [
      createMockGoal('1', 'High priority goal', 1),
      createMockGoal('2', 'Medium priority goal', 3),
      createMockGoal('3', 'Low priority goal', 5),
    ];

    const result = calculateDriftIndicator(goals, 'some context', 0);

    expect(result.topGoals.length).toBeLessThanOrEqual(3);
    expect(result.topGoals[0]!.priority).toBe(1);
  });

  it('should factor in time since last goal activity', () => {
    const goals = [createMockGoal('1', 'Test goal')];

    // No time passed
    const recent = calculateDriftIndicator(goals, 'unrelated context', 0);

    // 30 minutes passed
    const old = calculateDriftIndicator(goals, 'unrelated context', 30 * 60);

    // More time should increase drift
    expect(old.indicator).toBeGreaterThan(recent.indicator);
  });
});

describe('isContextRelevantToGoal', () => {
  it('should return true for matching context with shared keywords', () => {
    // Need substantial keyword overlap (>20% Jaccard similarity)
    const goal = createMockGoal('1', 'authentication user login');

    const relevant = isContextRelevantToGoal(
      'implementing user authentication login flow',
      goal
    );

    expect(relevant).toBe(true);
  });

  it('should return false for unrelated context', () => {
    const goal = createMockGoal('1', 'authentication user login session');

    const relevant = isContextRelevantToGoal(
      'database schema optimization queries reports',
      goal
    );

    expect(relevant).toBe(false);
  });
});

// ============================================================================
// Memory Type Tests
// ============================================================================

describe('V3 Memory Types', () => {
  it('should support goal memory type', () => {
    const goalMemory = createMockMemory('goal-1', {
      type: 'goal',
      goalStatus: 'active',
      goalPriority: 1,
    });

    expect(goalMemory.type).toBe('goal');
    expect(goalMemory.goalStatus).toBe('active');
    expect(goalMemory.goalPriority).toBe(1);
  });

  it('should support checkpoint memory type', () => {
    const checkpointMemory = createMockMemory('checkpoint-1', {
      type: 'checkpoint',
      checkpointData: {
        id: 'checkpoint-1',
        taskId: 'task-123',
        phase: 'implementation',
        completedSteps: ['step1', 'step2'],
        pendingSteps: ['step3'],
        artifacts: ['file.ts'],
        createdAt: new Date(),
      },
    });

    expect(checkpointMemory.type).toBe('checkpoint');
    expect(checkpointMemory.checkpointData?.taskId).toBe('task-123');
    expect(checkpointMemory.checkpointData?.completedSteps.length).toBe(2);
  });
});
