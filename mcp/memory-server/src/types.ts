import { z } from 'zod';

// ============================================================================
// Enums
// ============================================================================

export enum MemoryType {
  FACT = 'fact',
  PATTERN = 'pattern',
  DECISION = 'decision',
  ERROR = 'error',
  PREFERENCE = 'preference',
}

export enum EntityType {
  FILE = 'file',
  FUNCTION = 'function',
  TYPE = 'type',
  DECISION = 'decision',
  ERROR = 'error',
}

export enum RelationType {
  IMPLEMENTS = 'implements',
  DEPENDS_ON = 'depends_on',
  SATISFIES = 'satisfies',
  CALLS = 'calls',
  CONTRADICTS = 'contradicts',
  SUPERSEDES = 'supersedes',
}

// ============================================================================
// Core Interfaces
// ============================================================================

export interface Memory {
  id: string;
  content: string;
  embedding: Float32Array | null;
  type: MemoryType;
  confidence: number;
  citation: string | null;
  projectId: string;
  contentHash: string;
  createdAt: Date;
  accessedAt: Date;
  accessCount: number;
  deletedAt: Date | null;
  deleteReason: string | null;
}

export interface MemoryCreateInput {
  content: string;
  type?: MemoryType;
  confidence?: number;
  citation?: string;
  projectId: string;
}

export interface MemorySearchResult {
  memory: Memory;
  relevance: number;
  vectorScore?: number;
  bm25Score?: number;
}

export interface SearchResponse {
  memories: MemorySearchResult[];
  searchStats: {
    vectorMatches: number;
    bm25Matches: number;
    fusedResults: number;
    latencyMs: number;
  };
}

export interface SearchOptions {
  projectId: string;
  type?: MemoryType;
  limit?: number;
  minConfidence?: number;
  includeDeleted?: boolean;
}

// ============================================================================
// Core Memory (MemGPT-style)
// ============================================================================

export interface CoreMemoryBlock {
  content: string;
  lastUpdated: Date;
  source?: 'claude.md' | 'user' | 'claude';
}

export interface CoreMemory {
  persona: CoreMemoryBlock;
  human: CoreMemoryBlock;
  goals: CoreMemoryBlock;
  project: CoreMemoryBlock & {
    keyFiles: string[];
  };
}

// ============================================================================
// Session
// ============================================================================

export interface Session {
  id: string;
  projectId: string;
  workingMemory: WorkingMemory;
  coreMemorySnapshot: CoreMemory;
  conversationSummary: string;
  createdAt: Date;
  resumedAt: Date | null;
}

export interface WorkingMemory {
  currentTask: string | null;
  recentToolCalls: ToolCallRecord[];
  scratchpad: string;
}

export interface ToolCallRecord {
  tool: string;
  timestamp: Date;
  success: boolean;
}

// ============================================================================
// Knowledge Graph
// ============================================================================

export interface Entity {
  id: string;
  type: EntityType;
  name: string;
  properties: Record<string, unknown>;
  validFrom: Date;
  validTo: Date | null;
  projectId: string;
}

export interface Relation {
  id: string;
  sourceId: string;
  targetId: string;
  type: RelationType;
  properties: Record<string, unknown>;
  validFrom: Date;
  validTo: Date | null;
  projectId: string;
}

// ============================================================================
// Embedding Provider
// ============================================================================

export interface EmbeddingProvider {
  name: string;
  endpoint: string;
  health(): Promise<boolean>;
  listModels(): Promise<EmbeddingModel[]>;
  embed(text: string, model: string): Promise<Float32Array>;
}

export interface EmbeddingModel {
  id: string;
  name: string;
  dimensions?: number;
}

export interface EmbeddingConfig {
  provider: 'ollama' | 'lmstudio';
  endpoint: string;
  model: string;
  dimensions: number;
}

// ============================================================================
// Configuration
// ============================================================================

export interface Config {
  embedding: EmbeddingConfig;
  search: SearchConfig;
  autoDetect: boolean;
}

export interface SearchConfig {
  vectorWeight: number;
  bm25Weight: number;
  rrfK: number;
}

// ============================================================================
// Zod Schemas for Input Validation (SC-003)
// ============================================================================

export const MemoryTypeSchema = z.nativeEnum(MemoryType);

export const MemoryStoreInputSchema = z.object({
  content: z.string().min(1).max(50000),
  type: MemoryTypeSchema.optional().default(MemoryType.FACT),
  confidence: z.number().min(0).max(1).optional().default(1.0),
  citation: z.string().optional(),
});

export const MemoryRecallInputSchema = z.object({
  query: z.string().min(1).max(1000),
  type: MemoryTypeSchema.optional(),
  limit: z.number().int().min(1).max(50).optional().default(10),
  minConfidence: z.number().min(0).max(1).optional().default(0),
});

export const MemoryForgetInputSchema = z.object({
  id: z.string().uuid(),
  reason: z.string().min(1).max(500),
});

export const MemoryUpdateInputSchema = z.object({
  id: z.string().uuid(),
  content: z.string().min(1).max(50000),
});

export const SessionSaveInputSchema = z.object({
  summary: z.string().max(5000).optional(),
});

export const GraphQueryInputSchema = z.object({
  entityId: z.string().optional(),
  entityType: z.nativeEnum(EntityType).optional(),
  relationType: z.nativeEnum(RelationType).optional(),
  depth: z.number().int().min(1).max(5).optional().default(2),
});

// Type exports from Zod schemas
export type MemoryStoreInput = z.infer<typeof MemoryStoreInputSchema>;
export type MemoryRecallInput = z.infer<typeof MemoryRecallInputSchema>;
export type MemoryForgetInput = z.infer<typeof MemoryForgetInputSchema>;
export type MemoryUpdateInput = z.infer<typeof MemoryUpdateInputSchema>;
export type SessionSaveInput = z.infer<typeof SessionSaveInputSchema>;
export type GraphQueryInput = z.infer<typeof GraphQueryInputSchema>;
