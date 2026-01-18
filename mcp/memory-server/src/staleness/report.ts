import type { Memory } from '../types.js';
import type { StalenessDetector } from './detector.js';

/**
 * Staleness report data
 */
export interface StalenessReport {
  projectId: string;
  timestamp: Date;
  sourceMissing: Memory[];
  contentChanged: Memory[];
  accessStale: Memory[];
  lowConfidence: Memory[];
  totalFlaggable: number;
}

/**
 * Generates formatted staleness reports for session restore
 */
export class StalenessReportGenerator {
  constructor(private detector: StalenessDetector) {}

  /**
   * Generate a staleness report for a project
   */
  generateReport(
    projectId: string,
    projectRoot: string,
    options: {
      sessionThreshold?: number;
      confidenceThreshold?: number;
      includeAccessStale?: boolean;
      includeSourceMissing?: boolean;
      includeContentChanged?: boolean;
      includeLowConfidence?: boolean;
    } = {}
  ): StalenessReport {
    const {
      sessionThreshold = 10,
      confidenceThreshold = 0.5,
      includeAccessStale = true,
      includeSourceMissing = true,
      includeContentChanged = true,
      includeLowConfidence = true,
    } = options;

    const sourceMissing = includeSourceMissing
      ? this.detector.detectSourceMissing(projectId, projectRoot)
      : [];

    const contentChanged = includeContentChanged
      ? this.detector.detectContentChanged(projectId, projectRoot)
      : [];

    const accessStale = includeAccessStale
      ? this.detector.detectAccessStale(projectId, sessionThreshold)
      : [];

    const lowConfidence = includeLowConfidence
      ? this.detector.detectLowConfidence(projectId, confidenceThreshold)
      : [];

    return {
      projectId,
      timestamp: new Date(),
      sourceMissing,
      contentChanged,
      accessStale,
      lowConfidence,
      totalFlaggable:
        sourceMissing.length + contentChanged.length + accessStale.length + lowConfidence.length,
    };
  }

  /**
   * Format a staleness report as a readable string
   */
  formatReport(report: StalenessReport): string | null {
    if (report.totalFlaggable === 0) {
      return null; // No report needed
    }

    const lines: string[] = [
      'Memory Staleness Report',
      '═══════════════════════════════════════',
      '',
    ];

    if (report.sourceMissing.length > 0) {
      lines.push(`Source Missing (${report.sourceMissing.length}):`);
      for (const m of report.sourceMissing.slice(0, 10)) {
        const contentPreview = m.content.slice(0, 40).replace(/\n/g, ' ');
        lines.push(`  - "${contentPreview}..." - file deleted`);
        if (m.citation) {
          lines.push(`    Citation: ${m.citation}`);
        }
      }
      if (report.sourceMissing.length > 10) {
        lines.push(`  ... and ${report.sourceMissing.length - 10} more`);
      }
      lines.push('');
    }

    if (report.contentChanged.length > 0) {
      lines.push(`Source Changed (${report.contentChanged.length}):`);
      for (const m of report.contentChanged.slice(0, 10)) {
        const contentPreview = m.content.slice(0, 40).replace(/\n/g, ' ');
        lines.push(`  - "${contentPreview}..." - file modified`);
        if (m.citation) {
          lines.push(`    Citation: ${m.citation}`);
        }
      }
      if (report.contentChanged.length > 10) {
        lines.push(`  ... and ${report.contentChanged.length - 10} more`);
      }
      lines.push('');
    }

    if (report.accessStale.length > 0) {
      lines.push(`Not Accessed Recently (${report.accessStale.length}):`);
      for (const m of report.accessStale.slice(0, 10)) {
        const contentPreview = m.content.slice(0, 40).replace(/\n/g, ' ');
        const daysSinceAccess = Math.floor(
          (Date.now() - m.accessedAt.getTime()) / (1000 * 60 * 60 * 24)
        );
        lines.push(`  - "${contentPreview}..." - ${daysSinceAccess}d since access`);
      }
      if (report.accessStale.length > 10) {
        lines.push(`  ... and ${report.accessStale.length - 10} more`);
      }
      lines.push('');
    }

    if (report.lowConfidence.length > 0) {
      lines.push(`Low Confidence (${report.lowConfidence.length}):`);
      for (const m of report.lowConfidence.slice(0, 10)) {
        const contentPreview = m.content.slice(0, 40).replace(/\n/g, ' ');
        lines.push(`  - "${contentPreview}..." - confidence: ${(m.confidence * 100).toFixed(0)}%`);
      }
      if (report.lowConfidence.length > 10) {
        lines.push(`  ... and ${report.lowConfidence.length - 10} more`);
      }
      lines.push('');
    }

    lines.push('Actions:');
    lines.push('  - Use memory_forget to remove outdated memories');
    lines.push('  - Use memory_feedback to correct or flag memories');
    lines.push('  - Use memory_update to provide corrected information');

    return lines.join('\n');
  }

  /**
   * Auto-flag memories based on report
   */
  autoFlag(
    report: StalenessReport,
    options: {
      flagSourceMissing?: boolean;
      flagContentChanged?: boolean;
      flagAccessStale?: boolean;
    } = {}
  ): number {
    const { flagSourceMissing = true, flagContentChanged = true, flagAccessStale = false } =
      options;
    let flagged = 0;

    if (flagSourceMissing) {
      for (const m of report.sourceMissing) {
        if (this.detector.flagAsStale(m.id, report.projectId, 'Source file no longer exists')) {
          flagged++;
        }
      }
    }

    if (flagContentChanged) {
      for (const m of report.contentChanged) {
        if (this.detector.flagAsStale(m.id, report.projectId, 'Source file content changed')) {
          flagged++;
        }
      }
    }

    if (flagAccessStale) {
      for (const m of report.accessStale) {
        if (
          this.detector.flagAsStale(m.id, report.projectId, 'Not accessed in recent sessions')
        ) {
          flagged++;
        }
      }
    }

    return flagged;
  }
}
