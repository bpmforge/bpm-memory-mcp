import { describe, it, expect, afterEach } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  appendConsolidationLog,
  DEFAULT_CONSOLIDATION_LOG_PATH,
} from '../../mcp/memory-server/src/consolidation/run-log.js';
import type { SchedulerOutcome } from '../../mcp/memory-server/src/consolidation/scheduler.js';

describe('appendConsolidationLog', () => {
  let dir: string;
  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  it('creates the log directory and appends one JSON line', () => {
    dir = mkdtempSync(join(tmpdir(), 'consolidation-log-'));
    const logPath = join(dir, 'nested', 'consolidation.log');
    const outcome: SchedulerOutcome = {
      ran: true,
      reason: 'ok',
      summariesPersisted: 2,
      merged: 1,
      decayed: 0,
    };

    appendConsolidationLog(logPath, 'proj-a', outcome, 1_000);

    expect(existsSync(logPath)).toBe(true);
    const lines = readFileSync(logPath, 'utf8').trim().split('\n');
    expect(lines).toHaveLength(1);
    const entry = JSON.parse(lines[0]!);
    expect(entry).toMatchObject({
      projectId: 'proj-a',
      ran: true,
      reason: 'ok',
      summariesPersisted: 2,
      merged: 1,
      decayed: 0,
    });
    expect(entry.ts).toBe(new Date(1_000).toISOString());
  });

  it('appends across multiple calls (JSONL, not overwrite)', () => {
    dir = mkdtempSync(join(tmpdir(), 'consolidation-log-'));
    const logPath = join(dir, 'consolidation.log');
    const outcome: SchedulerOutcome = {
      ran: true,
      reason: 'ok',
      summariesPersisted: 0,
      merged: 0,
      decayed: 0,
    };

    appendConsolidationLog(logPath, 'proj-a', outcome, 1_000);
    appendConsolidationLog(logPath, 'proj-a', outcome, 2_000);
    appendConsolidationLog(logPath, 'proj-a', outcome, 3_000);

    const lines = readFileSync(logPath, 'utf8').trim().split('\n');
    expect(lines).toHaveLength(3);
    expect(lines.map((l) => JSON.parse(l).ts)).toEqual([
      new Date(1_000).toISOString(),
      new Date(2_000).toISOString(),
      new Date(3_000).toISOString(),
    ]);
  });

  it('includes detail for error outcomes', () => {
    dir = mkdtempSync(join(tmpdir(), 'consolidation-log-'));
    const logPath = join(dir, 'consolidation.log');
    const outcome: SchedulerOutcome = { ran: false, reason: 'error', detail: 'boom' };

    appendConsolidationLog(logPath, 'proj-a', outcome, 5_000);

    const entry = JSON.parse(readFileSync(logPath, 'utf8').trim());
    expect(entry).toMatchObject({ ran: false, reason: 'error', detail: 'boom' });
  });

  it('never throws even if the path is unwritable', () => {
    const outcome: SchedulerOutcome = { ran: true, reason: 'ok' };
    // A path nested under a file (not a directory) cannot be mkdir'd into.
    dir = mkdtempSync(join(tmpdir(), 'consolidation-log-'));
    const blocker = join(dir, 'blocker');
    writeFileSync(blocker, 'x');
    const badPath = join(blocker, 'consolidation.log');

    expect(() => appendConsolidationLog(badPath, 'proj-a', outcome, 1_000)).not.toThrow();
  });

  it('DEFAULT_CONSOLIDATION_LOG_PATH lives under ~/.claude-memory/logs', () => {
    expect(DEFAULT_CONSOLIDATION_LOG_PATH).toMatch(
      /\.claude-memory[\\/]logs[\\/]consolidation\.log$/
    );
  });
});
