/**
 * Benchmark test data generators
 * Provides utilities for generating test memories, files, and scenarios
 */

import { randomUUID } from 'crypto';
import { mkdirSync, writeFileSync, existsSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import type Database from 'better-sqlite3';

/**
 * Memory types as defined in the system
 */
export type MemoryType = 'fact' | 'pattern' | 'decision' | 'error' | 'preference';

/**
 * Languages supported by the system
 */
export type Language =
  | 'typescript'
  | 'javascript'
  | 'python'
  | 'rust'
  | 'go'
  | 'java'
  | 'c'
  | 'cpp'
  | 'ruby'
  | 'php'
  | 'shell'
  | 'sql'
  | 'markdown'
  | 'json'
  | 'yaml'
  | 'other';

/**
 * Code context structure
 */
export interface CodeContext {
  filePath: string;
  startLine: number;
  endLine?: number;
  symbolName?: string;
  symbolType?: 'function' | 'class' | 'variable' | 'type' | 'interface' | 'method' | 'property';
  sourceHash?: string;
}

/**
 * Memory row structure for database insertion
 */
export interface MemoryRow {
  id: string;
  content: string;
  embedding: Buffer | null;
  type: string;
  confidence: number;
  citation: string | null;
  project_id: string;
  content_hash: string;
  created_at: number;
  accessed_at: number;
  access_count: number;
  deleted_at: number | null;
  deleted_reason: string | null;
  language: string | null;
  code_context: string | null;
  version: number;
  supersedes_id: string | null;
  superseded_by: string | null;
  superseded_at: number | null;
  flagged_at: number | null;
  flagged_reason: string | null;
  embedding_model: string | null;
}

/**
 * Options for generating test memories
 */
export interface GenerateMemoryOptions {
  projectId?: string;
  type?: MemoryType;
  confidence?: number;
  citation?: string | null;
  language?: Language | null;
  codeContext?: CodeContext | null;
  accessCount?: number;
  accessedAt?: number;
  createdAt?: number;
}

/**
 * Generate a random content string of specified length
 */
export function generateContent(length: number): string {
  const words = [
    'function',
    'component',
    'handles',
    'user',
    'authentication',
    'using',
    'JWT',
    'tokens',
    'stored',
    'in',
    'HTTP-only',
    'cookies',
    'The',
    'implementation',
    'follows',
    'OWASP',
    'best',
    'practices',
    'and',
    'includes',
    'rate',
    'limiting',
    'CSRF',
    'protection',
    'This',
    'pattern',
    'is',
    'used',
    'throughout',
    'the',
    'codebase',
    'for',
    'API',
    'endpoints',
    'requiring',
    'authorization',
    'Database',
    'queries',
    'are',
    'optimized',
    'with',
    'indexes',
    'on',
    'frequently',
    'accessed',
    'columns',
  ];

  const result: string[] = [];
  let currentLength = 0;

  while (currentLength < length) {
    const word = words[Math.floor(Math.random() * words.length)];
    result.push(word);
    currentLength += word.length + 1;
  }

  return result.join(' ').slice(0, length);
}

/**
 * Generate a test memory record
 */
export function generateMemory(options: GenerateMemoryOptions = {}): MemoryRow {
  const now = Math.floor(Date.now() / 1000);
  const content = generateContent(500);
  const contentHash = Buffer.from(content).toString('base64').slice(0, 64);

  return {
    id: randomUUID(),
    content,
    embedding: null,
    type: options.type ?? 'fact',
    confidence: options.confidence ?? 0.8,
    citation: options.citation ?? null,
    project_id: options.projectId ?? 'test-project',
    content_hash: contentHash,
    created_at: options.createdAt ?? now,
    accessed_at: options.accessedAt ?? now,
    access_count: options.accessCount ?? 1,
    deleted_at: null,
    deleted_reason: null,
    language: options.language ?? null,
    code_context: options.codeContext ? JSON.stringify(options.codeContext) : null,
    version: 1,
    supersedes_id: null,
    superseded_by: null,
    superseded_at: null,
    flagged_at: null,
    flagged_reason: null,
    embedding_model: null,
  };
}

/**
 * Generate multiple test memories
 */
export function generateMemories(
  count: number,
  options: GenerateMemoryOptions = {}
): MemoryRow[] {
  return Array.from({ length: count }, () => generateMemory(options));
}

/**
 * Generate memories with varying citation configurations
 * @param count - Total number of memories
 * @param citationRatio - Ratio of memories with citations (0-1)
 * @param projectRoot - Project root for file creation
 * @param missingRatio - Ratio of cited files that should be missing (0-1)
 * @param changedRatio - Ratio of cited files that should have changed content (0-1)
 */
export function generateMemoriesWithCitations(
  count: number,
  citationRatio: number,
  projectRoot: string,
  missingRatio: number = 0,
  changedRatio: number = 0
): { memories: MemoryRow[]; files: Map<string, string> } {
  const memories: MemoryRow[] = [];
  const files = new Map<string, string>();
  const citedCount = Math.floor(count * citationRatio);
  const missingCount = Math.floor(citedCount * missingRatio);
  const changedCount = Math.floor(citedCount * changedRatio);

  // Ensure src directory exists
  const srcDir = join(projectRoot, 'src');
  if (!existsSync(srcDir)) {
    mkdirSync(srcDir, { recursive: true });
  }

  for (let i = 0; i < count; i++) {
    const hasCitation = i < citedCount;
    let citation: string | null = null;
    let codeContext: CodeContext | null = null;

    if (hasCitation) {
      const filePath = `src/file${i}.ts`;
      const fullPath = join(projectRoot, filePath);
      const isMissing = i < missingCount;
      const isChanged = !isMissing && i < missingCount + changedCount;

      // Generate file content
      const originalContent = `// File ${i}\nexport function handler${i}() {\n  return ${i};\n}`;
      const sourceHash = Buffer.from(originalContent)
        .toString('base64')
        .slice(0, 64);

      citation = `${filePath}:2-4:handler${i}`;
      codeContext = {
        filePath,
        startLine: 2,
        endLine: 4,
        symbolName: `handler${i}`,
        symbolType: 'function',
        sourceHash,
      };

      if (!isMissing) {
        // Create the file
        const currentContent = isChanged
          ? `// Modified File ${i}\nexport function handler${i}() {\n  return ${i * 2};\n}`
          : originalContent;

        writeFileSync(fullPath, currentContent);
        files.set(filePath, currentContent);
      }
    }

    memories.push(
      generateMemory({
        citation,
        codeContext,
        language: hasCitation ? 'typescript' : null,
      })
    );
  }

  return { memories, files };
}

/**
 * Create a temporary test directory
 */
export function createTempDir(prefix: string = 'bench'): string {
  const dir = join(tmpdir(), `claude-memory-${prefix}-${Date.now()}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

/**
 * Clean up a temporary test directory
 */
export function cleanupTempDir(dir: string): void {
  if (existsSync(dir)) {
    rmSync(dir, { recursive: true, force: true });
  }
}

/**
 * Insert memories directly into the database for benchmarking
 */
export function insertMemories(db: Database.Database, memories: MemoryRow[]): void {
  const stmt = db.prepare(`
    INSERT INTO memories (
      id, content, embedding, type, confidence, citation, project_id,
      content_hash, created_at, accessed_at, access_count, deleted_at,
      deleted_reason, language, code_context, version, supersedes_id,
      superseded_by, superseded_at, flagged_at, flagged_reason, embedding_model
    ) VALUES (
      ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
    )
  `);

  const insertMany = db.transaction((rows: MemoryRow[]) => {
    for (const row of rows) {
      stmt.run(
        row.id,
        row.content,
        row.embedding,
        row.type,
        row.confidence,
        row.citation,
        row.project_id,
        row.content_hash,
        row.created_at,
        row.accessed_at,
        row.access_count,
        row.deleted_at,
        row.deleted_reason,
        row.language,
        row.code_context,
        row.version,
        row.supersedes_id,
        row.superseded_by,
        row.superseded_at,
        row.flagged_at,
        row.flagged_reason,
        row.embedding_model
      );
    }
  });

  insertMany(memories);
}

/**
 * Create sessions for access staleness testing
 */
export function createSessions(
  db: Database.Database,
  projectId: string,
  count: number
): void {
  const stmt = db.prepare(`
    INSERT INTO sessions (id, project_id, session_number, created_at, working_memory, core_memory_snapshot, conversation_summary)
    VALUES (?, ?, ?, ?, '{}', '{}', 'Session summary')
  `);

  const baseTime = Math.floor(Date.now() / 1000);
  const insertMany = db.transaction(() => {
    for (let i = 0; i < count; i++) {
      stmt.run(randomUUID(), projectId, i + 1, baseTime - (count - i) * 3600);
    }
  });

  insertMany();
}

/**
 * Generate content of various sizes for performance testing
 */
export function generateContentSizes(): Map<string, string> {
  const sizes = new Map<string, string>();
  sizes.set('100', generateContent(100));
  sizes.set('500', generateContent(500));
  sizes.set('1000', generateContent(1000));
  sizes.set('5000', generateContent(5000));
  sizes.set('10000', generateContent(10000));
  sizes.set('50000', generateContent(50000));
  return sizes;
}

/**
 * Create test file with known content for hash verification
 */
export function createTestFile(
  dir: string,
  filename: string,
  content: string
): string {
  const filepath = join(dir, filename);
  const dirPath = join(dir, ...filename.split('/').slice(0, -1));
  if (!existsSync(dirPath)) {
    mkdirSync(dirPath, { recursive: true });
  }
  writeFileSync(filepath, content);
  return filepath;
}

/**
 * Initialize database schema for benchmarking
 */
export function initBenchmarkSchema(db: Database.Database): void {
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

    CREATE INDEX IF NOT EXISTS idx_memories_project ON memories(project_id);
    CREATE INDEX IF NOT EXISTS idx_memories_accessed ON memories(accessed_at);
    CREATE INDEX IF NOT EXISTS idx_memories_type ON memories(type);
    CREATE INDEX IF NOT EXISTS idx_sessions_project ON sessions(project_id);
  `);
}
