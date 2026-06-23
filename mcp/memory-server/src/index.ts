#!/usr/bin/env node

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';

import {
  connectionPool,
  runMigrations,
  getProjectId,
  GLOBAL_PROJECT_ID,
  listAllProjects,
  getProjectMetadata,
} from './storage/index.js';
import { EmbeddingService, loadConfig } from './embeddings/index.js';
import { HybridSearch } from './search/index.js';
import { MemoryRepository } from './storage/repository.js';
import { SessionRepository } from './storage/session.js';
import { CoreMemoryRepository } from './storage/core_memory.js';
import { StalenessDetector } from './staleness/detector.js';
import { containsCredentials } from './security/credentials.js';
import { isPathSafe } from './security/paths.js';
import { parseCodeContext } from './language/context.js';
import {
  MemoryStoreInputSchema,
  MemoryRecallInputSchema,
  MemoryForgetInputSchema,
  MemoryUpdateInputSchema,
  MemoryFeedbackInputSchema,
  SessionSaveInputSchema,
  GoalAnchorInputSchema,
  MemoryLinkInputSchema,
  CheckpointTaskInputSchema,
  FactStoreInputSchema,
  FactQueryInputSchema,
  FeedbackType,
  MemoryLinkType,
  MemoryLink,
  MemoryScope,
  MemoryType,
  type MemoryCreateInput,
  type SearchOptions,
  type CodeContext,
} from './types.js';
import { GoalRepository } from './goals/index.js';
import { calculateDriftIndicator, getDriftWarningMessage } from './goals/drift.js';
import { MemoryLinkRepository } from './storage/links.js';
import { CheckpointRepository } from './checkpoint/index.js';
import { ContradictionDetector } from './validation/contradictions.js';
import { AutoLinker } from './linking/index.js';
import { extractMemories, detectCitation } from './extraction/index.js';
import { ConsolidationService, type ConsolidationOptions } from './consolidation/index.js';
import {
  MemoryGraphService,
  KnowledgeGraphPopulator,
  type PopulationResult,
} from './graph/index.js';
import {
  estimateTokens,
  truncateToTokenBudget,
  fitItemsToTokenBudget,
  TOKEN_BUDGETS,
} from './utils/index.js';

// Storage quota: maximum memories per project
const MAX_MEMORIES_PER_PROJECT = 10000;

// Common stop words to filter from keyword extraction
const STOP_WORDS = new Set([
  'a',
  'an',
  'the',
  'is',
  'are',
  'was',
  'were',
  'be',
  'been',
  'being',
  'have',
  'has',
  'had',
  'do',
  'does',
  'did',
  'will',
  'would',
  'could',
  'should',
  'may',
  'might',
  'must',
  'shall',
  'can',
  'need',
  'dare',
  'ought',
  'used',
  'to',
  'of',
  'in',
  'for',
  'on',
  'with',
  'at',
  'by',
  'from',
  'as',
  'into',
  'through',
  'during',
  'before',
  'after',
  'above',
  'below',
  'between',
  'and',
  'but',
  'or',
  'nor',
  'so',
  'yet',
  'both',
  'either',
  'neither',
  'not',
  'only',
  'own',
  'same',
  'than',
  'too',
  'very',
  'just',
  'also',
  'this',
  'that',
  'these',
  'those',
  'it',
  'its',
  'i',
  'we',
  'you',
  'he',
  'she',
  'they',
]);

/**
 * Extract keywords from text for auto-recall queries
 */
function extractKeywords(text: string, maxKeywords: number = 5): string[] {
  const words = text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOP_WORDS.has(w));

  // Count word frequency
  const freq = new Map<string, number>();
  for (const word of words) {
    freq.set(word, (freq.get(word) ?? 0) + 1);
  }

  // Sort by frequency and return top N
  return [...freq.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, maxKeywords)
    .map(([word]) => word);
}

// Benchmark mode: disable hardening for comparison testing
// WARNING: Only use for benchmarking - never in production
const HARDENING_DISABLED = process.env.CLAUDE_MEMORY_DISABLE_HARDENING === 'true';

// Current project context
let currentProjectId: string | null = null;

// Services (initialized per project)
let embeddingService: EmbeddingService | null = null;
let hybridSearch: HybridSearch | null = null;
let memoryRepository: MemoryRepository | null = null;
let sessionRepository: SessionRepository | null = null;
let coreMemoryRepository: CoreMemoryRepository | null = null;
let stalenessDetector: StalenessDetector | null = null;
// V3 services for goals, links, and checkpoints
let goalRepository: GoalRepository | null = null;
let memoryLinkRepository: MemoryLinkRepository | null = null;
let checkpointRepository: CheckpointRepository | null = null;
let contradictionDetector: ContradictionDetector | null = null;
let lastGoalCheck: Date | null = null;
// V4 services for automatic linking
let autoLinker: AutoLinker | null = null;
// V5 services for graph queries
let memoryGraphService: MemoryGraphService | null = null;
// V11 knowledge graph population
let knowledgeGraphPopulator: KnowledgeGraphPopulator | null = null;

/**
 * Initialize services for a project
 */
async function initializeForProject(projectId: string): Promise<void> {
  if (currentProjectId === projectId && embeddingService && hybridSearch) {
    return; // Already initialized
  }

  currentProjectId = projectId;
  const db = connectionPool.get(projectId);

  // Run migrations
  runMigrations(db);

  // Initialize services with saved config
  const config = loadConfig();
  embeddingService = new EmbeddingService(db);
  await embeddingService.initialize(config.embedding);

  hybridSearch = new HybridSearch(db, embeddingService);
  memoryRepository = new MemoryRepository(db);
  sessionRepository = new SessionRepository(db);
  coreMemoryRepository = new CoreMemoryRepository(db);
  stalenessDetector = new StalenessDetector(db);
  // V3 services
  goalRepository = new GoalRepository(db);
  memoryLinkRepository = new MemoryLinkRepository(db);
  checkpointRepository = new CheckpointRepository(db);
  contradictionDetector = new ContradictionDetector(db);
  // V4 services
  autoLinker = new AutoLinker(db);
  // V5 services
  memoryGraphService = new MemoryGraphService(db);
  // V11 services
  knowledgeGraphPopulator = new KnowledgeGraphPopulator(db);

  // Initialize core memory if needed
  if (!coreMemoryRepository.isInitialized(projectId)) {
    coreMemoryRepository.initializeDefaults(projectId);
  }
}

// Global scope services (lazily initialized)
let globalEmbeddingService: EmbeddingService | null = null;
let globalHybridSearch: HybridSearch | null = null;
let globalMemoryRepository: MemoryRepository | null = null;

/**
 * Initialize and get services for global scope
 */
async function initializeGlobalScope(): Promise<{
  embeddingService: EmbeddingService;
  hybridSearch: HybridSearch;
  memoryRepository: MemoryRepository;
}> {
  if (globalEmbeddingService && globalHybridSearch && globalMemoryRepository) {
    return {
      embeddingService: globalEmbeddingService,
      hybridSearch: globalHybridSearch,
      memoryRepository: globalMemoryRepository,
    };
  }

  const db = connectionPool.get(GLOBAL_PROJECT_ID);
  runMigrations(db);

  const config = loadConfig();
  globalEmbeddingService = new EmbeddingService(db);
  await globalEmbeddingService.initialize(config.embedding);

  globalHybridSearch = new HybridSearch(db, globalEmbeddingService);
  globalMemoryRepository = new MemoryRepository(db);

  return {
    embeddingService: globalEmbeddingService,
    hybridSearch: globalHybridSearch,
    memoryRepository: globalMemoryRepository,
  };
}

/**
 * Get the effective project ID based on scope
 */
function getEffectiveProjectId(scope: string | undefined, currentProjectId: string): string {
  return scope === 'global' ? GLOBAL_PROJECT_ID : currentProjectId;
}

/**
 * Create and configure the MCP server
 */
function createServer(): Server {
  const server = new Server(
    {
      name: 'claude-memory',
      version: '1.0.0',
    },
    {
      capabilities: {
        tools: {},
        resources: {},
      },
    }
  );

  // List available tools
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
      {
        name: 'memory_store',
        description: 'Store a memory with embedding and optional entity extraction',
        inputSchema: {
          type: 'object',
          properties: {
            content: { type: 'string', description: 'Memory content to store' },
            type: {
              type: 'string',
              enum: ['fact', 'pattern', 'decision', 'error', 'preference'],
              description: 'Memory type',
            },
            confidence: { type: 'number', minimum: 0, maximum: 1, description: 'Confidence score' },
            citation: { type: 'string', description: 'Source reference (file:line)' },
            // V2 fields
            language: {
              type: 'string',
              enum: [
                'typescript',
                'javascript',
                'python',
                'rust',
                'go',
                'java',
                'c',
                'cpp',
                'ruby',
                'php',
                'shell',
                'sql',
                'markdown',
                'json',
                'yaml',
                'other',
              ],
              description: 'Programming language (auto-detected from citation if not provided)',
            },
            codeContext: {
              type: 'object',
              properties: {
                filePath: { type: 'string', description: 'Relative file path' },
                startLine: { type: 'integer', minimum: 1, description: 'Starting line number' },
                endLine: { type: 'integer', minimum: 1, description: 'Ending line number' },
                symbolName: { type: 'string', description: 'Function/class/variable name' },
                symbolType: {
                  type: 'string',
                  enum: ['function', 'class', 'variable', 'type', 'module', 'method'],
                },
              },
              description: 'Structured code context (auto-parsed from citation if not provided)',
            },
            scope: {
              type: 'string',
              enum: ['project', 'global'],
              description:
                'Memory scope: "project" (default) for project-specific, "global" for cross-project memories',
            },
          },
          required: ['content'],
        },
      },
      {
        name: 'memory_recall',
        description: 'Search memories using hybrid vector + keyword search',
        inputSchema: {
          type: 'object',
          properties: {
            query: { type: 'string', description: 'Search query' },
            type: {
              type: 'string',
              enum: ['fact', 'pattern', 'decision', 'error', 'preference'],
              description: 'Filter by memory type',
            },
            limit: { type: 'integer', minimum: 1, maximum: 50, description: 'Max results' },
            minConfidence: {
              type: 'number',
              minimum: 0,
              maximum: 1,
              description: 'Min confidence',
            },
            // V2 filters
            language: {
              type: 'string',
              enum: [
                'typescript',
                'javascript',
                'python',
                'rust',
                'go',
                'java',
                'c',
                'cpp',
                'ruby',
                'php',
                'shell',
                'sql',
                'markdown',
                'json',
                'yaml',
                'other',
              ],
              description: 'Filter by programming language',
            },
            includeStale: {
              type: 'boolean',
              description: 'Include flagged-stale memories (default: false)',
            },
            includeSuperseded: {
              type: 'boolean',
              description: 'Include superseded versions (default: false)',
            },
            scope: {
              type: 'string',
              enum: ['project', 'global', 'both', 'all'],
              description:
                'Search scope: "project" for current project only, "global" for global memories only, "both" (default) for project + global, "all" for ALL projects (cross-project search)',
            },
          },
          required: ['query'],
        },
      },
      {
        name: 'memory_forget',
        description: 'Soft-delete a memory with reason tracking',
        inputSchema: {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid', description: 'Memory ID to forget' },
            reason: { type: 'string', description: 'Reason for forgetting' },
          },
          required: ['id', 'reason'],
        },
      },
      {
        name: 'memory_update',
        description: 'Create a new version of a memory (supersedes the old version)',
        inputSchema: {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid', description: 'Memory ID to update' },
            content: { type: 'string', description: 'New content' },
            // V2 optional updates
            language: {
              type: 'string',
              enum: [
                'typescript',
                'javascript',
                'python',
                'rust',
                'go',
                'java',
                'c',
                'cpp',
                'ruby',
                'php',
                'shell',
                'sql',
                'markdown',
                'json',
                'yaml',
                'other',
              ],
              description: 'Update programming language',
            },
          },
          required: ['id', 'content'],
        },
      },
      {
        name: 'memory_feedback',
        description: 'Provide feedback on a recalled memory to improve future results',
        inputSchema: {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid', description: 'Memory ID to provide feedback on' },
            feedback: {
              type: 'string',
              enum: ['helpful', 'wrong', 'outdated', 'duplicate'],
              description: 'Type of feedback',
            },
            correction: { type: 'string', description: 'Corrected content (for wrong/outdated)' },
            duplicateOf: {
              type: 'string',
              format: 'uuid',
              description: 'Canonical memory ID (for duplicate)',
            },
          },
          required: ['id', 'feedback'],
        },
      },
      {
        name: 'session_save',
        description: 'Persist current session state',
        inputSchema: {
          type: 'object',
          properties: {
            summary: { type: 'string', description: 'Conversation summary' },
          },
        },
      },
      {
        name: 'session_restore',
        description: 'Load previous session state',
        inputSchema: {
          type: 'object',
          properties: {},
        },
      },
      // V3 tools for goals, links, and checkpoints
      {
        name: 'goal_anchor',
        description: 'Set, track, and check session goals to prevent context drift',
        inputSchema: {
          type: 'object',
          properties: {
            action: {
              type: 'string',
              enum: ['set', 'complete', 'check', 'list'],
              description: 'Action to perform',
            },
            content: { type: 'string', description: 'Goal description (for "set")' },
            priority: {
              type: 'integer',
              minimum: 1,
              maximum: 5,
              description: 'Priority 1-5 where 1 is highest (for "set")',
            },
            goalId: {
              type: 'string',
              format: 'uuid',
              description: 'Goal ID (for "complete"/"check")',
            },
            note: { type: 'string', description: 'Completion note (for "complete")' },
          },
          required: ['action'],
        },
      },
      {
        name: 'memory_link',
        description:
          'Create and query Zettelkasten-style links between memories. Supports graph queries for contradictions, chains, clusters, statistics, and knowledge graph entities.',
        inputSchema: {
          type: 'object',
          properties: {
            action: {
              type: 'string',
              enum: [
                'create',
                'find_related',
                'get_links',
                'get_stats',
                'find_contradictions',
                'find_chain',
                'find_cluster',
                'find_orphans',
                'get_entities',
                'find_by_entity',
              ],
              description:
                'Action: create/find_related/get_links (basic), get_stats/find_contradictions/find_chain/find_cluster/find_orphans (graph), get_entities/find_by_entity (knowledge graph)',
            },
            sourceId: {
              type: 'string',
              format: 'uuid',
              description: 'Source memory ID (for "create")',
            },
            targetId: {
              type: 'string',
              format: 'uuid',
              description: 'Target memory ID (for "create")',
            },
            linkType: {
              type: 'string',
              enum: ['relates_to', 'contradicts', 'supports', 'extends', 'derived_from'],
              description: 'Type of link relationship',
            },
            strength: { type: 'number', minimum: 0, maximum: 1, description: 'Link strength 0-1' },
            bidirectional: { type: 'boolean', description: 'Whether link works both directions' },
            memoryId: {
              type: 'string',
              format: 'uuid',
              description:
                'Memory ID (for find_related/get_links/find_chain/find_cluster/get_entities)',
            },
            entityName: {
              type: 'string',
              description:
                'Entity name to search (for find_by_entity, e.g., file path or function name)',
            },
            entityType: {
              type: 'string',
              enum: ['file', 'function', 'type', 'decision', 'error'],
              description: 'Entity type filter (for find_by_entity)',
            },
            depth: { type: 'integer', minimum: 1, maximum: 3, description: 'Traversal depth' },
            linkTypes: {
              type: 'array',
              items: { type: 'string' },
              description:
                'Link types to follow for find_chain (default: extends, derived_from, supports)',
            },
            direction: {
              type: 'string',
              enum: ['forward', 'backward', 'both'],
              description: 'Chain traversal direction (default: both)',
            },
          },
          required: ['action'],
        },
      },
      {
        name: 'checkpoint_task',
        description: 'Save/restore structured task progress for resumption',
        inputSchema: {
          type: 'object',
          properties: {
            action: {
              type: 'string',
              enum: ['save', 'restore', 'list'],
              description: 'Action to perform',
            },
            taskId: { type: 'string', description: 'Task identifier' },
            phase: { type: 'string', description: 'Current task phase' },
            completedSteps: {
              type: 'array',
              items: { type: 'string' },
              description: 'Steps already completed',
            },
            pendingSteps: {
              type: 'array',
              items: { type: 'string' },
              description: 'Steps still pending',
            },
            artifacts: {
              type: 'array',
              items: { type: 'string' },
              description: 'Artifacts created (file paths, etc.)',
            },
          },
          required: ['action'],
        },
      },
      // V8: Project management tools
      {
        name: 'memory_list_projects',
        description:
          'List all projects with memory databases. Shows project IDs, database sizes, and memory counts.',
        inputSchema: {
          type: 'object',
          properties: {},
        },
      },
      {
        name: 'memory_migrate',
        description: 'Move or copy a memory from one scope/project to another',
        inputSchema: {
          type: 'object',
          properties: {
            memoryId: { type: 'string', format: 'uuid', description: 'ID of memory to migrate' },
            targetScope: {
              type: 'string',
              enum: ['project', 'global'],
              description: 'Target scope for the memory',
            },
            action: {
              type: 'string',
              enum: ['move', 'copy'],
              description: 'Whether to move (delete original) or copy (keep original)',
            },
          },
          required: ['memoryId', 'targetScope', 'action'],
        },
      },
      // V9: Auto-extraction tools
      {
        name: 'memory_auto_extract',
        description:
          'Analyze text and automatically extract memories. Returns candidates for review or auto-stores them.',
        inputSchema: {
          type: 'object',
          properties: {
            content: {
              type: 'string',
              description: 'Text to analyze (conversation, error output, code changes, etc.)',
            },
            context: { type: 'string', description: 'Optional context about what was happening' },
            source: {
              type: 'string',
              enum: ['conversation', 'error', 'code_change', 'session_summary'],
              description: 'Source type to guide extraction',
            },
            autoStore: {
              type: 'boolean',
              description:
                'If true, automatically store extracted memories. If false, just return candidates for review.',
            },
            minConfidence: {
              type: 'number',
              minimum: 0,
              maximum: 1,
              description: 'Minimum confidence threshold for auto-storage (default: 0.7)',
            },
          },
          required: ['content', 'source'],
        },
      },
      // V9: Proactive context assembly
      {
        name: 'memory_context_assemble',
        description:
          'Assemble relevant memory context for a task. Call this BEFORE starting significant work to get relevant past decisions, patterns, and constraints. Returns formatted context to consider.',
        inputSchema: {
          type: 'object',
          properties: {
            task: { type: 'string', description: 'Description of the task or question to address' },
            files: {
              type: 'array',
              items: { type: 'string' },
              description: 'File paths that will be involved (for targeted recall)',
            },
            includeGlobal: {
              type: 'boolean',
              description: 'Include global memories (default: true)',
            },
            maxMemories: {
              type: 'integer',
              minimum: 1,
              maximum: 20,
              description: 'Maximum memories to include (default: 10)',
            },
            tokenBudget: {
              type: 'integer',
              minimum: 100,
              maximum: 10000,
              description:
                'Maximum tokens for assembled context. Memories will be truncated to fit. Presets: 500 (minimal), 2000 (standard), 4000 (detailed), 8000 (maximum)',
            },
          },
          required: ['task'],
        },
      },
      // V10: Memory consolidation
      {
        name: 'memory_consolidate',
        description:
          'Run memory consolidation: merge duplicates, decay unused memories, identify clusters for summarization. Run periodically to keep memory healthy.',
        inputSchema: {
          type: 'object',
          properties: {
            duplicateThreshold: {
              type: 'number',
              minimum: 0.5,
              maximum: 1.0,
              description: 'Similarity threshold for duplicate detection (default: 0.85)',
            },
            decayAfterDays: {
              type: 'integer',
              minimum: 1,
              maximum: 365,
              description: 'Days since last access before decay starts (default: 30)',
            },
            decayRate: {
              type: 'number',
              minimum: 0.001,
              maximum: 0.1,
              description: 'Confidence decay rate per day (default: 0.01)',
            },
            persistSummaries: {
              type: 'boolean',
              description:
                'If true, distill each identified cluster into a persisted semantic "pattern" memory (centroid embedding + derived_from provenance links to its sources). Episodic→semantic. Ignored when dryRun (default: false)',
            },
            dryRun: {
              type: 'boolean',
              description:
                'If true, report what would happen without making changes (default: false)',
            },
          },
        },
      },
      // V12: Re-embedding tool
      {
        name: 'memory_reembed',
        description:
          'Re-generate embeddings for all memories using the current embedding model. Use when changing embedding models or to fix corrupted embeddings.',
        inputSchema: {
          type: 'object',
          properties: {
            batchSize: {
              type: 'integer',
              minimum: 1,
              maximum: 50,
              description: 'Number of memories to process at once (default: 10)',
            },
            dryRun: {
              type: 'boolean',
              description:
                'If true, report what would happen without making changes (default: false)',
            },
            onlyMissing: {
              type: 'boolean',
              description: 'If true, only re-embed memories without embeddings (default: false)',
            },
          },
        },
      },
      // V9: Fact Store tools
      {
        name: 'fact_store',
        description:
          'Store a structured, cited fact extracted from a web source. Used by the research pipeline to build a grounded Fact Bank. Each fact has a claim, direct quote, source URL, and confidence score. Facts are the anti-hallucination layer — synthesis can only reference stored facts.',
        inputSchema: {
          type: 'object',
          properties: {
            claim: {
              type: 'string',
              description: 'A clear, specific factual claim extracted from the source',
            },
            directQuote: {
              type: 'string',
              description: 'The exact text from the source supporting this claim',
            },
            sourceUrl: { type: 'string', format: 'uri', description: 'URL of the source' },
            sourceTitle: { type: 'string', description: 'Title of the source page or document' },
            sourceType: {
              type: 'string',
              enum: ['official_docs', 'engineering_blog', 'academic', 'news', 'forum', 'unknown'],
              description: 'Type of source (affects credibility weighting)',
            },
            confidence: {
              type: 'number',
              minimum: 0,
              maximum: 1,
              description: 'Initial confidence (default: 0.6, increases with corroboration)',
            },
            domainTags: {
              type: 'array',
              items: { type: 'string' },
              description: 'Domain tags for filtering (e.g., ["go", "gc", "performance"])',
            },
            staleAfterDays: {
              type: 'integer',
              minimum: 1,
              description: 'Days until this fact should be re-verified (omit for evergreen facts)',
            },
            extractedBy: {
              type: 'string',
              description: 'Agent or process that extracted this fact',
            },
            scope: {
              type: 'string',
              enum: ['project', 'global'],
              description: 'Memory scope (default: project)',
            },
          },
          required: ['claim', 'directQuote', 'sourceUrl', 'sourceTitle'],
        },
      },
      {
        name: 'fact_query',
        description:
          'Query the Fact Bank for structured, cited facts. Supports semantic search, domain tag filtering, source type filtering, and confidence thresholds. Returns facts with their citations, confidence scores, and relationships (corroborating/contradicting facts).',
        inputSchema: {
          type: 'object',
          properties: {
            query: { type: 'string', description: 'Semantic search query to find relevant facts' },
            domainTags: {
              type: 'array',
              items: { type: 'string' },
              description: 'Filter by domain tags (facts must have ALL specified tags)',
            },
            sourceType: {
              type: 'string',
              enum: ['official_docs', 'engineering_blog', 'academic', 'news', 'forum', 'unknown'],
              description: 'Filter by source type',
            },
            minConfidence: {
              type: 'number',
              minimum: 0,
              maximum: 1,
              description: 'Minimum confidence threshold (default: 0)',
            },
            limit: {
              type: 'integer',
              minimum: 1,
              maximum: 50,
              description: 'Max results (default: 10)',
            },
            includeStale: {
              type: 'boolean',
              description: 'Include facts past their stale_after_days (default: false)',
            },
            includeContradictions: {
              type: 'boolean',
              description: 'Include contradicting facts in results (default: true)',
            },
            scope: {
              type: 'string',
              enum: ['project', 'global', 'both'],
              description: 'Search scope (default: both)',
            },
          },
          required: ['query'],
        },
      },
    ],
  }));

  // Handle tool calls
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    // Get project from environment or use default
    const projectRoot = process.env.CLAUDE_PROJECT_ROOT ?? process.cwd();
    const projectId = getProjectId(projectRoot);

    await initializeForProject(projectId);

    if (!embeddingService || !hybridSearch || !memoryRepository) {
      return {
        content: [{ type: 'text', text: 'Error: Services not initialized' }],
        isError: true,
      };
    }

    try {
      switch (name) {
        case 'memory_store': {
          const input = MemoryStoreInputSchema.parse(args);

          // V6: Determine scope - use global or project services
          const isGlobal = input.scope === MemoryScope.GLOBAL;
          const targetProjectId = isGlobal ? GLOBAL_PROJECT_ID : projectId;
          const targetRepo = isGlobal
            ? (await initializeGlobalScope()).memoryRepository
            : memoryRepository;
          const targetEmbedding = isGlobal
            ? (await initializeGlobalScope()).embeddingService
            : embeddingService;

          // Security checks (can be disabled for benchmarking)
          if (!HARDENING_DISABLED) {
            // Security: Check for credentials (SC-001)
            if (containsCredentials(input.content)) {
              return {
                content: [
                  {
                    type: 'text',
                    text: 'Error: Content appears to contain credentials or secrets. Memory not stored.',
                  },
                ],
                isError: true,
              };
            }

            // Security: Validate citation path (SC-002)
            if (input.citation) {
              const parsed = parseCodeContext(input.citation);
              if (parsed && !isPathSafe(parsed.filePath, projectRoot)) {
                return {
                  content: [
                    { type: 'text', text: 'Error: Citation path is outside project root.' },
                  ],
                  isError: true,
                };
              }
            }

            // Security: Check storage quota
            if (targetRepo.getMemoryCount(targetProjectId) >= MAX_MEMORIES_PER_PROJECT) {
              return {
                content: [
                  {
                    type: 'text',
                    text: `Error: Storage limit reached (${MAX_MEMORIES_PER_PROJECT} memories). Consider archiving or deleting old memories.`,
                  },
                ],
                isError: true,
              };
            }
          }

          const embedding = await targetEmbedding.embed(input.content);

          // Check for exact duplicate
          if (targetRepo.isDuplicateContent(input.content, targetProjectId)) {
            return {
              content: [{ type: 'text', text: 'Memory already exists (duplicate content)' }],
            };
          }

          // Semantic near-duplicate detection: soft-deprecate similar existing memories
          // so the newest version of a fact always wins in recall ranking.
          // Only applies to fact/preference/pattern types where the value changes over time.
          const semanticDedupTypes = ['fact', 'preference', 'pattern'];
          if (semanticDedupTypes.includes(input.type) && embedding) {
            const similar = targetRepo.findSemanticallySimilar(
              embedding,
              targetProjectId,
              0.88, // cosine threshold — high enough to avoid false positives
              5
            );
            for (const { memory } of similar) {
              // Reduce confidence of older near-duplicate so new one ranks higher
              targetRepo.setConfidence(memory.id, targetProjectId, 0.2);
            }
          }

          // Build memory input, only including defined optional properties
          const memoryInput: MemoryCreateInput = {
            content: input.content,
            type: input.type,
            confidence: input.confidence,
            projectId: targetProjectId,
          };
          if (input.citation) memoryInput.citation = input.citation;
          // V2 fields (language and codeContext auto-detected in repository if not provided)
          if (input.language) memoryInput.language = input.language;
          if (input.codeContext) {
            // Build CodeContext without undefined values for exactOptionalPropertyTypes
            const ctx: CodeContext = {
              filePath: input.codeContext.filePath,
              startLine: input.codeContext.startLine,
            };
            if (input.codeContext.endLine !== undefined) ctx.endLine = input.codeContext.endLine;
            if (input.codeContext.symbolName !== undefined)
              ctx.symbolName = input.codeContext.symbolName;
            if (input.codeContext.symbolType !== undefined)
              ctx.symbolType = input.codeContext.symbolType;
            memoryInput.codeContext = ctx;
          }

          // V3: Check for potential contradictions before storing
          let contradictionWarning: {
            count: number;
            memories: Array<{ id: string; similarity: number; reason: string }>;
          } | null = null;

          if (contradictionDetector && embedding && !HARDENING_DISABLED && !isGlobal) {
            const contradictions = await contradictionDetector.detectOnStore(
              input.content,
              embedding,
              targetProjectId
            );

            if (contradictions.length > 0) {
              contradictionWarning = {
                count: contradictions.length,
                memories: contradictions.slice(0, 3).map((c) => ({
                  id: c.memoryId,
                  similarity: Math.round(c.similarity * 100) / 100,
                  reason: c.reason,
                })),
              };
            }
          }

          const memory = targetRepo.createMemory(
            memoryInput,
            embedding,
            isGlobal ? undefined : projectRoot
          );

          // V4: Auto-link to related memories
          let autoLinkResult: {
            created: number;
            links: Array<{ targetId: string; linkType: string; strength: number }>;
            suggestions: Array<{ targetId: string; similarity: number; reason: string }>;
          } | null = null;

          // V6: Skip auto-linking for global memories (no cross-project linking)
          if (autoLinker && embedding && !HARDENING_DISABLED && !isGlobal) {
            const linkResult = await autoLinker.processNewMemory(
              memory.id,
              memory.content,
              embedding,
              targetProjectId
            );

            if (linkResult.createdLinks.length > 0 || linkResult.suggestedLinks.length > 0) {
              autoLinkResult = {
                created: linkResult.createdLinks.length,
                links: linkResult.createdLinks.map((l) => ({
                  targetId: l.targetId,
                  linkType: l.linkType,
                  strength: l.strength,
                })),
                suggestions: linkResult.suggestedLinks.slice(0, 3).map((s) => ({
                  targetId: s.targetId,
                  similarity: s.similarity,
                  reason: s.reason,
                })),
              };
            }
          }

          // V11: Populate knowledge graph with entities from citation/content
          let graphPopulationResult: {
            entitiesCreated: number;
            relationsCreated: number;
            entities: Array<{ name: string; type: string; isNew: boolean }>;
          } | null = null;

          // Skip graph population for global memories (no cross-project entities)
          if (knowledgeGraphPopulator && !HARDENING_DISABLED && !isGlobal) {
            const populationResult = await knowledgeGraphPopulator.populateFromMemory(
              memory,
              memory.codeContext
            );

            if (populationResult.entitiesCreated.length > 0) {
              graphPopulationResult = {
                entitiesCreated: populationResult.entitiesCreated.length,
                relationsCreated: populationResult.relationsCreated.length,
                entities: populationResult.entitiesCreated.slice(0, 5).map((e) => ({
                  name: e.name,
                  type: e.type,
                  isNew: e.isNew,
                })),
              };
            }
          }

          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify({
                  id: memory.id,
                  type: memory.type,
                  confidence: memory.confidence,
                  hasEmbedding: !!memory.embedding,
                  // V2 response fields
                  language: memory.language,
                  version: memory.version,
                  // V3 response fields
                  contradictionWarning,
                  // V4 response fields
                  autoLinks: autoLinkResult,
                  // V11 response fields
                  graphPopulation: graphPopulationResult,
                }),
              },
            ],
          };
        }

        case 'memory_recall': {
          const input = MemoryRecallInputSchema.parse(args);

          // V6/V8: Determine which scopes to search
          const searchScope = input.scope ?? 'both';
          const searchProject = searchScope === 'project' || searchScope === 'both';
          const searchGlobal = searchScope === 'global' || searchScope === 'both';
          const searchAll = searchScope === 'all';

          // Build base search options (only add type/language if defined)
          const baseOptions: Partial<SearchOptions> = {
            limit: input.limit,
            minConfidence: input.minConfidence,
            includeStale: input.includeStale,
            includeSuperseded: input.includeSuperseded,
          };
          if (input.type) baseOptions.type = input.type;
          if (input.language) baseOptions.language = input.language;

          // Collect results from scopes
          type MemoryResult = {
            id: string;
            content: string;
            type: string;
            confidence: number;
            citation: string | null;
            relevance: number;
            language: string | null;
            version: number;
            isSuperseded: boolean;
            isStale: boolean;
            scope: string;
            projectId?: string;
          };
          let allResults: MemoryResult[] = [];
          let combinedStats = {
            vectorMatches: 0,
            bm25Matches: 0,
            fusedResults: 0,
            latencyMs: 0,
            projectsSearched: 1,
          };

          // V8: Cross-project search (all projects)
          if (searchAll) {
            const allProjectIds = listAllProjects();
            combinedStats.projectsSearched = allProjectIds.length;

            for (const pid of allProjectIds) {
              try {
                // Initialize services for this project
                const db = connectionPool.get(pid);
                runMigrations(db);
                const config = loadConfig();
                const projEmbedding = new EmbeddingService(db);
                await projEmbedding.initialize(config.embedding);
                const projSearch = new HybridSearch(db, projEmbedding);
                const projRepo = new MemoryRepository(db);

                const searchOptions: SearchOptions = {
                  ...baseOptions,
                  projectId: pid,
                } as SearchOptions;
                const response = await projSearch.search(input.query, searchOptions);

                for (const result of response.memories) {
                  projRepo.updateAccessStats(result.memory.id);
                  allResults.push({
                    id: result.memory.id,
                    content: result.memory.content,
                    type: result.memory.type,
                    confidence: result.memory.confidence,
                    citation: result.memory.citation,
                    relevance: result.relevance,
                    language: result.memory.language,
                    version: result.memory.version,
                    isSuperseded: !!result.memory.supersededBy,
                    isStale: !!result.memory.flaggedAt,
                    scope: pid === GLOBAL_PROJECT_ID ? 'global' : 'project',
                    projectId: pid,
                  });
                }
                combinedStats.vectorMatches += response.searchStats.vectorMatches;
                combinedStats.bm25Matches += response.searchStats.bm25Matches;
                combinedStats.fusedResults += response.searchStats.fusedResults;
                combinedStats.latencyMs += response.searchStats.latencyMs;
              } catch {
                // Skip projects that fail to initialize
              }
            }
          } else {
            // Search current project scope
            if (searchProject) {
              const searchOptions: SearchOptions = { ...baseOptions, projectId } as SearchOptions;
              const response = await hybridSearch.search(input.query, searchOptions);

              for (const result of response.memories) {
                memoryRepository.updateAccessStats(result.memory.id);
                allResults.push({
                  id: result.memory.id,
                  content: result.memory.content,
                  type: result.memory.type,
                  confidence: result.memory.confidence,
                  citation: result.memory.citation,
                  relevance: result.relevance,
                  language: result.memory.language,
                  version: result.memory.version,
                  isSuperseded: !!result.memory.supersededBy,
                  isStale: !!result.memory.flaggedAt,
                  scope: 'project',
                });
              }
              combinedStats.vectorMatches += response.searchStats.vectorMatches;
              combinedStats.bm25Matches += response.searchStats.bm25Matches;
              combinedStats.fusedResults += response.searchStats.fusedResults;
              combinedStats.latencyMs += response.searchStats.latencyMs;
            }

            // Search global scope
            if (searchGlobal) {
              const globalServices = await initializeGlobalScope();
              const searchOptions: SearchOptions = {
                ...baseOptions,
                projectId: GLOBAL_PROJECT_ID,
              } as SearchOptions;
              const response = await globalServices.hybridSearch.search(input.query, searchOptions);

              for (const result of response.memories) {
                globalServices.memoryRepository.updateAccessStats(result.memory.id);
                allResults.push({
                  id: result.memory.id,
                  content: result.memory.content,
                  type: result.memory.type,
                  confidence: result.memory.confidence,
                  citation: result.memory.citation,
                  relevance: result.relevance,
                  language: result.memory.language,
                  version: result.memory.version,
                  isSuperseded: !!result.memory.supersededBy,
                  isStale: !!result.memory.flaggedAt,
                  scope: 'global',
                });
              }
              combinedStats.vectorMatches += response.searchStats.vectorMatches;
              combinedStats.bm25Matches += response.searchStats.bm25Matches;
              combinedStats.fusedResults += response.searchStats.fusedResults;
              combinedStats.latencyMs += response.searchStats.latencyMs;
            }
          }

          // Sort by relevance and limit
          allResults.sort((a, b) => b.relevance - a.relevance);
          allResults = allResults.slice(0, input.limit);

          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify({
                  memories: allResults,
                  stats: combinedStats,
                }),
              },
            ],
          };
        }

        case 'memory_forget': {
          const input = MemoryForgetInputSchema.parse(args);

          // Try project scope first
          let success = memoryRepository.softDelete(input.id, projectId, input.reason);
          let scope = 'project';

          // If not found in project, try global scope
          if (!success) {
            try {
              const globalServices = await initializeGlobalScope();
              success = globalServices.memoryRepository.softDelete(
                input.id,
                GLOBAL_PROJECT_ID,
                input.reason
              );
              scope = 'global';
            } catch {
              // Global scope not available
            }
          }

          return {
            content: [
              {
                type: 'text',
                text: success
                  ? `Memory ${input.id} marked as deleted (${scope} scope)`
                  : `Memory ${input.id} not found or already deleted`,
              },
            ],
          };
        }

        case 'memory_update': {
          const input = MemoryUpdateInputSchema.parse(args);

          // Try project scope first
          const projectMemory = memoryRepository.findById(input.id, projectId);

          if (projectMemory) {
            const embedding = await embeddingService.embed(input.content);
            const newMemory = memoryRepository.createSupersedingMemory(
              input.id,
              projectId,
              input.content,
              embedding,
              input.language,
              projectRoot
            );

            return {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify({
                    id: newMemory.id,
                    version: newMemory.version,
                    supersedesId: newMemory.supersedesId,
                    language: newMemory.language,
                    scope: 'project',
                    message: `Memory updated to version ${newMemory.version}`,
                  }),
                },
              ],
            };
          }

          // Try global scope
          try {
            const globalServices = await initializeGlobalScope();
            const globalMemory = globalServices.memoryRepository.findById(
              input.id,
              GLOBAL_PROJECT_ID
            );

            if (globalMemory) {
              const embedding = await globalServices.embeddingService.embed(input.content);
              const newMemory = globalServices.memoryRepository.createSupersedingMemory(
                input.id,
                GLOBAL_PROJECT_ID,
                input.content,
                embedding,
                input.language,
                undefined // No project root for global
              );

              return {
                content: [
                  {
                    type: 'text',
                    text: JSON.stringify({
                      id: newMemory.id,
                      version: newMemory.version,
                      supersedesId: newMemory.supersedesId,
                      language: newMemory.language,
                      scope: 'global',
                      message: `Memory updated to version ${newMemory.version}`,
                    }),
                  },
                ],
              };
            }
          } catch {
            // Global scope not available
          }

          return {
            content: [
              {
                type: 'text',
                text: `Memory ${input.id} not found in project or global scope`,
              },
            ],
          };
        }

        case 'memory_feedback': {
          const input = MemoryFeedbackInputSchema.parse(args);

          // Try project scope first
          const projectMemory = memoryRepository.findById(input.id, projectId);
          let scope = 'project';
          let feedback;
          let newMemoryId: string | null = null;

          if (projectMemory) {
            feedback = memoryRepository.recordFeedback(
              input.id,
              projectId,
              input.feedback as FeedbackType,
              input.correction,
              input.duplicateOf
            );

            if (input.correction && (input.feedback === 'wrong' || input.feedback === 'outdated')) {
              const embedding = await embeddingService.embed(input.correction);
              const newMemory = memoryRepository.createSupersedingMemory(
                input.id,
                projectId,
                input.correction,
                embedding,
                undefined,
                projectRoot
              );
              newMemoryId = newMemory.id;
            }
          } else {
            // Try global scope
            try {
              const globalServices = await initializeGlobalScope();
              const globalMemory = globalServices.memoryRepository.findById(
                input.id,
                GLOBAL_PROJECT_ID
              );

              if (globalMemory) {
                scope = 'global';
                feedback = globalServices.memoryRepository.recordFeedback(
                  input.id,
                  GLOBAL_PROJECT_ID,
                  input.feedback as FeedbackType,
                  input.correction,
                  input.duplicateOf
                );

                if (
                  input.correction &&
                  (input.feedback === 'wrong' || input.feedback === 'outdated')
                ) {
                  const embedding = await globalServices.embeddingService.embed(input.correction);
                  const newMemory = globalServices.memoryRepository.createSupersedingMemory(
                    input.id,
                    GLOBAL_PROJECT_ID,
                    input.correction,
                    embedding,
                    undefined,
                    undefined
                  );
                  newMemoryId = newMemory.id;
                }
              }
            } catch {
              // Global scope not available
            }
          }

          if (!feedback) {
            return {
              content: [
                {
                  type: 'text',
                  text: `Memory ${input.id} not found in project or global scope`,
                },
              ],
            };
          }

          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify({
                  feedbackId: feedback.id,
                  feedbackType: feedback.feedbackType,
                  confidenceDelta: feedback.confidenceDelta,
                  newMemoryId,
                  scope,
                  message: newMemoryId
                    ? `Feedback recorded (${scope}). New corrected memory created: ${newMemoryId}`
                    : `Feedback recorded (${scope}). Confidence adjusted by ${feedback.confidenceDelta}`,
                }),
              },
            ],
          };
        }

        case 'session_save': {
          const input = SessionSaveInputSchema.parse(args ?? {});

          if (!sessionRepository) {
            return {
              content: [{ type: 'text', text: 'Error: Session repository not initialized' }],
              isError: true,
            };
          }

          const workingMemory = sessionRepository.createDefaultWorkingMemory();
          const summary = input.summary ?? 'Session saved automatically';
          const sessionId = sessionRepository.saveSession(projectId, workingMemory, summary);

          // Prune old sessions to keep storage bounded
          sessionRepository.pruneOldSessions(projectId, 10);

          // V9: Auto-extract memories from session summary
          let extractedMemories: Array<{ id: string; type: string; confidence: number }> = [];

          if (summary && summary.length > 50 && !HARDENING_DISABLED) {
            const result = extractMemories(summary, 'session_summary');

            // Auto-store high-confidence extractions (>= 0.75)
            for (const candidate of result.candidates) {
              if (candidate.confidence >= 0.75) {
                try {
                  const citation = detectCitation(candidate.content);
                  const embedding = await embeddingService.embed(candidate.content);

                  const createInput: MemoryCreateInput = {
                    content: candidate.content,
                    type: candidate.type,
                    confidence: candidate.confidence,
                    projectId,
                  };
                  if (citation) createInput.citation = citation;

                  const memory = memoryRepository.createMemory(createInput, embedding, projectRoot);

                  // Auto-link
                  if (autoLinker && embedding) {
                    await autoLinker.processNewMemory(
                      memory.id,
                      memory.content,
                      embedding,
                      projectId
                    );
                  }

                  extractedMemories.push({
                    id: memory.id,
                    type: memory.type,
                    confidence: memory.confidence,
                  });
                } catch {
                  // Skip failed extractions
                }
              }
            }
          }

          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify({
                  sessionId,
                  summary,
                  extractedMemories,
                  message:
                    extractedMemories.length > 0
                      ? `Session saved. Auto-extracted ${extractedMemories.length} memories.`
                      : 'Session saved successfully',
                }),
              },
            ],
          };
        }

        case 'session_restore': {
          if (!sessionRepository) {
            return {
              content: [{ type: 'text', text: 'Error: Session repository not initialized' }],
              isError: true,
            };
          }

          const session = sessionRepository.getLatestSession(projectId);

          if (!session) {
            // Run staleness detection even for new sessions (can be disabled for benchmarking)
            const staleReport =
              stalenessDetector && !HARDENING_DISABLED
                ? {
                    accessStale: stalenessDetector.detectAccessStale(projectId).length,
                    sourceMissing: stalenessDetector.detectSourceMissing(projectId, projectRoot)
                      .length,
                    lowConfidence: stalenessDetector.detectLowConfidence(projectId).length,
                    contentChanged: stalenessDetector.detectContentChanged(projectId, projectRoot)
                      .length,
                  }
                : null;

            // V3: Include active goals even for new sessions
            const activeGoals = goalRepository?.getActiveGoals(projectId) ?? [];

            // V7: Auto-recall for new sessions (project name only)
            let autoRecalledMemories: Array<{
              id: string;
              content: string;
              type: string;
              relevance: number;
              scope: string;
            }> = [];
            if (hybridSearch && !HARDENING_DISABLED) {
              const projectName = projectRoot.split('/').pop() ?? 'project';
              const query = `${projectName} project status decisions constraints`;

              const searchOptions: SearchOptions = {
                projectId,
                limit: 7,
                minConfidence: 0.3,
              };
              const response = await hybridSearch.search(query, searchOptions);

              for (const result of response.memories) {
                autoRecalledMemories.push({
                  id: result.memory.id,
                  content:
                    result.memory.content.length > 200
                      ? result.memory.content.substring(0, 200) + '...'
                      : result.memory.content,
                  type: result.memory.type,
                  relevance: Math.round(result.relevance * 100) / 100,
                  scope: 'project',
                });
              }

              // Also search global
              try {
                const globalServices = await initializeGlobalScope();
                const globalSearchOptions: SearchOptions = {
                  projectId: GLOBAL_PROJECT_ID,
                  limit: 3,
                  minConfidence: 0.3,
                };
                const globalResponse = await globalServices.hybridSearch.search(
                  query,
                  globalSearchOptions
                );

                for (const result of globalResponse.memories) {
                  autoRecalledMemories.push({
                    id: result.memory.id,
                    content:
                      result.memory.content.length > 200
                        ? result.memory.content.substring(0, 200) + '...'
                        : result.memory.content,
                    type: result.memory.type,
                    relevance: Math.round(result.relevance * 100) / 100,
                    scope: 'global',
                  });
                }
              } catch {
                // Global search failed, continue with project-only
              }

              autoRecalledMemories.sort((a, b) => b.relevance - a.relevance);
              autoRecalledMemories = autoRecalledMemories.slice(0, 10);
            }

            return {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify({
                    message: 'No previous session found',
                    isNewSession: true,
                    stalenessReport: staleReport,
                    activeGoals: activeGoals.map((g) => ({
                      id: g.id,
                      content: g.content,
                      priority: g.priority,
                    })),
                    // V7: Auto-recalled memories
                    autoRecalledMemories,
                  }),
                },
              ],
            };
          }

          // Run staleness detection (can be disabled for benchmarking)
          const staleReport =
            stalenessDetector && !HARDENING_DISABLED
              ? {
                  accessStale: stalenessDetector.detectAccessStale(projectId).length,
                  sourceMissing: stalenessDetector.detectSourceMissing(projectId, projectRoot)
                    .length,
                  lowConfidence: stalenessDetector.detectLowConfidence(projectId).length,
                  contentChanged: stalenessDetector.detectContentChanged(projectId, projectRoot)
                    .length,
                }
              : null;

          // Mark session as resumed
          sessionRepository.markResumed(session.id);

          // V3: Include active goals and drift indicator
          const activeGoals = goalRepository?.getActiveGoals(projectId) ?? [];
          const driftResult = calculateDriftIndicator(
            activeGoals,
            session.conversationSummary,
            lastGoalCheck ? Math.floor((Date.now() - lastGoalCheck.getTime()) / 1000) : 0,
            lastGoalCheck ?? undefined
          );
          lastGoalCheck = new Date();

          // V5: Proactive context assembly
          let proactiveContext: {
            graphStats: {
              totalMemories: number;
              linkedMemories: number;
              contradictionCount: number;
            } | null;
            recentContradictions: Array<{ source: string; target: string }>;
            incompleteCheckpoints: Array<{ taskId: string; phase: string; pendingSteps: number }>;
            // V7: Auto-recalled memories
            autoRecalledMemories: Array<{
              id: string;
              content: string;
              type: string;
              relevance: number;
              scope: string;
            }>;
          } | null = null;

          if (memoryGraphService && !HARDENING_DISABLED) {
            const graphStats = memoryGraphService.getStats(projectId);
            const contradictions = memoryGraphService.findContradictions(projectId);
            const checkpoints =
              checkpointRepository?.listCheckpoints(projectId, { limit: 5 }) ?? [];
            const incompleteCheckpoints = checkpoints
              .filter((c) => c.pendingSteps.length > 0)
              .slice(0, 3);

            // V7: Auto-recall relevant memories based on project context
            let autoRecalledMemories: Array<{
              id: string;
              content: string;
              type: string;
              relevance: number;
              scope: string;
            }> = [];

            if (hybridSearch) {
              // Build query from project context
              const projectName = projectRoot.split('/').pop() ?? 'project';
              const summaryKeywords = extractKeywords(session.conversationSummary, 5);
              const query = [
                projectName,
                'project status decisions constraints',
                ...summaryKeywords,
              ].join(' ');

              // Search project scope
              const searchOptions: SearchOptions = {
                projectId,
                limit: 7,
                minConfidence: 0.3,
              };
              const response = await hybridSearch.search(query, searchOptions);

              for (const result of response.memories) {
                autoRecalledMemories.push({
                  id: result.memory.id,
                  content:
                    result.memory.content.length > 200
                      ? result.memory.content.substring(0, 200) + '...'
                      : result.memory.content,
                  type: result.memory.type,
                  relevance: Math.round(result.relevance * 100) / 100,
                  scope: 'project',
                });
              }

              // Search global scope
              try {
                const globalServices = await initializeGlobalScope();
                const globalSearchOptions: SearchOptions = {
                  projectId: GLOBAL_PROJECT_ID,
                  limit: 3,
                  minConfidence: 0.3,
                };
                const globalResponse = await globalServices.hybridSearch.search(
                  query,
                  globalSearchOptions
                );

                for (const result of globalResponse.memories) {
                  autoRecalledMemories.push({
                    id: result.memory.id,
                    content:
                      result.memory.content.length > 200
                        ? result.memory.content.substring(0, 200) + '...'
                        : result.memory.content,
                    type: result.memory.type,
                    relevance: Math.round(result.relevance * 100) / 100,
                    scope: 'global',
                  });
                }
              } catch {
                // Global scope search failed, continue with project-only results
              }

              // Sort by relevance and limit to top 10
              autoRecalledMemories.sort((a, b) => b.relevance - a.relevance);
              autoRecalledMemories = autoRecalledMemories.slice(0, 10);
            }

            proactiveContext = {
              graphStats: {
                totalMemories: graphStats.totalMemories,
                linkedMemories: graphStats.linkedMemories,
                contradictionCount: graphStats.contradictionCount,
              },
              recentContradictions: contradictions.slice(0, 3).map((c) => ({
                source: c.source.content.substring(0, 50) + '...',
                target: c.target.content.substring(0, 50) + '...',
              })),
              incompleteCheckpoints: incompleteCheckpoints.map((c) => ({
                taskId: c.taskId,
                phase: c.phase,
                pendingSteps: c.pendingSteps.length,
              })),
              autoRecalledMemories,
            };
          }

          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify({
                  sessionId: session.id,
                  summary: session.conversationSummary,
                  createdAt: session.createdAt.toISOString(),
                  coreMemory: {
                    persona: session.coreMemorySnapshot.persona.content.substring(0, 100),
                    goals: session.coreMemorySnapshot.goals.content.substring(0, 100),
                  },
                  stalenessReport: staleReport,
                  // V3 response fields
                  activeGoals: activeGoals.map((g) => ({
                    id: g.id,
                    content: g.content,
                    priority: g.priority,
                  })),
                  driftIndicator: driftResult.indicator,
                  driftWarning: driftResult.isWarning ? getDriftWarningMessage(driftResult) : null,
                  // V5 proactive context
                  proactiveContext,
                  message: 'Session restored successfully',
                }),
              },
            ],
          };
        }

        // V3 tool handlers
        case 'goal_anchor': {
          if (!goalRepository) {
            return {
              content: [{ type: 'text', text: 'Error: Goal repository not initialized' }],
              isError: true,
            };
          }

          const input = GoalAnchorInputSchema.parse(args);

          switch (input.action) {
            case 'set': {
              if (!input.content) {
                return {
                  content: [{ type: 'text', text: 'Error: content is required for "set" action' }],
                  isError: true,
                };
              }

              const goal = goalRepository.createGoal(projectId, {
                content: input.content,
                priority: input.priority,
              });
              lastGoalCheck = new Date();

              return {
                content: [
                  {
                    type: 'text',
                    text: JSON.stringify({
                      goalId: goal.id,
                      content: goal.content,
                      priority: goal.priority,
                      status: goal.status,
                      message: `Goal set with priority ${goal.priority}`,
                    }),
                  },
                ],
              };
            }

            case 'complete': {
              if (!input.goalId) {
                return {
                  content: [
                    { type: 'text', text: 'Error: goalId is required for "complete" action' },
                  ],
                  isError: true,
                };
              }

              const success = goalRepository.completeGoal(input.goalId, projectId, input.note);

              return {
                content: [
                  {
                    type: 'text',
                    text: success
                      ? JSON.stringify({
                          goalId: input.goalId,
                          status: 'completed',
                          message: 'Goal marked as completed',
                        })
                      : `Goal ${input.goalId} not found or already completed`,
                  },
                ],
              };
            }

            case 'check': {
              const activeGoals = goalRepository.getActiveGoals(projectId);
              const timeSinceLastCheck = lastGoalCheck
                ? Math.floor((Date.now() - lastGoalCheck.getTime()) / 1000)
                : 0;

              // Use recent context from session summary if available
              const session = sessionRepository?.getLatestSession(projectId);
              const recentContext = session?.conversationSummary ?? '';

              const driftResult = calculateDriftIndicator(
                activeGoals,
                recentContext,
                timeSinceLastCheck,
                lastGoalCheck ?? undefined
              );
              lastGoalCheck = new Date();

              return {
                content: [
                  {
                    type: 'text',
                    text: JSON.stringify({
                      driftIndicator: driftResult.indicator,
                      isWarning: driftResult.isWarning,
                      activeGoalCount: driftResult.activeGoalCount,
                      timeSinceLastCheck: driftResult.timeSinceLastCheck,
                      activeGoals: activeGoals.map((g) => ({
                        id: g.id,
                        content: g.content,
                        priority: g.priority,
                      })),
                      warning: driftResult.isWarning ? getDriftWarningMessage(driftResult) : null,
                    }),
                  },
                ],
              };
            }

            case 'list': {
              const allGoals = goalRepository.getAllGoals(projectId);

              return {
                content: [
                  {
                    type: 'text',
                    text: JSON.stringify({
                      goals: allGoals.map((g) => ({
                        id: g.id,
                        content: g.content,
                        priority: g.priority,
                        status: g.status,
                        createdAt: g.createdAt.toISOString(),
                        progressNotes: g.progressNotes,
                      })),
                      activeCount: allGoals.filter((g) => g.status === 'active').length,
                      completedCount: allGoals.filter((g) => g.status === 'completed').length,
                    }),
                  },
                ],
              };
            }

            default:
              return {
                content: [{ type: 'text', text: `Unknown goal_anchor action: ${input.action}` }],
                isError: true,
              };
          }
        }

        case 'memory_link': {
          if (!memoryLinkRepository) {
            return {
              content: [{ type: 'text', text: 'Error: Memory link repository not initialized' }],
              isError: true,
            };
          }

          const input = MemoryLinkInputSchema.parse(args);

          switch (input.action) {
            case 'create': {
              if (!input.sourceId || !input.targetId || !input.linkType) {
                return {
                  content: [
                    {
                      type: 'text',
                      text: 'Error: sourceId, targetId, and linkType are required for "create" action',
                    },
                  ],
                  isError: true,
                };
              }

              // Verify both memories exist
              const source = memoryRepository!.findById(input.sourceId, projectId);
              const target = memoryRepository!.findById(input.targetId, projectId);

              if (!source) {
                return {
                  content: [
                    { type: 'text', text: `Error: Source memory ${input.sourceId} not found` },
                  ],
                  isError: true,
                };
              }

              if (!target) {
                return {
                  content: [
                    { type: 'text', text: `Error: Target memory ${input.targetId} not found` },
                  ],
                  isError: true,
                };
              }

              // Check for existing link
              const existingLink = memoryLinkRepository.findLinkBetween(
                input.sourceId,
                input.targetId
              );
              if (existingLink) {
                return {
                  content: [
                    {
                      type: 'text',
                      text: JSON.stringify({
                        linkId: existingLink.id,
                        message: 'Link already exists between these memories',
                        existing: true,
                      }),
                    },
                  ],
                };
              }

              const link = memoryLinkRepository.createLink({
                sourceId: input.sourceId,
                targetId: input.targetId,
                linkType: input.linkType as MemoryLinkType,
                strength: input.strength,
                bidirectional: input.bidirectional,
                createdBy: 'claude',
              });

              return {
                content: [
                  {
                    type: 'text',
                    text: JSON.stringify({
                      linkId: link.id,
                      sourceId: link.sourceId,
                      targetId: link.targetId,
                      linkType: link.linkType,
                      strength: link.strength,
                      bidirectional: link.bidirectional,
                      message: 'Link created successfully',
                    }),
                  },
                ],
              };
            }

            case 'find_related': {
              if (!input.memoryId) {
                return {
                  content: [
                    { type: 'text', text: 'Error: memoryId is required for "find_related" action' },
                  ],
                  isError: true,
                };
              }

              const linkedIds = memoryLinkRepository.findLinkedMemoryIds(
                input.memoryId,
                input.depth ?? 2
              );

              // Fetch the actual memory content
              const relatedMemories = linkedIds
                .map(({ memoryId, distance, linkStrength }) => {
                  const memory = memoryRepository!.findById(memoryId, projectId);
                  if (!memory) return null;
                  return {
                    id: memory.id,
                    content: memory.content,
                    type: memory.type,
                    distance,
                    linkStrength,
                  };
                })
                .filter((m) => m !== null);

              return {
                content: [
                  {
                    type: 'text',
                    text: JSON.stringify({
                      seedMemoryId: input.memoryId,
                      depth: input.depth ?? 2,
                      relatedMemories,
                      totalFound: relatedMemories.length,
                    }),
                  },
                ],
              };
            }

            case 'get_links': {
              if (!input.memoryId) {
                return {
                  content: [
                    { type: 'text', text: 'Error: memoryId is required for "get_links" action' },
                  ],
                  isError: true,
                };
              }

              const links = memoryLinkRepository.findLinks(input.memoryId);

              return {
                content: [
                  {
                    type: 'text',
                    text: JSON.stringify({
                      memoryId: input.memoryId,
                      links: links.map((l) => ({
                        id: l.id,
                        sourceId: l.sourceId,
                        targetId: l.targetId,
                        linkType: l.linkType,
                        strength: l.strength,
                        bidirectional: l.bidirectional,
                        direction: l.sourceId === input.memoryId ? 'outgoing' : 'incoming',
                      })),
                      totalLinks: links.length,
                    }),
                  },
                ],
              };
            }

            // V5: Graph query actions
            case 'get_stats': {
              if (!memoryGraphService) {
                return {
                  content: [{ type: 'text', text: 'Error: Graph service not initialized' }],
                  isError: true,
                };
              }

              const stats = memoryGraphService.getStats(projectId);

              return {
                content: [
                  {
                    type: 'text',
                    text: JSON.stringify({
                      ...stats,
                      message: 'Graph statistics retrieved',
                    }),
                  },
                ],
              };
            }

            case 'find_contradictions': {
              if (!memoryGraphService) {
                return {
                  content: [{ type: 'text', text: 'Error: Graph service not initialized' }],
                  isError: true,
                };
              }

              const contradictions = memoryGraphService.findContradictions(projectId);

              return {
                content: [
                  {
                    type: 'text',
                    text: JSON.stringify({
                      contradictions: contradictions.map((c) => ({
                        linkId: c.linkId,
                        source: c.source,
                        target: c.target,
                        createdAt: c.createdAt.toISOString(),
                      })),
                      count: contradictions.length,
                      message:
                        contradictions.length > 0
                          ? `Found ${contradictions.length} contradiction(s) to review`
                          : 'No contradictions found',
                    }),
                  },
                ],
              };
            }

            case 'find_chain': {
              if (!memoryGraphService) {
                return {
                  content: [{ type: 'text', text: 'Error: Graph service not initialized' }],
                  isError: true,
                };
              }

              if (!input.memoryId) {
                return {
                  content: [
                    { type: 'text', text: 'Error: memoryId is required for "find_chain" action' },
                  ],
                  isError: true,
                };
              }

              const chainOptions: {
                linkTypes?: string[];
                maxLength?: number;
                direction?: 'forward' | 'backward' | 'both';
              } = {};
              if (input.linkTypes) chainOptions.linkTypes = input.linkTypes as string[];
              if (input.depth) chainOptions.maxLength = input.depth;
              if (input.direction)
                chainOptions.direction = input.direction as 'forward' | 'backward' | 'both';

              const chain = memoryGraphService.findChain(input.memoryId, projectId, chainOptions);

              return {
                content: [
                  {
                    type: 'text',
                    text: JSON.stringify({
                      startId: chain.startId,
                      nodes: chain.nodes.map((n) => ({
                        id: n.id,
                        content:
                          n.content.length > 100 ? n.content.substring(0, 100) + '...' : n.content,
                        type: n.type,
                        linkType: n.linkType,
                        createdAt: n.createdAt.toISOString(),
                      })),
                      length: chain.length,
                      message:
                        chain.length > 1
                          ? `Found chain of ${chain.length} connected memories`
                          : 'No connected memories found in chain',
                    }),
                  },
                ],
              };
            }

            case 'find_cluster': {
              if (!memoryGraphService) {
                return {
                  content: [{ type: 'text', text: 'Error: Graph service not initialized' }],
                  isError: true,
                };
              }

              if (!input.memoryId) {
                return {
                  content: [
                    { type: 'text', text: 'Error: memoryId is required for "find_cluster" action' },
                  ],
                  isError: true,
                };
              }

              const clusterOptions: { maxSize?: number; maxDepth?: number } = {};
              if (input.depth) clusterOptions.maxDepth = input.depth;

              const cluster = memoryGraphService.findCluster(
                input.memoryId,
                projectId,
                clusterOptions
              );

              return {
                content: [
                  {
                    type: 'text',
                    text: JSON.stringify({
                      centerId: cluster.centerId,
                      centerContent: cluster.centerContent,
                      members: cluster.members,
                      size: cluster.size,
                      message:
                        cluster.size > 1
                          ? `Found cluster of ${cluster.size} memories`
                          : 'Memory has no links',
                    }),
                  },
                ],
              };
            }

            case 'find_orphans': {
              if (!memoryGraphService) {
                return {
                  content: [{ type: 'text', text: 'Error: Graph service not initialized' }],
                  isError: true,
                };
              }

              const orphans = memoryGraphService.findOrphans(projectId);

              return {
                content: [
                  {
                    type: 'text',
                    text: JSON.stringify({
                      orphans: orphans.map((o) => ({
                        id: o.id,
                        content: o.content,
                        type: o.type,
                        createdAt: o.createdAt.toISOString(),
                      })),
                      count: orphans.length,
                      message:
                        orphans.length > 0
                          ? `Found ${orphans.length} unlinked memories. Consider linking them for better recall.`
                          : 'All memories are linked',
                    }),
                  },
                ],
              };
            }

            // V11: Knowledge graph entity queries
            case 'get_entities': {
              if (!knowledgeGraphPopulator) {
                return {
                  content: [
                    { type: 'text', text: 'Error: Knowledge graph populator not initialized' },
                  ],
                  isError: true,
                };
              }

              if (!input.memoryId) {
                return {
                  content: [
                    { type: 'text', text: 'Error: memoryId is required for "get_entities" action' },
                  ],
                  isError: true,
                };
              }

              const linkedEntities = knowledgeGraphPopulator.getLinkedEntities(
                input.memoryId,
                projectId
              );

              return {
                content: [
                  {
                    type: 'text',
                    text: JSON.stringify({
                      memoryId: input.memoryId,
                      entities: linkedEntities.map((e) => ({
                        entityId: e.entityId,
                        name: e.entityName,
                        type: e.entityType,
                        relationType: e.relationType,
                      })),
                      count: linkedEntities.length,
                      message:
                        linkedEntities.length > 0
                          ? `Memory is linked to ${linkedEntities.length} entities`
                          : 'Memory has no entity links',
                    }),
                  },
                ],
              };
            }

            case 'find_by_entity': {
              if (!knowledgeGraphPopulator) {
                return {
                  content: [
                    { type: 'text', text: 'Error: Knowledge graph populator not initialized' },
                  ],
                  isError: true,
                };
              }

              const entityNameArg = (args as { entityName?: string }).entityName;
              const entityTypeArg = (args as { entityType?: string }).entityType;

              if (!entityNameArg) {
                return {
                  content: [
                    {
                      type: 'text',
                      text: 'Error: entityName is required for "find_by_entity" action',
                    },
                  ],
                  isError: true,
                };
              }

              // Find the entity first
              const db = connectionPool.get(projectId);
              const entityQuery = entityTypeArg
                ? `SELECT id, name, type FROM entities WHERE project_id = ? AND LOWER(name) LIKE LOWER(?) AND type = ? AND valid_to IS NULL LIMIT 10`
                : `SELECT id, name, type FROM entities WHERE project_id = ? AND LOWER(name) LIKE LOWER(?) AND valid_to IS NULL LIMIT 10`;

              const entityParams = entityTypeArg
                ? [projectId, `%${entityNameArg}%`, entityTypeArg]
                : [projectId, `%${entityNameArg}%`];

              const matchingEntities = db.instance
                .prepare(entityQuery)
                .all(...entityParams) as Array<{
                id: string;
                name: string;
                type: string;
              }>;

              if (matchingEntities.length === 0) {
                return {
                  content: [
                    {
                      type: 'text',
                      text: JSON.stringify({
                        searchTerm: entityNameArg,
                        entityType: entityTypeArg ?? 'any',
                        entities: [],
                        memories: [],
                        message: 'No entities found matching the search term',
                      }),
                    },
                  ],
                };
              }

              // Get memories linked to these entities
              const entityIds = matchingEntities.map((e) => e.id);
              const placeholders = entityIds.map(() => '?').join(',');
              const memoryRows = db.instance
                .prepare(
                  `SELECT DISTINCT m.id, m.content, m.type, mel.entity_id
                   FROM memory_entity_links mel
                   JOIN memories m ON mel.memory_id = m.id
                   WHERE mel.entity_id IN (${placeholders})
                     AND m.deleted_at IS NULL
                   ORDER BY m.created_at DESC
                   LIMIT 20`
                )
                .all(...entityIds) as Array<{
                id: string;
                content: string;
                type: string;
                entity_id: string;
              }>;

              return {
                content: [
                  {
                    type: 'text',
                    text: JSON.stringify({
                      searchTerm: entityNameArg,
                      entityType: entityTypeArg ?? 'any',
                      entities: matchingEntities.map((e) => ({
                        id: e.id,
                        name: e.name,
                        type: e.type,
                      })),
                      memories: memoryRows.map((m) => ({
                        id: m.id,
                        content:
                          m.content.length > 150 ? m.content.substring(0, 150) + '...' : m.content,
                        type: m.type,
                        linkedEntity: matchingEntities.find((e) => e.id === m.entity_id)?.name,
                      })),
                      message: `Found ${matchingEntities.length} matching entities with ${memoryRows.length} linked memories`,
                    }),
                  },
                ],
              };
            }

            default:
              return {
                content: [{ type: 'text', text: `Unknown memory_link action: ${input.action}` }],
                isError: true,
              };
          }
        }

        case 'checkpoint_task': {
          if (!checkpointRepository) {
            return {
              content: [{ type: 'text', text: 'Error: Checkpoint repository not initialized' }],
              isError: true,
            };
          }

          const input = CheckpointTaskInputSchema.parse(args);

          switch (input.action) {
            case 'save': {
              if (!input.taskId || !input.phase) {
                return {
                  content: [
                    {
                      type: 'text',
                      text: 'Error: taskId and phase are required for "save" action',
                    },
                  ],
                  isError: true,
                };
              }

              const checkpointInput: {
                taskId: string;
                phase: string;
                completedSteps: string[];
                pendingSteps: string[];
                artifacts?: string[];
              } = {
                taskId: input.taskId,
                phase: input.phase,
                completedSteps: input.completedSteps ?? [],
                pendingSteps: input.pendingSteps ?? [],
              };
              if (input.artifacts) checkpointInput.artifacts = input.artifacts;

              const checkpoint = checkpointRepository.saveCheckpoint(projectId, checkpointInput);

              // Prune old checkpoints for this task
              checkpointRepository.pruneCheckpoints(projectId, input.taskId, 5);

              return {
                content: [
                  {
                    type: 'text',
                    text: JSON.stringify({
                      checkpointId: checkpoint.id,
                      taskId: checkpoint.taskId,
                      phase: checkpoint.phase,
                      completedSteps: checkpoint.completedSteps.length,
                      pendingSteps: checkpoint.pendingSteps.length,
                      artifacts: checkpoint.artifacts.length,
                      message: 'Checkpoint saved successfully',
                    }),
                  },
                ],
              };
            }

            case 'restore': {
              if (!input.taskId) {
                return {
                  content: [
                    { type: 'text', text: 'Error: taskId is required for "restore" action' },
                  ],
                  isError: true,
                };
              }

              const checkpoint = checkpointRepository.restoreCheckpoint(projectId, input.taskId);

              if (!checkpoint) {
                return {
                  content: [
                    {
                      type: 'text',
                      text: JSON.stringify({
                        message: `No checkpoint found for task "${input.taskId}"`,
                        taskId: input.taskId,
                      }),
                    },
                  ],
                };
              }

              return {
                content: [
                  {
                    type: 'text',
                    text: JSON.stringify({
                      checkpointId: checkpoint.id,
                      taskId: checkpoint.taskId,
                      phase: checkpoint.phase,
                      completedSteps: checkpoint.completedSteps,
                      pendingSteps: checkpoint.pendingSteps,
                      artifacts: checkpoint.artifacts,
                      createdAt: checkpoint.createdAt.toISOString(),
                      message: 'Checkpoint restored successfully',
                    }),
                  },
                ],
              };
            }

            case 'list': {
              const listOptions: { limit?: number; taskId?: string } = { limit: 20 };
              if (input.taskId) listOptions.taskId = input.taskId;

              const checkpoints = checkpointRepository.listCheckpoints(projectId, listOptions);

              const taskIds = checkpointRepository.getTasksWithCheckpoints(projectId);

              return {
                content: [
                  {
                    type: 'text',
                    text: JSON.stringify({
                      checkpoints: checkpoints.map((c) => ({
                        id: c.id,
                        taskId: c.taskId,
                        phase: c.phase,
                        completedSteps: c.completedSteps.length,
                        pendingSteps: c.pendingSteps.length,
                        createdAt: c.createdAt.toISOString(),
                      })),
                      tasksWithCheckpoints: taskIds,
                      totalCheckpoints: checkpoints.length,
                    }),
                  },
                ],
              };
            }

            default:
              return {
                content: [
                  { type: 'text', text: `Unknown checkpoint_task action: ${input.action}` },
                ],
                isError: true,
              };
          }
        }

        // V8: Project management tools
        case 'memory_list_projects': {
          const allProjectIds = listAllProjects();
          const projects: Array<{
            projectId: string;
            isGlobal: boolean;
            isCurrent: boolean;
            dbSizeKB: number;
            memoryCount: number;
          }> = [];

          for (const pid of allProjectIds) {
            try {
              const db = connectionPool.get(pid);
              runMigrations(db);
              const repo = new MemoryRepository(db);
              const count = repo.getMemoryCount(pid);
              const metadata = getProjectMetadata(pid);

              projects.push({
                projectId: pid,
                isGlobal: pid === GLOBAL_PROJECT_ID,
                isCurrent: pid === projectId,
                dbSizeKB: metadata ? Math.round(metadata.sizeBytes / 1024) : 0,
                memoryCount: count,
              });
            } catch {
              // Skip projects that fail to load
            }
          }

          // Sort: current first, then global, then by memory count
          projects.sort((a, b) => {
            if (a.isCurrent) return -1;
            if (b.isCurrent) return 1;
            if (a.isGlobal) return -1;
            if (b.isGlobal) return 1;
            return b.memoryCount - a.memoryCount;
          });

          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify({
                  currentProjectId: projectId,
                  projects,
                  totalProjects: projects.length,
                  totalMemories: projects.reduce((sum, p) => sum + p.memoryCount, 0),
                }),
              },
            ],
          };
        }

        case 'memory_migrate': {
          const { memoryId, targetScope, action } = args as {
            memoryId: string;
            targetScope: string;
            action: string;
          };

          if (!memoryId || !targetScope || !action) {
            return {
              content: [
                { type: 'text', text: 'Error: memoryId, targetScope, and action are required' },
              ],
              isError: true,
            };
          }

          // Find the memory in project or global scope
          let sourceMemory = memoryRepository.findById(memoryId, projectId);
          let sourceScope = 'project';
          let sourceRepo = memoryRepository;
          let sourceEmbedding = embeddingService;

          if (!sourceMemory) {
            const globalServices = await initializeGlobalScope();
            sourceMemory = globalServices.memoryRepository.findById(memoryId, GLOBAL_PROJECT_ID);
            sourceScope = 'global';
            sourceRepo = globalServices.memoryRepository;
            sourceEmbedding = globalServices.embeddingService;
          }

          if (!sourceMemory) {
            return {
              content: [
                { type: 'text', text: `Memory ${memoryId} not found in project or global scope` },
              ],
              isError: true,
            };
          }

          // Check if already in target scope
          if (sourceScope === targetScope) {
            return {
              content: [{ type: 'text', text: `Memory is already in ${targetScope} scope` }],
            };
          }

          // Get target services
          const targetIsGlobal = targetScope === 'global';
          const targetRepo = targetIsGlobal
            ? (await initializeGlobalScope()).memoryRepository
            : memoryRepository;
          const targetEmbedding = targetIsGlobal
            ? (await initializeGlobalScope()).embeddingService
            : embeddingService;
          const targetProjectId = targetIsGlobal ? GLOBAL_PROJECT_ID : projectId;

          // Create new embedding for target
          const newEmbedding = await targetEmbedding.embed(sourceMemory.content);

          // Create memory in target scope - build input with only defined properties
          const createInput: MemoryCreateInput = {
            content: sourceMemory.content,
            type: sourceMemory.type,
            confidence: sourceMemory.confidence,
            projectId: targetProjectId,
          };
          if (sourceMemory.citation) createInput.citation = sourceMemory.citation;
          if (sourceMemory.language) createInput.language = sourceMemory.language;

          const newMemory = targetRepo.createMemory(
            createInput,
            newEmbedding,
            targetIsGlobal ? undefined : projectRoot
          );

          // If move (not copy), delete from source
          if (action === 'move') {
            sourceRepo.softDelete(
              memoryId,
              sourceScope === 'global' ? GLOBAL_PROJECT_ID : projectId,
              `Migrated to ${targetScope} scope`
            );
          }

          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify({
                  action,
                  sourceId: memoryId,
                  sourceScope,
                  newId: newMemory.id,
                  targetScope,
                  message: `Memory ${action === 'move' ? 'moved' : 'copied'} from ${sourceScope} to ${targetScope}`,
                }),
              },
            ],
          };
        }

        // V9: Auto-extraction
        case 'memory_auto_extract': {
          const { content, context, source, autoStore, minConfidence } = args as {
            content: string;
            context?: string;
            source: string;
            autoStore?: boolean;
            minConfidence?: number;
          };

          if (!content || !source) {
            return {
              content: [{ type: 'text', text: 'Error: content and source are required' }],
              isError: true,
            };
          }

          // Extract memory candidates
          const result = extractMemories(content, source, context);
          const threshold = minConfidence ?? 0.7;
          const shouldAutoStore = autoStore ?? false;

          const stored: Array<{ id: string; type: string; confidence: number }> = [];
          const candidates: Array<{
            content: string;
            type: string;
            confidence: number;
            reason: string;
          }> = [];

          for (const candidate of result.candidates) {
            if (shouldAutoStore && candidate.confidence >= threshold) {
              // Auto-store this memory
              const citation = detectCitation(candidate.content);
              const embedding = await embeddingService.embed(candidate.content);

              const createInput: MemoryCreateInput = {
                content: candidate.content,
                type: candidate.type,
                confidence: candidate.confidence,
                projectId,
              };
              if (citation) createInput.citation = citation;

              const memory = memoryRepository.createMemory(createInput, embedding, projectRoot);

              // Auto-link
              if (autoLinker && embedding && !HARDENING_DISABLED) {
                await autoLinker.processNewMemory(memory.id, memory.content, embedding, projectId);
              }

              stored.push({
                id: memory.id,
                type: memory.type,
                confidence: memory.confidence,
              });
            } else {
              // Return as candidate for review
              candidates.push({
                content: candidate.content,
                type: candidate.type,
                confidence: candidate.confidence,
                reason: candidate.reason,
              });
            }
          }

          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify({
                  stored,
                  candidates,
                  stats: result.stats,
                  message:
                    stored.length > 0
                      ? `Auto-stored ${stored.length} memories. ${candidates.length} candidates below threshold.`
                      : `Found ${candidates.length} candidates. Use autoStore: true to store automatically.`,
                }),
              },
            ],
          };
        }

        // V9: Proactive context assembly (V12: with token budget support)
        case 'memory_context_assemble': {
          const { task, files, includeGlobal, maxMemories, tokenBudget } = args as {
            task: string;
            files?: string[];
            includeGlobal?: boolean;
            maxMemories?: number;
            tokenBudget?: number;
          };

          if (!task) {
            return {
              content: [{ type: 'text', text: 'Error: task is required' }],
              isError: true,
            };
          }

          const limit = maxMemories ?? 10;
          const searchGlobal = includeGlobal ?? true;
          const budget = tokenBudget ?? TOKEN_BUDGETS.standard; // Default 2000 tokens

          // Build search query from task and files
          let query = task;
          if (files && files.length > 0) {
            // Extract file names for targeted recall
            const fileNames = files.map((f) => f.split('/').pop()).join(' ');
            query = `${task} ${fileNames}`;
          }

          // Collect memories from both scopes
          type ContextMemory = {
            id: string;
            content: string;
            type: string;
            confidence: number;
            relevance: number;
            scope: string;
          };
          const memories: ContextMemory[] = [];
          let contradictions: Array<{ memory1: string; memory2: string }> = [];

          // Search project scope
          const searchOptions: SearchOptions = {
            projectId,
            limit: limit,
            minConfidence: 0.3,
          };
          const response = await hybridSearch.search(query, searchOptions);

          for (const result of response.memories) {
            memories.push({
              id: result.memory.id,
              content: result.memory.content,
              type: result.memory.type,
              confidence: result.memory.confidence,
              relevance: Math.round(result.relevance * 100) / 100,
              scope: 'project',
            });
          }

          // Search global scope
          if (searchGlobal) {
            try {
              const globalServices = await initializeGlobalScope();
              const globalSearchOptions: SearchOptions = {
                projectId: GLOBAL_PROJECT_ID,
                limit: Math.ceil(limit / 3),
                minConfidence: 0.3,
              };
              const globalResponse = await globalServices.hybridSearch.search(
                query,
                globalSearchOptions
              );

              for (const result of globalResponse.memories) {
                memories.push({
                  id: result.memory.id,
                  content: result.memory.content,
                  type: result.memory.type,
                  confidence: result.memory.confidence,
                  relevance: Math.round(result.relevance * 100) / 100,
                  scope: 'global',
                });
              }
            } catch {
              // Global scope not available
            }
          }

          // Sort by relevance and limit
          memories.sort((a, b) => b.relevance - a.relevance);
          const preTokenMemories = memories.slice(0, limit);

          // V12: Apply token budget - fit memories within budget
          const {
            items: topMemories,
            truncatedContents,
            totalTokens,
            itemsIncluded,
          } = fitItemsToTokenBudget(preTokenMemories, budget, {
            headerTokens: 100, // Reserve for section headers
            itemOverhead: 10, // Bullets, newlines per item
            minItemTokens: 30, // Minimum useful memory size
          });

          // Track truncation stats
          const truncatedCount = truncatedContents.size;

          // Check for contradictions among top memories
          if (memoryGraphService && topMemories.length > 1) {
            const allContradictions = memoryGraphService.findContradictions(projectId);
            const topIds = new Set(topMemories.map((m) => m.id));

            for (const c of allContradictions) {
              if (topIds.has(c.source.id) || topIds.has(c.target.id)) {
                contradictions.push({
                  memory1: c.source.content.substring(0, 100) + '...',
                  memory2: c.target.content.substring(0, 100) + '...',
                });
              }
            }
          }

          // Group memories by type for structured output
          const byType: Record<string, ContextMemory[]> = {};
          for (const m of topMemories) {
            const typeKey = m.type;
            if (!byType[typeKey]) {
              byType[typeKey] = [];
            }
            byType[typeKey]!.push(m);
          }

          // Build formatted context string
          let contextText = `## Relevant Memory Context for: "${task}"\n\n`;

          if (byType['decision'] && byType['decision'].length > 0) {
            contextText += '### Past Decisions\n';
            for (const m of byType['decision']) {
              contextText += `- ${m.content}\n`;
            }
            contextText += '\n';
          }

          if (byType['pattern'] && byType['pattern'].length > 0) {
            contextText += '### Patterns & Approaches\n';
            for (const m of byType['pattern']) {
              contextText += `- ${m.content}\n`;
            }
            contextText += '\n';
          }

          if (byType['error'] && byType['error'].length > 0) {
            contextText += '### Past Errors & Solutions\n';
            for (const m of byType['error']) {
              contextText += `- ${m.content}\n`;
            }
            contextText += '\n';
          }

          if (byType['preference'] && byType['preference'].length > 0) {
            contextText += '### Preferences & Conventions\n';
            for (const m of byType['preference']) {
              contextText += `- ${m.content}\n`;
            }
            contextText += '\n';
          }

          if (byType['fact'] && byType['fact'].length > 0) {
            contextText += '### Relevant Facts\n';
            for (const m of byType['fact']) {
              contextText += `- ${m.content}\n`;
            }
            contextText += '\n';
          }

          if (contradictions.length > 0) {
            contextText += '### ⚠️ Potential Contradictions\n';
            for (const c of contradictions) {
              contextText += `- "${c.memory1}" vs "${c.memory2}"\n`;
            }
            contextText += '\n';
          }

          // Calculate actual token usage of context text
          const contextTokens = estimateTokens(contextText);

          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify({
                  context: contextText,
                  memories: topMemories,
                  contradictions,
                  stats: {
                    totalRecalled: topMemories.length,
                    byType: Object.fromEntries(
                      Object.entries(byType).map(([k, v]) => [k, v.length])
                    ),
                    contradictionCount: contradictions.length,
                    // V12: Token budget stats
                    tokenBudget: budget,
                    estimatedTokens: contextTokens,
                    memoriesTruncated: truncatedCount,
                    memoriesExcluded: preTokenMemories.length - itemsIncluded,
                  },
                  message:
                    topMemories.length > 0
                      ? `Assembled context from ${topMemories.length} memories (~${contextTokens} tokens).${truncatedCount > 0 ? ` ${truncatedCount} truncated to fit budget.` : ''}${contradictions.length > 0 ? ` Warning: ${contradictions.length} potential contradiction(s).` : ''}`
                      : 'No relevant memories found for this task.',
                }),
              },
            ],
          };
        }

        // V10: Memory consolidation
        case 'memory_consolidate': {
          const { duplicateThreshold, decayAfterDays, decayRate, persistSummaries, dryRun } =
            args as {
              duplicateThreshold?: number;
              decayAfterDays?: number;
              decayRate?: number;
              persistSummaries?: boolean;
              dryRun?: boolean;
            };

          const db = connectionPool.get(projectId);
          const consolidationService = new ConsolidationService(db.instance);

          // Build options conditionally to satisfy exactOptionalPropertyTypes
          const consolidationOptions: ConsolidationOptions = {
            dryRun: dryRun ?? false,
          };
          if (duplicateThreshold !== undefined)
            consolidationOptions.duplicateThreshold = duplicateThreshold;
          if (decayAfterDays !== undefined) consolidationOptions.decayAfterDays = decayAfterDays;
          if (decayRate !== undefined) consolidationOptions.decayRate = decayRate;
          if (persistSummaries !== undefined)
            consolidationOptions.persistSummaries = persistSummaries;

          const result = await consolidationService.consolidate(projectId, consolidationOptions);

          // Build summary message
          const parts: string[] = [];
          if (result.merged.length > 0) {
            parts.push(`Merged ${result.merged.length} duplicate groups`);
          }
          if (result.decayed.length > 0) {
            parts.push(`Decayed ${result.decayed.length} memories`);
          }
          if (result.flaggedForReview.length > 0) {
            parts.push(`Flagged ${result.flaggedForReview.length} for review`);
          }
          if (result.clusters.length > 0) {
            parts.push(`Found ${result.clusters.length} clusters to potentially summarize`);
          }
          if (result.summaries.length > 0) {
            parts.push(`Persisted ${result.summaries.length} semantic summaries`);
          }

          const message = dryRun
            ? `[DRY RUN] Would: ${parts.join(', ') || 'no changes needed'}`
            : parts.length > 0
              ? parts.join(', ')
              : 'No consolidation needed - memory is healthy';

          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify({
                  ...result,
                  message,
                }),
              },
            ],
          };
        }

        // V12: Re-embedding tool
        case 'memory_reembed': {
          const { batchSize, dryRun, onlyMissing } = args as {
            batchSize?: number;
            dryRun?: boolean;
            onlyMissing?: boolean;
          };

          const batch = batchSize ?? 10;
          const isDryRun = dryRun ?? false;
          const missingOnly = onlyMissing ?? false;

          const db = connectionPool.get(projectId);

          // Get current model info
          const currentModel = embeddingService.currentModel ?? 'unknown';

          // Get memories to re-embed
          let query = `
            SELECT id, content, embedding, embedding_model
            FROM memories
            WHERE project_id = ? AND deleted_at IS NULL AND superseded_by IS NULL
          `;
          if (missingOnly) {
            query += ' AND embedding IS NULL';
          }
          query += ' ORDER BY created_at DESC';

          const memories = db.instance.prepare(query).all(projectId) as Array<{
            id: string;
            content: string;
            embedding: Buffer | null;
            embedding_model: string | null;
          }>;

          if (memories.length === 0) {
            return {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify({
                    message: missingOnly
                      ? 'No memories without embeddings found'
                      : 'No memories found to re-embed',
                    totalMemories: 0,
                  }),
                },
              ],
            };
          }

          if (isDryRun) {
            const needsUpdate = memories.filter(
              (m) => !m.embedding || m.embedding_model !== currentModel
            );
            return {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify({
                    message: `[DRY RUN] Would re-embed ${needsUpdate.length} of ${memories.length} memories`,
                    totalMemories: memories.length,
                    needsUpdate: needsUpdate.length,
                    currentModel,
                    dryRun: true,
                  }),
                },
              ],
            };
          }

          // Re-embed in batches
          let updated = 0;
          let errors = 0;
          const updateStmt = db.instance.prepare(
            'UPDATE memories SET embedding = ?, embedding_model = ? WHERE id = ?'
          );

          for (let i = 0; i < memories.length; i += batch) {
            const memoryBatch = memories.slice(i, i + batch);

            for (const memory of memoryBatch) {
              try {
                const embedding = await embeddingService.embed(memory.content);
                if (embedding) {
                  const buffer = Buffer.from(embedding.buffer);
                  updateStmt.run(buffer, currentModel, memory.id);
                  updated++;
                } else {
                  errors++;
                }
              } catch {
                errors++;
              }
            }
          }

          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify({
                  message: `Re-embedded ${updated} memories with ${errors} errors`,
                  totalMemories: memories.length,
                  updated,
                  errors,
                  model: currentModel,
                }),
              },
            ],
          };
        }

        // V9: Fact Store — structured, cited facts for anti-hallucination research
        case 'fact_store': {
          const input = FactStoreInputSchema.parse(args);

          // Determine scope
          const isGlobal = input.scope === MemoryScope.GLOBAL;
          const targetProjectId = isGlobal ? GLOBAL_PROJECT_ID : projectId;
          const targetRepo = isGlobal
            ? (await initializeGlobalScope()).memoryRepository
            : memoryRepository;
          const targetEmbedding = isGlobal
            ? (await initializeGlobalScope()).embeddingService
            : embeddingService;

          // Build content that includes claim + quote for good embedding quality
          const content = `FACT: ${input.claim}\nSOURCE: ${input.sourceTitle} (${input.sourceUrl})\nQUOTE: "${input.directQuote}"`;

          // Security: Check for credentials
          if (!HARDENING_DISABLED && containsCredentials(content)) {
            return {
              content: [{ type: 'text', text: 'Error: Content appears to contain credentials.' }],
              isError: true,
            };
          }

          // Quota check
          if (
            !HARDENING_DISABLED &&
            targetRepo.getMemoryCount(targetProjectId) >= MAX_MEMORIES_PER_PROJECT
          ) {
            return {
              content: [
                {
                  type: 'text',
                  text: `Error: Storage limit reached (${MAX_MEMORIES_PER_PROJECT}).`,
                },
              ],
              isError: true,
            };
          }

          // Generate embedding from claim text (not the full content — claim is what we search on)
          const embedding = await targetEmbedding.embed(input.claim);

          // Check for duplicate claims
          if (targetRepo.isDuplicateContent(content, targetProjectId)) {
            return {
              content: [{ type: 'text', text: 'Fact already exists (duplicate content)' }],
            };
          }

          // Create base memory
          const memoryInput: MemoryCreateInput = {
            content,
            type: MemoryType.FACT,
            confidence: input.confidence,
            projectId: targetProjectId,
            citation: input.sourceUrl,
          };

          // Contradiction detection
          let contradictionWarning: {
            count: number;
            memories: Array<{ id: string; similarity: number; reason: string }>;
          } | null = null;

          if (contradictionDetector && embedding && !HARDENING_DISABLED && !isGlobal) {
            const contradictions = await contradictionDetector.detectOnStore(
              input.claim,
              embedding,
              targetProjectId
            );
            if (contradictions.length > 0) {
              contradictionWarning = {
                count: contradictions.length,
                memories: contradictions.slice(0, 3).map((c) => ({
                  id: c.memoryId,
                  similarity: Math.round(c.similarity * 100) / 100,
                  reason: c.reason,
                })),
              };
            }
          }

          const memory = targetRepo.createMemory(
            memoryInput,
            embedding,
            isGlobal ? undefined : projectRoot
          );

          // Update with V9 fact-specific fields
          const now = Math.floor(Date.now() / 1000);
          const db = connectionPool.get(isGlobal ? GLOBAL_PROJECT_ID : projectId);

          if (db) {
            db.instance
              .prepare(
                `
              UPDATE memories SET
                source_url = ?,
                source_title = ?,
                source_type = ?,
                direct_quote = ?,
                domain_tags = ?,
                stale_after_days = ?,
                last_verified = ?,
                extracted_by = ?
              WHERE id = ?
            `
              )
              .run(
                input.sourceUrl,
                input.sourceTitle,
                input.sourceType,
                input.directQuote,
                JSON.stringify(input.domainTags),
                input.staleAfterDays ?? null,
                now,
                input.extractedBy,
                memory.id
              );
          }

          // Auto-link to find corroborating/contradicting facts
          let autoLinkResult: {
            created: number;
            links: Array<{ targetId: string; linkType: string; strength: number }>;
            suggestions: Array<{ targetId: string; similarity: number; reason: string }>;
          } | null = null;

          if (autoLinker && embedding && !HARDENING_DISABLED && !isGlobal) {
            const linkResult = await autoLinker.processNewMemory(
              memory.id,
              input.claim,
              embedding,
              targetProjectId
            );
            if (linkResult.createdLinks.length > 0 || linkResult.suggestedLinks.length > 0) {
              autoLinkResult = {
                created: linkResult.createdLinks.length,
                links: linkResult.createdLinks.map((l) => ({
                  targetId: l.targetId,
                  linkType: l.linkType,
                  strength: l.strength,
                })),
                suggestions: linkResult.suggestedLinks.slice(0, 3).map((s) => ({
                  targetId: s.targetId,
                  similarity: s.similarity,
                  reason: s.reason,
                })),
              };
            }
          }

          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify({
                  id: memory.id,
                  type: 'fact',
                  claim: input.claim,
                  sourceUrl: input.sourceUrl,
                  sourceTitle: input.sourceTitle,
                  sourceType: input.sourceType,
                  confidence: input.confidence,
                  domainTags: input.domainTags,
                  hasEmbedding: !!embedding,
                  contradictionWarning,
                  autoLinks: autoLinkResult,
                }),
              },
            ],
          };
        }

        case 'fact_query': {
          const input = FactQueryInputSchema.parse(args);

          // Determine search scope
          const searchProjectId = input.scope === 'global' ? GLOBAL_PROJECT_ID : projectId;

          // Use hybrid search to find relevant facts
          const searchOptions: SearchOptions = {
            projectId: searchProjectId,
            type: MemoryType.FACT,
            limit: (input.limit ?? 10) * 2, // Over-fetch to allow post-filtering
            minConfidence: input.minConfidence,
            includeStale: input.includeStale,
          };

          const results = await hybridSearch.search(input.query, searchOptions);

          // If scope is 'both', also search global
          let globalResults: typeof results = {
            memories: [],
            searchStats: { vectorMatches: 0, bm25Matches: 0, fusedResults: 0, latencyMs: 0 },
          };
          if (input.scope === 'both' || input.scope === undefined) {
            const globalScope = await initializeGlobalScope();
            const globalOptions: SearchOptions = {
              ...searchOptions,
              projectId: GLOBAL_PROJECT_ID,
            };
            globalResults = await globalScope.hybridSearch.search(input.query, globalOptions);
          }

          // Merge results
          const allResults = [...results.memories, ...globalResults.memories];

          // Post-filter by V9 fields
          const now = Math.floor(Date.now() / 1000);
          const filtered = allResults.filter((r) => {
            const m = r.memory;

            // Must have source_url (be a structured fact, not a legacy memory)
            // Read the V9 fields from the raw row since Memory interface may not have them yet
            const db =
              connectionPool.get(m.projectId === GLOBAL_PROJECT_ID ? '_global' : m.projectId) ??
              connectionPool.get(projectId);
            if (!db) return true; // Can't filter, include it

            const row = db.instance
              .prepare(
                'SELECT source_url, source_type, domain_tags, stale_after_days, last_verified FROM memories WHERE id = ?'
              )
              .get(m.id) as
              | {
                  source_url: string | null;
                  source_type: string | null;
                  domain_tags: string | null;
                  stale_after_days: number | null;
                  last_verified: number | null;
                }
              | undefined;

            if (!row?.source_url) return false; // Not a structured fact

            // Filter by source type
            if (input.sourceType && row.source_type !== input.sourceType) return false;

            // Filter by domain tags (AND logic — fact must have ALL requested tags)
            if (input.domainTags && input.domainTags.length > 0 && row.domain_tags) {
              const factTags: string[] = JSON.parse(row.domain_tags);
              if (!input.domainTags.every((t) => factTags.includes(t))) return false;
            } else if (input.domainTags && input.domainTags.length > 0) {
              return false; // No domain tags on fact, but filter requested
            }

            // Filter stale facts
            if (!input.includeStale && row.stale_after_days && row.last_verified) {
              const staleCutoff = row.last_verified + row.stale_after_days * 86400;
              if (now > staleCutoff) return false;
            }

            return true;
          });

          // Limit results
          const limited = filtered.slice(0, input.limit ?? 10);

          // Enrich with V9 fields and contradictions
          const enriched = limited.map((r) => {
            const db =
              connectionPool.get(
                r.memory.projectId === GLOBAL_PROJECT_ID ? '_global' : r.memory.projectId
              ) ?? connectionPool.get(projectId);

            let factFields: {
              sourceUrl: string | null;
              sourceTitle: string | null;
              sourceType: string | null;
              directQuote: string | null;
              domainTags: string[];
              staleAfterDays: number | null;
              lastVerified: number | null;
              extractedBy: string | null;
            } = {
              sourceUrl: null,
              sourceTitle: null,
              sourceType: null,
              directQuote: null,
              domainTags: [],
              staleAfterDays: null,
              lastVerified: null,
              extractedBy: null,
            };

            if (db) {
              const row = db.instance
                .prepare(
                  'SELECT source_url, source_title, source_type, direct_quote, domain_tags, stale_after_days, last_verified, extracted_by FROM memories WHERE id = ?'
                )
                .get(r.memory.id) as Record<string, unknown> | undefined;

              if (row) {
                factFields = {
                  sourceUrl: row.source_url as string | null,
                  sourceTitle: row.source_title as string | null,
                  sourceType: row.source_type as string | null,
                  directQuote: row.direct_quote as string | null,
                  domainTags: row.domain_tags ? JSON.parse(row.domain_tags as string) : [],
                  staleAfterDays: row.stale_after_days as number | null,
                  lastVerified: row.last_verified as number | null,
                  extractedBy: row.extracted_by as string | null,
                };
              }
            }

            // Get contradicting/supporting links
            let links: Array<{ targetId: string; linkType: string; strength: number }> = [];
            if (memoryLinkRepository && input.includeContradictions !== false) {
              const memLinks: MemoryLink[] = memoryLinkRepository.findLinks(r.memory.id);
              links = memLinks
                .filter(
                  (l: MemoryLink) =>
                    l.linkType === MemoryLinkType.CONTRADICTS ||
                    l.linkType === MemoryLinkType.SUPPORTS
                )
                .map((l: MemoryLink) => ({
                  targetId: l.sourceId === r.memory.id ? l.targetId : l.sourceId,
                  linkType: l.linkType,
                  strength: l.strength,
                }));
            }

            return {
              id: r.memory.id,
              claim: r.memory.content,
              relevance: r.relevance,
              confidence: r.memory.confidence,
              ...factFields,
              relationships: links,
            };
          });

          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify({
                  facts: enriched,
                  searchStats: {
                    totalFound: allResults.length,
                    afterFiltering: filtered.length,
                    returned: enriched.length,
                    latencyMs: results.searchStats.latencyMs + globalResults.searchStats.latencyMs,
                  },
                }),
              },
            ],
          };
        }

        default:
          return {
            content: [{ type: 'text', text: `Unknown tool: ${name}` }],
            isError: true,
          };
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        content: [{ type: 'text', text: `Error: ${message}` }],
        isError: true,
      };
    }
  });

  // List resources
  server.setRequestHandler(ListResourcesRequestSchema, async () => ({
    resources: [
      {
        uri: 'memory://stats',
        name: 'Memory Statistics',
        mimeType: 'application/json',
        description: 'Memory system statistics and health',
      },
    ],
  }));

  // Read resources
  server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
    const { uri } = request.params;

    if (uri === 'memory://stats') {
      const projectRoot = process.env.CLAUDE_PROJECT_ROOT ?? process.cwd();
      const projectId = getProjectId(projectRoot);

      await initializeForProject(projectId);

      const count = memoryRepository?.countByProject(projectId) ?? 0;
      const byType = memoryRepository?.countByType(projectId) ?? {};
      const embeddingStatus = await embeddingService?.getStatus();

      return {
        contents: [
          {
            uri,
            mimeType: 'application/json',
            text: JSON.stringify({
              projectId,
              totalMemories: count,
              byType,
              embedding: embeddingStatus,
            }),
          },
        ],
      };
    }

    throw new Error(`Unknown resource: ${uri}`);
  });

  return server;
}

/**
 * Main entry point
 */
async function main(): Promise<void> {
  const server = createServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((error) => {
  console.error('Server error:', error);
  process.exit(1);
});
