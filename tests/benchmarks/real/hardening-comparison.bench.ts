/**
 * Hardening Overhead Comparison Benchmark
 *
 * Compares performance WITH hardening vs WITHOUT hardening
 * to measure the actual cost of security features.
 *
 * Hardening features tested:
 * - SC-001: Credential detection
 * - SC-002: Path traversal prevention
 * - SC-003: Storage quota checks
 * - Staleness detection in session_restore
 *
 * Run with: npm run bench:real
 */

import { describe, bench, beforeAll, afterAll, beforeEach } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { execSync } from 'child_process';

// Test infrastructure
let clientWithHardening: Client;
let clientWithoutHardening: Client;
let transportWith: StdioClientTransport;
let transportWithout: StdioClientTransport;
let projectRootWith: string;
let projectRootWithout: string;
let serversReady = false;

// Results tracking
const results = {
  withHardening: {
    memoryStore: [] as number[],
    sessionRestore: [] as number[],
  },
  withoutHardening: {
    memoryStore: [] as number[],
    sessionRestore: [] as number[],
  },
};

/**
 * Generate test content
 */
function generateContent(length: number): string {
  const words = [
    'The', 'authentication', 'module', 'uses', 'JWT', 'tokens', 'with',
    'refresh', 'mechanism', 'implemented', 'in', 'TypeScript', 'following',
    'the', 'repository', 'pattern', 'for', 'database', 'access',
  ];
  const result: string[] = [];
  while (result.join(' ').length < length) {
    result.push(words[Math.floor(Math.random() * words.length)]);
  }
  return result.join(' ').slice(0, length);
}

/**
 * Setup test project directory
 */
function setupProjectDir(name: string): string {
  const dir = join(tmpdir(), `claude-memory-${name}-${Date.now()}`);
  mkdirSync(dir, { recursive: true });
  mkdirSync(join(dir, 'src'), { recursive: true });
  writeFileSync(join(dir, 'src', 'test.ts'), 'export const x = 1;');
  return dir;
}

/**
 * Start MCP server with or without hardening
 */
async function startServer(
  projectRoot: string,
  disableHardening: boolean
): Promise<{ client: Client; transport: StdioClientTransport }> {
  const transport = new StdioClientTransport({
    command: 'node',
    args: ['/Users/bmatthews/Code/claude-memory/mcp/memory-server/dist/index.js'],
    env: {
      ...process.env,
      CLAUDE_PROJECT_ROOT: projectRoot,
      CLAUDE_MEMORY_DISABLE_HARDENING: disableHardening ? 'true' : 'false',
    },
    stderr: 'pipe',
  });

  const client = new Client(
    { name: 'benchmark-client', version: '1.0.0' },
    { capabilities: {} }
  );

  await client.connect(transport);
  return { client, transport };
}

// ============================================================================
// SETUP: Start both servers (with and without hardening)
// ============================================================================

beforeAll(async () => {
  console.log('\n[Comparison Benchmark] Building MCP server...');

  // Build server
  try {
    execSync('npm run build', {
      cwd: '/Users/bmatthews/Code/claude-memory',
      stdio: 'pipe',
    });
  } catch {
    console.error('[Comparison Benchmark] Build failed');
  }

  // Setup project directories
  projectRootWith = setupProjectDir('with-hardening');
  projectRootWithout = setupProjectDir('without-hardening');

  console.log('[Comparison Benchmark] Starting server WITH hardening...');
  try {
    const withServer = await startServer(projectRootWith, false);
    clientWithHardening = withServer.client;
    transportWith = withServer.transport;
    console.log('[Comparison Benchmark] Server WITH hardening: ready');
  } catch (e) {
    console.error('[Comparison Benchmark] Failed to start WITH hardening:', e);
  }

  console.log('[Comparison Benchmark] Starting server WITHOUT hardening...');
  try {
    const withoutServer = await startServer(projectRootWithout, true);
    clientWithoutHardening = withoutServer.client;
    transportWithout = withoutServer.transport;
    console.log('[Comparison Benchmark] Server WITHOUT hardening: ready');
  } catch (e) {
    console.error('[Comparison Benchmark] Failed to start WITHOUT hardening:', e);
  }

  serversReady = !!(clientWithHardening && clientWithoutHardening);
  console.log(`[Comparison Benchmark] Both servers ready: ${serversReady}`);
}, 120000);

afterAll(async () => {
  // Cleanup
  if (clientWithHardening) await clientWithHardening.close().catch(() => {});
  if (clientWithoutHardening) await clientWithoutHardening.close().catch(() => {});

  if (existsSync(projectRootWith)) rmSync(projectRootWith, { recursive: true, force: true });
  if (existsSync(projectRootWithout)) rmSync(projectRootWithout, { recursive: true, force: true });

  // Print comparison results
  console.log('\n' + '='.repeat(70));
  console.log('HARDENING OVERHEAD COMPARISON');
  console.log('='.repeat(70));

  if (results.withHardening.memoryStore.length > 0 && results.withoutHardening.memoryStore.length > 0) {
    const avgWith = results.withHardening.memoryStore.reduce((a, b) => a + b, 0) / results.withHardening.memoryStore.length;
    const avgWithout = results.withoutHardening.memoryStore.reduce((a, b) => a + b, 0) / results.withoutHardening.memoryStore.length;
    const overhead = avgWith - avgWithout;
    const overheadPct = (overhead / avgWithout) * 100;

    console.log('\nmemory_store:');
    console.log(`  WITH hardening:    ${avgWith.toFixed(2)}ms avg`);
    console.log(`  WITHOUT hardening: ${avgWithout.toFixed(2)}ms avg`);
    console.log(`  Overhead:          ${overhead.toFixed(2)}ms (${overheadPct.toFixed(1)}%)`);
  }

  if (results.withHardening.sessionRestore.length > 0 && results.withoutHardening.sessionRestore.length > 0) {
    const avgWith = results.withHardening.sessionRestore.reduce((a, b) => a + b, 0) / results.withHardening.sessionRestore.length;
    const avgWithout = results.withoutHardening.sessionRestore.reduce((a, b) => a + b, 0) / results.withoutHardening.sessionRestore.length;
    const overhead = avgWith - avgWithout;
    const overheadPct = (overhead / avgWithout) * 100;

    console.log('\nsession_restore:');
    console.log(`  WITH hardening:    ${avgWith.toFixed(2)}ms avg`);
    console.log(`  WITHOUT hardening: ${avgWithout.toFixed(2)}ms avg`);
    console.log(`  Overhead:          ${overhead.toFixed(2)}ms (${overheadPct.toFixed(1)}%)`);
  }

  console.log('\n' + '='.repeat(70));
  console.log('Hardening features measured:');
  console.log('  - SC-001: Credential detection (regex matching)');
  console.log('  - SC-002: Path traversal prevention (path validation)');
  console.log('  - SC-003: Storage quota checks (DB count query)');
  console.log('  - Staleness detection (4 detector queries on session_restore)');
  console.log('='.repeat(70) + '\n');
});

// ============================================================================
// BENCHMARK: memory_store comparison
// ============================================================================

describe('Hardening Comparison: memory_store', () => {
  const content = generateContent(500);

  bench(
    'WITH hardening - memory_store',
    async () => {
      if (!serversReady) return;

      const start = performance.now();
      await clientWithHardening.callTool({
        name: 'memory_store',
        arguments: {
          content: content + Math.random(), // Unique content
          type: 'fact',
          confidence: 0.9,
        },
      });
      const duration = performance.now() - start;
      results.withHardening.memoryStore.push(duration);
    },
    { iterations: 20 }
  );

  bench(
    'WITHOUT hardening - memory_store',
    async () => {
      if (!serversReady) return;

      const start = performance.now();
      await clientWithoutHardening.callTool({
        name: 'memory_store',
        arguments: {
          content: content + Math.random(), // Unique content
          type: 'fact',
          confidence: 0.9,
        },
      });
      const duration = performance.now() - start;
      results.withoutHardening.memoryStore.push(duration);
    },
    { iterations: 20 }
  );
});

// ============================================================================
// BENCHMARK: memory_store with citation comparison
// ============================================================================

describe('Hardening Comparison: memory_store with citation', () => {
  const content = generateContent(500);

  bench(
    'WITH hardening - memory_store + citation',
    async () => {
      if (!serversReady) return;

      const start = performance.now();
      await clientWithHardening.callTool({
        name: 'memory_store',
        arguments: {
          content: content + Math.random(),
          type: 'pattern',
          confidence: 0.85,
          citation: 'src/test.ts:1-5',
        },
      });
      const duration = performance.now() - start;
      results.withHardening.memoryStore.push(duration);
    },
    { iterations: 20 }
  );

  bench(
    'WITHOUT hardening - memory_store + citation',
    async () => {
      if (!serversReady) return;

      const start = performance.now();
      await clientWithoutHardening.callTool({
        name: 'memory_store',
        arguments: {
          content: content + Math.random(),
          type: 'pattern',
          confidence: 0.85,
          citation: 'src/test.ts:1-5',
        },
      });
      const duration = performance.now() - start;
      results.withoutHardening.memoryStore.push(duration);
    },
    { iterations: 20 }
  );
});

// ============================================================================
// BENCHMARK: session_restore comparison (includes staleness detection)
// ============================================================================

describe('Hardening Comparison: session_restore', () => {
  // First populate both databases with memories
  beforeAll(async () => {
    if (!serversReady) return;

    const content = generateContent(300);

    // Add memories to both databases
    for (let i = 0; i < 50; i++) {
      await Promise.all([
        clientWithHardening.callTool({
          name: 'memory_store',
          arguments: { content: content + i, type: 'fact', confidence: 0.8 },
        }),
        clientWithoutHardening.callTool({
          name: 'memory_store',
          arguments: { content: content + i, type: 'fact', confidence: 0.8 },
        }),
      ]);
    }

    // Save sessions
    await Promise.all([
      clientWithHardening.callTool({
        name: 'session_save',
        arguments: { summary: 'Test session' },
      }),
      clientWithoutHardening.callTool({
        name: 'session_save',
        arguments: { summary: 'Test session' },
      }),
    ]);
  });

  bench(
    'WITH hardening - session_restore (50 memories)',
    async () => {
      if (!serversReady) return;

      const start = performance.now();
      await clientWithHardening.callTool({
        name: 'session_restore',
        arguments: {},
      });
      const duration = performance.now() - start;
      results.withHardening.sessionRestore.push(duration);
    },
    { iterations: 20 }
  );

  bench(
    'WITHOUT hardening - session_restore (50 memories)',
    async () => {
      if (!serversReady) return;

      const start = performance.now();
      await clientWithoutHardening.callTool({
        name: 'session_restore',
        arguments: {},
      });
      const duration = performance.now() - start;
      results.withoutHardening.sessionRestore.push(duration);
    },
    { iterations: 20 }
  );
});

// ============================================================================
// BENCHMARK: Full workflow comparison
// ============================================================================

describe('Hardening Comparison: Full Workflow', () => {
  bench(
    'WITH hardening - full workflow',
    async () => {
      if (!serversReady) return;

      await clientWithHardening.callTool({ name: 'session_restore', arguments: {} });

      await clientWithHardening.callTool({
        name: 'memory_store',
        arguments: {
          content: generateContent(400) + Math.random(),
          type: 'decision',
          confidence: 0.95,
        },
      });

      await clientWithHardening.callTool({
        name: 'memory_recall',
        arguments: { query: 'authentication', limit: 5 },
      });

      await clientWithHardening.callTool({
        name: 'session_save',
        arguments: { summary: 'Workflow test' },
      });
    },
    { iterations: 10 }
  );

  bench(
    'WITHOUT hardening - full workflow',
    async () => {
      if (!serversReady) return;

      await clientWithoutHardening.callTool({ name: 'session_restore', arguments: {} });

      await clientWithoutHardening.callTool({
        name: 'memory_store',
        arguments: {
          content: generateContent(400) + Math.random(),
          type: 'decision',
          confidence: 0.95,
        },
      });

      await clientWithoutHardening.callTool({
        name: 'memory_recall',
        arguments: { query: 'authentication', limit: 5 },
      });

      await clientWithoutHardening.callTool({
        name: 'session_save',
        arguments: { summary: 'Workflow test' },
      });
    },
    { iterations: 10 }
  );
});
