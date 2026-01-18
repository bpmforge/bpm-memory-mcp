# Implementation Tasks: claude-memory

## Document Information

| Field | Value |
|-------|-------|
| Version | 1.1 |
| Date | 2026-01-17 |
| Status | Active |
| Total Tasks | 38 |
| Last Validated | 2026-01-17 |

## Progress Summary

| Status | Count | Percentage |
|--------|-------|------------|
| Done | 28 | 74% |
| Partial | 0 | 0% |
| Pending | 10 | 26% |

### P0 Tasks (28 total)
- **Done:** 28 (100%)
- **Partial:** 0 (0%)
- **Pending:** 0 (0%)

### P1 Tasks (10 total)
- **Done:** 0 (0%)
- **Partial:** 0 (0%)
- **Pending:** 10 (100%)

### Confidence Distribution
- 🟢 High (90%+): 28 tasks
- 🟡 Medium (70-89%): 0 tasks
- 🟠 Low (40-69%): 0 tasks

### User Stories Satisfied
| Story | Title | Status |
|-------|-------|--------|
| US-002 | Skill Teaches Memory Patterns | ✓ Done |
| US-003 | MCP Protocol Compliance | ✓ Done |
| US-005 | Discover Available Tools | ✓ Done |
| US-006 | Store Project Facts | ✓ Done |
| US-008 | Search Memories Semantically | ✓ Done |
| US-009 | Search Memories by Keyword | ✓ Done |
| US-010 | Forget Outdated Information | ✓ Done |
| US-018 | Best-of-Both-Worlds Search | ✓ Done |
| US-021 | Local Embedding Generation | ✓ Done |
| US-022 | Embedding Caching | ✓ Done |
| US-023 | Work Without Embedding Server | ✓ Done |
| US-034 | Automatic Project Detection | ✓ Done |
| US-037 | Reliable SQLite Storage | ✓ Done |
| US-038 | Database Schema Upgrades | ✓ Done |
| US-050 | Provider Auto-Detection | ✓ Done |
| US-051 | Model Discovery | ✓ Done |
| US-031 | Automatic Session Save | ✓ Done |
| US-032 | Automatic Session Restore | ✓ Done |
| US-013 | Project Identity from CLAUDE.md | ✓ Done |

### Validation Notes

**Verified 2026-01-18:**
- Build compiles: ✓ `npm run build` succeeds
- Directory structure: ✓ Matches ARCHITECTURE.md
- All P0 modules implemented: storage, embeddings, search, tools, skill
- MCP Server: 6 tools registered and functional
- Hybrid search: Vector + BM25 + RRF fusion working
- Session management: Full save/restore with state serialization
- Core memory: MemGPT-style blocks (persona, human, goals, project)

**P0 Complete!** All 28 P0 tasks done with 90%+ confidence.

## Task Overview

| Task ID | Title | Module | Priority | Status | Confidence | Requirements |
|---------|-------|--------|----------|--------|------------|--------------|
| TASK-001 | Project Setup & Configuration | core | P0 | Done | 95% | - |
| TASK-002 | TypeScript Configuration | core | P0 | Done | 95% | NFR-040, NFR-042 |
| TASK-003 | Core Types & Interfaces | core | P0 | Done | 95% | FR-010, FR-011 |
| TASK-004 | SQLite Database Connection | storage | P0 | Done | 95% | FR-090 |
| TASK-005 | Database Schema & Migrations | storage | P0 | Done | 95% | FR-090, FR-091 |
| TASK-006 | Memory Repository CRUD | storage | P0 | Done | 95% | FR-010, FR-011, FR-012 |
| TASK-007 | FTS5 Virtual Table Setup | storage | P0 | Done | 95% | FR-031 |
| TASK-008 | Provider Interface & Types | embeddings | P0 | Done | 95% | FR-040 |
| TASK-009 | Ollama Provider Implementation | embeddings | P0 | Done | 90% | FR-041 |
| TASK-010 | LM Studio Provider Implementation | embeddings | P0 | Done | 90% | FR-041 |
| TASK-011 | Provider Auto-Detection | embeddings | P0 | Done | 90% | FR-044 |
| TASK-012 | Model Discovery & Filtering | embeddings | P0 | Done | 90% | FR-045 |
| TASK-013 | Embedding Cache | embeddings | P0 | Done | 90% | FR-042 |
| TASK-014 | Graceful Degradation | embeddings | P0 | Done | 85% | FR-043 |
| TASK-015 | Vector Search (Cosine Similarity) | search | P0 | Done | 95% | FR-030 |
| TASK-016 | BM25 Keyword Search | search | P0 | Done | 95% | FR-031 |
| TASK-017 | RRF Fusion Algorithm | search | P0 | Done | 95% | FR-032 |
| TASK-018 | Hybrid Search Orchestration | search | P0 | Done | 95% | FR-030, FR-031, FR-032 |
| TASK-019 | MCP Server Core Setup | tools | P0 | Done | 95% | MCP-001 |
| TASK-020 | memory_store Tool | tools | P0 | Done | 90% | FR-010, MCP-002 |
| TASK-021 | memory_recall Tool | tools | P0 | Done | 90% | FR-011, MCP-002 |
| TASK-022 | memory_forget Tool | tools | P0 | Done | 90% | FR-012, MCP-002 |
| TASK-023 | Session State Serialization | session | P0 | Done | 90% | FR-070 |
| TASK-024 | session_save Tool | session | P0 | Done | 90% | FR-070, MCP-002 |
| TASK-025 | session_restore Tool | session | P0 | Done | 90% | FR-071, MCP-002 |
| TASK-026 | Project Identification | storage | P0 | Done | 95% | FR-080, FR-081 |
| TASK-027 | Core Memory Blocks (MemGPT-style) | storage | P0 | Done | 90% | FR-021 |
| TASK-028 | SKILL.md Memory Skill | skill | P0 | Done | 95% | SK-001 |
| TASK-029 | Model Validation | embeddings | P1 | Pending | - | FR-047 |
| TASK-030 | Model Selection Interface | embeddings | P1 | Pending | - | FR-046 |
| TASK-031 | Search Re-ranking | search | P1 | Pending | - | FR-033 |
| TASK-032 | Entity Management | graph | P1 | Pending | - | FR-050 |
| TASK-033 | Relationship Management | graph | P1 | Pending | - | FR-051 |
| TASK-034 | graph_query Tool | graph | P1 | Pending | - | FR-053, MCP-002 |
| TASK-035 | Session Hooks Configuration | hooks | P1 | Pending | - | HK-001, HK-005 |
| TASK-036 | Project Switch Hook | hooks | P1 | Pending | - | HK-006 |
| TASK-037 | compact.sh Script | skill | P1 | Pending | - | SK-002, FR-060 |
| TASK-038 | Plugin Manifest & Installation | core | P1 | Pending | - | PL-001, PL-002 |

---

## P0 Tasks (Must Have - Core Functionality)

### TASK-001: Project Setup & Configuration
**Module:** core
**Priority:** P0
**Traces To:** NFR-040, NFR-041
**Depends On:** None

**Description:**
Initialize the claude-memory project with npm, create the directory structure per ARCHITECTURE.md, and set up the development environment.

**Deliverables:**
- [ ] File: `package.json` - npm configuration with dependencies from TECH_STACK.md
- [ ] File: `.npmrc` - npm configuration for Node 24.x
- [ ] File: `.gitignore` - Exclude node_modules, dist, *.db files
- [ ] Dir: `mcp/memory-server/src/` - MCP server source directory
- [ ] Dir: `skills/memory/` - Skill files directory
- [ ] Dir: `hooks/` - Hook configurations directory
- [ ] Dir: `tests/unit/` and `tests/integration/` - Test directories

**Acceptance Criteria:**
- [ ] `npm install` completes without errors
- [ ] Directory structure matches ARCHITECTURE.md
- [ ] All dependencies from TECH_STACK.md are listed in package.json

---

### TASK-002: TypeScript Configuration
**Module:** core
**Priority:** P0
**Traces To:** NFR-042
**Depends On:** TASK-001

**Description:**
Configure TypeScript for the MCP server with strict type checking and ESM output compatible with Node.js 24.x.

**Deliverables:**
- [ ] File: `tsconfig.json` - TypeScript configuration
- [ ] File: `mcp/memory-server/tsconfig.json` - Server-specific config
- [ ] File: `.eslintrc.json` - ESLint configuration for TypeScript
- [ ] File: `.prettierrc` - Prettier configuration

**Acceptance Criteria:**
- [ ] `npm run build` compiles without TypeScript errors
- [ ] ESLint passes with zero warnings
- [ ] Output targets Node 24.x ESM

---

### TASK-003: Core Types & Interfaces
**Module:** core
**Priority:** P0
**Traces To:** FR-010, FR-011, FR-012, FR-020, FR-021, FR-022
**Depends On:** TASK-002

**Description:**
Define core TypeScript types and interfaces for memories, sessions, entities, and search results as specified in SRS.md Appendix.

**Deliverables:**
- [ ] File: `mcp/memory-server/src/types.ts` - Core type definitions
  - MemoryType enum (fact, pattern, decision, error, preference)
  - Memory interface (id, content, type, confidence, citation, etc.)
  - CoreMemory interface (persona, human, goals, project blocks)
  - SearchResponse interface with searchStats
  - Session interface
  - Entity and Relation interfaces

**Acceptance Criteria:**
- [ ] All types from SRS.md Appendix A, B, C are defined
- [ ] Types are exported for use by other modules
- [ ] Zod schemas defined for input validation (SC-003)

---

### TASK-004: SQLite Database Connection
**Module:** storage
**Priority:** P0
**Traces To:** FR-090, NFR-010
**Depends On:** TASK-002

**Description:**
Implement SQLite database connection using better-sqlite3 with WAL mode and optimized pragmas per DATABASE.md.

**Deliverables:**
- [ ] File: `mcp/memory-server/src/storage/database.ts`
  - Database class with connection management
  - WAL mode configuration
  - Pragma settings (cache_size, mmap_size, temp_store)
  - Connection pooling for concurrent access

**Acceptance Criteria:**
- [ ] Database opens in WAL mode (verified by PRAGMA journal_mode)
- [ ] Crash-safe operations (data preserved after kill -9)
- [ ] Performance pragmas applied per DATABASE.md

---

### TASK-005: Database Schema & Migrations
**Module:** storage
**Priority:** P0
**Traces To:** FR-090, FR-091
**Depends On:** TASK-004

**Description:**
Implement database schema creation and migration system per DATABASE.md schema definitions.

**Deliverables:**
- [ ] File: `mcp/memory-server/src/storage/schema.ts` - Table definitions
- [ ] File: `mcp/memory-server/src/storage/migrations.ts` - Migration runner
  - schema_version table
  - Up/down migration support
  - Transaction safety

**Acceptance Criteria:**
- [ ] All tables from DATABASE.md ER diagram created
- [ ] Indexes created per DATABASE.md specifications
- [ ] Migrations run automatically on server start
- [ ] schema_version tracks applied migrations

---

### TASK-006: Memory Repository CRUD
**Module:** storage
**Priority:** P0
**Traces To:** FR-010, FR-011, FR-012
**Depends On:** TASK-005

**Description:**
Implement Repository pattern for memory CRUD operations with project isolation.

**Deliverables:**
- [ ] File: `mcp/memory-server/src/storage/repository.ts`
  - createMemory(input): Memory
  - findMemoryById(id, projectId): Memory | null
  - findMemoriesByProject(projectId, options): Memory[]
  - softDeleteMemory(id, projectId, reason): boolean
  - updateAccessStats(id): void
  - checkDuplicate(contentHash, projectId): boolean

**Acceptance Criteria:**
- [ ] All CRUD operations work correctly
- [ ] Project isolation enforced (FR-083)
- [ ] Soft delete with reason tracking (FR-012)
- [ ] Access count and timestamp updated on retrieval

---

### TASK-007: FTS5 Virtual Table Setup
**Module:** storage
**Priority:** P0
**Traces To:** FR-031
**Depends On:** TASK-005

**Description:**
Create FTS5 virtual table for BM25 full-text search with sync triggers.

**Deliverables:**
- [ ] File: `mcp/memory-server/src/storage/fts.ts`
  - memories_fts virtual table creation
  - Insert/update/delete triggers for sync
  - BM25 search query helper

**Acceptance Criteria:**
- [ ] FTS5 table created with content column
- [ ] Triggers keep FTS in sync with memories table
- [ ] BM25 ranking works correctly via bm25(memories_fts)

---

### TASK-008: Provider Interface & Types
**Module:** embeddings
**Priority:** P0
**Traces To:** FR-040
**Depends On:** TASK-003

**Description:**
Define the EmbeddingProvider interface that abstracts Ollama and LM Studio providers.

**Deliverables:**
- [ ] File: `mcp/memory-server/src/embeddings/types.ts`
  - EmbeddingProvider interface (listModels, embed, health)
  - ProviderConfig type
  - ModelInfo type (id, name, dimensions)
  - EmbeddingResult type

**Acceptance Criteria:**
- [ ] Interface supports both Ollama and LM Studio APIs
- [ ] Type-safe provider configuration
- [ ] Model metadata includes dimensions

---

### TASK-009: Ollama Provider Implementation
**Module:** embeddings
**Priority:** P0
**Traces To:** FR-041
**Depends On:** TASK-008

**Description:**
Implement Ollama provider using native Ollama API at localhost:11434.

**Deliverables:**
- [ ] File: `mcp/memory-server/src/embeddings/ollama.ts`
  - OllamaProvider class implementing EmbeddingProvider
  - GET /api/tags for model listing
  - POST /api/embeddings for embedding generation
  - Health check via /api/tags

**Acceptance Criteria:**
- [ ] Connects to Ollama at localhost:11434
- [ ] Lists available embedding models (filter by name contains "embed")
- [ ] Generates embeddings for text content
- [ ] Returns dimensions from actual embedding response

---

### TASK-010: LM Studio Provider Implementation
**Module:** embeddings
**Priority:** P0
**Traces To:** FR-041
**Depends On:** TASK-008

**Description:**
Implement LM Studio provider using OpenAI-compatible API at localhost:1234.

**Deliverables:**
- [ ] File: `mcp/memory-server/src/embeddings/lmstudio.ts`
  - LMStudioProvider class implementing EmbeddingProvider
  - GET /v1/models for model listing
  - POST /v1/embeddings for embedding generation
  - Health check via /v1/models

**Acceptance Criteria:**
- [ ] Connects to LM Studio at localhost:1234
- [ ] Lists available embedding models (filter by name)
- [ ] Generates embeddings using OpenAI API format
- [ ] Handles LM Studio-specific response format

---

### TASK-011: Provider Auto-Detection
**Module:** embeddings
**Priority:** P0
**Traces To:** FR-044
**Depends On:** TASK-009, TASK-010

**Description:**
Implement automatic detection of available embedding providers on startup.

**Deliverables:**
- [ ] File: `mcp/memory-server/src/embeddings/index.ts`
  - detectProviders(): Promise<ProviderInfo[]>
  - getActiveProvider(): EmbeddingProvider
  - Provider selection logic (first available)
  - Configuration override support

**Acceptance Criteria:**
- [ ] Detects Ollama at localhost:11434
- [ ] Detects LM Studio at localhost:1234
- [ ] Uses first responding provider automatically
- [ ] Allows manual override via config
- [ ] Caches detection result for session

---

### TASK-012: Model Discovery & Filtering
**Module:** embeddings
**Priority:** P0
**Traces To:** FR-045
**Depends On:** TASK-011

**Description:**
Implement model discovery that filters to embedding-capable models.

**Deliverables:**
- [ ] File: `mcp/memory-server/src/embeddings/discovery.ts`
  - discoverModels(provider): Promise<ModelInfo[]>
  - filterEmbeddingModels(models): ModelInfo[]
  - Auto-select first embedding model

**Acceptance Criteria:**
- [ ] Queries provider's model listing endpoint
- [ ] Filters models by name containing "embed"
- [ ] Returns model ID and dimensions (if known)
- [ ] Handles both Ollama and LM Studio response formats

---

### TASK-013: Embedding Cache
**Module:** embeddings
**Priority:** P0
**Traces To:** FR-042
**Depends On:** TASK-006

**Description:**
Implement embedding cache to avoid recomputation for identical content.

**Deliverables:**
- [ ] File: `mcp/memory-server/src/embeddings/cache.ts`
  - getCachedEmbedding(contentHash): Float32Array | null
  - cacheEmbedding(contentHash, embedding): void
  - invalidateCache(contentHash): void
  - Content hash calculation (SHA256)

**Acceptance Criteria:**
- [ ] Embeddings stored in SQLite BLOB column
- [ ] Cache lookup by content hash (FR-042)
- [ ] Cache hit avoids API call
- [ ] Invalidation on content change

---

### TASK-014: Graceful Degradation
**Module:** embeddings
**Priority:** P0
**Traces To:** FR-043, NFR-011
**Depends On:** TASK-011

**Description:**
Implement graceful degradation to BM25-only when embedding server unavailable.

**Deliverables:**
- [ ] File: `mcp/memory-server/src/embeddings/fallback.ts`
  - isProviderAvailable(): boolean
  - handleProviderUnavailable(): void
  - Queue for pending embeddings

**Acceptance Criteria:**
- [ ] Detects embedding server unavailable
- [ ] Falls back to BM25-only search
- [ ] Shows clear warning message with instructions
- [ ] Queues embeddings for later generation

---

### TASK-015: Vector Search (Cosine Similarity)
**Module:** search
**Priority:** P0
**Traces To:** FR-030
**Depends On:** TASK-006, TASK-013

**Description:**
Implement vector search using cosine similarity computation.

**Deliverables:**
- [ ] File: `mcp/memory-server/src/search/vector.ts`
  - cosineSimilarity(a, b): number
  - vectorSearch(queryEmbedding, projectId, limit): VectorResult[]
  - Embedding deserialization from BLOB

**Acceptance Criteria:**
- [ ] Computes cosine similarity correctly
- [ ] Returns top-k results sorted by similarity
- [ ] Handles variable dimensions (768-4096)
- [ ] Performance: <20ms for 1000 memories (NFR-001)

---

### TASK-016: BM25 Keyword Search
**Module:** search
**Priority:** P0
**Traces To:** FR-031
**Depends On:** TASK-007

**Description:**
Implement BM25 keyword search using SQLite FTS5.

**Deliverables:**
- [ ] File: `mcp/memory-server/src/search/bm25.ts`
  - bm25Search(query, projectId, limit): BM25Result[]
  - Query tokenization using natural
  - Boolean operators support (AND, OR, NOT)

**Acceptance Criteria:**
- [ ] Uses FTS5 MATCH for search
- [ ] Returns results with BM25 scores
- [ ] Supports exact term matching for identifiers
- [ ] Performance: <10ms typical

---

### TASK-017: RRF Fusion Algorithm
**Module:** search
**Priority:** P0
**Traces To:** FR-032
**Depends On:** TASK-015, TASK-016

**Description:**
Implement Reciprocal Rank Fusion to combine vector and BM25 results.

**Deliverables:**
- [ ] File: `mcp/memory-server/src/search/rrf.ts`
  - rrfFusion(vectorResults, bm25Results, k): FusedResult[]
  - Configurable k parameter (default 60)
  - Weighted fusion support

**Acceptance Criteria:**
- [ ] Implements RRF formula: score(d) = SUM 1/(k + rank_i(d))
- [ ] Combines vector and BM25 rankings correctly
- [ ] Configurable weights (default 0.5/0.5)

---

### TASK-018: Hybrid Search Orchestration
**Module:** search
**Priority:** P0
**Traces To:** FR-030, FR-031, FR-032, US-018
**Depends On:** TASK-017

**Description:**
Implement hybrid search facade that orchestrates vector, BM25, and RRF.

**Deliverables:**
- [ ] File: `mcp/memory-server/src/search/index.ts`
  - hybridSearch(query, projectId, options): SearchResponse
  - Parallel vector and BM25 execution
  - Search statistics collection

**Acceptance Criteria:**
- [ ] Executes vector and BM25 in parallel
- [ ] Fuses results using RRF
- [ ] Returns SearchResponse with searchStats
- [ ] Total latency <50ms for 1000 memories (NFR-001)

---

### TASK-019: MCP Server Core Setup
**Module:** tools
**Priority:** P0
**Traces To:** MCP-001, US-003
**Depends On:** TASK-003

**Description:**
Set up MCP server using @modelcontextprotocol/sdk with stdio transport.

**Deliverables:**
- [ ] File: `mcp/memory-server/src/index.ts`
  - MCP Server initialization
  - stdio transport configuration
  - Tool registration framework
  - Error handling per MCP spec

**Acceptance Criteria:**
- [ ] JSON-RPC 2.0 message handling works
- [ ] stdio transport functional
- [ ] Tool schemas validated
- [ ] Errors return proper MCP error format

---

### TASK-020: memory_store Tool
**Module:** tools
**Priority:** P0
**Traces To:** FR-010, MCP-002, US-006
**Depends On:** TASK-019, TASK-006, TASK-013

**Description:**
Implement memory_store MCP tool for storing memories with embeddings.

**Deliverables:**
- [ ] File: `mcp/memory-server/src/tools/memory_store.ts`
  - Input schema (content, type, source, confidence)
  - Content hash calculation for deduplication
  - Embedding generation
  - Storage with project isolation

**Acceptance Criteria:**
- [ ] Accepts content and optional type
- [ ] Generates embedding automatically
- [ ] Deduplicates by content hash
- [ ] Returns memory ID and confirmation

---

### TASK-021: memory_recall Tool
**Module:** tools
**Priority:** P0
**Traces To:** FR-011, MCP-002, US-008, US-009
**Depends On:** TASK-019, TASK-018

**Description:**
Implement memory_recall MCP tool for hybrid search retrieval.

**Deliverables:**
- [ ] File: `mcp/memory-server/src/tools/memory_recall.ts`
  - Input schema (query, limit, type, minConfidence)
  - Hybrid search invocation
  - Result formatting with citations
  - Access stats update

**Acceptance Criteria:**
- [ ] Accepts natural language query
- [ ] Returns memories with relevance scores
- [ ] Includes citations and confidence
- [ ] Updates access_count and accessed_at

---

### TASK-022: memory_forget Tool
**Module:** tools
**Priority:** P0
**Traces To:** FR-012, MCP-002, US-010
**Depends On:** TASK-019, TASK-006

**Description:**
Implement memory_forget MCP tool for soft-deleting memories.

**Deliverables:**
- [ ] File: `mcp/memory-server/src/tools/memory_forget.ts`
  - Input schema (id or query, reason)
  - Soft delete implementation
  - Provenance tracking

**Acceptance Criteria:**
- [ ] Soft deletes by ID or matching query
- [ ] Records deletion reason
- [ ] Excludes from future searches
- [ ] Maintains for audit/recovery

---

### TASK-023: Session State Serialization
**Module:** session
**Priority:** P0
**Traces To:** FR-070, FR-071
**Depends On:** TASK-005

**Description:**
Implement session state serialization and deserialization.

**Deliverables:**
- [ ] File: `mcp/memory-server/src/session/state.ts`
  - serializeSession(session): Buffer
  - deserializeSession(buffer): Session
  - Session interface with working memory, core memory, summary

**Acceptance Criteria:**
- [ ] Serializes working memory contents
- [ ] Serializes core memory blocks
- [ ] Preserves conversation summary
- [ ] Efficient binary format (BLOB)

---

### TASK-024: session_save Tool
**Module:** session
**Priority:** P0
**Traces To:** FR-070, MCP-002, US-031
**Depends On:** TASK-019, TASK-023

**Description:**
Implement session_save MCP tool for persisting session state.

**Deliverables:**
- [ ] File: `mcp/memory-server/src/tools/session_save.ts`
  - Input schema (summary, taskContext)
  - Session serialization
  - Storage in sessions table

**Acceptance Criteria:**
- [ ] Persists working memory
- [ ] Persists core memory blocks
- [ ] Includes conversation summary
- [ ] Timestamps session creation

---

### TASK-025: session_restore Tool
**Module:** session
**Priority:** P0
**Traces To:** FR-071, MCP-002, US-032
**Depends On:** TASK-019, TASK-023

**Description:**
Implement session_restore MCP tool for loading previous session state.

**Deliverables:**
- [ ] File: `mcp/memory-server/src/tools/session_restore.ts`
  - Input schema (sessionId - optional, defaults to latest)
  - Session deserialization
  - Context injection

**Acceptance Criteria:**
- [ ] Loads session by ID or latest
- [ ] Restores working memory
- [ ] Restores core memory blocks
- [ ] Returns summary for context injection

---

### TASK-026: Project Identification
**Module:** storage
**Priority:** P0
**Traces To:** FR-080, FR-081, US-034
**Depends On:** TASK-004

**Description:**
Implement project identification using git root hash.

**Deliverables:**
- [ ] File: `mcp/memory-server/src/storage/project.ts`
  - getProjectId(cwd): string
  - findGitRoot(path): string | null
  - Hash calculation (SHA256 truncated to 16 chars)
  - Database path resolution per project

**Acceptance Criteria:**
- [ ] Detects git root correctly
- [ ] Falls back to CLAUDE.md location
- [ ] Creates unique project hash
- [ ] Separate database per project at ~/.claude-memory/<hash>/

---

### TASK-027: Core Memory Blocks (MemGPT-style)
**Module:** storage
**Priority:** P0
**Traces To:** FR-021, US-013
**Depends On:** TASK-005

**Description:**
Implement MemGPT-style core memory blocks (persona, human, goals, project).

**Deliverables:**
- [ ] File: `mcp/memory-server/src/storage/core_memory.ts`
  - getCoreMemory(projectId): CoreMemory
  - updateBlock(projectId, block, content, source): void
  - Block validation (persona, human, goals, project)

**Acceptance Criteria:**
- [ ] Four blocks per project: persona, human, goals, project
- [ ] Tracks source (claude.md, user, claude)
- [ ] Persists across sessions
- [ ] Updates timestamp on modification

---

### TASK-028: SKILL.md Memory Skill
**Module:** skill
**Priority:** P0
**Traces To:** SK-001, US-002
**Depends On:** None

**Description:**
Create the SKILL.md file that teaches Claude memory patterns.

**Deliverables:**
- [ ] File: `skills/memory/SKILL.md`
  - When to store (decisions, errors, patterns, preferences)
  - How to query (effective search formulation)
  - Context engineering (when to compact, budget awareness)
  - Memory type selection guidance
  - Project isolation awareness
  - Must stay under 2000 tokens

**Acceptance Criteria:**
- [ ] Covers when to store (decisions, errors, patterns)
- [ ] Teaches query formulation
- [ ] Explains memory types (fact, pattern, decision, error)
- [ ] Token count under 2000
- [ ] Progressive disclosure structure

---

## P1 Tasks (Should Have - Important Features)

### TASK-029: Model Validation
**Module:** embeddings
**Priority:** P1
**Traces To:** FR-047, US-053
**Depends On:** TASK-011

**Description:**
Implement validation of embedding model configuration.

**Deliverables:**
- [ ] File: `mcp/memory-server/src/embeddings/validation.ts`
  - validateModel(provider, modelId): ValidationResult
  - Test embedding generation with sample text
  - Dimension detection from response

**Acceptance Criteria:**
- [ ] Generates test embedding for sample text
- [ ] Verifies response contains valid vector
- [ ] Detects and stores dimension count
- [ ] Reports validation success/failure with suggestions

---

### TASK-030: Model Selection Interface
**Module:** embeddings
**Priority:** P1
**Traces To:** FR-046, US-052
**Depends On:** TASK-012, TASK-029

**Description:**
Implement interface for embedding model selection and configuration.

**Deliverables:**
- [ ] File: `mcp/memory-server/src/embeddings/config.ts`
  - listAvailableModels(): ModelInfo[]
  - selectModel(modelId): void
  - Re-embedding warning and estimate
  - Configuration persistence to config.json

**Acceptance Criteria:**
- [ ] Lists detected providers and status
- [ ] Lists available models from active provider
- [ ] Warns about re-embedding on model change
- [ ] Persists selection to ~/.claude-memory/config.json

---

### TASK-031: Search Re-ranking
**Module:** search
**Priority:** P1
**Traces To:** FR-033, US-019
**Depends On:** TASK-018

**Description:**
Implement re-ranking of search results by additional factors.

**Deliverables:**
- [ ] File: `mcp/memory-server/src/search/rerank.ts`
  - rerankResults(results, options): RankedResult[]
  - Type-aware recency decay
  - Confidence boosting
  - Access frequency boosting

**Acceptance Criteria:**
- [ ] ERROR memories have strong recency decay
- [ ] FACT memories have weak/no recency decay
- [ ] High confidence boosted
- [ ] Frequently accessed memories boosted

---

### TASK-032: Entity Management
**Module:** graph
**Priority:** P1
**Traces To:** FR-050, US-024
**Depends On:** TASK-005

**Description:**
Implement knowledge graph entity management.

**Deliverables:**
- [ ] File: `mcp/memory-server/src/graph/entities.ts`
  - createEntity(entity): Entity
  - findEntityByName(name, projectId): Entity | null
  - updateEntity(id, properties): void
  - Bi-temporal support (valid_from, valid_to)

**Acceptance Criteria:**
- [ ] Supports entity types: file, function, type, decision, error
- [ ] Creates entities with bi-temporal timestamps
- [ ] Tracks entity properties as JSON
- [ ] Project isolation enforced

---

### TASK-033: Relationship Management
**Module:** graph
**Priority:** P1
**Traces To:** FR-051
**Depends On:** TASK-032

**Description:**
Implement knowledge graph relationship management.

**Deliverables:**
- [ ] File: `mcp/memory-server/src/graph/relations.ts`
  - createRelation(source, target, type, properties): Relation
  - findRelations(entityId, direction): Relation[]
  - Relationship types from FR-051

**Acceptance Criteria:**
- [ ] Supports relation types: implements, depends_on, calls, etc.
- [ ] Bi-temporal validity tracking
- [ ] Bidirectional query support

---

### TASK-034: graph_query Tool
**Module:** graph
**Priority:** P1
**Traces To:** FR-053, MCP-002, US-026
**Depends On:** TASK-033

**Description:**
Implement graph_query MCP tool for knowledge graph queries.

**Deliverables:**
- [ ] File: `mcp/memory-server/src/tools/graph_query.ts`
  - find_connected(entity, depth) operation
  - shortest_path(from, to) operation
  - get_subgraph(entity, radius) operation

**Acceptance Criteria:**
- [ ] Finds connected entities with depth limit
- [ ] Computes shortest path between entities
- [ ] Extracts subgraph around entity
- [ ] Respects bi-temporal constraints

---

### TASK-035: Session Hooks Configuration
**Module:** hooks
**Priority:** P1
**Traces To:** HK-001, HK-005, US-031, US-032
**Depends On:** TASK-024, TASK-025

**Description:**
Configure session lifecycle hooks for auto-save and auto-restore.

**Deliverables:**
- [ ] File: `hooks/settings.json` - Hook configurations
- [ ] Script: `hooks/session-restore.sh` - Session restore command
- [ ] Script: `hooks/session-save.sh` - Session save command

**Acceptance Criteria:**
- [ ] PreToolUse hook triggers session restore on SessionStart
- [ ] SessionEnd hook triggers session save
- [ ] Commands invoke correct MCP tools

---

### TASK-036: Project Switch Hook
**Module:** hooks
**Priority:** P1
**Traces To:** HK-006, US-035
**Depends On:** TASK-026

**Description:**
Configure project switch hook for automatic database switching.

**Deliverables:**
- [ ] Script: `hooks/project-switch.sh` - Project switch command
- [ ] Hook configuration in settings.json

**Acceptance Criteria:**
- [ ] Detects working directory change
- [ ] Saves current project session
- [ ] Loads new project database
- [ ] Restores new project core memory

---

### TASK-037: compact.sh Script
**Module:** skill
**Priority:** P1
**Traces To:** SK-002, FR-060, US-027
**Depends On:** TASK-028

**Description:**
Create context compaction script for the skill layer.

**Deliverables:**
- [ ] File: `skills/memory/scripts/compact.sh`
  - Summarizes conversation history
  - Extracts key decisions
  - Stores decisions to archival memory
  - Returns summary text

**Acceptance Criteria:**
- [ ] Executable shell script
- [ ] Integrates with memory_store for decisions
- [ ] Returns summarized context
- [ ] Preserves essential items

---

### TASK-038: Plugin Manifest & Installation
**Module:** core
**Priority:** P1
**Traces To:** PL-001, PL-002, US-041, US-042
**Depends On:** TASK-001, TASK-028

**Description:**
Create plugin manifest and installation script.

**Deliverables:**
- [ ] File: `.claude-plugin/manifest.json` - Plugin metadata
- [ ] File: `install.sh` - Installation script
  - Copy skill to ~/.claude/skills/memory/
  - Configure MCP server in ~/.claude/settings.json
  - Merge hooks into settings
  - Pull Ollama model if needed

**Acceptance Criteria:**
- [ ] manifest.json follows plugin format from SRS
- [ ] Single-command installation works
- [ ] All components configured correctly
- [ ] Ollama model pulled if not present

---

## Implementation Notes

### Module Dependencies Graph

```
core (TASK-001, TASK-002, TASK-003)
    |
    v
storage (TASK-004, TASK-005, TASK-006, TASK-007, TASK-026, TASK-027)
    |
    +---> embeddings (TASK-008 to TASK-014)
    |         |
    |         v
    +---> search (TASK-015 to TASK-018)
              |
              v
          tools (TASK-019 to TASK-025)
              |
              +---> session (TASK-023 to TASK-025)
              |
              +---> graph (TASK-032 to TASK-034) [P1]
              |
              v
          skill (TASK-028, TASK-037)
              |
              v
          hooks (TASK-035, TASK-036) [P1]
              |
              v
          install (TASK-038) [P1]
```

### Recommended Implementation Order

**Phase A: Foundation (TASK-001 to TASK-007)**
1. TASK-001: Project Setup
2. TASK-002: TypeScript Config
3. TASK-003: Core Types
4. TASK-004: SQLite Connection
5. TASK-005: Schema & Migrations
6. TASK-006: Memory Repository
7. TASK-007: FTS5 Setup

**Phase B: Embeddings (TASK-008 to TASK-014)**
1. TASK-008: Provider Interface
2. TASK-009: Ollama Provider
3. TASK-010: LM Studio Provider
4. TASK-011: Auto-Detection
5. TASK-012: Model Discovery
6. TASK-013: Embedding Cache
7. TASK-014: Graceful Degradation

**Phase C: Search (TASK-015 to TASK-018)**
1. TASK-015: Vector Search
2. TASK-016: BM25 Search
3. TASK-017: RRF Fusion
4. TASK-018: Hybrid Search

**Phase D: MCP Tools (TASK-019 to TASK-027)**
1. TASK-019: MCP Server Core
2. TASK-020: memory_store
3. TASK-021: memory_recall
4. TASK-022: memory_forget
5. TASK-023: Session Serialization
6. TASK-024: session_save
7. TASK-025: session_restore
8. TASK-026: Project Identification
9. TASK-027: Core Memory Blocks

**Phase E: Skill Layer (TASK-028)**
1. TASK-028: SKILL.md

**Phase F: P1 Features (TASK-029 to TASK-038)**
1. TASK-029 to TASK-034: Graph & Reranking
2. TASK-035 to TASK-037: Hooks & Scripts
3. TASK-038: Plugin Installation

### Testing Strategy

Each task should include:
- Unit tests for isolated functions
- Integration tests for module interactions
- Mock providers for embedding tests
- In-memory SQLite for fast tests

### Performance Targets (from NFR)

| Metric | Target | Task |
|--------|--------|------|
| Search latency | <50ms (1000 memories) | TASK-018 |
| Embedding latency | <200ms | TASK-009, TASK-010 |
| Session restore | <1 second | TASK-025 |
| Memory footprint | <512MB RAM | All |

---

## Traceability Summary

### P0 Requirements Coverage

| Requirement | Tasks |
|-------------|-------|
| MCP-001 | TASK-019 |
| MCP-002 | TASK-020, TASK-021, TASK-022, TASK-024, TASK-025 |
| FR-010 | TASK-003, TASK-006, TASK-020 |
| FR-011 | TASK-003, TASK-006, TASK-021 |
| FR-012 | TASK-003, TASK-006, TASK-022 |
| FR-021 | TASK-027 |
| FR-030 | TASK-015, TASK-018 |
| FR-031 | TASK-007, TASK-016, TASK-018 |
| FR-032 | TASK-017, TASK-018 |
| FR-040 | TASK-008 |
| FR-041 | TASK-009, TASK-010 |
| FR-042 | TASK-013 |
| FR-043 | TASK-014 |
| FR-044 | TASK-011 |
| FR-045 | TASK-012 |
| FR-070 | TASK-023, TASK-024 |
| FR-071 | TASK-023, TASK-025 |
| FR-080 | TASK-026 |
| FR-081 | TASK-026 |
| FR-090 | TASK-004, TASK-005 |
| FR-091 | TASK-005 |
| SK-001 | TASK-028 |

### P1 Requirements Coverage

| Requirement | Tasks |
|-------------|-------|
| FR-033 | TASK-031 |
| FR-046 | TASK-030 |
| FR-047 | TASK-029 |
| FR-050 | TASK-032 |
| FR-051 | TASK-033 |
| FR-053 | TASK-034 |
| FR-060 | TASK-037 |
| HK-001 | TASK-035 |
| HK-005 | TASK-035 |
| HK-006 | TASK-036 |
| SK-002 | TASK-037 |
| PL-001 | TASK-038 |
| PL-002 | TASK-038 |
