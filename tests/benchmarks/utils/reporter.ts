/**
 * Benchmark results reporter
 * Formats and outputs benchmark results in various formats
 */

/**
 * Result from a single benchmark run
 */
export interface BenchmarkResult {
  name: string;
  category: string;
  metrics: {
    total: number;
    passed: number;
    failed: number;
    rate: number; // percentage
  };
  details?: Array<{
    testCase: string;
    expected: boolean;
    actual: boolean;
    content?: string;
  }>;
}

/**
 * Performance timing result
 */
export interface TimingResult {
  name: string;
  iterations: number;
  p50: number; // microseconds
  p95: number;
  p99: number;
  min: number;
  max: number;
  mean: number;
}

/**
 * Scalability result
 */
export interface ScalabilityResult {
  memoryCount: number;
  scenario: string;
  p50: number; // milliseconds
  p95: number;
  p99: number;
  bottleneck?: string;
}

/**
 * Full benchmark report
 */
export interface BenchmarkReport {
  date: string;
  environment: {
    platform: string;
    nodeVersion: string;
    arch: string;
  };
  security: {
    credentialDetection: {
      truePositiveRate: number;
      falsePositiveRate: number;
      bypassRate: number;
      details: BenchmarkResult[];
    };
    pathTraversal: {
      blockRate: number;
      acceptRate: number;
      details: BenchmarkResult[];
    };
  };
  performance: {
    credentialCheck: TimingResult[];
    pathValidation: TimingResult[];
    memoryStore: TimingResult[];
    transaction: TimingResult[];
  };
  staleness: {
    scalability: ScalabilityResult[];
    accuracy: BenchmarkResult[];
    detectorBreakdown: Record<string, TimingResult>;
  };
  recommendations: string[];
}

/**
 * Calculate percentile from sorted array
 */
export function percentile(sortedValues: number[], p: number): number {
  if (sortedValues.length === 0) return 0;
  const index = Math.ceil((p / 100) * sortedValues.length) - 1;
  return sortedValues[Math.max(0, index)];
}

/**
 * Calculate statistics from timing array
 */
export function calculateStats(timings: number[]): Omit<TimingResult, 'name' | 'iterations'> {
  if (timings.length === 0) {
    return { p50: 0, p95: 0, p99: 0, min: 0, max: 0, mean: 0 };
  }

  const sorted = [...timings].sort((a, b) => a - b);
  const sum = sorted.reduce((a, b) => a + b, 0);

  return {
    p50: percentile(sorted, 50),
    p95: percentile(sorted, 95),
    p99: percentile(sorted, 99),
    min: sorted[0],
    max: sorted[sorted.length - 1],
    mean: sum / sorted.length,
  };
}

/**
 * Format timing in human-readable form
 */
export function formatTiming(microseconds: number): string {
  if (microseconds < 1000) {
    return `${microseconds.toFixed(1)}µs`;
  } else if (microseconds < 1000000) {
    return `${(microseconds / 1000).toFixed(2)}ms`;
  } else {
    return `${(microseconds / 1000000).toFixed(2)}s`;
  }
}

/**
 * Format percentage with color indicator
 */
export function formatPercentage(rate: number, target: number, higherIsBetter: boolean): string {
  const formatted = `${(rate * 100).toFixed(1)}%`;
  const meetsTarget = higherIsBetter ? rate >= target : rate <= target;
  const indicator = meetsTarget ? '✓' : '⚠️';
  return `${formatted} ${indicator}`;
}

/**
 * Generate summary report as string
 */
export function generateSummaryReport(report: BenchmarkReport): string {
  const lines: string[] = [];

  lines.push('='.repeat(60));
  lines.push('claude-memory v2 Hardening Benchmark Report');
  lines.push('='.repeat(60));
  lines.push(`Date: ${report.date}`);
  lines.push(
    `Environment: ${report.environment.platform}, Node ${report.environment.nodeVersion}, ${report.environment.arch}`
  );
  lines.push('');

  // Security Effectiveness
  lines.push('SECURITY EFFECTIVENESS');
  lines.push('-'.repeat(40));
  lines.push('Credential Detection:');
  lines.push(
    `  True Positive Rate:  ${formatPercentage(report.security.credentialDetection.truePositiveRate, 0.95, true)}`
  );
  lines.push(
    `  False Positive Rate: ${formatPercentage(report.security.credentialDetection.falsePositiveRate, 0.05, false)}`
  );
  lines.push(
    `  Bypass Rate:         ${formatPercentage(report.security.credentialDetection.bypassRate, 0.10, false)}`
  );
  lines.push('');
  lines.push('Path Traversal:');
  lines.push(
    `  Attack Block Rate:   ${formatPercentage(report.security.pathTraversal.blockRate, 1.0, true)}`
  );
  lines.push(
    `  Valid Accept Rate:   ${formatPercentage(report.security.pathTraversal.acceptRate, 1.0, true)}`
  );
  lines.push('');

  // Performance Impact
  lines.push('PERFORMANCE IMPACT');
  lines.push('-'.repeat(40));
  if (report.performance.credentialCheck.length > 0) {
    lines.push('Credential check latency (p95):');
    for (const timing of report.performance.credentialCheck) {
      lines.push(`  ${timing.name}: ${formatTiming(timing.p95)}`);
    }
    lines.push('');
  }

  if (report.performance.pathValidation.length > 0) {
    lines.push('Path validation latency (p95):');
    for (const timing of report.performance.pathValidation) {
      lines.push(`  ${timing.name}: ${formatTiming(timing.p95)}`);
    }
    lines.push('');
  }

  if (report.performance.memoryStore.length > 0) {
    lines.push('memory_store overhead (p95):');
    for (const timing of report.performance.memoryStore) {
      lines.push(`  ${timing.name}: ${formatTiming(timing.p95)}`);
    }
    lines.push('');
  }

  // Staleness Scalability
  lines.push('STALENESS SCALABILITY');
  lines.push('-'.repeat(40));
  if (report.staleness.scalability.length > 0) {
    lines.push('session_restore latency (p95):');
    lines.push(
      '| Memories | No Files | 50% Files | 10% Missing | 10% Changed |'
    );
    lines.push(
      '|----------|----------|-----------|-------------|-------------|'
    );

    // Group by memory count
    const byCount = new Map<number, ScalabilityResult[]>();
    for (const result of report.staleness.scalability) {
      const existing = byCount.get(result.memoryCount) ?? [];
      existing.push(result);
      byCount.set(result.memoryCount, existing);
    }

    for (const [count, results] of byCount) {
      const noFiles = results.find((r) => r.scenario === 'no_files')?.p95 ?? 0;
      const withFiles = results.find((r) => r.scenario === 'with_files')?.p95 ?? 0;
      const missing = results.find((r) => r.scenario === 'missing_files')?.p95 ?? 0;
      const changed = results.find((r) => r.scenario === 'changed_files')?.p95 ?? 0;

      lines.push(
        `| ${count.toString().padEnd(8)} | ${formatTiming(noFiles * 1000).padEnd(8)} | ${formatTiming(withFiles * 1000).padEnd(9)} | ${formatTiming(missing * 1000).padEnd(11)} | ${formatTiming(changed * 1000).padEnd(11)} |`
      );
    }
    lines.push('');
  }

  // Detector Breakdown
  if (Object.keys(report.staleness.detectorBreakdown).length > 0) {
    lines.push('Detector breakdown (p95):');
    for (const [name, timing] of Object.entries(report.staleness.detectorBreakdown)) {
      const percentage = timing.mean > 0 ? ` (${((timing.p95 / timing.mean) * 100).toFixed(0)}% of total)` : '';
      lines.push(`  ${name}: ${formatTiming(timing.p95)}${percentage}`);
    }
    lines.push('');
  }

  // Accuracy
  lines.push('ACCURACY');
  lines.push('-'.repeat(40));
  if (report.staleness.accuracy.length > 0) {
    for (const result of report.staleness.accuracy) {
      const status = result.metrics.rate === 1.0 ? '✓' : '⚠️';
      lines.push(
        `${result.name}: ${result.metrics.passed}/${result.metrics.total} ${status}`
      );
    }
    lines.push('');
  }

  // Recommendations
  if (report.recommendations.length > 0) {
    lines.push('RECOMMENDATIONS');
    lines.push('-'.repeat(40));
    for (let i = 0; i < report.recommendations.length; i++) {
      lines.push(`${i + 1}. ${report.recommendations[i]}`);
    }
    lines.push('');
  }

  lines.push('='.repeat(60));

  return lines.join('\n');
}

/**
 * Generate JSON report
 */
export function generateJsonReport(report: BenchmarkReport): string {
  return JSON.stringify(report, null, 2);
}

/**
 * Create empty benchmark report
 */
export function createEmptyReport(): BenchmarkReport {
  return {
    date: new Date().toISOString().split('T')[0],
    environment: {
      platform: process.platform,
      nodeVersion: process.version,
      arch: process.arch,
    },
    security: {
      credentialDetection: {
        truePositiveRate: 0,
        falsePositiveRate: 0,
        bypassRate: 0,
        details: [],
      },
      pathTraversal: {
        blockRate: 0,
        acceptRate: 0,
        details: [],
      },
    },
    performance: {
      credentialCheck: [],
      pathValidation: [],
      memoryStore: [],
      transaction: [],
    },
    staleness: {
      scalability: [],
      accuracy: [],
      detectorBreakdown: {},
    },
    recommendations: [],
  };
}

/**
 * Measure execution time of a function in microseconds
 */
export async function measureTime<T>(
  fn: () => T | Promise<T>
): Promise<{ result: T; duration: number }> {
  const start = process.hrtime.bigint();
  const result = await fn();
  const end = process.hrtime.bigint();
  const duration = Number(end - start) / 1000; // nanoseconds to microseconds
  return { result, duration };
}

/**
 * Run function multiple times and collect timing statistics
 */
export async function benchmark<T>(
  name: string,
  fn: () => T | Promise<T>,
  iterations: number
): Promise<TimingResult> {
  const timings: number[] = [];

  for (let i = 0; i < iterations; i++) {
    const { duration } = await measureTime(fn);
    timings.push(duration);
  }

  const stats = calculateStats(timings);
  return {
    name,
    iterations,
    ...stats,
  };
}

/**
 * Run warmup iterations before actual benchmark
 */
export async function warmup<T>(fn: () => T | Promise<T>, iterations: number = 10): Promise<void> {
  for (let i = 0; i < iterations; i++) {
    await fn();
  }
}
