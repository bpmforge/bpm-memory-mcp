/**
 * Benchmark 2: Path Traversal Prevention
 *
 * Measures:
 * - Attack vector coverage (should block all traversal attempts)
 * - Legitimate path acceptance (should allow valid paths)
 * - Validation latency
 */

import { describe, bench, expect, beforeAll, afterAll } from 'vitest';
import { readFileSync, mkdirSync, rmSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { isPathSafe, validateCitationPath } from '../../../mcp/memory-server/src/security/paths.js';
import { formatPercentage } from '../utils/reporter.js';

// Load test fixtures
const fixturesDir = join(__dirname, '../fixtures');

interface PathTestCase {
  path: string;
  description: string;
}

interface PathCategory {
  category: string;
  samples: PathTestCase[];
}

interface PathFixture {
  description: string;
  testCases: PathCategory[];
}

let attacksFixture: PathFixture;
let validFixture: PathFixture;
let projectRoot: string;

// Results tracking
const results = {
  attacks: { blocked: 0, total: 0, failures: [] as string[] },
  valid: { accepted: 0, total: 0, failures: [] as string[] },
};

beforeAll(() => {
  attacksFixture = JSON.parse(
    readFileSync(join(fixturesDir, 'paths-attacks.json'), 'utf-8')
  );
  validFixture = JSON.parse(
    readFileSync(join(fixturesDir, 'paths-valid.json'), 'utf-8')
  );

  // Create temporary project root for testing
  projectRoot = join(tmpdir(), `path-bench-${Date.now()}`);
  mkdirSync(projectRoot, { recursive: true });

  // Create some directories for valid path tests
  const dirs = [
    'src',
    'src/components',
    'src/components/ui',
    'src/components/ui/buttons',
    'lib',
    'tests',
    'tests/unit',
    'config',
    'packages/core/src',
    'apps/web/src',
  ];
  for (const dir of dirs) {
    const fullPath = join(projectRoot, dir);
    if (!existsSync(fullPath)) {
      mkdirSync(fullPath, { recursive: true });
    }
  }
});

afterAll(() => {
  // Cleanup
  if (existsSync(projectRoot)) {
    rmSync(projectRoot, { recursive: true, force: true });
  }
});

describe('Path Traversal - Attack Vectors', () => {
  describe.each([
    'basic_traversal',
    'url_encoding',
    'unicode_tricks',
    'null_byte_injection',
    'mixed_slashes',
    'absolute_paths',
  ])('Category: %s', (categoryName) => {
    bench(
      `should block ${categoryName}`,
      () => {
        const category = attacksFixture.testCases.find(
          (c) => c.category === categoryName
        );
        if (!category) return;

        for (const sample of category.samples) {
          const safe = isPathSafe(sample.path, projectRoot);
          results.attacks.total++;
          if (!safe) {
            results.attacks.blocked++;
          } else {
            results.attacks.failures.push(
              `${categoryName}: ${sample.path} - ${sample.description}`
            );
          }
        }
      },
      { iterations: 100 }
    );
  });
});

describe('Path Traversal - Valid Paths', () => {
  describe.each([
    'relative_paths',
    'deep_nesting',
    'special_characters',
    'spaces_and_special',
    'normalized_traversal',
  ])('Category: %s', (categoryName) => {
    bench(
      `should accept ${categoryName}`,
      () => {
        const category = validFixture.testCases.find(
          (c) => c.category === categoryName
        );
        if (!category) return;

        for (const sample of category.samples) {
          const safe = isPathSafe(sample.path, projectRoot);
          results.valid.total++;
          if (safe) {
            results.valid.accepted++;
          } else {
            results.valid.failures.push(
              `${categoryName}: ${sample.path} - ${sample.description}`
            );
          }
        }
      },
      { iterations: 100 }
    );
  });
});

describe('Path Traversal - Citation Validation', () => {
  bench(
    'validate simple citation',
    () => {
      validateCitationPath('src/index.ts:42', projectRoot);
    },
    { iterations: 10000 }
  );

  bench(
    'validate citation with line range',
    () => {
      validateCitationPath('src/components/Button.tsx:10-25', projectRoot);
    },
    { iterations: 10000 }
  );

  bench(
    'validate citation with symbol',
    () => {
      validateCitationPath('src/utils/helpers.ts:15:handleClick', projectRoot);
    },
    { iterations: 10000 }
  );

  bench(
    'reject traversal in citation',
    () => {
      validateCitationPath('../../../etc/passwd:1', projectRoot);
    },
    { iterations: 10000 }
  );

  bench(
    'handle null/empty citation',
    () => {
      validateCitationPath(null, projectRoot);
      validateCitationPath('', projectRoot);
      validateCitationPath('   ', projectRoot);
    },
    { iterations: 10000 }
  );
});

describe('Path Traversal - Performance', () => {
  // Test various path complexities
  const paths = [
    { name: 'simple', path: 'src/index.ts' },
    { name: 'deep', path: 'src/components/ui/buttons/primary/index.tsx' },
    { name: 'dots', path: './src/../src/./index.ts' },
    { name: 'traversal', path: '../../../etc/passwd' },
    { name: 'encoded', path: '..%2f..%2f..%2fetc/passwd' },
    { name: 'unicode', path: '..／..／etc/passwd' },
    { name: 'absolute', path: '/etc/passwd' },
    { name: 'complex', path: 'src/[id]/[[...slug]]/page.tsx' },
  ];

  describe.each(paths)('Path complexity: $name', ({ name, path }) => {
    bench(
      `isPathSafe - ${name}`,
      () => {
        isPathSafe(path, projectRoot);
      },
      { iterations: 10000 }
    );
  });
});

describe('Path Traversal - Edge Cases', () => {
  bench(
    'empty path',
    () => {
      isPathSafe('', projectRoot);
    },
    { iterations: 10000 }
  );

  bench(
    'empty project root',
    () => {
      isPathSafe('src/index.ts', '');
    },
    { iterations: 10000 }
  );

  bench(
    'null-ish values',
    () => {
      isPathSafe(null as unknown as string, projectRoot);
      isPathSafe(undefined as unknown as string, projectRoot);
      isPathSafe('src/index.ts', null as unknown as string);
    },
    { iterations: 10000 }
  );

  bench(
    'very long path',
    () => {
      const longPath = 'src/' + 'nested/'.repeat(50) + 'file.ts';
      isPathSafe(longPath, projectRoot);
    },
    { iterations: 1000 }
  );

  bench(
    'many traversals',
    () => {
      const manyTraversals = '../'.repeat(100) + 'etc/passwd';
      isPathSafe(manyTraversals, projectRoot);
    },
    { iterations: 1000 }
  );

  bench(
    'path at project root boundary',
    () => {
      isPathSafe('.', projectRoot);
      isPathSafe('./', projectRoot);
      isPathSafe('..', projectRoot);
    },
    { iterations: 10000 }
  );
});

describe('Path Traversal - Concurrent Validation', () => {
  bench(
    'batch validate 100 paths',
    () => {
      const paths = [
        ...Array(50).fill('src/index.ts'),
        ...Array(50).fill('../../../etc/passwd'),
      ];
      for (const path of paths) {
        isPathSafe(path, projectRoot);
      }
    },
    { iterations: 100 }
  );
});

// Summary output
describe('Path Traversal - Summary', () => {
  bench(
    'generate summary',
    () => {
      const blockRate = results.attacks.blocked / results.attacks.total;
      const acceptRate = results.valid.accepted / results.valid.total;

      console.log('\n' + '='.repeat(60));
      console.log('PATH TRAVERSAL PREVENTION SUMMARY');
      console.log('='.repeat(60));
      console.log(
        `Attack Block Rate:   ${formatPercentage(blockRate, 1.0, true)} (${results.attacks.blocked}/${results.attacks.total})`
      );
      console.log(
        `Valid Accept Rate:   ${formatPercentage(acceptRate, 1.0, true)} (${results.valid.accepted}/${results.valid.total})`
      );

      if (results.attacks.failures.length > 0) {
        console.log('\nFailed to block (security risk):');
        for (const failure of results.attacks.failures.slice(0, 10)) {
          console.log(`  - ${failure}`);
        }
        if (results.attacks.failures.length > 10) {
          console.log(`  ... and ${results.attacks.failures.length - 10} more`);
        }
      }

      if (results.valid.failures.length > 0) {
        console.log('\nIncorrectly rejected (false negatives):');
        for (const failure of results.valid.failures.slice(0, 10)) {
          console.log(`  - ${failure}`);
        }
        if (results.valid.failures.length > 10) {
          console.log(`  ... and ${results.valid.failures.length - 10} more`);
        }
      }

      console.log('='.repeat(60) + '\n');

      // Assertions for CI - these are critical security tests
      expect(blockRate).toBeGreaterThanOrEqual(0.95); // Must block at least 95% of attacks
    },
    { iterations: 1 }
  );
});
