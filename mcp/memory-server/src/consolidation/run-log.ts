/**
 * Append-only run log for sleep-time consolidation (T2.1).
 *
 * One JSON line per *attempted* scheduler run (outcome 'ok' or 'error' — not
 * 'disabled'/'throttled', which never touched the database) so an operator
 * can verify the "N consecutive daily runs" acceptance bar from disk without
 * a DB query.
 */

import { appendFileSync, mkdirSync } from 'fs';
import { dirname, join } from 'path';
import { homedir } from 'os';
import type { SchedulerOutcome } from './scheduler.js';

/** Default location, mirroring the `~/.claude-memory` convention used for the
 *  memory databases themselves (see storage/database.ts). Overridable via
 *  `CLAUDE_MEMORY_CONSOLIDATION_LOG_PATH` (see scheduler.ts `fromEnv`). */
export const DEFAULT_CONSOLIDATION_LOG_PATH = join(
  homedir(),
  '.claude-memory',
  'logs',
  'consolidation.log'
);

export interface ConsolidationLogEntry {
  ts: string;
  projectId: string;
  ran: boolean;
  reason: SchedulerOutcome['reason'];
  summariesPersisted: number;
  merged: number;
  decayed: number;
  detail?: string;
}

/**
 * Append one JSONL summary line to `logPath`. Best-effort: a logging failure
 * must never break the caller (mirrors `maybeRun()`'s never-throws contract).
 */
export function appendConsolidationLog(
  logPath: string,
  projectId: string,
  outcome: SchedulerOutcome,
  atMs: number
): void {
  try {
    mkdirSync(dirname(logPath), { recursive: true });
    const entry: ConsolidationLogEntry = {
      ts: new Date(atMs).toISOString(),
      projectId,
      ran: outcome.ran,
      reason: outcome.reason,
      summariesPersisted: outcome.summariesPersisted ?? 0,
      merged: outcome.merged ?? 0,
      decayed: outcome.decayed ?? 0,
      ...(outcome.detail !== undefined ? { detail: outcome.detail } : {}),
    };
    appendFileSync(logPath, JSON.stringify(entry) + '\n');
  } catch {
    // Best-effort — see contract above.
  }
}
