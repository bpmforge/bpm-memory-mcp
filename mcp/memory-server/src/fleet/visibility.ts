import type { MemoryVisibility } from '../types.js';

/**
 * Who is asking. Resolved by callers from explicit tool args or the
 * MEMORY_AGENT_ID / MEMORY_TEAM_ID env vars (see index.ts).
 */
export interface ReaderContext {
  agentId?: string | undefined;
  teamId?: string | undefined;
}

/**
 * The subset of a Memory row needed to decide readability. Kept narrow so
 * this module has no dependency on the full Memory shape.
 */
export interface VisibilityFields {
  visibility: MemoryVisibility;
  writerAgentId: string | null;
  writerTeamId: string | null;
  restrictedReaders: string[] | null;
}

/**
 * T11.4 fleet-scope enforcement. 'global' is always readable (the pre-T11.4
 * default — every existing memory and every memory written without an
 * explicit visibility opt-in). Every other tier fails closed: a memory with
 * no recorded owner (writerAgentId/writerTeamId null, e.g. a malformed or
 * legacy row) is readable by nobody, not by a reader who also lacks
 * identity — an unidentified reader must never be treated as a match.
 */
export function canReadMemory(fields: VisibilityFields, reader: ReaderContext): boolean {
  switch (fields.visibility) {
    case 'global':
      return true;
    case 'agent_local':
      return !!fields.writerAgentId && !!reader.agentId && fields.writerAgentId === reader.agentId;
    case 'team':
      return !!fields.writerTeamId && !!reader.teamId && fields.writerTeamId === reader.teamId;
    case 'restricted':
      return !!reader.agentId && !!fields.restrictedReaders?.includes(reader.agentId);
    default:
      return false; // fail closed on any unrecognized tier
  }
}

export function filterByVisibility<T extends VisibilityFields>(
  items: T[],
  reader: ReaderContext
): T[] {
  return items.filter((item) => canReadMemory(item, reader));
}

/**
 * SQL WHERE fragment (with matching bound params) implementing the same
 * rule as canReadMemory, for pushing the filter into bulk queries — mirrors
 * quarantine's includeQuarantined SQL-level filter (T11.3). Only emits the
 * agent_local/team/restricted branches the reader could possibly satisfy,
 * so a fully anonymous reader (no agentId, no teamId) gets a plain
 * `visibility = 'global'` clause.
 *
 * restrictedReaders is stored as a JSON array string; membership is tested
 * with a parameterized substring match on the quoted id, which is correct
 * for the plain alphanumeric/hyphen agent ids this system issues.
 */
export function buildVisibilityClause(
  reader: ReaderContext,
  tableAlias = ''
): { sql: string; params: unknown[] } {
  const col = (name: string) => (tableAlias ? `${tableAlias}.${name}` : name);
  const clauses = [`${col('visibility')} = 'global'`];
  const params: unknown[] = [];

  if (reader.agentId) {
    clauses.push(`(${col('visibility')} = 'agent_local' AND ${col('writer_agent_id')} = ?)`);
    params.push(reader.agentId);
  }
  if (reader.teamId) {
    clauses.push(`(${col('visibility')} = 'team' AND ${col('writer_team_id')} = ?)`);
    params.push(reader.teamId);
  }
  if (reader.agentId) {
    clauses.push(`(${col('visibility')} = 'restricted' AND ${col('restricted_readers')} LIKE ?)`);
    params.push(`%"${reader.agentId}"%`);
  }

  return { sql: `(${clauses.join(' OR ')})`, params };
}
