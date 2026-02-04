/**
 * Token and Response Size Measurement
 *
 * Measures actual data returned by MCP tools to estimate token impact.
 * Run with: npx tsx tests/benchmarks/real/measure-tokens.ts
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { execSync } from 'child_process';

// Rough token estimation: ~4 chars per token for English text
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

async function main() {
  // Setup
  const projectRoot = join(tmpdir(), `claude-memory-tokens-${Date.now()}`);
  mkdirSync(projectRoot, { recursive: true });
  mkdirSync(join(projectRoot, 'src'), { recursive: true });
  writeFileSync(join(projectRoot, 'src', 'auth.ts'), 'export function authenticate() { return true; }');

  console.log('Building MCP server...');
  execSync('npm run build', { cwd: '/Users/bmatthews/Code/claude-memory', stdio: 'pipe' });

  // Start server
  const transport = new StdioClientTransport({
    command: 'node',
    args: ['/Users/bmatthews/Code/claude-memory/mcp/memory-server/dist/index.js'],
    env: { ...process.env, CLAUDE_PROJECT_ROOT: projectRoot },
    stderr: 'pipe',
  });

  const client = new Client(
    { name: 'token-measure', version: '1.0.0' },
    { capabilities: {} }
  );

  await client.connect(transport);
  console.log('Connected to MCP server\n');

  const results: { operation: string; responseSize: number; estimatedTokens: number; latencyMs: number }[] = [];

  // 1. session_restore (empty database)
  console.log('=== MEASURING SESSION_RESTORE (empty) ===');
  let start = performance.now();
  let result = await client.callTool({ name: 'session_restore', arguments: {} });
  let latency = performance.now() - start;
  let responseText = JSON.stringify(result.content);
  console.log('Response:', responseText.slice(0, 500));
  console.log(`Size: ${responseText.length} chars, ~${estimateTokens(responseText)} tokens, ${latency.toFixed(1)}ms\n`);
  results.push({ operation: 'session_restore (empty)', responseSize: responseText.length, estimatedTokens: estimateTokens(responseText), latencyMs: latency });

  // 2. memory_store
  console.log('=== MEASURING MEMORY_STORE ===');
  start = performance.now();
  result = await client.callTool({
    name: 'memory_store',
    arguments: {
      content: 'The authentication module uses JWT tokens with 24h expiry and refresh mechanism',
      type: 'fact',
      confidence: 0.95,
    },
  });
  latency = performance.now() - start;
  responseText = JSON.stringify(result.content);
  console.log('Response:', responseText.slice(0, 500));
  console.log(`Size: ${responseText.length} chars, ~${estimateTokens(responseText)} tokens, ${latency.toFixed(1)}ms\n`);
  results.push({ operation: 'memory_store', responseSize: responseText.length, estimatedTokens: estimateTokens(responseText), latencyMs: latency });

  // 3. Store more memories for recall test
  const testMemories = [
    { content: 'Database connections should use connection pooling for performance', type: 'pattern', confidence: 0.9 },
    { content: 'Chose PostgreSQL over MongoDB for ACID compliance requirements', type: 'decision', confidence: 1.0 },
    { content: 'ECONNREFUSED error when Redis not running, need to start Redis first', type: 'error', confidence: 0.8 },
    { content: 'User prefers functional programming style over object-oriented', type: 'preference', confidence: 0.7 },
    { content: 'API rate limiting implemented using sliding window counter algorithm', type: 'pattern', confidence: 0.85 },
    { content: 'WebSocket connections for real-time features use Socket.IO library', type: 'fact', confidence: 0.9 },
    { content: 'File uploads stored in S3 with CloudFront CDN for distribution', type: 'decision', confidence: 0.95 },
    { content: 'TypeORM migration failed with missing column, run migrations before deploy', type: 'error', confidence: 0.8 },
    { content: 'Testing uses Jest with coverage threshold of 80%', type: 'fact', confidence: 0.9 },
    { content: 'CI/CD pipeline runs on GitHub Actions with staging deploy on merge', type: 'pattern', confidence: 0.85 },
  ];

  for (const mem of testMemories) {
    await client.callTool({ name: 'memory_store', arguments: mem });
  }
  console.log(`Stored ${testMemories.length + 1} total memories\n`);

  // 4. memory_recall
  console.log('=== MEASURING MEMORY_RECALL (limit=5) ===');
  start = performance.now();
  result = await client.callTool({
    name: 'memory_recall',
    arguments: { query: 'database and authentication', limit: 5 },
  });
  latency = performance.now() - start;
  responseText = JSON.stringify(result.content);
  console.log('Response:', responseText.slice(0, 1000), responseText.length > 1000 ? '...' : '');
  console.log(`Size: ${responseText.length} chars, ~${estimateTokens(responseText)} tokens, ${latency.toFixed(1)}ms\n`);
  results.push({ operation: 'memory_recall (5 results)', responseSize: responseText.length, estimatedTokens: estimateTokens(responseText), latencyMs: latency });

  // 5. memory_recall with limit=10
  console.log('=== MEASURING MEMORY_RECALL (limit=10) ===');
  start = performance.now();
  result = await client.callTool({
    name: 'memory_recall',
    arguments: { query: 'database authentication api', limit: 10 },
  });
  latency = performance.now() - start;
  responseText = JSON.stringify(result.content);
  console.log('Response:', responseText.slice(0, 1000), responseText.length > 1000 ? '...' : '');
  console.log(`Size: ${responseText.length} chars, ~${estimateTokens(responseText)} tokens, ${latency.toFixed(1)}ms\n`);
  results.push({ operation: 'memory_recall (10 results)', responseSize: responseText.length, estimatedTokens: estimateTokens(responseText), latencyMs: latency });

  // 6. session_save
  console.log('=== MEASURING SESSION_SAVE ===');
  start = performance.now();
  result = await client.callTool({
    name: 'session_save',
    arguments: { summary: 'Worked on authentication and database configuration' },
  });
  latency = performance.now() - start;
  responseText = JSON.stringify(result.content);
  console.log('Response:', responseText.slice(0, 500));
  console.log(`Size: ${responseText.length} chars, ~${estimateTokens(responseText)} tokens, ${latency.toFixed(1)}ms\n`);
  results.push({ operation: 'session_save', responseSize: responseText.length, estimatedTokens: estimateTokens(responseText), latencyMs: latency });

  // 7. session_restore (with memories)
  console.log('=== MEASURING SESSION_RESTORE (with 11 memories) ===');
  start = performance.now();
  result = await client.callTool({ name: 'session_restore', arguments: {} });
  latency = performance.now() - start;
  responseText = JSON.stringify(result.content);
  console.log('Response:', responseText.slice(0, 1500), responseText.length > 1500 ? '...' : '');
  console.log(`Size: ${responseText.length} chars, ~${estimateTokens(responseText)} tokens, ${latency.toFixed(1)}ms\n`);
  results.push({ operation: 'session_restore (11 memories)', responseSize: responseText.length, estimatedTokens: estimateTokens(responseText), latencyMs: latency });

  // Summary table
  console.log('\n' + '='.repeat(80));
  console.log('TOKEN AND RESPONSE SIZE SUMMARY');
  console.log('='.repeat(80));
  console.log('');
  console.log('| Operation                      | Response Size | Est. Tokens | Latency    |');
  console.log('|--------------------------------|---------------|-------------|------------|');
  for (const r of results) {
    const op = r.operation.padEnd(30);
    const size = `${r.responseSize} chars`.padStart(11);
    const tokens = `~${r.estimatedTokens}`.padStart(11);
    const lat = `${r.latencyMs.toFixed(1)}ms`.padStart(10);
    console.log(`| ${op} | ${size} | ${tokens} | ${lat} |`);
  }
  console.log('');

  // Typical session workflow token budget
  console.log('='.repeat(80));
  console.log('TYPICAL SESSION TOKEN BUDGET');
  console.log('='.repeat(80));
  const sessionStart = results.find(r => r.operation.includes('session_restore (11'))!;
  const storeOp = results.find(r => r.operation === 'memory_store')!;
  const recallOp = results.find(r => r.operation.includes('memory_recall (5'))!;
  const saveOp = results.find(r => r.operation === 'session_save')!;

  const typicalSession = {
    restore: sessionStart.estimatedTokens,
    store3: storeOp.estimatedTokens * 3,
    recall2: recallOp.estimatedTokens * 2,
    save: saveOp.estimatedTokens,
  };
  const totalTokens = Object.values(typicalSession).reduce((a, b) => a + b, 0);

  console.log('');
  console.log('Typical session (restore → store 3 memories → recall 2x → save):');
  console.log(`  session_restore:      ~${typicalSession.restore} tokens`);
  console.log(`  memory_store x3:      ~${typicalSession.store3} tokens`);
  console.log(`  memory_recall x2:     ~${typicalSession.recall2} tokens`);
  console.log(`  session_save:         ~${typicalSession.save} tokens`);
  console.log(`  ─────────────────────────────────`);
  console.log(`  TOTAL TOKEN OVERHEAD: ~${totalTokens} tokens`);
  console.log('');

  // Tool call count (turns)
  console.log('='.repeat(80));
  console.log('TOOL CALLS (TURNS) PER SESSION');
  console.log('='.repeat(80));
  console.log('');
  console.log('Without Memory Plugin:');
  console.log('  - Claude starts fresh each session (0 memory tool calls)');
  console.log('  - Context limited to current conversation');
  console.log('');
  console.log('With Memory Plugin (typical session):');
  console.log('  1. session_restore (auto via hook) - 1 call');
  console.log('  2. memory_store (Claude decides, ~3x per session) - 3 calls');
  console.log('  3. memory_recall (Claude decides, ~2x per session) - 2 calls');
  console.log('  4. session_save (auto via hook) - 1 call');
  console.log('  ─────────────────────────────────');
  console.log('  TOTAL: 7 tool calls per session');
  console.log('');

  // Cleanup
  await client.close();
  if (existsSync(projectRoot)) {
    rmSync(projectRoot, { recursive: true, force: true });
  }
}

main().catch(console.error);
