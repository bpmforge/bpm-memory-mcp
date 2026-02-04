/**
 * Benchmark 1: Credential Detection Effectiveness
 *
 * Measures:
 * - True positive rate (should block known credentials)
 * - False positive rate (should allow safe content)
 * - Bypass rate (evasion attempts)
 * - Latency for various content sizes
 */

import { describe, bench, expect, beforeAll } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { containsCredentials, getCredentialMatches } from '../../../mcp/memory-server/src/security/credentials.js';
import { generateContent } from '../utils/generators.js';
import { calculateStats, formatPercentage, formatTiming } from '../utils/reporter.js';

// Load test fixtures
const fixturesDir = join(__dirname, '../fixtures');

interface CredentialTestCase {
  content: string;
  pattern: string;
}

interface CredentialCategory {
  category: string;
  samples: CredentialTestCase[];
}

interface CredentialFixture {
  description: string;
  testCases: CredentialCategory[];
}

interface EvasionTestCase {
  content: string;
  description: string;
  expectedBlocked: boolean;
}

interface EvasionCategory {
  category: string;
  samples: EvasionTestCase[];
}

interface EvasionFixture {
  description: string;
  note: string;
  testCases: EvasionCategory[];
}

let positiveFixture: CredentialFixture;
let negativeFixture: CredentialFixture;
let evasionFixture: EvasionFixture;

// Results tracking
const results = {
  truePositives: { blocked: 0, total: 0, failures: [] as string[] },
  falsePositives: { blocked: 0, total: 0, failures: [] as string[] },
  evasion: { bypassed: 0, total: 0, details: [] as { content: string; expected: boolean; actual: boolean }[] },
};

beforeAll(() => {
  positiveFixture = JSON.parse(
    readFileSync(join(fixturesDir, 'credentials-positive.json'), 'utf-8')
  );
  negativeFixture = JSON.parse(
    readFileSync(join(fixturesDir, 'credentials-negative.json'), 'utf-8')
  );
  evasionFixture = JSON.parse(
    readFileSync(join(fixturesDir, 'credentials-evasion.json'), 'utf-8')
  );
});

describe('Credential Detection - True Positives', () => {
  // Test each category of known credentials
  describe.each([
    'passwords',
    'api_keys',
    'tokens',
    'private_keys',
    'aws_credentials',
    'database_urls',
    'platform_tokens',
    'high_entropy_strings',
    'secrets',
  ])('Category: %s', (categoryName) => {
    bench(
      `should block ${categoryName}`,
      () => {
        const category = positiveFixture.testCases.find(
          (c) => c.category === categoryName
        );
        if (!category) return;

        for (const sample of category.samples) {
          const blocked = containsCredentials(sample.content);
          results.truePositives.total++;
          if (blocked) {
            results.truePositives.blocked++;
          } else {
            results.truePositives.failures.push(
              `${categoryName}/${sample.pattern}: ${sample.content.slice(0, 50)}...`
            );
          }
        }
      },
      { iterations: 100 }
    );
  });
});

describe('Credential Detection - False Positives', () => {
  // Test each category of safe content
  describe.each([
    'code_references',
    'documentation',
    'variable_names',
    'safe_patterns',
    'technical_content',
  ])('Category: %s', (categoryName) => {
    bench(
      `should allow ${categoryName}`,
      () => {
        const category = negativeFixture.testCases.find(
          (c) => c.category === categoryName
        );
        if (!category) return;

        for (const sample of category.samples) {
          const blocked = containsCredentials(sample.content);
          results.falsePositives.total++;
          if (blocked) {
            results.falsePositives.blocked++;
            results.falsePositives.failures.push(
              `${categoryName}/${sample.pattern}: ${sample.content.slice(0, 50)}...`
            );
          }
        }
      },
      { iterations: 100 }
    );
  });
});

describe('Credential Detection - Evasion Attempts', () => {
  // Test evasion techniques
  describe.each([
    'encoding_tricks',
    'string_splitting',
    'unusual_formats',
    'edge_cases',
  ])('Category: %s', (categoryName) => {
    bench(
      `evasion: ${categoryName}`,
      () => {
        const category = evasionFixture.testCases.find(
          (c) => c.category === categoryName
        );
        if (!category) return;

        for (const sample of category.samples) {
          const blocked = containsCredentials(sample.content);
          results.evasion.total++;

          results.evasion.details.push({
            content: sample.description,
            expected: sample.expectedBlocked,
            actual: blocked,
          });

          // Count bypasses - cases that should be blocked but weren't
          if (sample.expectedBlocked && !blocked) {
            results.evasion.bypassed++;
          }
        }
      },
      { iterations: 100 }
    );
  });
});

describe('Credential Detection - Performance', () => {
  const contentSizes = [
    { name: '100 chars', size: 100 },
    { name: '500 chars', size: 500 },
    { name: '1K chars', size: 1000 },
    { name: '5K chars', size: 5000 },
    { name: '10K chars', size: 10000 },
    { name: '50K chars', size: 50000 },
  ];

  // Pre-generate content for consistent benchmarks
  const contentMap = new Map<number, string>();
  beforeAll(() => {
    for (const { size } of contentSizes) {
      contentMap.set(size, generateContent(size));
    }
  });

  describe.each(contentSizes)('Content size: $name', ({ size }) => {
    bench(
      `check ${size} chars - clean content`,
      () => {
        const content = contentMap.get(size) ?? generateContent(size);
        containsCredentials(content);
      },
      { iterations: 1000 }
    );

    bench(
      `check ${size} chars - with credential`,
      () => {
        const baseContent = contentMap.get(size) ?? generateContent(size);
        const content = baseContent + '\npassword="secret123"';
        containsCredentials(content);
      },
      { iterations: 1000 }
    );
  });
});

describe('Credential Detection - Pattern Matching', () => {
  // Test individual patterns in isolation
  const patterns = [
    { name: 'password', content: 'password="secret"' },
    { name: 'api_key', content: 'api_key="sk-abc123"' },
    { name: 'bearer', content: 'Bearer eyJhbGciOiJIUzI1NiJ9' },
    { name: 'private_key', content: '-----BEGIN RSA PRIVATE KEY-----' },
    { name: 'aws_secret', content: 'aws_secret_access_key="wJalrXUtnFEMI"' },
    { name: 'mongodb', content: 'mongodb://user:pass@localhost' },
    { name: 'github_token', content: 'ghp_1234567890abcdefghijklmnopqrstuvwxyz' },
    { name: 'high_entropy', content: '"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"' },
  ];

  describe.each(patterns)('Pattern: $name', ({ name, content }) => {
    bench(
      `detect ${name}`,
      () => {
        containsCredentials(content);
      },
      { iterations: 10000 }
    );

    bench(
      `get matches for ${name}`,
      () => {
        getCredentialMatches(content);
      },
      { iterations: 10000 }
    );
  });
});

// Summary output (runs after all benchmarks)
describe('Credential Detection - Summary', () => {
  bench(
    'generate summary',
    () => {
      const truePositiveRate = results.truePositives.blocked / results.truePositives.total;
      const falsePositiveRate = results.falsePositives.blocked / results.falsePositives.total;
      const bypassRate = results.evasion.bypassed / results.evasion.total;

      console.log('\n' + '='.repeat(60));
      console.log('CREDENTIAL DETECTION EFFECTIVENESS SUMMARY');
      console.log('='.repeat(60));
      console.log(
        `True Positive Rate:  ${formatPercentage(truePositiveRate, 0.95, true)} (${results.truePositives.blocked}/${results.truePositives.total})`
      );
      console.log(
        `False Positive Rate: ${formatPercentage(falsePositiveRate, 0.05, false)} (${results.falsePositives.blocked}/${results.falsePositives.total})`
      );
      console.log(
        `Bypass Rate:         ${formatPercentage(bypassRate, 0.10, false)} (${results.evasion.bypassed}/${results.evasion.total})`
      );

      if (results.truePositives.failures.length > 0) {
        console.log('\nMissed detections (false negatives):');
        for (const failure of results.truePositives.failures.slice(0, 10)) {
          console.log(`  - ${failure}`);
        }
        if (results.truePositives.failures.length > 10) {
          console.log(`  ... and ${results.truePositives.failures.length - 10} more`);
        }
      }

      if (results.falsePositives.failures.length > 0) {
        console.log('\nFalse alarms (incorrectly blocked):');
        for (const failure of results.falsePositives.failures.slice(0, 10)) {
          console.log(`  - ${failure}`);
        }
        if (results.falsePositives.failures.length > 10) {
          console.log(`  ... and ${results.falsePositives.failures.length - 10} more`);
        }
      }

      console.log('='.repeat(60) + '\n');

      // Assertions for CI
      expect(truePositiveRate).toBeGreaterThan(0.9); // >90% true positive
      expect(falsePositiveRate).toBeLessThan(0.1); // <10% false positive
    },
    { iterations: 1 }
  );
});
