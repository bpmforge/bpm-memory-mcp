#!/usr/bin/env node
/**
 * Memory CLI (V12)
 *
 * Standalone command-line tool for memory management.
 * Usage: npx memory-cli <command> [options]
 *
 * Commands:
 *   list       List memories in a project
 *   search     Search memories by query
 *   delete     Delete a memory by ID
 *   export     Export memories to JSON
 *   import     Import memories from JSON
 *   stats      Show memory statistics
 *   consolidate Run memory consolidation
 *   projects   List all projects with memories
 */

import { parseArgs } from 'node:util';
import { existsSync, writeFileSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { connectionPool, runMigrations, getProjectId, GLOBAL_PROJECT_ID, listAllProjects } from './storage/index.js';
import { MemoryRepository } from './storage/repository.js';
import { EmbeddingService } from './embeddings/index.js';
import { HybridSearch } from './search/index.js';
import { ConsolidationService } from './consolidation/index.js';
import { MemoryType, type Language } from './types.js';

// Memory directory path
const MEMORY_DIR = join(homedir(), '.claude-memory');

// ANSI colors for terminal output
const colors = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
};

function log(msg: string) {
  console.log(msg);
}

function error(msg: string) {
  console.error(`${colors.red}Error:${colors.reset} ${msg}`);
}

function success(msg: string) {
  console.log(`${colors.green}✓${colors.reset} ${msg}`);
}

function heading(msg: string) {
  console.log(`\n${colors.bold}${colors.cyan}${msg}${colors.reset}\n`);
}

async function main() {
  const args = process.argv.slice(2);
  const command = args[0];

  if (!command || command === 'help' || command === '--help' || command === '-h') {
    showHelp();
    return;
  }

  try {
    switch (command) {
      case 'list':
        await listMemories(args.slice(1));
        break;
      case 'search':
        await searchMemories(args.slice(1));
        break;
      case 'delete':
        await deleteMemory(args.slice(1));
        break;
      case 'export':
        await exportMemories(args.slice(1));
        break;
      case 'import':
        await importMemories(args.slice(1));
        break;
      case 'stats':
        await showStats(args.slice(1));
        break;
      case 'consolidate':
        await runConsolidate(args.slice(1));
        break;
      case 'projects':
        await listProjects();
        break;
      default:
        error(`Unknown command: ${command}`);
        showHelp();
        process.exit(1);
    }
  } catch (err) {
    error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}

function showHelp() {
  log(`
${colors.bold}Memory CLI${colors.reset} - Manage claude-memory databases

${colors.bold}Usage:${colors.reset}
  memory-cli <command> [options]

${colors.bold}Commands:${colors.reset}
  list        List memories (--project <path>, --type <type>, --limit <n>)
  search      Search memories (--query <text>, --project <path>)
  delete      Delete memory (--id <uuid>, --project <path>)
  export      Export to JSON (--project <path>, --output <file>)
  import      Import from JSON (--project <path>, --input <file>)
  stats       Show statistics (--project <path>)
  consolidate Run consolidation (--project <path>, --dry-run)
  projects    List all projects with memory databases

${colors.bold}Options:${colors.reset}
  --project <path>  Project path (default: current directory)
  --global          Use global memory scope
  --type <type>     Filter by type (fact, pattern, decision, error, preference)
  --limit <n>       Limit results (default: 20)
  --query <text>    Search query text
  --id <uuid>       Memory ID for delete
  --output <file>   Output file for export
  --input <file>    Input file for import
  --dry-run         Preview changes without applying

${colors.bold}Examples:${colors.reset}
  memory-cli list --limit 10
  memory-cli search --query "authentication" --type decision
  memory-cli export --output memories.json
  memory-cli consolidate --dry-run
  memory-cli projects
`);
}

function parseOptions(args: string[]) {
  const { values } = parseArgs({
    args,
    options: {
      project: { type: 'string', short: 'p' },
      global: { type: 'boolean', short: 'g' },
      type: { type: 'string', short: 't' },
      limit: { type: 'string', short: 'l' },
      query: { type: 'string', short: 'q' },
      id: { type: 'string' },
      output: { type: 'string', short: 'o' },
      input: { type: 'string', short: 'i' },
      'dry-run': { type: 'boolean' },
    },
    allowPositionals: true,
  });
  return values;
}

function getProjectIdFromOptions(options: ReturnType<typeof parseOptions>): string {
  if (options.global) {
    return GLOBAL_PROJECT_ID;
  }
  const projectPath = options.project ?? process.cwd();
  return getProjectId(projectPath);
}

async function listMemories(args: string[]) {
  const options = parseOptions(args);
  const projectId = getProjectIdFromOptions(options);
  const limit = parseInt(options.limit ?? '20', 10);
  const typeFilter = options.type as MemoryType | undefined;

  const db = connectionPool.get(projectId);
  runMigrations(db);

  const repo = new MemoryRepository(db);

  heading(`Memories in project: ${projectId.substring(0, 8)}...`);

  let query = `
    SELECT id, content, type, confidence, created_at, accessed_at, access_count
    FROM memories
    WHERE project_id = ? AND deleted_at IS NULL AND superseded_by IS NULL
  `;
  const params: unknown[] = [projectId];

  if (typeFilter) {
    query += ' AND type = ?';
    params.push(typeFilter);
  }

  query += ' ORDER BY created_at DESC LIMIT ?';
  params.push(limit);

  const rows = db.instance.prepare(query).all(...params) as Array<{
    id: string;
    content: string;
    type: string;
    confidence: number;
    created_at: number;
    accessed_at: number;
    access_count: number;
  }>;

  if (rows.length === 0) {
    log('No memories found.');
    return;
  }

  for (const row of rows) {
    const date = new Date(row.created_at * 1000).toLocaleDateString();
    const typeColors: Record<string, string> = {
      decision: colors.yellow,
      error: colors.red,
      pattern: colors.green,
      fact: colors.blue,
      preference: colors.cyan,
    };
    const typeColor = typeColors[row.type] ?? colors.reset;

    log(`${colors.dim}${row.id.substring(0, 8)}${colors.reset} ${typeColor}[${row.type}]${colors.reset} ${date}`);
    log(`  ${row.content.substring(0, 100)}${row.content.length > 100 ? '...' : ''}`);
    log(`  ${colors.dim}confidence: ${row.confidence}, accessed: ${row.access_count}x${colors.reset}\n`);
  }

  log(`${colors.dim}Showing ${rows.length} memories${colors.reset}`);
}

async function searchMemories(args: string[]) {
  const options = parseOptions(args);
  const projectId = getProjectIdFromOptions(options);
  const query = options.query;
  const limit = parseInt(options.limit ?? '10', 10);

  if (!query) {
    error('--query is required for search');
    process.exit(1);
  }

  const db = connectionPool.get(projectId);
  runMigrations(db);

  // Initialize embedding service with auto-detection
  const embeddingService = new EmbeddingService(db);
  const initialized = await embeddingService.initialize();
  if (!initialized) {
    error('Could not initialize embedding service. Is Ollama or LM Studio running?');
    process.exit(1);
  }

  const hybridSearch = new HybridSearch(db, embeddingService);

  heading(`Search results for: "${query}"`);

  const response = await hybridSearch.search(query, {
    projectId,
    limit,
    minConfidence: 0.1,
  });

  if (response.memories.length === 0) {
    log('No matching memories found.');
    return;
  }

  for (const result of response.memories) {
    const m = result.memory;
    const relevance = Math.round(result.relevance * 100);
    const typeColor: Record<string, string> = {
      decision: colors.yellow,
      error: colors.red,
      pattern: colors.green,
      fact: colors.blue,
      preference: colors.cyan,
    };

    log(`${colors.dim}${m.id.substring(0, 8)}${colors.reset} ${typeColor[m.type] ?? colors.reset}[${m.type}]${colors.reset} ${colors.green}${relevance}% match${colors.reset}`);
    log(`  ${m.content.substring(0, 120)}${m.content.length > 120 ? '...' : ''}\n`);
  }

  log(`${colors.dim}Found ${response.memories.length} memories (${response.searchStats.latencyMs}ms)${colors.reset}`);
}

async function deleteMemory(args: string[]) {
  const options = parseOptions(args);
  const projectId = getProjectIdFromOptions(options);
  const memoryId = options.id;

  if (!memoryId) {
    error('--id is required for delete');
    process.exit(1);
  }

  const db = connectionPool.get(projectId);
  runMigrations(db);

  const repo = new MemoryRepository(db);
  const memory = repo.findById(memoryId, projectId);

  if (!memory) {
    error(`Memory not found: ${memoryId}`);
    process.exit(1);
  }

  log(`${colors.dim}Deleting:${colors.reset} ${memory.content.substring(0, 80)}...`);

  repo.softDelete(memoryId, projectId, 'Deleted via CLI');
  success(`Memory ${memoryId.substring(0, 8)}... deleted`);
}

async function exportMemories(args: string[]) {
  const options = parseOptions(args);
  const projectId = getProjectIdFromOptions(options);
  const outputFile = options.output ?? 'memories-export.json';

  const db = connectionPool.get(projectId);
  runMigrations(db);

  heading(`Exporting memories from: ${projectId.substring(0, 8)}...`);

  const rows = db.instance.prepare(`
    SELECT id, content, type, confidence, citation, language, created_at, version
    FROM memories
    WHERE project_id = ? AND deleted_at IS NULL AND superseded_by IS NULL
    ORDER BY created_at DESC
  `).all(projectId) as Array<{
    id: string;
    content: string;
    type: string;
    confidence: number;
    citation: string | null;
    language: string | null;
    created_at: number;
    version: number;
  }>;

  const exportData = {
    exportedAt: new Date().toISOString(),
    projectId,
    memoryCount: rows.length,
    memories: rows.map(r => ({
      id: r.id,
      content: r.content,
      type: r.type,
      confidence: r.confidence,
      citation: r.citation,
      language: r.language,
      createdAt: new Date(r.created_at * 1000).toISOString(),
      version: r.version,
    })),
  };

  writeFileSync(outputFile, JSON.stringify(exportData, null, 2));
  success(`Exported ${rows.length} memories to ${outputFile}`);
}

async function importMemories(args: string[]) {
  const options = parseOptions(args);
  const projectId = getProjectIdFromOptions(options);
  const inputFile = options.input;

  if (!inputFile) {
    error('--input is required for import');
    process.exit(1);
  }

  if (!existsSync(inputFile)) {
    error(`File not found: ${inputFile}`);
    process.exit(1);
  }

  const db = connectionPool.get(projectId);
  runMigrations(db);

  // Initialize embedding service with auto-detection
  const embeddingService = new EmbeddingService(db);
  const initialized = await embeddingService.initialize();
  if (!initialized) {
    error('Could not initialize embedding service. Is Ollama or LM Studio running?');
    process.exit(1);
  }

  const repo = new MemoryRepository(db);

  heading(`Importing memories to: ${projectId.substring(0, 8)}...`);

  const data = JSON.parse(readFileSync(inputFile, 'utf-8')) as {
    memories: Array<{
      content: string;
      type: string;
      confidence: number;
      citation?: string;
      language?: string;
    }>;
  };

  let imported = 0;
  let skipped = 0;

  for (const m of data.memories) {
    // Check for duplicate
    if (repo.isDuplicateContent(m.content, projectId)) {
      skipped++;
      continue;
    }

    const embedding = await embeddingService.embed(m.content);

    const input: {
      content: string;
      type: MemoryType;
      confidence: number;
      projectId: string;
      citation?: string;
      language?: Language;
    } = {
      content: m.content,
      type: m.type as MemoryType,
      confidence: m.confidence,
      projectId,
    };
    if (m.citation) input.citation = m.citation;
    if (m.language) input.language = m.language as Language;

    repo.createMemory(input, embedding);
    imported++;
  }

  success(`Imported ${imported} memories (${skipped} duplicates skipped)`);
}

async function showStats(args: string[]) {
  const options = parseOptions(args);
  const projectId = getProjectIdFromOptions(options);

  const db = connectionPool.get(projectId);
  runMigrations(db);

  heading(`Statistics for: ${projectId.substring(0, 8)}...`);

  const totalRow = db.instance.prepare(`
    SELECT COUNT(*) as total FROM memories
    WHERE project_id = ? AND deleted_at IS NULL AND superseded_by IS NULL
  `).get(projectId) as { total: number };

  const byTypeRows = db.instance.prepare(`
    SELECT type, COUNT(*) as count FROM memories
    WHERE project_id = ? AND deleted_at IS NULL AND superseded_by IS NULL
    GROUP BY type ORDER BY count DESC
  `).all(projectId) as Array<{ type: string; count: number }>;

  const deletedRow = db.instance.prepare(`
    SELECT COUNT(*) as total FROM memories
    WHERE project_id = ? AND deleted_at IS NOT NULL
  `).get(projectId) as { total: number };

  const supersededRow = db.instance.prepare(`
    SELECT COUNT(*) as total FROM memories
    WHERE project_id = ? AND superseded_by IS NOT NULL
  `).get(projectId) as { total: number };

  log(`${colors.bold}Total memories:${colors.reset} ${totalRow.total}`);
  log('');
  log(`${colors.bold}By type:${colors.reset}`);
  for (const row of byTypeRows) {
    log(`  ${row.type}: ${row.count}`);
  }
  log('');
  log(`${colors.dim}Deleted: ${deletedRow.total}, Superseded: ${supersededRow.total}${colors.reset}`);
}

async function runConsolidate(args: string[]) {
  const options = parseOptions(args);
  const projectId = getProjectIdFromOptions(options);
  const dryRun = options['dry-run'] ?? false;

  const db = connectionPool.get(projectId);
  runMigrations(db);

  const consolidator = new ConsolidationService(db.instance);

  heading(`${dryRun ? '[DRY RUN] ' : ''}Consolidating: ${projectId.substring(0, 8)}...`);

  const result = await consolidator.consolidate(projectId, { dryRun });

  if (result.merged.length > 0) {
    log(`${colors.yellow}Duplicate groups merged:${colors.reset} ${result.merged.length}`);
  }
  if (result.decayed.length > 0) {
    log(`${colors.yellow}Memories decayed:${colors.reset} ${result.decayed.length}`);
  }
  if (result.flaggedForReview.length > 0) {
    log(`${colors.red}Flagged for review:${colors.reset} ${result.flaggedForReview.length}`);
    for (const f of result.flaggedForReview.slice(0, 5)) {
      log(`  ${colors.dim}${f.id.substring(0, 8)}${colors.reset} - ${f.reason}`);
    }
  }
  if (result.clusters.length > 0) {
    log(`${colors.green}Clusters found:${colors.reset} ${result.clusters.length}`);
  }

  if (result.merged.length === 0 && result.decayed.length === 0 && result.flaggedForReview.length === 0) {
    success('Memory is healthy - no consolidation needed');
  } else if (dryRun) {
    log(`\n${colors.dim}Run without --dry-run to apply changes${colors.reset}`);
  } else {
    success('Consolidation complete');
  }
}

async function listProjects() {
  heading('Projects with memory databases');

  const projects = listAllProjects();

  if (projects.length === 0) {
    log('No projects found.');
    log(`${colors.dim}Memory databases are stored in: ${MEMORY_DIR}${colors.reset}`);
    return;
  }

  for (const projectId of projects) {
    const db = connectionPool.get(projectId);

    const countRow = db.instance.prepare(`
      SELECT COUNT(*) as total FROM memories
      WHERE project_id = ? AND deleted_at IS NULL AND superseded_by IS NULL
    `).get(projectId) as { total: number };

    const isGlobal = projectId === GLOBAL_PROJECT_ID;
    const label = isGlobal ? `${colors.cyan}[GLOBAL]${colors.reset}` : projectId.substring(0, 16);

    log(`${label} - ${countRow.total} memories`);
  }

  log(`\n${colors.dim}Total projects: ${projects.length}${colors.reset}`);
}

// Run CLI
main().catch(err => {
  error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
