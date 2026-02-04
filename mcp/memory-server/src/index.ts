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
  FeedbackType,
  MemoryLinkType,
  type MemoryCreateInput,
  type SearchOptions,
  type CodeContext,
} from './types.js';
import { GoalRepository } from './goals/index.js';
import { calculateDriftIndicator, getDriftWarningMessage } from './goals/drift.js';
import { MemoryLinkRepository } from './storage/links.js';
import { CheckpointRepository } from './checkpoint/index.js';
import { ContradictionDetector } from './validation/contradictions.js';

// Storage quota: maximum memories per project
const MAX_MEMORIES_PER_PROJECT = 10000;

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
  stalenessDetector = new StalenessDetector(db);
  // V3 services
  goalRepository = new GoalRepository(db);
  memoryLinkRepository = new MemoryLinkRepository(db);
  checkpointRepository = new CheckpointRepository(db);
  contradictionDetector = new ContradictionDetector(db);

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
            goalId: { type: 'string', format: 'uuid', description: 'Goal ID (for "complete"/"check")' },
            note: { type: 'string', description: 'Completion note (for "complete")' },
          },
          required: ['action'],
        },
      },
      {
        name: 'memory_link',
        description: 'Create Zettelkasten-style links between memories',
        inputSchema: {
          type: 'object',
          properties: {
            action: {
              type: 'string',
              enum: ['create', 'find_related', 'get_links'],
              description: 'Action to perform',
            },
            sourceId: { type: 'string', format: 'uuid', description: 'Source memory ID (for "create")' },
            targetId: { type: 'string', format: 'uuid', description: 'Target memory ID (for "create")' },
            linkType: {
              type: 'string',
              enum: ['relates_to', 'contradicts', 'supports', 'extends', 'derived_from'],
              description: 'Type of link relationship',
            },
            strength: { type: 'number', minimum: 0, maximum: 1, description: 'Link strength 0-1' },
            bidirectional: { type: 'boolean', description: 'Whether link works both directions' },
            memoryId: { type: 'string', format: 'uuid', description: 'Memory ID (for "find_related"/"get_links")' },
            depth: { type: 'integer', minimum: 1, maximum: 3, description: 'Traversal depth for "find_related"' },
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

          // Security checks (can be disabled for benchmarking)
          if (!HARDENING_DISABLED) {
            // Security: Check for credentials (SC-001)
            if (containsCredentials(input.content)) {
              return {
                content: [{ type: 'text', text: 'Error: Content appears to contain credentials or secrets. Memory not stored.' }],
                isError: true,
              };
            }

            // Security: Validate citation path (SC-002)
            if (input.citation) {
              const parsed = parseCodeContext(input.citation);
              if (parsed && !isPathSafe(parsed.filePath, projectRoot)) {
                return {
                  content: [{ type: 'text', text: 'Error: Citation path is outside project root.' }],
                  isError: true,
                };
              }
            }

            // Security: Check storage quota
            if (memoryRepository.getMemoryCount(projectId) >= MAX_MEMORIES_PER_PROJECT) {
              return {
                content: [{ type: 'text', text: `Error: Storage limit reached (${MAX_MEMORIES_PER_PROJECT} memories). Consider archiving or deleting old memories.` }],
                isError: true,
              };
            }
          }

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

          // V3: Check for potential contradictions before storing
          let contradictionWarning: {
            count: number;
            memories: Array<{ id: string; similarity: number; reason: string }>;
          } | null = null;

          if (contradictionDetector && embedding && !HARDENING_DISABLED) {
            const contradictions = await contradictionDetector.detectOnStore(
              input.content,
              embedding,
              projectId
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

          const memory = memoryRepository.createMemory(memoryInput, embedding, projectRoot);

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
              embedding,
              input.language, // Honor new language if provided
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
              embedding,
              undefined, // Keep existing language
              projectRoot
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
            // Run staleness detection even for new sessions (can be disabled for benchmarking)
            const staleReport = (stalenessDetector && !HARDENING_DISABLED) ? {
              accessStale: stalenessDetector.detectAccessStale(projectId).length,
              sourceMissing: stalenessDetector.detectSourceMissing(projectId, projectRoot).length,
              lowConfidence: stalenessDetector.detectLowConfidence(projectId).length,
              contentChanged: stalenessDetector.detectContentChanged(projectId, projectRoot).length,
            } : null;

            // V3: Include active goals even for new sessions
            const activeGoals = goalRepository?.getActiveGoals(projectId) ?? [];

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
                  }),
                },
              ],
            };
          }

          // Run staleness detection (can be disabled for benchmarking)
          const staleReport = (stalenessDetector && !HARDENING_DISABLED) ? {
            accessStale: stalenessDetector.detectAccessStale(projectId).length,
            sourceMissing: stalenessDetector.detectSourceMissing(projectId, projectRoot).length,
            lowConfidence: stalenessDetector.detectLowConfidence(projectId).length,
            contentChanged: stalenessDetector.detectContentChanged(projectId, projectRoot).length,
          } : null;

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
                  content: [{ type: 'text', text: 'Error: goalId is required for "complete" action' }],
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
                  content: [{ type: 'text', text: 'Error: sourceId, targetId, and linkType are required for "create" action' }],
                  isError: true,
                };
              }

              // Verify both memories exist
              const source = memoryRepository!.findById(input.sourceId, projectId);
              const target = memoryRepository!.findById(input.targetId, projectId);

              if (!source) {
                return {
                  content: [{ type: 'text', text: `Error: Source memory ${input.sourceId} not found` }],
                  isError: true,
                };
              }

              if (!target) {
                return {
                  content: [{ type: 'text', text: `Error: Target memory ${input.targetId} not found` }],
                  isError: true,
                };
              }

              // Check for existing link
              const existingLink = memoryLinkRepository.findLinkBetween(input.sourceId, input.targetId);
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
                  content: [{ type: 'text', text: 'Error: memoryId is required for "find_related" action' }],
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
                  content: [{ type: 'text', text: 'Error: memoryId is required for "get_links" action' }],
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
                  content: [{ type: 'text', text: 'Error: taskId and phase are required for "save" action' }],
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
                  content: [{ type: 'text', text: 'Error: taskId is required for "restore" action' }],
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
                content: [{ type: 'text', text: `Unknown checkpoint_task action: ${input.action}` }],
                isError: true,
              };
          }
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
