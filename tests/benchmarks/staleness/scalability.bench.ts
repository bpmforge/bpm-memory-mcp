/**
 * Benchmark 4: Staleness Detection Scalability
 *
 * Measures:
 * - session_restore latency vs memory count
 * - Individual detector performance breakdown
 * - File I/O impact on staleness detection
 */

import { describe, bench, beforeAll, afterAll, beforeEach } from 'vitest';
import { mkdirSync, writeFileSync, rmSync, existsSync, unlinkSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { createHash } from 'crypto';
import Database from 'better-sqlite3';

import { StalenessDetector } from '../../../mcp/memory-server/src/staleness/detector.js';
import {
  generateMemory,
  generateMemories,
  generateMemoriesWithCitations,
  initBenchmarkSchema,
  insertMemories,
  createSessions,
  createTempDir,
  cleanupTempDir,
  generateContent,
} from '../utils/generators.js';
import { formatTiming } from '../utils/reporter.js';

let projectRoot: string;
let db: Database.Database;
let detector: StalenessDetector;
const projectId = 'bench-project';

// Memory counts to test
const MEMORY_COUNTS = [100, 500, 1000, 2500, 5000, 10000];

// Create a mock DatabaseConnection that wraps the raw database
function createMockDbConnection(rawDb: Database.Database): {
  instance: Database.Database;
  project: string;
  transaction: <T>(fn: () => T) => T;
  close: () => void;
} {
  return {
    get instance() {
      return rawDb;
    },
    get project() {
      return projectId;
    },
    transaction<T>(fn: () => T): T {
      return rawDb.transaction(fn)();
    },
    close() {
      rawDb.close();
    },
  };
}

beforeAll(() => {
  projectRoot = createTempDir('staleness');
  mkdirSync(join(projectRoot, 'src'), { recursive: true });

  db = new Database(':memory:');
  initBenchmarkSchema(db);

  // Create the StalenessDetector with our mock connection
  const mockConnection = createMockDbConnection(db);
  detector = new StalenessDetector(mockConnection as any);

  // Create sessions for access staleness testing
  createSessions(db, projectId, 20);
});

afterAll(() => {
  db.close();
  cleanupTempDir(projectRoot);
});

describe('Staleness Detection - No File I/O', () => {
  // Test with memories that have no citations (pure DB operations)

  describe.each(MEMORY_COUNTS)('Memory count: %i', (count) => {
    beforeEach(() => {
      // Clear and repopulate database
      db.exec('DELETE FROM memories');

      // Generate memories without citations
      const memories = generateMemories(count, {
        projectId,
        accessedAt: Math.floor(Date.now() / 1000) - 86400 * 30, // 30 days ago
      });
      insertMemories(db, memories);
    });

    bench(
      `detectAccessStale - ${count} memories`,
      () => {
        detector.detectAccessStale(projectId, 10);
      },
      { iterations: 10 }
    );

    bench(
      `detectLowConfidence - ${count} memories`,
      () => {
        detector.detectLowConfidence(projectId, 0.5);
      },
      { iterations: 10 }
    );
  });
});

describe('Staleness Detection - With File I/O', () => {
  // Test with citations that require file system access

  describe.each([100, 500, 1000, 2500])('Memory count: %i with 50% citations', (count) => {
    beforeEach(() => {
      // Clear database and project files
      db.exec('DELETE FROM memories');

      // Clear old test files
      const srcDir = join(projectRoot, 'src');
      if (existsSync(srcDir)) {
        rmSync(srcDir, { recursive: true, force: true });
      }
      mkdirSync(srcDir, { recursive: true });

      // Generate memories with citations (50% have files)
      const { memories, files } = generateMemoriesWithCitations(
        count,
        0.5, // 50% with citations
        projectRoot,
        0, // 0% missing
        0 // 0% changed
      );
      insertMemories(db, memories);
    });

    bench(
      `detectSourceMissing - ${count} memories, 50% files`,
      () => {
        detector.detectSourceMissing(projectId, projectRoot);
      },
      { iterations: 10 }
    );

    bench(
      `detectContentChanged - ${count} memories, 50% files`,
      () => {
        detector.detectContentChanged(projectId, projectRoot);
      },
      { iterations: 10 }
    );
  });

  // Test with missing files
  describe.each([100, 500, 1000])('Memory count: %i with 10% missing files', (count) => {
    beforeEach(() => {
      db.exec('DELETE FROM memories');

      const srcDir = join(projectRoot, 'src');
      if (existsSync(srcDir)) {
        rmSync(srcDir, { recursive: true, force: true });
      }
      mkdirSync(srcDir, { recursive: true });

      // Generate memories with 50% citations, 10% of those missing
      const { memories } = generateMemoriesWithCitations(
        count,
        0.5,
        projectRoot,
        0.1, // 10% missing
        0
      );
      insertMemories(db, memories);
    });

    bench(
      `detectSourceMissing - ${count} memories, 10% missing`,
      () => {
        detector.detectSourceMissing(projectId, projectRoot);
      },
      { iterations: 10 }
    );
  });

  // Test with changed files
  describe.each([100, 500, 1000])('Memory count: %i with 10% changed files', (count) => {
    beforeEach(() => {
      db.exec('DELETE FROM memories');

      const srcDir = join(projectRoot, 'src');
      if (existsSync(srcDir)) {
        rmSync(srcDir, { recursive: true, force: true });
      }
      mkdirSync(srcDir, { recursive: true });

      // Generate memories with 50% citations, 10% of those changed
      const { memories } = generateMemoriesWithCitations(
        count,
        0.5,
        projectRoot,
        0,
        0.1 // 10% changed
      );
      insertMemories(db, memories);
    });

    bench(
      `detectContentChanged - ${count} memories, 10% changed`,
      () => {
        detector.detectContentChanged(projectId, projectRoot);
      },
      { iterations: 10 }
    );
  });
});

describe('Staleness Detection - Combined Report', () => {
  // Simulate full session_restore staleness report generation

  describe.each([100, 500, 1000, 2500])('Full report: %i memories', (count) => {
    beforeEach(() => {
      db.exec('DELETE FROM memories');

      const srcDir = join(projectRoot, 'src');
      if (existsSync(srcDir)) {
        rmSync(srcDir, { recursive: true, force: true });
      }
      mkdirSync(srcDir, { recursive: true });

      // Realistic scenario: 50% with citations, 5% missing, 5% changed
      const { memories } = generateMemoriesWithCitations(
        count,
        0.5,
        projectRoot,
        0.05,
        0.05
      );
      insertMemories(db, memories);
    });

    bench(
      `full staleness report - ${count} memories`,
      () => {
        // Run all detectors as would happen in session_restore
        const accessStale = detector.detectAccessStale(projectId, 10);
        const sourceMissing = detector.detectSourceMissing(projectId, projectRoot);
        const lowConfidence = detector.detectLowConfidence(projectId, 0.5);
        const contentChanged = detector.detectContentChanged(projectId, projectRoot);

        // Combine results (as session_restore does)
        const allStale = new Set([
          ...accessStale.map((m) => m.id),
          ...sourceMissing.map((m) => m.id),
          ...lowConfidence.map((m) => m.id),
          ...contentChanged.map((m) => m.id),
        ]);

        return allStale.size;
      },
      { iterations: 5 }
    );
  });
});

describe('Staleness Detection - Individual Detector Breakdown', () => {
  // Profile each detector in isolation with 1000 memories

  const BREAKDOWN_COUNT = 1000;

  beforeEach(() => {
    db.exec('DELETE FROM memories');

    const srcDir = join(projectRoot, 'src');
    if (existsSync(srcDir)) {
      rmSync(srcDir, { recursive: true, force: true });
    }
    mkdirSync(srcDir, { recursive: true });

    // Generate with various characteristics for breakdown
    const { memories } = generateMemoriesWithCitations(
      BREAKDOWN_COUNT,
      0.5,
      projectRoot,
      0.05,
      0.05
    );

    // Set some with low confidence
    for (let i = 0; i < Math.floor(BREAKDOWN_COUNT * 0.1); i++) {
      memories[i].confidence = 0.3;
    }

    insertMemories(db, memories);
  });

  bench(
    'detectAccessStale only',
    () => {
      detector.detectAccessStale(projectId, 10);
    },
    { iterations: 20 }
  );

  bench(
    'detectSourceMissing only',
    () => {
      detector.detectSourceMissing(projectId, projectRoot);
    },
    { iterations: 20 }
  );

  bench(
    'detectLowConfidence only',
    () => {
      detector.detectLowConfidence(projectId, 0.5);
    },
    { iterations: 20 }
  );

  bench(
    'detectContentChanged only',
    () => {
      detector.detectContentChanged(projectId, projectRoot);
    },
    { iterations: 20 }
  );
});

describe('Staleness Detection - sourceHash Computation', () => {
  // Benchmark the hash computation specifically

  const fileSizes = [
    { name: '1KB', size: 1024 },
    { name: '10KB', size: 10240 },
    { name: '100KB', size: 102400 },
    { name: '1MB', size: 1048576 },
    { name: '10MB', size: 10485760 },
  ];

  // Pre-create files of various sizes
  beforeAll(() => {
    const hashDir = join(projectRoot, 'hash-test');
    mkdirSync(hashDir, { recursive: true });

    for (const { name, size } of fileSizes) {
      const content = generateContent(size);
      writeFileSync(join(hashDir, `${name}.txt`), content);
    }
  });

  describe.each(fileSizes)('File size: $name', ({ name }) => {
    bench(
      `computeFileHash - ${name}`,
      () => {
        const filepath = join(projectRoot, 'hash-test', `${name}.txt`);
        detector.computeFileHash(filepath);
      },
      { iterations: 100 }
    );
  });
});

describe('Staleness Detection - Scaling Trends', () => {
  // Test how detection scales with memory count

  bench(
    'scaling test - varied counts',
    () => {
      const counts = [50, 100, 200, 500, 1000];
      const results: Record<number, number> = {};

      for (const count of counts) {
        db.exec('DELETE FROM memories');

        const memories = generateMemories(count, {
          projectId,
          accessedAt: Math.floor(Date.now() / 1000) - 86400 * 30,
        });
        insertMemories(db, memories);

        const start = performance.now();
        detector.detectAccessStale(projectId, 10);
        detector.detectLowConfidence(projectId, 0.5);
        results[count] = performance.now() - start;
      }

      // Log scaling results
      console.log('\nScaling trend (no file I/O):');
      for (const [count, time] of Object.entries(results)) {
        console.log(`  ${count} memories: ${time.toFixed(2)}ms`);
      }
    },
    { iterations: 3 }
  );
});

describe('Staleness Detection - Summary', () => {
  bench(
    'generate summary',
    () => {
      console.log('\n' + '='.repeat(60));
      console.log('STALENESS DETECTION SCALABILITY SUMMARY');
      console.log('='.repeat(60));
      console.log('');
      console.log('Performance characteristics:');
      console.log('  - DB-only detectors (accessStale, lowConfidence): O(n) with DB');
      console.log('  - File I/O detectors (sourceMissing, contentChanged): O(n*fileIO)');
      console.log('');
      console.log('Bottleneck identification:');
      console.log('  - Without file I/O: Database query time dominates');
      console.log('  - With file I/O: File read + hash computation dominates');
      console.log('');
      console.log('Recommendations:');
      console.log('  1. Cache sourceHash values to avoid recomputation');
      console.log('  2. Parallelize staleness detection across detectors');
      console.log('  3. Consider file size limits for hash computation');
      console.log('  4. Use incremental detection for large memory counts');
      console.log('='.repeat(60) + '\n');
    },
    { iterations: 1 }
  );
});
