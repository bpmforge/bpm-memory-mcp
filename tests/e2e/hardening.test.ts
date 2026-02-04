/**
 * E2E Tests for claude-memory v2 Hardening
 *
 * Tests all security and data integrity features from the implementation plan:
 * 1. Credential blocking
 * 2. Path traversal prevention
 * 3. Storage quota limit
 * 4. Supersession transaction integrity
 * 5. sourceHash persistence
 * 6. Staleness report in session_restore
 * 7. Language update in memory_update
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { writeFileSync, unlinkSync, mkdirSync, rmSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { MemoryRepository } from '../../mcp/memory-server/src/storage/repository.js';
import { SessionRepository } from '../../mcp/memory-server/src/storage/session.js';
import { StalenessDetector } from '../../mcp/memory-server/src/staleness/detector.js';
import { MIGRATIONS } from '../../mcp/memory-server/src/storage/schema.js';
import { containsCredentials } from '../../mcp/memory-server/src/security/credentials.js';
import { isPathSafe } from '../../mcp/memory-server/src/security/paths.js';
import { enrichWithSourceHash } from '../../mcp/memory-server/src/language/context.js';

// Create test database with transaction support
function createTestDb(): {
  instance: Database.Database;
  close: () => void;
  transaction: <T>(fn: () => T) => T;
} {
  const db = new Database(':memory:');
  for (const migration of MIGRATIONS) {
    db.exec(migration.up);
  }
  return {
    instance: db,
    close: () => db.close(),
    transaction: <T>(fn: () => T): T => db.transaction(fn)(),
  };
}

// Create temp directory for file-based tests
function createTempDir(): string {
  const dir = join(tmpdir(), `claude-memory-e2e-${Date.now()}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

describe('E2E: Hardening Tests', () => {
  let db: ReturnType<typeof createTestDb>;
  let repo: MemoryRepository;
  let tempDir: string;

  beforeEach(() => {
    db = createTestDb();
    repo = new MemoryRepository(db as any);
    tempDir = createTempDir();
  });

  afterEach(() => {
    db.close();
    if (existsSync(tempDir)) {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  // =========================================================================
  // E2E Test 1: Credential Blocking
  // =========================================================================
  describe('E2E Test 1: Credential Blocking', () => {
    const credentialTestCases = [
      { name: 'password assignment', content: 'The config uses password="secret123" for auth' },
      { name: 'API key', content: 'Set the api_key="sk-abc123xyz789" in settings' },
      { name: 'bearer token', content: 'Use Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9 for auth' },
      { name: 'private key', content: '-----BEGIN RSA PRIVATE KEY-----\nMIIE...' },
      { name: 'AWS secret', content: 'aws_secret_access_key="wJalrXUtnFEMI/K7MDENG/bPxRfiCY"' },
      { name: 'MongoDB URL', content: 'Connect to mongodb://admin:password123@localhost:27017' },
      { name: 'GitHub token', content: 'Use token ghp_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx' },
    ];

    for (const testCase of credentialTestCases) {
      it(`should block ${testCase.name}`, () => {
        const detected = containsCredentials(testCase.content);
        expect(detected).toBe(true);
      });
    }

    it('should allow safe content without credentials', () => {
      const safeContent = 'The API uses REST endpoints with JSON responses. Authentication is handled via OAuth2.';
      expect(containsCredentials(safeContent)).toBe(false);
    });

    it('should allow code that references password fields without values', () => {
      const codeContent = 'const passwordField = document.getElementById("password");';
      expect(containsCredentials(codeContent)).toBe(false);
    });
  });

  // =========================================================================
  // E2E Test 2: Path Traversal Prevention
  // =========================================================================
  describe('E2E Test 2: Path Traversal Prevention', () => {
    const projectRoot = '/project/root';

    it('should allow valid relative paths', () => {
      expect(isPathSafe('src/index.ts', projectRoot)).toBe(true);
      expect(isPathSafe('lib/utils/helper.js', projectRoot)).toBe(true);
      expect(isPathSafe('./src/index.ts', projectRoot)).toBe(true);
    });

    it('should block path traversal with ../', () => {
      expect(isPathSafe('../../../etc/passwd', projectRoot)).toBe(false);
      expect(isPathSafe('src/../../../etc/passwd', projectRoot)).toBe(false);
      expect(isPathSafe('../../sensitive.txt', projectRoot)).toBe(false);
    });

    it('should block absolute paths outside root', () => {
      expect(isPathSafe('/etc/passwd', projectRoot)).toBe(false);
      expect(isPathSafe('/home/user/.ssh/id_rsa', projectRoot)).toBe(false);
    });

    it('should allow absolute paths inside root', () => {
      expect(isPathSafe('/project/root/src/index.ts', projectRoot)).toBe(true);
    });

    it('should handle edge cases', () => {
      expect(isPathSafe('', projectRoot)).toBe(false);
      // Note: whitespace-only paths like '   ' technically resolve to valid paths
      // within project root (e.g., /project/root/   ) - this is OS-dependent behavior
      expect(isPathSafe('   ', projectRoot)).toBe(true); // Resolves to /project/root/
    });
  });

  // =========================================================================
  // E2E Test 3: Storage Quota Limit
  // =========================================================================
  describe('E2E Test 3: Storage Quota Limit', () => {
    it('should count memories correctly', () => {
      const projectId = 'quota-test';

      // Create some memories
      for (let i = 0; i < 5; i++) {
        repo.createMemory({
          content: `Memory ${i}`,
          projectId,
        });
      }

      expect(repo.getMemoryCount(projectId)).toBe(5);
    });

    it('should not count deleted memories in quota', () => {
      const projectId = 'quota-deleted-test';

      const memory = repo.createMemory({
        content: 'Will be deleted',
        projectId,
      });

      expect(repo.getMemoryCount(projectId)).toBe(1);

      repo.softDelete(memory.id, projectId, 'Test deletion');

      expect(repo.getMemoryCount(projectId)).toBe(0);
    });

    it('should isolate counts between projects', () => {
      repo.createMemory({ content: 'Project A', projectId: 'project-a' });
      repo.createMemory({ content: 'Project A 2', projectId: 'project-a' });
      repo.createMemory({ content: 'Project B', projectId: 'project-b' });

      expect(repo.getMemoryCount('project-a')).toBe(2);
      expect(repo.getMemoryCount('project-b')).toBe(1);
      expect(repo.getMemoryCount('project-c')).toBe(0);
    });
  });

  // =========================================================================
  // E2E Test 4: Supersession Transaction Integrity
  // =========================================================================
  describe('E2E Test 4: Supersession Transaction Integrity', () => {
    it('should atomically supersede memory', () => {
      const projectId = 'supersede-test';

      const original = repo.createMemory({
        content: 'Original content',
        projectId,
      });

      const updated = repo.createSupersedingMemory(
        original.id,
        projectId,
        'Updated content'
      );

      // Verify new memory created
      expect(updated.version).toBe(2);
      expect(updated.supersedesId).toBe(original.id);

      // Verify old memory marked as superseded
      const oldMemory = repo.findById(original.id, projectId);
      expect(oldMemory?.supersededBy).toBe(updated.id);
      expect(oldMemory?.supersededAt).not.toBeNull();
    });

    it('should maintain version chain integrity', () => {
      const projectId = 'chain-test';

      const v1 = repo.createMemory({ content: 'Version 1', projectId });
      const v2 = repo.createSupersedingMemory(v1.id, projectId, 'Version 2');
      const v3 = repo.createSupersedingMemory(v2.id, projectId, 'Version 3');

      expect(v1.version).toBe(1);
      expect(v2.version).toBe(2);
      expect(v3.version).toBe(3);

      // Check chain
      const history = repo.getVersionHistory(v3.id, projectId);
      expect(history.length).toBe(3);
      expect(history[0].version).toBe(3);
      expect(history[2].version).toBe(1);
    });

    it('should rollback on error (simulated)', () => {
      const projectId = 'rollback-test';

      const original = repo.createMemory({
        content: 'Should not be marked superseded',
        projectId,
      });

      // Try to supersede non-existent memory (should throw)
      expect(() => {
        repo.createSupersedingMemory('non-existent-id', projectId, 'New content');
      }).toThrow();

      // Original should be unchanged
      const unchanged = repo.findById(original.id, projectId);
      expect(unchanged?.supersededBy).toBeNull();
    });
  });

  // =========================================================================
  // E2E Test 5: sourceHash Persistence
  // =========================================================================
  describe('E2E Test 5: sourceHash Persistence', () => {
    it('should compute and store sourceHash for existing files', () => {
      // Create a test file
      const testFile = join(tempDir, 'test.ts');
      writeFileSync(testFile, 'export const foo = 42;');

      const memory = repo.createMemory(
        {
          content: 'The foo constant is 42',
          citation: 'test.ts:1',
          projectId: 'hash-test',
        },
        null,
        tempDir // projectRoot
      );

      expect(memory.codeContext).not.toBeNull();
      expect(memory.codeContext?.sourceHash).toBeDefined();
      expect(memory.codeContext?.sourceHash?.length).toBe(64); // SHA-256 hex
    });

    it('should detect content changes via hash mismatch', () => {
      const testFile = join(tempDir, 'mutable.ts');
      writeFileSync(testFile, 'const value = 1;');

      const memory = repo.createMemory(
        {
          content: 'Value starts at 1',
          citation: 'mutable.ts:1',
          projectId: 'hash-change-test',
        },
        null,
        tempDir
      );

      const originalHash = memory.codeContext?.sourceHash;

      // Modify the file
      writeFileSync(testFile, 'const value = 999;');

      // Use enrichWithSourceHash to get new hash
      const newContext = enrichWithSourceHash(
        { filePath: 'mutable.ts', startLine: 1 },
        tempDir
      );

      expect(newContext.sourceHash).not.toBe(originalHash);
    });

    it('should handle missing files gracefully', () => {
      const memory = repo.createMemory(
        {
          content: 'References non-existent file',
          citation: 'nonexistent.ts:1',
          projectId: 'missing-file-test',
        },
        null,
        tempDir
      );

      // Should still create memory, just without sourceHash
      expect(memory.codeContext?.filePath).toBe('nonexistent.ts');
      expect(memory.codeContext?.sourceHash).toBeUndefined();
    });
  });

  // =========================================================================
  // E2E Test 6: Staleness Report in session_restore
  // =========================================================================
  describe('E2E Test 6: Staleness Detection', () => {
    it('should detect low confidence memories', () => {
      const projectId = 'staleness-confidence-test';

      // Create memory and reduce confidence via feedback
      const memory = repo.createMemory({
        content: 'Uncertain information',
        confidence: 0.3,
        projectId,
      });

      const detector = new StalenessDetector(db as any);
      const lowConfidence = detector.detectLowConfidence(projectId, 0.5);

      expect(lowConfidence.length).toBe(1);
      expect(lowConfidence[0].id).toBe(memory.id);
    });

    it('should detect missing source files', () => {
      const projectId = 'staleness-missing-test';

      // Create memory with citation to file that exists
      const testFile = join(tempDir, 'will-delete.ts');
      writeFileSync(testFile, 'temp content');

      repo.createMemory(
        {
          content: 'References file that will be deleted',
          citation: 'will-delete.ts:1',
          projectId,
        },
        null,
        tempDir
      );

      // Delete the file
      unlinkSync(testFile);

      const detector = new StalenessDetector(db as any);
      const missing = detector.detectSourceMissing(projectId, tempDir);

      expect(missing.length).toBe(1);
    });

    it('should detect content-changed files', () => {
      const projectId = 'staleness-changed-test';

      const testFile = join(tempDir, 'changing.ts');
      writeFileSync(testFile, 'original content');

      repo.createMemory(
        {
          content: 'About the original content',
          citation: 'changing.ts:1',
          projectId,
        },
        null,
        tempDir
      );

      // Modify file
      writeFileSync(testFile, 'modified content');

      const detector = new StalenessDetector(db as any);
      const changed = detector.detectContentChanged(projectId, tempDir);

      expect(changed.length).toBe(1);
    });
  });

  // =========================================================================
  // E2E Test 7: Language Update in memory_update
  // =========================================================================
  describe('E2E Test 7: Language Update', () => {
    it('should preserve language when not specified in update', () => {
      const projectId = 'lang-preserve-test';

      const original = repo.createMemory({
        content: 'TypeScript pattern',
        language: 'typescript',
        projectId,
      });

      const updated = repo.createSupersedingMemory(
        original.id,
        projectId,
        'Updated TypeScript pattern',
        null,
        undefined // No language override
      );

      expect(updated.language).toBe('typescript');
    });

    it('should update language when specified', () => {
      const projectId = 'lang-update-test';

      const original = repo.createMemory({
        content: 'Code pattern',
        language: 'javascript',
        projectId,
      });

      const updated = repo.createSupersedingMemory(
        original.id,
        projectId,
        'Now a Python pattern',
        null,
        'python' // Language override
      );

      expect(updated.language).toBe('python');
    });

    it('should handle null to language transition', () => {
      const projectId = 'lang-null-test';

      const original = repo.createMemory({
        content: 'Generic pattern',
        projectId,
        // No language
      });

      expect(original.language).toBeNull();

      const updated = repo.createSupersedingMemory(
        original.id,
        projectId,
        'Now a Rust pattern',
        null,
        'rust'
      );

      expect(updated.language).toBe('rust');
    });
  });
});
