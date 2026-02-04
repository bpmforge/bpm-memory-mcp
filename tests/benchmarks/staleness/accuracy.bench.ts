/**
 * Benchmark 5: Staleness Detection Accuracy
 *
 * Validates:
 * - Correct identification of stale memories
 * - sourceHash integrity
 * - No false positives/negatives in detection
 */

import { describe, bench, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { mkdirSync, writeFileSync, rmSync, existsSync, unlinkSync, appendFileSync } from 'fs';
import { join } from 'path';
import { createHash } from 'crypto';
import Database from 'better-sqlite3';
import { randomUUID } from 'crypto';

import { StalenessDetector } from '../../../mcp/memory-server/src/staleness/detector.js';
import {
  generateMemory,
  initBenchmarkSchema,
  insertMemories,
  createSessions,
  createTempDir,
  cleanupTempDir,
  generateContent,
} from '../utils/generators.js';
import { formatPercentage } from '../utils/reporter.js';

let projectRoot: string;
let db: Database.Database;
let detector: StalenessDetector;
const projectId = 'accuracy-test';

// Create mock connection
function createMockDbConnection(rawDb: Database.Database) {
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

// Test results tracking
const results = {
  accessStale: { correct: 0, total: 0 },
  sourceMissing: { correct: 0, total: 0 },
  lowConfidence: { correct: 0, total: 0 },
  contentChanged: { correct: 0, total: 0 },
  sourceHash: { correct: 0, total: 0 },
};

beforeAll(() => {
  projectRoot = createTempDir('accuracy');
  mkdirSync(join(projectRoot, 'src'), { recursive: true });

  db = new Database(':memory:');
  initBenchmarkSchema(db);

  detector = new StalenessDetector(createMockDbConnection(db) as any);
});

afterAll(() => {
  db.close();
  cleanupTempDir(projectRoot);
});

describe('Staleness Detection Accuracy - Access Stale', () => {
  beforeEach(() => {
    db.exec('DELETE FROM memories');
    db.exec('DELETE FROM sessions');
  });

  bench(
    'detect memory not accessed in 10 sessions',
    () => {
      // Create 15 sessions
      createSessions(db, projectId, 15);

      // Get session threshold timestamp (10 sessions ago)
      const thresholdRow = db
        .prepare(
          `SELECT created_at FROM sessions
           WHERE project_id = ?
           ORDER BY session_number DESC
           LIMIT 1 OFFSET 9`
        )
        .get(projectId) as { created_at: number };

      // Create memory accessed before threshold (should be stale)
      const staleMemory = generateMemory({
        projectId,
        accessedAt: thresholdRow.created_at - 3600, // 1 hour before threshold
      });

      // Create memory accessed after threshold (should NOT be stale)
      const freshMemory = generateMemory({
        projectId,
        accessedAt: Math.floor(Date.now() / 1000), // now
      });

      insertMemories(db, [staleMemory, freshMemory]);

      // Detect
      const staleResults = detector.detectAccessStale(projectId, 10);
      const staleIds = staleResults.map((m) => m.id);

      results.accessStale.total += 2;
      if (staleIds.includes(staleMemory.id)) {
        results.accessStale.correct++;
      }
      if (!staleIds.includes(freshMemory.id)) {
        results.accessStale.correct++;
      }

      // Assertions
      expect(staleIds).toContain(staleMemory.id);
      expect(staleIds).not.toContain(freshMemory.id);
    },
    { iterations: 10 }
  );

  bench(
    'no false positives when not enough sessions',
    () => {
      // Create only 5 sessions (threshold is 10)
      createSessions(db, projectId, 5);

      // Create old memory
      const memory = generateMemory({
        projectId,
        accessedAt: Math.floor(Date.now() / 1000) - 86400 * 365, // 1 year ago
      });
      insertMemories(db, [memory]);

      // Should return empty (not enough sessions for detection)
      const staleResults = detector.detectAccessStale(projectId, 10);

      results.accessStale.total++;
      if (staleResults.length === 0) {
        results.accessStale.correct++;
      }

      expect(staleResults).toHaveLength(0);
    },
    { iterations: 10 }
  );
});

describe('Staleness Detection Accuracy - Source Missing', () => {
  beforeEach(() => {
    db.exec('DELETE FROM memories');

    // Clear and recreate src directory
    const srcDir = join(projectRoot, 'src');
    if (existsSync(srcDir)) {
      rmSync(srcDir, { recursive: true, force: true });
    }
    mkdirSync(srcDir, { recursive: true });
  });

  bench(
    'detect memory with deleted citation file',
    () => {
      const filePath = 'src/deleted.ts';
      const fullPath = join(projectRoot, filePath);

      // Create file, then delete it
      writeFileSync(fullPath, 'export const x = 1;');

      const memory = generateMemory({
        projectId,
        citation: `${filePath}:1`,
      });
      insertMemories(db, [memory]);

      // Delete the file
      unlinkSync(fullPath);

      // Detect
      const missingResults = detector.detectSourceMissing(projectId, projectRoot);
      const missingIds = missingResults.map((m) => m.id);

      results.sourceMissing.total++;
      if (missingIds.includes(memory.id)) {
        results.sourceMissing.correct++;
      }

      expect(missingIds).toContain(memory.id);
    },
    { iterations: 10 }
  );

  bench(
    'no false positive when file exists',
    () => {
      const filePath = 'src/exists.ts';
      const fullPath = join(projectRoot, filePath);

      // Create file that exists
      writeFileSync(fullPath, 'export const y = 2;');

      const memory = generateMemory({
        projectId,
        citation: `${filePath}:1`,
      });
      insertMemories(db, [memory]);

      // Detect - should NOT find this memory
      const missingResults = detector.detectSourceMissing(projectId, projectRoot);
      const missingIds = missingResults.map((m) => m.id);

      results.sourceMissing.total++;
      if (!missingIds.includes(memory.id)) {
        results.sourceMissing.correct++;
      }

      expect(missingIds).not.toContain(memory.id);
    },
    { iterations: 10 }
  );
});

describe('Staleness Detection Accuracy - Low Confidence', () => {
  beforeEach(() => {
    db.exec('DELETE FROM memories');
  });

  bench(
    'detect memory with confidence below threshold',
    () => {
      // Memory with low confidence (should be detected)
      const lowConfMemory = generateMemory({
        projectId,
        confidence: 0.3,
      });

      // Memory with high confidence (should NOT be detected)
      const highConfMemory = generateMemory({
        projectId,
        confidence: 0.9,
      });

      // Memory at threshold (should NOT be detected)
      const thresholdMemory = generateMemory({
        projectId,
        confidence: 0.5,
      });

      insertMemories(db, [lowConfMemory, highConfMemory, thresholdMemory]);

      // Detect with threshold 0.5
      const lowConfResults = detector.detectLowConfidence(projectId, 0.5);
      const lowConfIds = lowConfResults.map((m) => m.id);

      results.lowConfidence.total += 3;
      if (lowConfIds.includes(lowConfMemory.id)) {
        results.lowConfidence.correct++;
      }
      if (!lowConfIds.includes(highConfMemory.id)) {
        results.lowConfidence.correct++;
      }
      if (!lowConfIds.includes(thresholdMemory.id)) {
        results.lowConfidence.correct++;
      }

      expect(lowConfIds).toContain(lowConfMemory.id);
      expect(lowConfIds).not.toContain(highConfMemory.id);
      expect(lowConfIds).not.toContain(thresholdMemory.id);
    },
    { iterations: 10 }
  );
});

describe('Staleness Detection Accuracy - Content Changed', () => {
  beforeEach(() => {
    db.exec('DELETE FROM memories');

    const srcDir = join(projectRoot, 'src');
    if (existsSync(srcDir)) {
      rmSync(srcDir, { recursive: true, force: true });
    }
    mkdirSync(srcDir, { recursive: true });
  });

  bench(
    'detect memory when source file content changed',
    () => {
      const filePath = 'src/changed.ts';
      const fullPath = join(projectRoot, filePath);
      const originalContent = 'export function original() { return 1; }';

      // Create file with original content
      writeFileSync(fullPath, originalContent);
      const originalHash = createHash('sha256').update(originalContent).digest('hex');

      // Create memory with original hash
      const memory = generateMemory({
        projectId,
        citation: `${filePath}:1`,
        codeContext: {
          filePath,
          startLine: 1,
          sourceHash: originalHash,
        },
      });
      insertMemories(db, [memory]);

      // Modify the file
      writeFileSync(fullPath, 'export function modified() { return 2; }');

      // Detect
      const changedResults = detector.detectContentChanged(projectId, projectRoot);
      const changedIds = changedResults.map((m) => m.id);

      results.contentChanged.total++;
      if (changedIds.includes(memory.id)) {
        results.contentChanged.correct++;
      }

      expect(changedIds).toContain(memory.id);
    },
    { iterations: 10 }
  );

  bench(
    'no false positive when file unchanged',
    () => {
      const filePath = 'src/unchanged.ts';
      const fullPath = join(projectRoot, filePath);
      const content = 'export function unchanged() { return 42; }';

      // Create file
      writeFileSync(fullPath, content);
      const hash = createHash('sha256').update(content).digest('hex');

      // Create memory with matching hash
      const memory = generateMemory({
        projectId,
        citation: `${filePath}:1`,
        codeContext: {
          filePath,
          startLine: 1,
          sourceHash: hash,
        },
      });
      insertMemories(db, [memory]);

      // Detect - file not changed, should NOT be detected
      const changedResults = detector.detectContentChanged(projectId, projectRoot);
      const changedIds = changedResults.map((m) => m.id);

      results.contentChanged.total++;
      if (!changedIds.includes(memory.id)) {
        results.contentChanged.correct++;
      }

      expect(changedIds).not.toContain(memory.id);
    },
    { iterations: 10 }
  );
});

describe('sourceHash Integrity', () => {
  beforeEach(() => {
    const hashDir = join(projectRoot, 'hash-integrity');
    if (existsSync(hashDir)) {
      rmSync(hashDir, { recursive: true, force: true });
    }
    mkdirSync(hashDir, { recursive: true });
  });

  bench(
    'unchanged file produces same hash',
    () => {
      const filePath = join(projectRoot, 'hash-integrity', 'stable.ts');
      const content = 'const stable = true;';

      writeFileSync(filePath, content);

      const hash1 = detector.computeFileHash(filePath);
      const hash2 = detector.computeFileHash(filePath);

      results.sourceHash.total++;
      if (hash1 === hash2) {
        results.sourceHash.correct++;
      }

      expect(hash1).toBe(hash2);
    },
    { iterations: 10 }
  );

  bench(
    'whitespace change produces different hash',
    () => {
      const filePath = join(projectRoot, 'hash-integrity', 'whitespace.ts');
      const content = 'const x = 1;';

      writeFileSync(filePath, content);
      const hash1 = detector.computeFileHash(filePath);

      // Add newline
      writeFileSync(filePath, content + '\n');
      const hash2 = detector.computeFileHash(filePath);

      results.sourceHash.total++;
      if (hash1 !== hash2) {
        results.sourceHash.correct++;
      }

      expect(hash1).not.toBe(hash2);
    },
    { iterations: 10 }
  );

  bench(
    'content change produces different hash',
    () => {
      const filePath = join(projectRoot, 'hash-integrity', 'content.ts');

      writeFileSync(filePath, 'const value = 1;');
      const hash1 = detector.computeFileHash(filePath);

      writeFileSync(filePath, 'const value = 2;');
      const hash2 = detector.computeFileHash(filePath);

      results.sourceHash.total++;
      if (hash1 !== hash2) {
        results.sourceHash.correct++;
      }

      expect(hash1).not.toBe(hash2);
    },
    { iterations: 10 }
  );

  bench(
    'append change produces different hash',
    () => {
      const filePath = join(projectRoot, 'hash-integrity', 'append.ts');

      writeFileSync(filePath, 'const original = true;');
      const hash1 = detector.computeFileHash(filePath);

      appendFileSync(filePath, '\nconst added = true;');
      const hash2 = detector.computeFileHash(filePath);

      results.sourceHash.total++;
      if (hash1 !== hash2) {
        results.sourceHash.correct++;
      }

      expect(hash1).not.toBe(hash2);
    },
    { iterations: 10 }
  );
});

describe('Edge Cases', () => {
  beforeEach(() => {
    db.exec('DELETE FROM memories');
  });

  bench(
    'exclude deleted memories from staleness detection',
    () => {
      // Create deleted memory with low confidence
      const deletedMemory = generateMemory({
        projectId,
        confidence: 0.1,
      });
      deletedMemory.deleted_at = Math.floor(Date.now() / 1000);
      deletedMemory.deleted_reason = 'test deletion';

      insertMemories(db, [deletedMemory]);

      // Should not appear in low confidence detection
      const results = detector.detectLowConfidence(projectId, 0.5);
      expect(results.map((m) => m.id)).not.toContain(deletedMemory.id);
    },
    { iterations: 10 }
  );

  bench(
    'exclude superseded memories from staleness detection',
    () => {
      // Create superseded memory with low confidence
      const supersededMemory = generateMemory({
        projectId,
        confidence: 0.1,
      });
      supersededMemory.superseded_by = randomUUID();
      supersededMemory.superseded_at = Math.floor(Date.now() / 1000);

      insertMemories(db, [supersededMemory]);

      // Should not appear in detection
      const results = detector.detectLowConfidence(projectId, 0.5);
      expect(results.map((m) => m.id)).not.toContain(supersededMemory.id);
    },
    { iterations: 10 }
  );

  bench(
    'exclude already flagged memories',
    () => {
      // Create already flagged memory with low confidence
      const flaggedMemory = generateMemory({
        projectId,
        confidence: 0.1,
      });
      flaggedMemory.flagged_at = Math.floor(Date.now() / 1000);
      flaggedMemory.flagged_reason = 'already flagged';

      insertMemories(db, [flaggedMemory]);

      // Should not appear in detection (already flagged)
      const results = detector.detectLowConfidence(projectId, 0.5);
      expect(results.map((m) => m.id)).not.toContain(flaggedMemory.id);
    },
    { iterations: 10 }
  );
});

describe('Staleness Detection Accuracy - Summary', () => {
  bench(
    'generate accuracy summary',
    () => {
      const accessRate = results.accessStale.correct / results.accessStale.total;
      const missingRate = results.sourceMissing.correct / results.sourceMissing.total;
      const confidenceRate = results.lowConfidence.correct / results.lowConfidence.total;
      const changedRate = results.contentChanged.correct / results.contentChanged.total;
      const hashRate = results.sourceHash.correct / results.sourceHash.total;

      console.log('\n' + '='.repeat(60));
      console.log('STALENESS DETECTION ACCURACY SUMMARY');
      console.log('='.repeat(60));
      console.log(
        `detectAccessStale:    ${formatPercentage(accessRate, 1.0, true)} (${results.accessStale.correct}/${results.accessStale.total})`
      );
      console.log(
        `detectSourceMissing:  ${formatPercentage(missingRate, 1.0, true)} (${results.sourceMissing.correct}/${results.sourceMissing.total})`
      );
      console.log(
        `detectLowConfidence:  ${formatPercentage(confidenceRate, 1.0, true)} (${results.lowConfidence.correct}/${results.lowConfidence.total})`
      );
      console.log(
        `detectContentChanged: ${formatPercentage(changedRate, 1.0, true)} (${results.contentChanged.correct}/${results.contentChanged.total})`
      );
      console.log(
        `sourceHash integrity: ${formatPercentage(hashRate, 1.0, true)} (${results.sourceHash.correct}/${results.sourceHash.total})`
      );
      console.log('='.repeat(60) + '\n');

      // All accuracy tests should pass
      expect(accessRate).toBe(1.0);
      expect(missingRate).toBe(1.0);
      expect(confidenceRate).toBe(1.0);
      expect(changedRate).toBe(1.0);
      expect(hashRate).toBe(1.0);
    },
    { iterations: 1 }
  );
});
