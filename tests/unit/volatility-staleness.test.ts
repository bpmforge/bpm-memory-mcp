import { describe, it, expect } from 'vitest';
import {
  volatilityMultiplier,
  applyVolatilityStaleness,
} from '../../mcp/memory-server/src/search/volatility-staleness.js';
import type { Memory, MemorySearchResult, Volatility } from '../../mcp/memory-server/src/types.js';

const DAY_MS = 24 * 60 * 60 * 1000;
const NOW = new Date('2026-07-10T00:00:00Z');

function daysAgo(days: number): Date {
  return new Date(NOW.getTime() - days * DAY_MS);
}

function createMockMemory(
  id: string,
  options: {
    volatility?: Volatility;
    verifiedAt?: Date | null;
    createdAt?: Date;
  } = {}
): Memory {
  return {
    id,
    content: `Content for ${id}`,
    embedding: null,
    type: 'fact',
    confidence: 1.0,
    citation: null,
    projectId: 'test-project',
    contentHash: `hash-${id}`,
    createdAt: options.createdAt ?? NOW,
    accessedAt: NOW,
    accessCount: 0,
    deletedAt: null,
    deleteReason: null,
    volatility: options.volatility ?? 'slow',
    verifiedAt: options.verifiedAt ?? null,
  } as Memory;
}

function createResult(memory: Memory, relevance: number): MemorySearchResult {
  return { memory, relevance };
}

const ALL_CLASSES: Volatility[] = ['static', 'slow', 'volatile'];
const AGES_DAYS = [0, 1, 5, 7, 15, 29, 29.9, 30, 30.1, 45, 90, 180, 181, 365, 1000];

describe('volatilityMultiplier', () => {
  describe('property: bounded and monotonic non-increasing with age', () => {
    for (const volatility of ALL_CLASSES) {
      it(`stays within [0,1] and never increases as ${volatility} ages, for any verifiedAt reference`, () => {
        let previous = 1;
        for (const age of AGES_DAYS) {
          const memory = createMockMemory('m', { volatility, verifiedAt: daysAgo(age) });
          const score = volatilityMultiplier(memory, NOW);

          expect(score).toBeGreaterThanOrEqual(0);
          expect(score).toBeLessThanOrEqual(1);
          expect(score).toBeLessThanOrEqual(previous + 1e-9);
          previous = score;
        }
      });
    }
  });

  describe('static class', () => {
    it('never decays regardless of age', () => {
      for (const age of AGES_DAYS) {
        const memory = createMockMemory('m', { volatility: 'static', verifiedAt: daysAgo(age) });
        expect(volatilityMultiplier(memory, NOW)).toBe(1);
      }
    });

    it('never decays even when never verified and very old', () => {
      const memory = createMockMemory('m', { volatility: 'static', createdAt: daysAgo(5000) });
      expect(volatilityMultiplier(memory, NOW)).toBe(1);
    });
  });

  describe('slow class', () => {
    it('floors at 0.5, never reaching 0', () => {
      const memory = createMockMemory('m', { volatility: 'slow', verifiedAt: daysAgo(10000) });
      expect(volatilityMultiplier(memory, NOW)).toBe(0.5);
    });

    it('is ~1 immediately after verification', () => {
      const memory = createMockMemory('m', { volatility: 'slow', verifiedAt: daysAgo(0) });
      expect(volatilityMultiplier(memory, NOW)).toBe(1);
    });

    it('is roughly midway between 1 and the floor at half the decay window', () => {
      const memory = createMockMemory('m', { volatility: 'slow', verifiedAt: daysAgo(90) });
      expect(volatilityMultiplier(memory, NOW)).toBeCloseTo(0.75, 5);
    });
  });

  describe('volatile class — VOLATILE unverified >30d ≈ 0 (acceptance criterion)', () => {
    it('is ~1 immediately after verification', () => {
      const memory = createMockMemory('m', { volatility: 'volatile', verifiedAt: daysAgo(0) });
      expect(volatilityMultiplier(memory, NOW)).toBe(1);
    });

    it('is exactly 0 at 30 days unverified', () => {
      const memory = createMockMemory('m', { volatility: 'volatile', verifiedAt: daysAgo(30) });
      expect(volatilityMultiplier(memory, NOW)).toBe(0);
    });

    it('is exactly 0 well past 30 days unverified', () => {
      const memory = createMockMemory('m', { volatility: 'volatile', verifiedAt: daysAgo(1000) });
      expect(volatilityMultiplier(memory, NOW)).toBe(0);
    });

    it('is small but nonzero just under 30 days', () => {
      const memory = createMockMemory('m', { volatility: 'volatile', verifiedAt: daysAgo(29.9) });
      const score = volatilityMultiplier(memory, NOW);
      expect(score).toBeGreaterThan(0);
      expect(score).toBeLessThan(0.01);
    });
  });

  describe('NULL verifiedAt falls back to createdAt', () => {
    it('a never-verified memory created today scores ~1 regardless of volatility', () => {
      for (const volatility of ALL_CLASSES) {
        const memory = createMockMemory('m', { volatility, createdAt: NOW, verifiedAt: null });
        expect(volatilityMultiplier(memory, NOW)).toBe(1);
      }
    });

    it('a never-verified volatile memory created 31 days ago is ~0', () => {
      const memory = createMockMemory('m', {
        volatility: 'volatile',
        createdAt: daysAgo(31),
        verifiedAt: null,
      });
      expect(volatilityMultiplier(memory, NOW)).toBe(0);
    });

    it('recent verification resets the clock even for an old memory', () => {
      const memory = createMockMemory('m', {
        volatility: 'volatile',
        createdAt: daysAgo(400),
        verifiedAt: daysAgo(1),
      });
      const score = volatilityMultiplier(memory, NOW);
      expect(score).toBeGreaterThan(0.9);
    });
  });

  it('defaults to the slow window if volatility is missing on the row (defensive)', () => {
    const memory = createMockMemory('m', { verifiedAt: daysAgo(10000) });
    // @ts-expect-error — simulating a row missing the (NOT NULL) column
    memory.volatility = undefined;
    expect(volatilityMultiplier(memory, NOW)).toBe(0.5);
  });
});

describe('applyVolatilityStaleness', () => {
  it('displaces a staled-out volatile memory below a fresh static memory of equal base relevance', () => {
    const stale = createResult(
      createMockMemory('stale-volatile', { volatility: 'volatile', verifiedAt: daysAgo(60) }),
      0.9
    );
    const fresh = createResult(
      createMockMemory('fresh-static', { volatility: 'static', verifiedAt: daysAgo(400) }),
      0.5
    );

    // Before staleness scaling, `stale` ranks first on raw relevance.
    const results = applyVolatilityStaleness([stale, fresh], NOW);

    expect(results[0]!.memory.id).toBe('fresh-static');
    expect(results[1]!.memory.id).toBe('stale-volatile');
    expect(results[1]!.relevance).toBe(0);
  });

  it('preserves order and scores when nothing has decayed', () => {
    const a = createResult(createMockMemory('a', { volatility: 'static' }), 0.9);
    const b = createResult(createMockMemory('b', { volatility: 'static' }), 0.5);

    const results = applyVolatilityStaleness([b, a], NOW);

    expect(results.map((r) => r.memory.id)).toEqual(['a', 'b']);
    expect(results[0]!.relevance).toBe(0.9);
  });

  it('handles an empty result set', () => {
    expect(applyVolatilityStaleness([], NOW)).toEqual([]);
  });
});
