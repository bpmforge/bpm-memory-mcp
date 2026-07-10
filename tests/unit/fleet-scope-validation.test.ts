import { describe, it, expect } from 'vitest';
import { MemoryStoreInputSchema, FactStoreInputSchema } from '../../mcp/memory-server/src/types.js';

describe('MemoryStoreInputSchema — fleet scope validation (T11.4)', () => {
  it('accepts input with no visibility at all (pre-T11.4 shape)', () => {
    const result = MemoryStoreInputSchema.safeParse({ content: 'plain memory' });
    expect(result.success).toBe(true);
  });

  it('accepts agent_local with no provenance (only team+ requires it)', () => {
    const result = MemoryStoreInputSchema.safeParse({
      content: 'scratch note',
      visibility: 'agent_local',
      writerAgentId: 'agent-1',
    });
    expect(result.success).toBe(true);
  });

  it('rejects team visibility without writerTeamId', () => {
    const result = MemoryStoreInputSchema.safeParse({
      content: 'team note',
      visibility: 'team',
      writerAgentId: 'agent-1',
      provenance: 'because',
    });
    expect(result.success).toBe(false);
  });

  it('rejects restricted visibility without restrictedReaders', () => {
    const result = MemoryStoreInputSchema.safeParse({
      content: 'need to know',
      visibility: 'restricted',
      writerAgentId: 'agent-1',
      provenance: 'because',
    });
    expect(result.success).toBe(false);
  });

  it('rejects restricted visibility with an empty restrictedReaders array', () => {
    const result = MemoryStoreInputSchema.safeParse({
      content: 'need to know',
      visibility: 'restricted',
      writerAgentId: 'agent-1',
      provenance: 'because',
      restrictedReaders: [],
    });
    expect(result.success).toBe(false);
  });

  it('accepts a fully-specified team memory', () => {
    const result = MemoryStoreInputSchema.safeParse({
      content: 'team note',
      visibility: 'team',
      writerAgentId: 'agent-1',
      writerTeamId: 'team-a',
      provenance: 'runbook sync',
    });
    expect(result.success).toBe(true);
  });

  it('accepts a fully-specified restricted memory', () => {
    const result = MemoryStoreInputSchema.safeParse({
      content: 'need to know',
      visibility: 'restricted',
      writerAgentId: 'agent-1',
      provenance: 'need-to-know',
      restrictedReaders: ['agent-a'],
    });
    expect(result.success).toBe(true);
  });

  it('rejects an unrecognized visibility value', () => {
    const result = MemoryStoreInputSchema.safeParse({
      content: 'x',
      visibility: 'super_admin',
    });
    expect(result.success).toBe(false);
  });
});

describe('FactStoreInputSchema — fleet scope validation (T11.4)', () => {
  const baseFact = {
    claim: 'the sky is blue',
    directQuote: 'the sky is blue',
    sourceUrl: 'https://example.com/sky',
    sourceTitle: 'Sky facts',
  };

  it('rejects team visibility without writerTeamId', () => {
    const result = FactStoreInputSchema.safeParse({
      ...baseFact,
      visibility: 'team',
      writerAgentId: 'agent-1',
      provenance: 'because',
    });
    expect(result.success).toBe(false);
  });

  it('accepts a fully-specified restricted fact', () => {
    const result = FactStoreInputSchema.safeParse({
      ...baseFact,
      visibility: 'restricted',
      writerAgentId: 'agent-1',
      provenance: 'need-to-know',
      restrictedReaders: ['agent-a'],
    });
    expect(result.success).toBe(true);
  });
});
