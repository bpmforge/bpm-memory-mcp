#!/usr/bin/env npx tsx
/**
 * Re-embed all memories with the current configured model
 *
 * Usage:
 *   npx tsx scripts/reembed.ts [--dry-run] [--project <project-id>]
 *
 * Options:
 *   --dry-run    Show what would be done without making changes
 *   --project    Only re-embed a specific project
 */

import { readdirSync, existsSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import Database from 'better-sqlite3';
import { loadConfig } from '../src/embeddings/config.js';
import { LMStudioProvider } from '../src/embeddings/lmstudio.js';
import { OllamaProvider } from '../src/embeddings/ollama.js';
import type { EmbeddingProvider } from '../src/embeddings/types.js';

const MEMORY_DIR = join(homedir(), '.claude-memory');
const BATCH_SIZE = 10;

interface Memory {
  id: string;
  content: string;
  embedding: Buffer | null;
}

async function getProvider(config: ReturnType<typeof loadConfig>): Promise<EmbeddingProvider> {
  const { provider, endpoint } = config.embedding;

  if (provider === 'lmstudio') {
    return new LMStudioProvider(endpoint);
  }
  return new OllamaProvider(endpoint);
}

async function reembedProject(
  projectPath: string,
  provider: EmbeddingProvider,
  model: string,
  dryRun: boolean
): Promise<{ total: number; updated: number; errors: number }> {
  const dbPath = join(projectPath, 'memory.db');

  if (!existsSync(dbPath)) {
    return { total: 0, updated: 0, errors: 0 };
  }

  const db = new Database(dbPath);
  const stats = { total: 0, updated: 0, errors: 0 };

  try {
    // Get all memories
    const memories = db.prepare('SELECT id, content, embedding FROM memories').all() as Memory[];
    stats.total = memories.length;

    if (dryRun) {
      console.log(`  Would re-embed ${memories.length} memories`);
      return stats;
    }

    // Process in batches
    for (let i = 0; i < memories.length; i += BATCH_SIZE) {
      const batch = memories.slice(i, i + BATCH_SIZE);
      const contents = batch.map(m => m.content);

      try {
        // Generate embeddings
        const embeddings = provider.embedBatch
          ? await provider.embedBatch(contents, model)
          : await Promise.all(contents.map(c => provider.embed(c, model)));

        // Update database
        const updateStmt = db.prepare(
          'UPDATE memories SET embedding = ?, embedding_model = ? WHERE id = ?'
        );

        const transaction = db.transaction(() => {
          for (let j = 0; j < batch.length; j++) {
            const memory = batch[j]!;
            const embedding = embeddings[j];

            if (embedding) {
              const buffer = Buffer.from(embedding.buffer);
              updateStmt.run(buffer, model, memory.id);
              stats.updated++;
            } else {
              stats.errors++;
            }
          }
        });

        transaction();
        process.stdout.write(`\r  Progress: ${Math.min(i + BATCH_SIZE, memories.length)}/${memories.length}`);

      } catch (err) {
        console.error(`\n  Batch error: ${err}`);
        stats.errors += batch.length;
      }
    }

    console.log(''); // New line after progress

  } finally {
    db.close();
  }

  return stats;
}

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const projectIndex = args.indexOf('--project');
  const specificProject = projectIndex !== -1 ? args[projectIndex + 1] : null;

  console.log('=== Claude Memory Re-embedding Tool ===\n');

  // Load config
  const config = loadConfig();
  console.log(`Provider: ${config.embedding.provider}`);
  console.log(`Endpoint: ${config.embedding.endpoint}`);
  console.log(`Model: ${config.embedding.model}`);
  console.log(`Dimensions: ${config.embedding.dimensions}`);
  console.log(`Mode: ${dryRun ? 'DRY RUN' : 'LIVE'}\n`);

  // Initialize provider
  const provider = await getProvider(config);
  const healthy = await provider.health();

  if (!healthy) {
    console.error(`Error: Provider ${config.embedding.provider} is not responding`);
    process.exit(1);
  }

  // Test embedding dimensions
  const testEmbed = await provider.embed('test', config.embedding.model);
  console.log(`Verified model dimensions: ${testEmbed.length}\n`);

  if (testEmbed.length !== config.embedding.dimensions) {
    console.warn(`Warning: Actual dimensions (${testEmbed.length}) differ from config (${config.embedding.dimensions})`);
  }

  // Find project directories
  const entries = readdirSync(MEMORY_DIR, { withFileTypes: true });
  const projectDirs = entries
    .filter(e => e.isDirectory() && !e.name.startsWith('.'))
    .filter(e => !specificProject || e.name === specificProject)
    .map(e => join(MEMORY_DIR, e.name));

  if (projectDirs.length === 0) {
    console.log('No project databases found.');
    return;
  }

  console.log(`Found ${projectDirs.length} project(s)\n`);

  let totalStats = { total: 0, updated: 0, errors: 0 };

  for (const projectPath of projectDirs) {
    const projectId = projectPath.split('/').pop()!;
    console.log(`Project: ${projectId}`);

    const stats = await reembedProject(projectPath, provider, config.embedding.model, dryRun);

    totalStats.total += stats.total;
    totalStats.updated += stats.updated;
    totalStats.errors += stats.errors;

    console.log(`  Total: ${stats.total}, Updated: ${stats.updated}, Errors: ${stats.errors}\n`);
  }

  console.log('=== Summary ===');
  console.log(`Total memories: ${totalStats.total}`);
  console.log(`Updated: ${totalStats.updated}`);
  console.log(`Errors: ${totalStats.errors}`);
}

main().catch(console.error);
