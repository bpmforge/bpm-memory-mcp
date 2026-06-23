/**
 * Sleep-time consolidation scheduler (B1 slice 3)
 *
 * Runs memory consolidation autonomously at a natural "sleep" boundary
 * (session_save) so memory maintains itself without a manual tool call — the
 * sleep-time-compute lever from the bridging-the-frontier-gap research.
 *
 * Two guards keep it safe:
 *  - OFF by default (opt-in via CLAUDE_MEMORY_SLEEP_CONSOLIDATION=true).
 *  - Throttled to at most once per project per interval, persisted in
 *    `consolidation_runs` so it survives process restarts.
 *
 * maybeRun() never throws: a failed consolidation must never break session_save.
 */

import type Database from 'better-sqlite3';
import { ConsolidationService, type ConsolidationOptions } from './index.js';

export interface SchedulerConfig {
  /** Master switch. Default false (opt-in). */
  enabled: boolean;
  /** Minimum gap between autonomous runs for a project, in ms. */
  intervalMs: number;
  /** Options passed to consolidate() when a run fires. */
  options: ConsolidationOptions;
}

export interface SchedulerOutcome {
  ran: boolean;
  reason: 'disabled' | 'throttled' | 'ok' | 'error';
  detail?: string;
  summariesPersisted?: number;
  merged?: number;
  decayed?: number;
}

const DEFAULT_INTERVAL_HOURS = 24;

export class ConsolidationScheduler {
  constructor(
    private db: Database.Database,
    private config: SchedulerConfig
  ) {}

  /**
   * Build a scheduler from environment configuration.
   * - CLAUDE_MEMORY_SLEEP_CONSOLIDATION=true enables it (default off)
   * - CLAUDE_MEMORY_CONSOLIDATION_INTERVAL_HOURS sets the throttle (default 24)
   */
  static fromEnv(db: Database.Database): ConsolidationScheduler {
    const enabled = process.env.CLAUDE_MEMORY_SLEEP_CONSOLIDATION === 'true';
    const rawHours = Number(process.env.CLAUDE_MEMORY_CONSOLIDATION_INTERVAL_HOURS);
    const hours = Number.isFinite(rawHours) && rawHours > 0 ? rawHours : DEFAULT_INTERVAL_HOURS;
    return new ConsolidationScheduler(db, {
      enabled,
      intervalMs: hours * 60 * 60 * 1000,
      // Conservative defaults; persist distilled summaries (episodic→semantic).
      options: { persistSummaries: true },
    });
  }

  /**
   * Run consolidation if enabled and the throttle interval has elapsed.
   * Returns a small outcome describing what happened. Never throws.
   */
  async maybeRun(projectId: string): Promise<SchedulerOutcome> {
    if (!this.config.enabled) return { ran: false, reason: 'disabled' };

    try {
      const nowMs = Date.now();
      const last = this.getLastRun(projectId);
      if (last != null && nowMs - last < this.config.intervalMs) {
        return { ran: false, reason: 'throttled' };
      }

      const service = new ConsolidationService(this.db);
      const result = await service.consolidate(projectId, this.config.options);
      this.recordRun(projectId, nowMs, result.stats.summariesPersisted);

      return {
        ran: true,
        reason: 'ok',
        summariesPersisted: result.stats.summariesPersisted,
        merged: result.merged.length,
        decayed: result.decayed.length,
      };
    } catch (err) {
      return { ran: false, reason: 'error', detail: (err as Error).message };
    }
  }

  private getLastRun(projectId: string): number | null {
    const row = this.db
      .prepare('SELECT last_run_at FROM consolidation_runs WHERE project_id = ?')
      .get(projectId) as { last_run_at: number } | undefined;
    return row ? row.last_run_at : null;
  }

  private recordRun(projectId: string, atMs: number, summaryCount: number): void {
    this.db
      .prepare(
        `INSERT INTO consolidation_runs (project_id, last_run_at, last_summary_count)
         VALUES (?, ?, ?)
         ON CONFLICT(project_id) DO UPDATE SET
           last_run_at = excluded.last_run_at,
           last_summary_count = excluded.last_summary_count`
      )
      .run(projectId, atMs, summaryCount);
  }
}
