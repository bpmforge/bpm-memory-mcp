#!/usr/bin/env node

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';

import { connectionPool, runMigrations, getProjectId } from './storage/index.js';
import { EmbeddingService } from './embeddings/index.js';
import { HybridSearch } from './search/index.js';
import { MemoryRepository } from './storage/repository.js';
import { SessionRepository } from './storage/session.js';
import { CoreMemoryRepository } from './storage/core_memory.js';
import {
  MemoryStoreInputSchema,
  MemoryRecallInputSchema,
  MemoryForgetInputSchema,
  MemoryUpdateInputSchema,
  MemoryFeedbackInputSchema,
  SessionSaveInputSchema,
  FeedbackType,
  type MemoryCreateInput,
  type SearchOptions,
  type CodeContext,
} from './types.js';

// Current project context
let currentProjectId: string | null = null;

// Services (initialized per project)
let embeddingService: EmbeddingService | null = null;
let hybridSearch: HybridSearch | null = null;
let memoryRepository: MemoryRepository | null = null;
let sessionRepository: SessionRepository | null = null;
let coreMemoryRepository: CoreMemoryRepository | null = null;

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

  // Initialize services
  embeddingService = new EmbeddingService(db);
  await embeddingService.initialize();

  hybridSearch = new HybridSearch(db, embeddingService);
  memoryRepository = new MemoryRepository(db);
  sessionRepository = new SessionRepository(db);
  coreMemoryRepository = new CoreMemoryRepository(db);

  // Initialize core memory if needed
  if (!coreMemoryRepository.isInitialized(projectId)) {
    coreMemoryRepository.initializeDefaults(projectId);
  }
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
              enum: ['typescript', 'javascript', 'python', 'rust', 'go', 'java', 'c', 'cpp', 'ruby', 'php', 'shell', 'sql', 'markdown', 'json', 'yaml', 'other'],
              description: 'Programming language (auto-detected from citation if not provided)',
            },
            codeContext: {
              type: 'object',
              properties: {
                filePath: { type: 'string', description: 'Relative file path' },
                startLine: { type: 'integer', minimum: 1, description: 'Starting line number' },
                endLine: { type: 'integer', minimum: 1, description: 'Ending line number' },
                symbolName: { type: 'string', description: 'Function/class/variable name' },
                symbolType: { type: 'string', enum: ['function', 'class', 'variable', 'type', 'module', 'method'] },
              },
              description: 'Structured code context (auto-parsed from citation if not provided)',
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
            minConfidence: { type: 'number', minimum: 0, maximum: 1, description: 'Min confidence' },
            // V2 filters
            language: {
              type: 'string',
              enum: ['typescript', 'javascript', 'python', 'rust', 'go', 'java', 'c', 'cpp', 'ruby', 'php', 'shell', 'sql', 'markdown', 'json', 'yaml', 'other'],
              description: 'Filter by programming language',
            },
            includeStale: { type: 'boolean', description: 'Include flagged-stale memories (default: false)' },
            includeSuperseded: { type: 'boolean', description: 'Include superseded versions (default: false)' },
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
              enum: ['typescript', 'javascript', 'python', 'rust', 'go', 'java', 'c', 'cpp', 'ruby', 'php', 'shell', 'sql', 'markdown', 'json', 'yaml', 'other'],
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
            duplicateOf: { type: 'string', format: 'uuid', description: 'Canonical memory ID (for duplicate)' },
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
          const embedding = await embeddingService.embed(input.content);

          // Check for duplicate
          if (memoryRepository.isDuplicateContent(input.content, projectId)) {
            return {
              content: [{ type: 'text', text: 'Memory already exists (duplicate content)' }],
            };
          }

          // Build memory input, only including defined optional properties
          const memoryInput: MemoryCreateInput = {
            content: input.content,
            type: input.type,
            confidence: input.confidence,
            projectId,
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
            if (input.codeContext.symbolName !== undefined) ctx.symbolName = input.codeContext.symbolName;
            if (input.codeContext.symbolType !== undefined) ctx.symbolType = input.codeContext.symbolType;
            memoryInput.codeContext = ctx;
          }

          const memory = memoryRepository.createMemory(memoryInput, embedding);

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
                }),
              },
            ],
          };
        }

        case 'memory_recall': {
          const input = MemoryRecallInputSchema.parse(args);

          // Build search options, only including defined optional properties
          const searchOptions: SearchOptions = {
            projectId,
            limit: input.limit,
            minConfidence: input.minConfidence,
            // V2 filters
            includeStale: input.includeStale,
            includeSuperseded: input.includeSuperseded,
          };
          if (input.type) searchOptions.type = input.type;
          if (input.language) searchOptions.language = input.language;

          const response = await hybridSearch.search(input.query, searchOptions);

          // Update access stats for returned memories
          for (const result of response.memories) {
            memoryRepository.updateAccessStats(result.memory.id);
          }

          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify({
                  memories: response.memories.map((r) => ({
                    id: r.memory.id,
                    content: r.memory.content,
                    type: r.memory.type,
                    confidence: r.memory.confidence,
                    citation: r.memory.citation,
                    relevance: r.relevance,
                    // V2 response fields
                    language: r.memory.language,
                    version: r.memory.version,
                    isSuperseded: !!r.memory.supersededBy,
                    isStale: !!r.memory.flaggedAt,
                  })),
                  stats: response.searchStats,
                }),
              },
            ],
          };
        }

        case 'memory_forget': {
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

        case 'memory_update': {
          const input = MemoryUpdateInputSchema.parse(args);
          const embedding = await embeddingService.embed(input.content);

          // V2: Create superseding memory instead of in-place update
          try {
            const newMemory = memoryRepository.createSupersedingMemory(
              input.id,
              projectId,
              input.content,
              embedding
            );

            return {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify({
                    id: newMemory.id,
                    version: newMemory.version,
                    supersedesId: newMemory.supersedesId,
                    message: `Memory updated to version ${newMemory.version}`,
                  }),
                },
              ],
            };
          } catch (error) {
            return {
              content: [
                {
                  type: 'text',
                  text: `Memory ${input.id} not found`,
                },
              ],
            };
          }
        }

        case 'memory_feedback': {
          const input = MemoryFeedbackInputSchema.parse(args);

          // Record feedback and adjust confidence
          const feedback = memoryRepository.recordFeedback(
            input.id,
            projectId,
            input.feedback as FeedbackType,
            input.correction,
            input.duplicateOf
          );

          // If correction provided for wrong/outdated, create superseding memory
          let newMemoryId: string | null = null;
          if (input.correction && (input.feedback === 'wrong' || input.feedback === 'outdated')) {
            const embedding = await embeddingService.embed(input.correction);
            const newMemory = memoryRepository.createSupersedingMemory(
              input.id,
              projectId,
              input.correction,
              embedding
            );
            newMemoryId = newMemory.id;
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
                  message: newMemoryId
                    ? `Feedback recorded. New corrected memory created: ${newMemoryId}`
                    : `Feedback recorded. Confidence adjusted by ${feedback.confidenceDelta}`,
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

        case 'session_restore': {
          if (!sessionRepository) {
            return {
              content: [{ type: 'text', text: 'Error: Session repository not initialized' }],
              isError: true,
            };
          }

          const session = sessionRepository.getLatestSession(projectId);

          if (!session) {
            return {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify({
                    message: 'No previous session found',
                    isNewSession: true,
                  }),
                },
              ],
            };
          }

          // Mark session as resumed
          sessionRepository.markResumed(session.id);

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
                  message: 'Session restored successfully',
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
