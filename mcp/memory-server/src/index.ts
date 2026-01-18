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
import {
  MemoryStoreInputSchema,
  MemoryRecallInputSchema,
  MemoryForgetInputSchema,
  MemoryUpdateInputSchema,
  SessionSaveInputSchema,
  type MemoryCreateInput,
  type SearchOptions,
} from './types.js';

// Current project context
let currentProjectId: string | null = null;

// Services (initialized per project)
let embeddingService: EmbeddingService | null = null;
let hybridSearch: HybridSearch | null = null;
let memoryRepository: MemoryRepository | null = null;

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
        description: 'Update memory content and re-embed (atomic operation)',
        inputSchema: {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid', description: 'Memory ID to update' },
            content: { type: 'string', description: 'New content' },
          },
          required: ['id', 'content'],
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
          };
          if (input.type) searchOptions.type = input.type;

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
          const success = memoryRepository.updateContent(
            input.id,
            projectId,
            input.content,
            embedding
          );

          return {
            content: [
              {
                type: 'text',
                text: success
                  ? `Memory ${input.id} updated`
                  : `Memory ${input.id} not found`,
              },
            ],
          };
        }

        case 'session_save': {
          const input = SessionSaveInputSchema.parse(args ?? {});
          // TODO: Implement full session save
          return {
            content: [{ type: 'text', text: `Session saved: ${input.summary ?? 'No summary'}` }],
          };
        }

        case 'session_restore': {
          // TODO: Implement full session restore
          return {
            content: [{ type: 'text', text: 'Session restored (stub)' }],
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
