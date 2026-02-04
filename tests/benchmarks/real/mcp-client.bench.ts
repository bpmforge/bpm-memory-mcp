/**
 * REAL End-User Benchmarks
 *
 * These benchmarks measure the ACTUAL user experience by:
 * 1. Spawning the real MCP server as a subprocess
 * 2. Making real MCP protocol calls via StdioClientTransport
 * 3. Using real LM Studio embeddings (if available)
 * 4. Measuring actual round-trip latencies
 *
 * This is what Claude Code experiences when using the memory plugin.
 *
 * Run with: npm run bench:real
 * Requires: LM Studio running on localhost:1234 (optional, degrades gracefully)
 */

import { describe, bench, beforeAll, afterAll, expect } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { execSync } from 'child_process';

// Test infrastructure
let client: Client;
let transport: StdioClientTransport;
let projectRoot: string;
let serverReady = false;

// Track results for comparison
const results = {
  memoryStore: [] as number[],
  memoryRecall: [] as number[],
  sessionRestore: [] as number[],
  sessionSave: [] as number[],
};

/**
 * Generate test content of specified length
 */
function generateContent(length: number): string {
  const words = [
    'The', 'authentication', 'module', 'uses', 'JWT', 'tokens', 'with',
    'refresh', 'mechanism', 'implemented', 'in', 'TypeScript', 'following',
    'the', 'repository', 'pattern', 'for', 'database', 'access', 'and',
    'dependency', 'injection', 'for', 'service', 'composition', 'which',
    'enables', 'better', 'testing', 'and', 'modularity', 'across', 'the',
    'codebase', 'architecture', 'decisions', 'are', 'documented', 'here',
  ];
  const result: string[] = [];
  while (result.join(' ').length < length) {
    result.push(words[Math.floor(Math.random() * words.length)]);
  }
  return result.join(' ').slice(0, length);
}

/**
 * Measure a tool call and return duration in milliseconds
 */
async function measureToolCall(
  toolName: string,
  args: Record<string, unknown>
): Promise<{ duration: number; result: unknown }> {
  const start = performance.now();
  const result = await client.callTool({ name: toolName, arguments: args });
  const duration = performance.now() - start;
  return { duration, result };
}

// ============================================================================
// SETUP: Start real MCP server
// ============================================================================

beforeAll(async () => {
  // Create temporary project directory
  projectRoot = join(tmpdir(), `claude-memory-bench-${Date.now()}`);
  mkdirSync(projectRoot, { recursive: true });
  mkdirSync(join(projectRoot, 'src'), { recursive: true });

  // Create some test files for citations
  writeFileSync(
    join(projectRoot, 'src', 'auth.ts'),
    'export function authenticate() { return true; }'
  );
  writeFileSync(
    join(projectRoot, 'src', 'config.ts'),
    'export const config = { timeout: 5000 };'
  );

  console.log(`\n[Benchmark] Project root: ${projectRoot}`);
  console.log('[Benchmark] Building MCP server...');

  // Ensure server is built
  try {
    execSync('npm run build', {
      cwd: '/Users/bmatthews/Code/claude-memory',
      stdio: 'pipe'
    });
  } catch (e) {
    console.error('[Benchmark] Build failed, trying to continue...');
  }

  console.log('[Benchmark] Starting MCP server...');

  // Start the REAL MCP server
  transport = new StdioClientTransport({
    command: 'node',
    args: ['/Users/bmatthews/Code/claude-memory/mcp/memory-server/dist/index.js'],
    env: {
      ...process.env,
      CLAUDE_PROJECT_ROOT: projectRoot,
    },
    stderr: 'pipe',
  });

  client = new Client(
    { name: 'benchmark-client', version: '1.0.0' },
    { capabilities: {} }
  );

  try {
    await client.connect(transport);
    serverReady = true;
    console.log('[Benchmark] MCP server connected!');

    // List tools to verify connection
    const tools = await client.listTools();
    console.log(`[Benchmark] Available tools: ${tools.tools.map(t => t.name).join(', ')}`);

    // Check if embeddings are available (LM Studio running?)
    const stats = await client.readResource({ uri: 'memory://stats' });
    const statsData = JSON.parse(stats.contents[0].text as string);
    console.log(`[Benchmark] Embedding provider: ${statsData.embedding?.provider ?? 'none (BM25 only)'}`);

  } catch (error) {
    console.error('[Benchmark] Failed to connect to MCP server:', error);
    serverReady = false;
  }
}, 60000); // 60s timeout for setup

afterAll(async () => {
  if (client) {
    try {
      await client.close();
    } catch {
      // Ignore close errors
    }
  }

  // Cleanup project directory
  if (existsSync(projectRoot)) {
    rmSync(projectRoot, { recursive: true, force: true });
  }

  // Print summary
  console.log('\n' + '='.repeat(70));
  console.log('REAL MCP BENCHMARK RESULTS');
  console.log('='.repeat(70));

  if (results.memoryStore.length > 0) {
    const avg = results.memoryStore.reduce((a, b) => a + b, 0) / results.memoryStore.length;
    const p95 = results.memoryStore.sort((a, b) => a - b)[Math.floor(results.memoryStore.length * 0.95)];
    console.log(`memory_store:    avg=${avg.toFixed(1)}ms  p95=${p95?.toFixed(1) ?? 'N/A'}ms  (n=${results.memoryStore.length})`);
  }

  if (results.memoryRecall.length > 0) {
    const avg = results.memoryRecall.reduce((a, b) => a + b, 0) / results.memoryRecall.length;
    const p95 = results.memoryRecall.sort((a, b) => a - b)[Math.floor(results.memoryRecall.length * 0.95)];
    console.log(`memory_recall:   avg=${avg.toFixed(1)}ms  p95=${p95?.toFixed(1) ?? 'N/A'}ms  (n=${results.memoryRecall.length})`);
  }

  if (results.sessionRestore.length > 0) {
    const avg = results.sessionRestore.reduce((a, b) => a + b, 0) / results.sessionRestore.length;
    const p95 = results.sessionRestore.sort((a, b) => a - b)[Math.floor(results.sessionRestore.length * 0.95)];
    console.log(`session_restore: avg=${avg.toFixed(1)}ms  p95=${p95?.toFixed(1) ?? 'N/A'}ms  (n=${results.sessionRestore.length})`);
  }

  if (results.sessionSave.length > 0) {
    const avg = results.sessionSave.reduce((a, b) => a + b, 0) / results.sessionSave.length;
    const p95 = results.sessionSave.sort((a, b) => a - b)[Math.floor(results.sessionSave.length * 0.95)];
    console.log(`session_save:    avg=${avg.toFixed(1)}ms  p95=${p95?.toFixed(1) ?? 'N/A'}ms  (n=${results.sessionSave.length})`);
  }

  console.log('='.repeat(70));
  console.log('NOTE: These are REAL latencies including:');
  console.log('  - MCP protocol (JSON-RPC over stdio)');
  console.log('  - LM Studio embeddings (if running)');
  console.log('  - SQLite operations');
  console.log('  - Security checks (credential detection, path validation)');
  console.log('='.repeat(70) + '\n');
});

// ============================================================================
// BENCHMARK: session_restore (Hook: SessionStart)
// ============================================================================

describe('Real MCP: session_restore', () => {
  bench(
    'session_restore - first call (cold)',
    async () => {
      if (!serverReady) return;

      const { duration } = await measureToolCall('session_restore', {});
      results.sessionRestore.push(duration);
    },
    { iterations: 10 }
  );

  bench(
    'session_restore - subsequent calls (warm)',
    async () => {
      if (!serverReady) return;

      const { duration } = await measureToolCall('session_restore', {});
      results.sessionRestore.push(duration);
    },
    { iterations: 20 }
  );
});

// ============================================================================
// BENCHMARK: memory_store (Skill: store decisions/patterns/errors)
// ============================================================================

describe('Real MCP: memory_store', () => {
  const contentSizes = [
    { name: '100 chars', size: 100 },
    { name: '500 chars', size: 500 },
    { name: '1K chars', size: 1000 },
  ];

  describe.each(contentSizes)('Content: $name', ({ size }) => {
    bench(
      `memory_store - ${size} chars - fact`,
      async () => {
        if (!serverReady) return;

        const { duration } = await measureToolCall('memory_store', {
          content: generateContent(size),
          type: 'fact',
          confidence: 0.9,
        });
        results.memoryStore.push(duration);
      },
      { iterations: 10 }
    );

    bench(
      `memory_store - ${size} chars - with citation`,
      async () => {
        if (!serverReady) return;

        const { duration } = await measureToolCall('memory_store', {
          content: generateContent(size),
          type: 'pattern',
          confidence: 0.85,
          citation: 'src/auth.ts:1-5',
        });
        results.memoryStore.push(duration);
      },
      { iterations: 10 }
    );
  });

  // Security check - should be blocked quickly
  bench(
    'memory_store - blocked by credential detection',
    async () => {
      if (!serverReady) return;

      const start = performance.now();
      const result = await client.callTool({
        name: 'memory_store',
        arguments: {
          content: 'Database connection: password="secret123" for prod',
          type: 'fact',
        },
      });
      const duration = performance.now() - start;

      // Should be blocked
      const text = (result.content[0] as { text: string }).text;
      expect(text).toContain('credentials');

      results.memoryStore.push(duration);
    },
    { iterations: 20 }
  );

  bench(
    'memory_store - blocked by path traversal',
    async () => {
      if (!serverReady) return;

      const start = performance.now();
      const result = await client.callTool({
        name: 'memory_store',
        arguments: {
          content: 'Sensitive file content',
          type: 'fact',
          citation: '../../../etc/passwd:1',
        },
      });
      const duration = performance.now() - start;

      // Should be blocked
      const text = (result.content[0] as { text: string }).text;
      expect(text).toContain('outside project root');

      results.memoryStore.push(duration);
    },
    { iterations: 20 }
  );
});

// ============================================================================
// BENCHMARK: memory_recall (Skill: search for relevant memories)
// ============================================================================

describe('Real MCP: memory_recall', () => {
  // First, store some memories to search
  beforeAll(async () => {
    if (!serverReady) return;

    // Store diverse test memories
    const testMemories = [
      { content: 'Authentication uses JWT with 24h expiry and refresh tokens', type: 'fact', confidence: 0.95 },
      { content: 'Database connections should use connection pooling', type: 'pattern', confidence: 0.9 },
      { content: 'Chose PostgreSQL over MongoDB for ACID compliance', type: 'decision', confidence: 1.0 },
      { content: 'ECONNREFUSED error when Redis not running, start Redis first', type: 'error', confidence: 0.8 },
      { content: 'User prefers functional programming style over OOP', type: 'preference', confidence: 0.7 },
    ];

    for (const mem of testMemories) {
      await client.callTool({ name: 'memory_store', arguments: mem });
    }
  });

  bench(
    'memory_recall - simple query',
    async () => {
      if (!serverReady) return;

      const { duration } = await measureToolCall('memory_recall', {
        query: 'authentication',
        limit: 5,
      });
      results.memoryRecall.push(duration);
    },
    { iterations: 20 }
  );

  bench(
    'memory_recall - with type filter',
    async () => {
      if (!serverReady) return;

      const { duration } = await measureToolCall('memory_recall', {
        query: 'database connection',
        type: 'pattern',
        limit: 10,
      });
      results.memoryRecall.push(duration);
    },
    { iterations: 20 }
  );

  bench(
    'memory_recall - complex query',
    async () => {
      if (!serverReady) return;

      const { duration } = await measureToolCall('memory_recall', {
        query: 'how to handle authentication tokens with refresh mechanism',
        minConfidence: 0.5,
        limit: 10,
      });
      results.memoryRecall.push(duration);
    },
    { iterations: 20 }
  );
});

// ============================================================================
// BENCHMARK: session_save (Hook: SessionEnd)
// ============================================================================

describe('Real MCP: session_save', () => {
  bench(
    'session_save - minimal',
    async () => {
      if (!serverReady) return;

      const { duration } = await measureToolCall('session_save', {});
      results.sessionSave.push(duration);
    },
    { iterations: 10 }
  );

  bench(
    'session_save - with summary',
    async () => {
      if (!serverReady) return;

      const { duration } = await measureToolCall('session_save', {
        summary: 'Implemented user authentication with JWT. Fixed database connection pooling. Resolved Redis connection errors.',
      });
      results.sessionSave.push(duration);
    },
    { iterations: 10 }
  );
});

// ============================================================================
// BENCHMARK: Realistic User Session Flow
// ============================================================================

describe('Real MCP: Full Session Workflow', () => {
  bench(
    'typical session: restore → store 3 → recall → save',
    async () => {
      if (!serverReady) return;

      const start = performance.now();

      // 1. Session restore (hook: SessionStart)
      await client.callTool({ name: 'session_restore', arguments: {} });

      // 2. Store some memories (Claude decides based on SKILL.md)
      await client.callTool({
        name: 'memory_store',
        arguments: {
          content: 'API endpoints follow REST conventions with versioned paths /api/v1/*',
          type: 'pattern',
          confidence: 0.9,
        },
      });

      await client.callTool({
        name: 'memory_store',
        arguments: {
          content: 'Chose Redis for session storage due to TTL support',
          type: 'decision',
          confidence: 1.0,
        },
      });

      await client.callTool({
        name: 'memory_store',
        arguments: {
          content: 'TypeORM migration failed: run npm run typeorm migration:run',
          type: 'error',
          confidence: 0.8,
          citation: 'src/database/index.ts:45',
        },
      });

      // 3. Recall relevant memories
      await client.callTool({
        name: 'memory_recall',
        arguments: {
          query: 'database setup and configuration',
          limit: 5,
        },
      });

      // 4. Session save (hook: SessionEnd)
      await client.callTool({
        name: 'session_save',
        arguments: {
          summary: 'Set up API endpoints, configured Redis sessions, resolved migration issue.',
        },
      });

      const totalDuration = performance.now() - start;
      console.log(`[Full session workflow: ${totalDuration.toFixed(1)}ms]`);
    },
    { iterations: 5 }
  );
});

// ============================================================================
// Skip marker for when server not available
// ============================================================================

describe('Server Status', () => {
  bench(
    'verify server connection',
    async () => {
      expect(serverReady).toBe(true);
    },
    { iterations: 1 }
  );
});
