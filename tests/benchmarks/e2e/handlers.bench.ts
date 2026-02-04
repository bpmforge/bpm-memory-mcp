/**
 * End-to-End Handler Benchmarks
 *
 * These benchmarks test the ACTUAL user experience by exercising
 * the full handler logic including:
 * - Zod schema parsing
 * - Security checks
 * - Database operations
 * - Response formatting
 *
 * Note: Embedding generation is mocked since it's an external dependency
 * (Ollama/LM Studio) that would dominate all measurements.
 */

import { describe, bench, beforeAll, afterAll, beforeEach } from 'vitest';
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { createHash, randomUUID } from 'crypto';
import Database from 'better-sqlite3';

// Import actual modules used by handlers
import {
  MemoryStoreInputSchema,
  MemoryRecallInputSchema,
  MemoryForgetInputSchema,
  SessionSaveInputSchema,
  type MemoryCreateInput,
  type SearchOptions,
  type CodeContext,
} from '../../../mcp/memory-server/src/types.js';
import { containsCredentials } from '../../../mcp/memory-server/src/security/credentials.js';
import { isPathSafe } from '../../../mcp/memory-server/src/security/paths.js';
import { parseCodeContext } from '../../../mcp/memory-server/src/language/context.js';
import { MemoryRepository } from '../../../mcp/memory-server/src/storage/repository.js';
import { SessionRepository } from '../../../mcp/memory-server/src/storage/session.js';
import { StalenessDetector } from '../../../mcp/memory-server/src/staleness/detector.js';

import {
  generateContent,
  generateMemoriesWithCitations,
  initBenchmarkSchema,
  insertMemories,
  createSessions,
  createTempDir,
  cleanupTempDir,
} from '../utils/generators.js';

// Test infrastructure
let projectRoot: string;
let db: Database.Database;
let memoryRepository: MemoryRepository;
let sessionRepository: SessionRepository;
let stalenessDetector: StalenessDetector;

const projectId = 'e2e-bench';
const MAX_MEMORIES_PER_PROJECT = 10000;

// Mock DatabaseConnection to match the interface expected by repositories
class MockDatabaseConnection {
  constructor(
    public instance: Database.Database,
    public project: string
  ) {}

  transaction<T>(fn: () => T): T {
    return this.instance.transaction(fn)();
  }

  close(): void {
    this.instance.close();
  }
}

// Mock embedding service (returns consistent embeddings based on content hash)
function mockEmbed(content: string): Float32Array {
  const hash = createHash('sha256').update(content).digest();
  // Create a 384-dimensional embedding from hash (typical small embedding size)
  const embedding = new Float32Array(384);
  for (let i = 0; i < 384; i++) {
    embedding[i] = (hash[i % hash.length] - 128) / 128;
  }
  return embedding;
}

/**
 * Simulates the FULL memory_store handler logic
 * This is exactly what the MCP handler does, minus the Server wrapper
 */
function handleMemoryStore(args: unknown): { content: { type: string; text: string }[]; isError?: boolean } {
  // Step 1: Zod parsing (real overhead)
  const input = MemoryStoreInputSchema.parse(args);

  // Step 2: Security - credential check (SC-001)
  if (containsCredentials(input.content)) {
    return {
      content: [{ type: 'text', text: 'Error: Content appears to contain credentials or secrets. Memory not stored.' }],
      isError: true,
    };
  }

  // Step 3: Security - path validation (SC-002)
  if (input.citation) {
    const parsed = parseCodeContext(input.citation);
    if (parsed && !isPathSafe(parsed.filePath, projectRoot)) {
      return {
        content: [{ type: 'text', text: 'Error: Citation path is outside project root.' }],
        isError: true,
      };
    }
  }

  // Step 4: Storage quota check
  if (memoryRepository.getMemoryCount(projectId) >= MAX_MEMORIES_PER_PROJECT) {
    return {
      content: [{ type: 'text', text: `Error: Storage limit reached (${MAX_MEMORIES_PER_PROJECT} memories).` }],
      isError: true,
    };
  }

  // Step 5: Generate embedding (mocked - real would be ~100-500ms external call)
  const embedding = mockEmbed(input.content);

  // Step 6: Duplicate check
  if (memoryRepository.isDuplicateContent(input.content, projectId)) {
    return {
      content: [{ type: 'text', text: 'Memory already exists (duplicate content)' }],
    };
  }

  // Step 7: Build memory input
  const memoryInput: MemoryCreateInput = {
    content: input.content,
    type: input.type,
    confidence: input.confidence,
    projectId,
  };
  if (input.citation) memoryInput.citation = input.citation;
  if (input.language) memoryInput.language = input.language;
  if (input.codeContext) {
    const ctx: CodeContext = {
      filePath: input.codeContext.filePath,
      startLine: input.codeContext.startLine,
    };
    if (input.codeContext.endLine !== undefined) ctx.endLine = input.codeContext.endLine;
    if (input.codeContext.symbolName !== undefined) ctx.symbolName = input.codeContext.symbolName;
    if (input.codeContext.symbolType !== undefined) ctx.symbolType = input.codeContext.symbolType;
    memoryInput.codeContext = ctx;
  }

  // Step 8: Create memory in DB
  const memory = memoryRepository.createMemory(memoryInput, embedding, projectRoot);

  // Step 9: Format response
  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify({
          id: memory.id,
          type: memory.type,
          confidence: memory.confidence,
          hasEmbedding: !!memory.embedding,
          language: memory.language,
          version: memory.version,
        }),
      },
    ],
  };
}

/**
 * Simulates the FULL session_restore handler logic
 */
function handleSessionRestore(): { content: { type: string; text: string }[] } {
  const session = sessionRepository.getLatestSession(projectId);

  // Always run staleness detection (this is the expensive part)
  const staleReport = {
    accessStale: stalenessDetector.detectAccessStale(projectId).length,
    sourceMissing: stalenessDetector.detectSourceMissing(projectId, projectRoot).length,
    lowConfidence: stalenessDetector.detectLowConfidence(projectId).length,
    contentChanged: stalenessDetector.detectContentChanged(projectId, projectRoot).length,
  };

  if (!session) {
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            message: 'No previous session found',
            isNewSession: true,
            stalenessReport: staleReport,
          }),
        },
      ],
    };
  }

  sessionRepository.markResumed(session.id);

  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify({
          sessionId: session.id,
          summary: session.conversationSummary,
          createdAt: session.createdAt.toISOString(),
          stalenessReport: staleReport,
          message: 'Session restored successfully',
        }),
      },
    ],
  };
}

/**
 * Simulates the session_save handler
 */
function handleSessionSave(args: unknown): { content: { type: string; text: string }[] } {
  const input = SessionSaveInputSchema.parse(args ?? {});

  const workingMemory = sessionRepository.createDefaultWorkingMemory();
  const summary = input.summary ?? 'Session saved automatically';
  const sessionId = sessionRepository.saveSession(projectId, workingMemory, summary);

  sessionRepository.pruneOldSessions(projectId, 10);

  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify({
          sessionId,
          summary,
          message: 'Session saved successfully',
        }),
      },
    ],
  };
}

/**
 * Simulates memory_forget handler
 */
function handleMemoryForget(args: unknown): { content: { type: string; text: string }[] } {
  const input = MemoryForgetInputSchema.parse(args);
  const success = memoryRepository.softDelete(input.id, projectId, input.reason);

  return {
    content: [
      {
        type: 'text',
        text: success
          ? `Memory ${input.id} marked as deleted`
          : `Memory ${input.id} not found or already deleted`,
      },
    ],
  };
}

// Setup & Teardown
beforeAll(() => {
  projectRoot = createTempDir('e2e-handlers');
  mkdirSync(join(projectRoot, 'src'), { recursive: true });

  db = new Database(':memory:');

  // Initialize with FULL schema (matching production)
  db.exec(`
    CREATE TABLE IF NOT EXISTS memories (
      id TEXT PRIMARY KEY,
      content TEXT NOT NULL,
      embedding BLOB,
      type TEXT NOT NULL DEFAULT 'fact',
      confidence REAL NOT NULL DEFAULT 0.8,
      citation TEXT,
      project_id TEXT NOT NULL,
      content_hash TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      accessed_at INTEGER NOT NULL,
      access_count INTEGER NOT NULL DEFAULT 1,
      deleted_at INTEGER,
      deleted_reason TEXT,
      language TEXT,
      code_context TEXT,
      version INTEGER NOT NULL DEFAULT 1,
      supersedes_id TEXT,
      superseded_by TEXT,
      superseded_at INTEGER,
      flagged_at INTEGER,
      flagged_reason TEXT,
      embedding_model TEXT
    );

    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      session_number INTEGER,
      created_at INTEGER NOT NULL,
      resumed_at INTEGER,
      working_memory TEXT NOT NULL DEFAULT '{}',
      core_memory_snapshot TEXT NOT NULL DEFAULT '{}',
      conversation_summary TEXT NOT NULL DEFAULT ''
    );

    CREATE TABLE IF NOT EXISTS memory_feedback (
      id TEXT PRIMARY KEY,
      memory_id TEXT NOT NULL,
      project_id TEXT NOT NULL,
      feedback_type TEXT NOT NULL,
      correction TEXT,
      duplicate_of TEXT,
      confidence_delta REAL NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      FOREIGN KEY (memory_id) REFERENCES memories(id)
    );

    CREATE TABLE IF NOT EXISTS core_memory (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      section TEXT NOT NULL,
      content TEXT NOT NULL,
      updated_at INTEGER NOT NULL,
      UNIQUE(project_id, section)
    );

    CREATE INDEX IF NOT EXISTS idx_memories_project ON memories(project_id);
    CREATE INDEX IF NOT EXISTS idx_memories_hash ON memories(content_hash, project_id);
    CREATE INDEX IF NOT EXISTS idx_memories_accessed ON memories(accessed_at);
    CREATE INDEX IF NOT EXISTS idx_sessions_project ON sessions(project_id);
  `);

  // Initialize repositories with mock connection
  const mockDb = new MockDatabaseConnection(db, projectId);
  memoryRepository = new MemoryRepository(mockDb as any);
  sessionRepository = new SessionRepository(mockDb as any);
  stalenessDetector = new StalenessDetector(mockDb as any);
});

afterAll(() => {
  db.close();
  cleanupTempDir(projectRoot);
});

// ============================================================================
// BENCHMARKS: memory_store end-to-end
// ============================================================================

describe('E2E: memory_store Handler', () => {
  beforeEach(() => {
    db.exec('DELETE FROM memories');
  });

  const contentSizes = [
    { name: '100 chars', size: 100 },
    { name: '500 chars', size: 500 },
    { name: '1K chars', size: 1000 },
    { name: '5K chars', size: 5000 },
  ];

  describe.each(contentSizes)('Content size: $name', ({ name, size }) => {
    bench(
      `memory_store - ${name} - clean content`,
      () => {
        const content = generateContent(size);
        handleMemoryStore({
          content,
          type: 'fact',
          confidence: 0.8,
        });
      },
      { iterations: 100 }
    );

    bench(
      `memory_store - ${name} - with citation`,
      () => {
        const content = generateContent(size);
        const filepath = 'src/test.ts';
        writeFileSync(join(projectRoot, filepath), content);

        handleMemoryStore({
          content,
          type: 'pattern',
          confidence: 0.9,
          citation: `${filepath}:1-10`,
          language: 'typescript',
        });
      },
      { iterations: 100 }
    );

    bench(
      `memory_store - ${name} - with codeContext`,
      () => {
        const content = generateContent(size);
        handleMemoryStore({
          content,
          type: 'fact',
          confidence: 0.8,
          citation: 'src/handler.ts:42-58',
          codeContext: {
            filePath: 'src/handler.ts',
            startLine: 42,
            endLine: 58,
            symbolName: 'handleRequest',
            symbolType: 'function',
          },
        });
      },
      { iterations: 100 }
    );
  });

  // Security check benchmarks
  bench(
    'memory_store - blocked by credential check',
    () => {
      const result = handleMemoryStore({
        content: 'Config: password="secret123" for database',
        type: 'fact',
        confidence: 0.8,
      });
      // Should be blocked
      if (!result.isError) throw new Error('Expected block');
    },
    { iterations: 1000 }
  );

  bench(
    'memory_store - blocked by path traversal',
    () => {
      const result = handleMemoryStore({
        content: 'File content from sensitive location',
        type: 'fact',
        citation: '../../../etc/passwd:1',
      });
      // Should be blocked
      if (!result.isError) throw new Error('Expected block');
    },
    { iterations: 1000 }
  );
});

// ============================================================================
// BENCHMARKS: session_restore end-to-end
// ============================================================================

describe('E2E: session_restore Handler', () => {
  const memoryCounts = [100, 500, 1000, 2500];

  describe.each(memoryCounts)('With %i memories', (count) => {
    beforeEach(() => {
      // Clear and setup
      db.exec('DELETE FROM memories');
      db.exec('DELETE FROM sessions');

      const srcDir = join(projectRoot, 'src');
      if (existsSync(srcDir)) {
        rmSync(srcDir, { recursive: true, force: true });
      }
      mkdirSync(srcDir, { recursive: true });

      // Create sessions
      createSessions(db, projectId, 15);

      // Create memories with varying characteristics
      const { memories } = generateMemoriesWithCitations(count, 0.3, projectRoot, 0.05, 0.05);

      // Set some with old access times and low confidence
      const threshold = Math.floor(Date.now() / 1000) - 86400 * 30;
      for (let i = 0; i < Math.floor(count * 0.2); i++) {
        memories[i].accessed_at = threshold - 3600;
        memories[i].confidence = 0.3;
      }

      insertMemories(db, memories);
    });

    bench(
      `session_restore - ${count} memories (no files)`,
      () => {
        handleSessionRestore();
      },
      { iterations: 10 }
    );
  });

  // Realistic scenario with file I/O
  bench(
    'session_restore - 500 memories with 30% files',
    () => {
      handleSessionRestore();
    },
    { iterations: 10 }
  );
});

// ============================================================================
// BENCHMARKS: session_save end-to-end
// ============================================================================

describe('E2E: session_save Handler', () => {
  bench(
    'session_save - minimal',
    () => {
      handleSessionSave({});
    },
    { iterations: 100 }
  );

  bench(
    'session_save - with summary',
    () => {
      handleSessionSave({
        summary: 'Implemented user authentication module with JWT tokens and session management.',
      });
    },
    { iterations: 100 }
  );

  bench(
    'session_save - with long summary',
    () => {
      handleSessionSave({
        summary: generateContent(2000),
      });
    },
    { iterations: 100 }
  );
});

// ============================================================================
// BENCHMARKS: memory_forget end-to-end
// ============================================================================

describe('E2E: memory_forget Handler', () => {
  let memoryIds: string[] = [];

  beforeEach(() => {
    db.exec('DELETE FROM memories');

    // Create memories to forget
    memoryIds = [];
    for (let i = 0; i < 100; i++) {
      const result = handleMemoryStore({
        content: generateContent(500),
        type: 'fact',
        confidence: 0.8,
      });
      const data = JSON.parse(result.content[0].text);
      memoryIds.push(data.id);
    }
  });

  bench(
    'memory_forget - existing memory',
    () => {
      const id = memoryIds[Math.floor(Math.random() * memoryIds.length)];
      handleMemoryForget({
        id,
        reason: 'No longer relevant',
      });
    },
    { iterations: 100 }
  );

  bench(
    'memory_forget - non-existent memory',
    () => {
      handleMemoryForget({
        id: randomUUID(),
        reason: 'Cleanup',
      });
    },
    { iterations: 100 }
  );
});

// ============================================================================
// BENCHMARKS: Combined Workflow (realistic user session)
// ============================================================================

describe('E2E: Realistic User Workflow', () => {
  bench(
    'typical session: restore → store 5 → save',
    () => {
      // 1. Restore session (staleness check)
      handleSessionRestore();

      // 2. Store 5 memories (typical session might store 3-10)
      for (let i = 0; i < 5; i++) {
        handleMemoryStore({
          content: generateContent(800),
          type: i % 2 === 0 ? 'fact' : 'pattern',
          confidence: 0.8 + Math.random() * 0.2,
          citation: `src/file${i}.ts:${i * 10}-${i * 10 + 20}`,
        });
      }

      // 3. Save session
      handleSessionSave({
        summary: 'Implemented feature X with patterns Y and Z',
      });
    },
    { iterations: 20 }
  );

  bench(
    'heavy session: restore → store 20 → forget 5 → save',
    () => {
      // 1. Restore session
      handleSessionRestore();

      // 2. Store many memories
      const ids: string[] = [];
      for (let i = 0; i < 20; i++) {
        const result = handleMemoryStore({
          content: generateContent(500),
          type: 'fact',
          confidence: 0.8,
        });
        if (!result.isError) {
          const data = JSON.parse(result.content[0].text);
          ids.push(data.id);
        }
      }

      // 3. Forget some (simulating corrections/cleanup)
      for (let i = 0; i < 5 && i < ids.length; i++) {
        handleMemoryForget({
          id: ids[i],
          reason: 'Superseded by better information',
        });
      }

      // 4. Save session
      handleSessionSave({
        summary: 'Major refactoring session with lots of patterns discovered',
      });
    },
    { iterations: 10 }
  );
});

// ============================================================================
// Summary
// ============================================================================

describe('E2E: Summary', () => {
  bench(
    'generate summary',
    () => {
      console.log('\n' + '='.repeat(60));
      console.log('END-TO-END HANDLER BENCHMARK SUMMARY');
      console.log('='.repeat(60));
      console.log('');
      console.log('These benchmarks measure ACTUAL user experience by testing');
      console.log('the full handler logic including:');
      console.log('  - Zod schema validation');
      console.log('  - Security checks (credential detection, path validation)');
      console.log('  - Database operations (real SQLite queries)');
      console.log('  - Staleness detection (all 4 detectors)');
      console.log('  - Response formatting');
      console.log('');
      console.log('NOTE: Embedding generation is mocked (~0ms vs ~100-500ms real)');
      console.log('Add ~100-500ms to memory_store times for real-world usage.');
      console.log('');
      console.log('Target latencies (excluding embedding):');
      console.log('  - memory_store: < 10ms');
      console.log('  - session_restore (1000 memories): < 500ms');
      console.log('  - session_save: < 50ms');
      console.log('  - memory_forget: < 5ms');
      console.log('='.repeat(60) + '\n');
    },
    { iterations: 1 }
  );
});
