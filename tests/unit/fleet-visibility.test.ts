import { describe, it, expect } from 'vitest';
import {
  canReadMemory,
  filterByVisibility,
  buildVisibilityClause,
  type VisibilityFields,
} from '../../mcp/memory-server/src/fleet/visibility.js';

function fields(overrides: Partial<VisibilityFields> = {}): VisibilityFields {
  return {
    visibility: 'global',
    writerAgentId: null,
    writerTeamId: null,
    restrictedReaders: null,
    ...overrides,
  };
}

describe('canReadMemory (T11.4 fleet scopes)', () => {
  it('global is always readable, even by an anonymous reader', () => {
    expect(canReadMemory(fields({ visibility: 'global' }), {})).toBe(true);
    expect(canReadMemory(fields({ visibility: 'global' }), { agentId: 'someone-else' })).toBe(true);
  });

  it('agent_local is readable only by the exact writer agent', () => {
    const memory = fields({ visibility: 'agent_local', writerAgentId: 'agent-a' });
    expect(canReadMemory(memory, { agentId: 'agent-a' })).toBe(true);
    expect(canReadMemory(memory, { agentId: 'agent-b' })).toBe(false);
    expect(canReadMemory(memory, {})).toBe(false);
  });

  it('agent_local with no recorded writer is readable by nobody (fails closed)', () => {
    const memory = fields({ visibility: 'agent_local', writerAgentId: null });
    expect(canReadMemory(memory, { agentId: 'agent-a' })).toBe(false);
    expect(canReadMemory(memory, {})).toBe(false);
  });

  it('an anonymous reader never matches an anonymous owner', () => {
    // Both sides "no identity" must NOT be treated as a match — that would
    // let any reader without an agentId see every agent_local memory
    // written without one.
    const memory = fields({ visibility: 'agent_local', writerAgentId: null });
    expect(canReadMemory(memory, { agentId: undefined })).toBe(false);
  });

  it('team is readable only by readers on the same team', () => {
    const memory = fields({ visibility: 'team', writerTeamId: 'team-x' });
    expect(canReadMemory(memory, { teamId: 'team-x' })).toBe(true);
    expect(canReadMemory(memory, { teamId: 'team-y' })).toBe(false);
    expect(canReadMemory(memory, {})).toBe(false);
  });

  it('restricted is readable only by ids on the explicit allowlist', () => {
    const memory = fields({
      visibility: 'restricted',
      restrictedReaders: ['agent-a', 'agent-b'],
    });
    expect(canReadMemory(memory, { agentId: 'agent-a' })).toBe(true);
    expect(canReadMemory(memory, { agentId: 'agent-c' })).toBe(false);
    expect(canReadMemory(memory, {})).toBe(false);
  });

  it('restricted with no allowlist is readable by nobody', () => {
    const memory = fields({ visibility: 'restricted', restrictedReaders: null });
    expect(canReadMemory(memory, { agentId: 'agent-a' })).toBe(false);
  });

  it('fails closed on an unrecognized visibility value', () => {
    const memory = fields({ visibility: 'made_up_tier' as VisibilityFields['visibility'] });
    expect(canReadMemory(memory, { agentId: 'agent-a', teamId: 'team-x' })).toBe(false);
  });
});

describe('filterByVisibility', () => {
  it('keeps only readable items, preserving order', () => {
    const items = [
      fields({ visibility: 'global' }),
      fields({ visibility: 'agent_local', writerAgentId: 'agent-a' }),
      fields({ visibility: 'agent_local', writerAgentId: 'agent-b' }),
      fields({ visibility: 'team', writerTeamId: 'team-x' }),
    ];

    const result = filterByVisibility(items, { agentId: 'agent-a', teamId: 'team-x' });

    expect(result).toHaveLength(3);
    expect(result).toEqual([items[0], items[1], items[3]]);
  });
});

describe('buildVisibilityClause', () => {
  it('an anonymous reader only gets the global clause and no params', () => {
    const { sql, params } = buildVisibilityClause({});
    expect(sql).toBe("(visibility = 'global')");
    expect(params).toEqual([]);
  });

  it('a reader with only an agentId gets global + agent_local + restricted clauses', () => {
    const { sql, params } = buildVisibilityClause({ agentId: 'agent-a' });
    expect(sql).toContain("visibility = 'agent_local' AND writer_agent_id = ?");
    expect(sql).toContain("visibility = 'restricted' AND restricted_readers LIKE ?");
    expect(sql).not.toContain("visibility = 'team'");
    expect(params).toEqual(['agent-a', '%"agent-a"%']);
  });

  it('a reader with only a teamId gets global + team clauses', () => {
    const { sql, params } = buildVisibilityClause({ teamId: 'team-x' });
    expect(sql).toContain("visibility = 'team' AND writer_team_id = ?");
    expect(sql).not.toContain('agent_local');
    expect(params).toEqual(['team-x']);
  });

  it('honors a table alias', () => {
    const { sql } = buildVisibilityClause({ agentId: 'agent-a' }, 'm');
    expect(sql).toContain('m.visibility');
    expect(sql).toContain('m.writer_agent_id');
    expect(sql).toContain('m.restricted_readers');
  });
});
