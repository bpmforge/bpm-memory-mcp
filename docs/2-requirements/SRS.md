# Software Requirements Specification: claude-memory

## Document Information

| Field | Value |
|-------|-------|
| Version | 2.0 |
| Date | 2026-01-16 |
| Status | Draft |
| Author | Claude + User |

## 1. Introduction

### 1.1 Purpose

This Software Requirements Specification (SRS) defines the functional and non-functional requirements for **claude-memory**, a **hybrid Claude Code plugin** providing persistent intelligent memory through the optimal combination of Skills, MCP Server, and Hooks.

### 1.2 Scope

claude-memory provides:
- **Skill Layer**: Teaches Claude memory patterns (low token overhead)
- **MCP Server**: Handles computation-heavy operations (embeddings, search)
- **Hooks Layer**: Deterministic automation (session management, project switching)
- Hybrid search (vector + BM25 with RRF fusion)
- Knowledge graph with temporal awareness
- Context engineering (auto-compact, token budgets)
- Strong project isolation

### 1.3 Definitions

| Term | Definition |
|------|------------|
| MCP | Model Context Protocol - standard for Claude tool integration |
| Skill | Markdown file teaching Claude procedures, loaded on demand |
| Hook | Shell command executed on Claude Code events |
| RRF | Reciprocal Rank Fusion - algorithm to combine search rankings |
| BM25 | Best Match 25 - probabilistic keyword search algorithm |
| Core Memory | MemGPT-style self-editable memory blocks |
| Archival Memory | Long-term searchable fact storage |
| FTS5 | SQLite Full-Text Search version 5 |

### 1.4 References

- [MCP Specification](https://modelcontextprotocol.io)
- [Claude Code Skills Documentation](https://code.claude.com/docs/en/skills)
- [Claude Code Hooks Guide](https://code.claude.com/docs/en/hooks-guide)
- [mcp-memory-service](https://github.com/doobidoo/mcp-memory-service)
- [MemGPT Paper](https://arxiv.org/abs/2310.08560)

### 1.5 Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                    claude-memory Plugin                         │
├─────────────────────────────────────────────────────────────────┤
│  Skill Layer (~100-2000 tokens)                                 │
│  ┌─────────────────────────────────────────────────────────────┐│
│  │ SKILL.md: When to store, query formulation, context mgmt   ││
│  │ compact.sh: Context summarization script                    ││
│  │ validate.sh: Memory validation script                       ││
│  └─────────────────────────────────────────────────────────────┘│
├─────────────────────────────────────────────────────────────────┤
│  MCP Server Layer (6 focused tools)                             │
│  ┌─────────────────────────────────────────────────────────────┐│
│  │ memory_store, memory_recall, memory_forget                  ││
│  │ session_save, session_restore, graph_query                  ││
│  └─────────────────────────────────────────────────────────────┘│
├─────────────────────────────────────────────────────────────────┤
│  Hooks Layer (deterministic automation)                         │
│  ┌─────────────────────────────────────────────────────────────┐│
│  │ PreToolUse: Auto-restore sessions, sync CLAUDE.md           ││
│  │ PostToolUse: Log file changes, store errors                 ││
│  └─────────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────────┘
```

---

## 2. Functional Requirements

### 2.1 Skill Layer

#### SK-001: Memory Skill File
The system SHALL provide a SKILL.md file that teaches Claude memory patterns.

**Content:**
1. When to store (decisions, errors, patterns, preferences)
2. How to query (effective search formulation)
3. Context engineering (when to compact, budget awareness)
4. Memory type selection (fact, pattern, decision, error)
5. Project isolation awareness

**Token Efficiency:**
- Metadata: ~100 tokens (always loaded)
- Full skill: ~2,000 tokens (loaded on memory task)
- Progressive disclosure

**File:** `skills/memory/SKILL.md`

**Priority:** P0 (Must Have)
**Traces To:** US-001, US-002

---

#### SK-002: Skill Scripts
The system SHALL provide helper scripts for skill operations.

**Scripts:**
| Script | Purpose | Trigger |
|--------|---------|---------|
| `compact.sh` | Summarize context, extract facts | Skill invokes at 95% capacity |
| `validate.sh` | Validate memory consistency | Manual or scheduled |

**File:** `skills/memory/scripts/`

**Priority:** P1 (Should Have)
**Traces To:** US-027, US-028

---

#### SK-003: Skill Progressive Disclosure
The system SHALL support progressive skill loading.

**Levels:**
1. **Metadata** (~100 tokens): Always loaded with skill directory
2. **Full skill** (~2,000 tokens): Loaded when user invokes `/memory` or similar
3. **Archival retrieval**: On explicit query via MCP tool

**Priority:** P0 (Must Have)
**Traces To:** US-029

---

### 2.2 MCP Server Core

#### MCP-001: MCP Protocol Compliance
The system SHALL implement the MCP specification using the official TypeScript SDK.

**Acceptance Criteria:**
- JSON-RPC 2.0 message handling
- stdio transport support
- Tool schema validation
- Resource exposure
- Error responses per spec

**Priority:** P0 (Must Have)
**Traces To:** US-003, US-004

---

#### MCP-002: Tool Registration (Reduced Set)
The system SHALL register 6 MCP tools with Claude Code.

**Tools:**
| ID | Tool Name | Purpose |
|----|-----------|---------|
| T-001 | `memory_store` | Store with embedding + entity extraction |
| T-002 | `memory_recall` | Hybrid search with citations |
| T-003 | `memory_forget` | Soft-delete with provenance |
| T-004 | `session_save` | Persist session state |
| T-005 | `session_restore` | Load previous session |
| T-006 | `graph_query` | Query entity relationships |

**Operations Moved to Skill/Scripts:**
| Former Tool | New Location | Rationale |
|-------------|--------------|-----------|
| `context_compact` | Skill + compact.sh | Orchestration logic |
| `context_status` | Skill reads storage | Read-only operation |
| `memory_update` | Skill orchestrates store + forget | Composition |
| `session_list` | Skill reads storage | Read-only operation |
| `graph_add` | Implicit in memory_store | Entity extraction auto |
| `graph_visualize` | Skill formats output | Text formatting |
| `project_switch` | Hook on directory change | Deterministic trigger |
| `project_list` | Skill reads storage | Read-only operation |

**Priority:** P0 (Must Have)
**Traces To:** US-005, US-006, US-007

---

#### MCP-003: Resource Exposure
The system SHALL expose MCP resources for memory inspection.

**Resources:**
- `memory://stats` - Memory statistics and health
- `memory://core` - Current core memory blocks
- `memory://graph` - Knowledge graph summary

**Priority:** P1 (Should Have)
**Traces To:** US-020

---

### 2.3 Hooks Layer

#### HK-001: Session Start Hook
The system SHALL auto-restore sessions on Claude Code start.

**Configuration:**
```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "SessionStart",
        "command": "claude-memory session-restore"
      }
    ]
  }
}
```

**Behavior:**
1. Detect session start event
2. Find most recent session for current project
3. Restore working memory and core memory
4. Inject session summary to context

**Priority:** P0 (Must Have)
**Traces To:** US-031, US-032

---

#### HK-002: CLAUDE.md Sync Hook
The system SHALL sync CLAUDE.md changes to core memory.

**Configuration:**
```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Read(CLAUDE.md)",
        "command": "claude-memory sync-claudemd"
      }
    ]
  }
}
```

**Behavior:**
1. Detect CLAUDE.md read
2. Parse project identity, guidelines, architecture
3. Update core memory Persona block
4. Store key facts to archival

**Priority:** P1 (Should Have)
**Traces To:** US-013, US-014

---

#### HK-003: File Change Hook
The system SHALL log file changes to memory.

**Configuration:**
```json
{
  "hooks": {
    "PostToolUse": [
      {
        "matcher": "Edit|Write",
        "command": "claude-memory log-change \"$FILE_PATH\""
      }
    ]
  }
}
```

**Behavior:**
1. Detect Edit or Write tool completion
2. Extract changed file path
3. Store change summary as fact
4. Update knowledge graph entities

**Priority:** P1 (Should Have)
**Traces To:** US-015

---

#### HK-004: Error Capture Hook
The system SHALL capture errors for learning.

**Configuration:**
```json
{
  "hooks": {
    "PostToolUse": [
      {
        "matcher": "Bash(error)",
        "command": "claude-memory store-error \"$ERROR\""
      }
    ]
  }
}
```

**Behavior:**
1. Detect Bash tool errors
2. Extract error message and context
3. Store as ERROR memory type
4. Link to related code entities

**Priority:** P1 (Should Have)
**Traces To:** US-016

---

#### HK-005: Session End Hook
The system SHALL auto-save sessions on exit.

**Configuration:**
```json
{
  "hooks": {
    "SessionEnd": [
      {
        "command": "claude-memory session-save"
      }
    ]
  }
}
```

**Behavior:**
1. Detect session end event
2. Serialize working memory
3. Snapshot core memory
4. Generate conversation summary
5. Persist to storage

**Priority:** P0 (Must Have)
**Traces To:** US-031

---

#### HK-006: Project Switch Hook
The system SHALL switch databases on project change.

**Configuration:**
```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "DirectoryChange",
        "command": "claude-memory project-switch"
      }
    ]
  }
}
```

**Behavior:**
1. Detect working directory change
2. Identify new project (git root, CLAUDE.md)
3. Save current project state
4. Load new project database
5. Restore new project core memory

**Priority:** P0 (Must Have)
**Traces To:** US-034, US-035

---

### 2.4 Plugin Distribution

#### PL-001: Plugin Manifest
The system SHALL provide a standard plugin manifest.

**File:** `.claude-plugin/manifest.json`
```json
{
  "name": "claude-memory",
  "version": "1.0.0",
  "description": "Persistent intelligent memory for Claude Code",
  "author": "...",
  "license": "MIT",
  "components": {
    "skills": ["memory"],
    "mcp": ["memory-server"],
    "hooks": true
  },
  "dependencies": {
    "runtime": {
      "@modelcontextprotocol/sdk": "^1.0.0",
      "better-sqlite3": "^9.0.0"
    },
    "optional": {
      "ollama": "For local embeddings"
    }
  }
}
```

**Priority:** P0 (Must Have)
**Traces To:** US-041

---

#### PL-002: Single-Command Installation
The system SHALL support single-command installation.

**Commands:**
```bash
# From marketplace (future)
/plugin install claude-memory

# From repository
/plugin install github:user/claude-memory

# Manual
git clone ... && cd claude-memory && ./install.sh
```

**Install Actions:**
1. Create `~/.claude-memory/` directory
2. Copy skill to `~/.claude/skills/memory/`
3. Configure MCP server in `~/.claude/settings.json`
4. Merge hooks into settings
5. Pull Ollama model if needed

**Priority:** P0 (Must Have)
**Traces To:** US-042

---

#### PL-003: Marketplace Metadata
The system SHALL provide marketplace distribution info.

**File:** `.claude-plugin/marketplace.json`
```json
{
  "category": "productivity",
  "tags": ["memory", "context", "persistence"],
  "screenshots": [...],
  "readme": "README.md",
  "changelog": "CHANGELOG.md"
}
```

**Priority:** P2 (Nice to Have)
**Traces To:** US-043

---

### 2.5 Memory Storage

#### FR-010: Memory Store Operation
The system SHALL store memories with automatic metadata extraction.

**Input:**
```typescript
{
  content: string,      // Memory content
  type?: MemoryType,    // fact | pattern | decision | error
  source?: string,      // Source file/location
  confidence?: number   // 0.0-1.0
}
```

**Behavior:**
1. Generate embedding for content
2. Extract entities and relations
3. Calculate content hash for deduplication
4. Store with timestamp and project ID
5. Return memory ID and confirmation

**Priority:** P0 (Must Have)
**Traces To:** US-006, US-007

---

#### FR-011: Memory Recall Operation
The system SHALL retrieve memories using hybrid search.

**Input:**
```typescript
{
  query: string,        // Search query
  limit?: number,       // Max results (default 10)
  type?: MemoryType,    // Filter by type
  minConfidence?: number // Min confidence threshold
}
```

**Output:**
```typescript
{
  memories: [{
    id: string,
    content: string,
    type: MemoryType,
    confidence: number,
    citation: string,    // Source reference
    relevance: number,   // Search score
    created: timestamp,
    accessed: timestamp
  }],
  searchStats: {
    vectorMatches: number,
    bm25Matches: number,
    fusedResults: number,
    latencyMs: number
  }
}
```

**Priority:** P0 (Must Have)
**Traces To:** US-008, US-009

---

#### FR-012: Memory Forget Operation
The system SHALL soft-delete memories with provenance tracking.

**Input:**
```typescript
{
  id?: string,          // Specific memory ID
  query?: string,       // Delete matching query
  reason?: string       // Reason for deletion
}
```

**Behavior:**
1. Mark memory as deleted (soft delete)
2. Record deletion timestamp and reason
3. Exclude from future searches
4. Maintain for audit/recovery

**Priority:** P0 (Must Have)
**Traces To:** US-010

---

### 2.6 Memory Types

#### FR-020: Working Memory
The system SHALL maintain session-scoped working memory.

**Contents:**
- Current task context (buffer)
- Recent tool calls (last 10)
- Scratchpad (temporary computations)

**Behavior:**
- Auto-cleared on session end
- Token budget: 20% of context
- Volatile (not persisted)

**Priority:** P0 (Must Have)
**Traces To:** US-012

---

#### FR-021: Core Memory (MemGPT-style)
The system SHALL maintain self-editable core memory blocks.

**Blocks:**
| Block | Purpose | Editable |
|-------|---------|----------|
| Persona | Project identity (from CLAUDE.md) | Yes |
| Human | User preferences, coding style | Yes |
| Goals | Current objectives, constraints | Yes |
| Project | Key files, patterns, architecture | Yes |

**Behavior:**
- Claude can self-edit during sessions
- Persisted per project
- Token budget: 15% of context
- CLAUDE.md parsed on first access

**Priority:** P0 (Must Have)
**Traces To:** US-013, US-014

---

#### FR-022: Archival Memory
The system SHALL maintain persistent searchable archival memory.

**Contents:**
- Facts with citations (source file + line)
- Architectural decisions (ADR links)
- Learned patterns (success/failure)
- Error resolutions (problem -> solution)

**Metadata:**
- Confidence scores (0.0-1.0)
- Temporal (created, accessed, validated)
- Citation (source reference)
- Project ID (isolation)

**Priority:** P0 (Must Have)
**Traces To:** US-015, US-016

---

#### FR-023: Memory Consolidation
The system SHALL perform periodic memory consolidation.

**Operations:**
1. Decay scoring (older = lower relevance)
2. Association discovery (link related)
3. Compression (merge duplicates)
4. Archival (move cold to long-term)
5. Cleanup (remove contradicted facts)

**Triggers:**
- Session end
- 100+ memory operations
- Manual trigger via skill

**Priority:** P1 (Should Have)
**Traces To:** US-017

---

### 2.7 Hybrid Search

#### FR-030: Vector Search
The system SHALL perform embedding-based semantic search.

**Behavior:**
1. Embed query using configured provider
2. Compute cosine similarity with stored embeddings
3. Return top-k by similarity score
4. Support configurable k (default 10)

**Priority:** P0 (Must Have)
**Traces To:** US-018

---

#### FR-031: BM25 Keyword Search
The system SHALL perform BM25-based keyword search.

**Behavior:**
1. Tokenize query
2. Search FTS5 virtual table
3. Rank by BM25 score
4. Support boolean operators (AND, OR, NOT)

**Priority:** P0 (Must Have)
**Traces To:** US-018

---

#### FR-032: Reciprocal Rank Fusion
The system SHALL combine search results using RRF.

**Algorithm:**
```
score(d) = SUM 1/(k + rank_i(d))
```

**Configuration:**
- k = 60 (default, configurable)
- Vector weight: 0.5 (configurable)
- BM25 weight: 0.5 (configurable)

**Priority:** P0 (Must Have)
**Traces To:** US-018

---

#### FR-033: Search Re-ranking
The system SHALL re-rank fused results by additional factors.

**Factors:**
- Recency (recent memories boosted)
- Confidence (high confidence boosted)
- Access frequency (frequently accessed boosted)
- Project isolation (wrong project filtered)

**Priority:** P1 (Should Have)
**Traces To:** US-019

---

### 2.8 Embeddings

#### FR-040: Embedding Provider Abstraction
The system SHALL support multiple embedding providers as first-class options.

**Providers:**
| Provider | Default Endpoint | API Format | Status |
|----------|-----------------|------------|--------|
| Ollama | localhost:11434 | Ollama native | Supported |
| LM Studio | localhost:1234 | OpenAI-compatible | Supported |

**Common Interface:**
All providers implement:
- `listModels()` - Returns available embedding models
- `embed(text)` - Returns vector for text
- `health()` - Returns provider status

**Priority:** P0 (Must Have)
**Traces To:** US-021, US-050

---

#### FR-041: Embedding Generation
The system SHALL generate embeddings for memory content.

**Behavior:**
1. Connect to configured provider
2. Send content for embedding
3. Receive vector (768 or 256 dimensions)
4. Cache with content hash
5. Handle errors gracefully

**Priority:** P0 (Must Have)
**Traces To:** US-021

---

#### FR-042: Embedding Cache
The system SHALL cache embeddings to avoid recomputation.

**Behavior:**
- Store embeddings as BLOB in SQLite
- Key by content hash (SHA256)
- Invalidate on content change
- Pre-warm for CLAUDE.md, key files

**Priority:** P0 (Must Have)
**Traces To:** US-022

---

#### FR-043: Graceful Degradation
The system SHALL function without embedding server.

**Behavior:**
- Detect embedding server unavailable
- Fall back to BM25-only search
- Show clear warning to user
- Queue embeddings for later

**Priority:** P0 (Must Have)
**Traces To:** US-023

---

#### FR-044: Provider Auto-Detection
The system SHALL auto-detect available embedding providers.

**Behavior:**
1. On startup, probe known provider endpoints:
   - Ollama: `http://localhost:11434/api/tags`
   - LM Studio: `http://localhost:1234/v1/models`
2. Use first responding provider automatically
3. Cache detection result for session lifetime
4. Allow manual override via configuration

**Endpoints:**
| Provider | Health Check | Models List |
|----------|-------------|-------------|
| Ollama | GET /api/tags | GET /api/tags |
| LM Studio | GET /v1/models | GET /v1/models |

**Priority:** P0 (Must Have)
**Traces To:** US-050

---

#### FR-045: Model Discovery
The system SHALL discover available embedding models from providers.

**Behavior:**
1. Query provider's model listing endpoint
2. Filter to embedding-capable models:
   - Name contains "embed" or "embedding"
   - Or model metadata indicates embedding capability
3. Return list with model ID and dimensions (if known)
4. Support both Ollama and OpenAI-compatible (LM Studio) formats

**Ollama Response Format:**
```json
{
  "models": [
    { "name": "nomic-embed-text:v2", "size": 274000000 }
  ]
}
```

**LM Studio Response Format (OpenAI-compatible):**
```json
{
  "data": [
    { "id": "text-embedding-nomic-embed-text-v1.5", "object": "model" }
  ]
}
```

**Priority:** P0 (Must Have)
**Traces To:** US-051

---

#### FR-046: Model Selection Interface
The system SHALL provide an interface for embedding model selection.

**Behavior:**
1. Display detected providers and status
2. List available embedding models from active provider
3. Show current selection
4. Allow selection by number or name
5. Persist selection to configuration file
6. Warn if changing models requires re-embedding

**Re-embedding Warning:**
When model changes:
- Count existing memories with embeddings
- Estimate re-embedding time (memories / 10 per second)
- Require explicit confirmation
- Perform re-embedding in background

**Configuration Persistence:**
```json
{
  "embedding": {
    "provider": "lmstudio",
    "endpoint": "http://localhost:1234",
    "model": "text-embedding-qwen3-embedding-8b",
    "dimensions": 4096
  }
}
```

**Priority:** P1 (Should Have)
**Traces To:** US-052

---

#### FR-047: Model Validation
The system SHALL validate embedding model configuration.

**Behavior:**
1. On model selection, generate test embedding for sample text
2. Verify response contains valid vector
3. Detect and store dimension count
4. Report validation success/failure
5. On failure, suggest available alternatives

**Test Payload:**
```
"Test embedding for claude-memory configuration validation"
```

**Validation Checks:**
- Response received within 5 seconds
- Response contains embedding array
- Embedding has consistent dimensions
- No error in response

**Priority:** P1 (Should Have)
**Traces To:** US-053

---

### 2.9 Knowledge Graph

#### FR-050: Entity Management
The system SHALL manage knowledge graph entities.

**Entity Types:**
- File (path, type, size, hash)
- Function (name, signature, location)
- Type (name, definition, usage)
- Decision (description, rationale, date)
- Error (description, solution, context)

**Operations:**
- Create entity (implicit in memory_store)
- Update entity
- Query entities by type
- Delete entity (soft)

**Priority:** P1 (Should Have)
**Traces To:** US-024

---

#### FR-051: Relationship Management
The system SHALL manage knowledge graph relationships.

**Relationship Types:**
- `implements` (function -> interface)
- `depends_on` (file -> file)
- `satisfies` (code -> requirement)
- `calls` (function -> function)
- `contradicts` (fact -> fact)
- `supersedes` (decision -> decision)

**Priority:** P1 (Should Have)
**Traces To:** US-024

---

#### FR-052: Temporal Model
The system SHALL support bi-temporal versioning.

**Timestamps:**
- Event time: When fact was true
- Ingestion time: When we learned it
- Valid from/to for relationships

**Queries:**
- Current state (default)
- Historical state at time T
- Changes between T1 and T2

**Priority:** P2 (Nice to Have)
**Traces To:** US-025

---

#### FR-053: Graph Query Tool
The system SHALL provide graph query operations.

**Operations:**
- `find_connected(entity, depth)`: Get related entities
- `shortest_path(from, to)`: Find connection path
- `get_subgraph(entity, radius)`: Extract subgraph

**Priority:** P1 (Should Have)
**Traces To:** US-026

---

### 2.10 Context Engineering

#### FR-060: Auto-Compact
The system SHALL auto-compact context at threshold.

**Trigger:** Context window > 95% capacity

**Behavior (Skill-driven):**
1. Skill detects high usage
2. Skill invokes `compact.sh` script
3. Script summarizes conversation history
4. Key facts stored to archival memory
5. Summary replaces verbose content
6. Report compaction to user

**Priority:** P0 (Must Have)
**Traces To:** US-027, US-028

---

#### FR-061: Token Budget Management
The system SHALL enforce token budgets by category.

**Budgets:**
| Category | Budget |
|----------|--------|
| Core Memory | 15% |
| Working Memory | 20% |
| Retrieved Archival | 25% |
| Current Task | 40% |

**Behavior:**
- Track usage per category
- Priority-based eviction on overflow
- Report usage via skill status

**Priority:** P0 (Must Have)
**Traces To:** US-029

---

#### FR-062: Context Status
The system SHALL report context and memory status.

**Output (via Skill reading storage):**
```typescript
{
  tokenUsage: {
    core: number,
    working: number,
    archival: number,
    task: number,
    total: number,
    budget: number
  },
  memoryStats: {
    totalMemories: number,
    byType: Record<MemoryType, number>,
    storageBytes: number
  },
  health: {
    embeddingServer: boolean,
    database: boolean,
    lastConsolidation: timestamp
  }
}
```

**Priority:** P1 (Should Have)
**Traces To:** US-030

---

### 2.11 Session Management

#### FR-070: Session Save
The system SHALL persist full session state.

**State Includes:**
- Working memory contents
- Core memory blocks
- Conversation summary
- Active task context
- Timestamp

**Trigger:** Hook (HK-005) or MCP tool (T-004)

**Priority:** P0 (Must Have)
**Traces To:** US-031

---

#### FR-071: Session Restore
The system SHALL restore previous session state.

**Behavior:**
1. Load session by ID or latest
2. Restore working memory
3. Restore core memory blocks
4. Inject conversation summary
5. Report restoration to user

**Trigger:** Hook (HK-001) or MCP tool (T-005)

**Priority:** P0 (Must Have)
**Traces To:** US-032

---

#### FR-072: Session List
The system SHALL list available sessions (via Skill).

**Output:**
```typescript
{
  sessions: [{
    id: string,
    created: timestamp,
    resumed: timestamp | null,
    summary: string,
    taskContext: string
  }]
}
```

**Priority:** P1 (Should Have)
**Traces To:** US-033

---

### 2.12 Project Isolation

#### FR-080: Project Identification
The system SHALL identify projects uniquely.

**Methods (priority order):**
1. Git root path hash (SHA256)
2. CLAUDE.md path hash
3. Working directory hash
4. Manual override via skill

**Priority:** P0 (Must Have)
**Traces To:** US-034

---

#### FR-081: Separate Storage
The system SHALL use separate databases per project.

**Location:** `~/.claude-memory/<project-hash>/memory.db`

**Priority:** P0 (Must Have)
**Traces To:** US-034

---

#### FR-082: Project Switch
The system SHALL support automatic project switching via Hook (HK-006).

**Behavior:**
1. Save current project session
2. Load target project database
3. Restore target project core memory
4. Report switch to user

**Priority:** P0 (Must Have)
**Traces To:** US-035

---

#### FR-083: Cross-Project Validation
The system SHALL prevent cross-project contamination.

**Behavior:**
- Tag every memory with project ID
- Validate at retrieval time
- Block cross-project results
- Log violations for debugging

**Priority:** P0 (Must Have)
**Traces To:** US-036

---

### 2.13 Storage

#### FR-090: SQLite Database
The system SHALL use SQLite for all persistence.

**Features:**
- WAL mode for concurrency
- FTS5 for full-text search
- BLOB for embeddings
- Pragmas optimized for performance

**Priority:** P0 (Must Have)
**Traces To:** US-037

---

#### FR-091: Schema Migration
The system SHALL support schema migrations.

**Behavior:**
- Version tracking in database
- Automatic upgrade on start
- Rollback capability
- Data preservation

**Priority:** P1 (Should Have)
**Traces To:** US-038

---

#### FR-092: Backup and Export
The system SHALL support data backup.

**Operations:**
- Export to JSON
- Import from JSON
- Database backup (copy)
- Selective export by type

**Priority:** P2 (Nice to Have)
**Traces To:** US-039

---

### 2.14 Configuration

#### FR-100: Global Configuration
The system SHALL read global configuration.

**Location:** `~/.claude-memory/config.json`

**Priority:** P1 (Should Have)
**Traces To:** US-040

---

#### FR-101: Project Configuration
The system SHALL support project-specific overrides.

**Location:** `.claude-memory.json` in project root

**Priority:** P1 (Should Have)
**Traces To:** US-040

---

#### FR-102: Environment Variables
The system SHALL support environment variable configuration.

**Variables:**
- `CLAUDE_MEMORY_PATH`: Storage location
- `CLAUDE_MEMORY_EMBEDDING_URL`: Embedding endpoint
- `CLAUDE_MEMORY_DEBUG`: Enable debug logging

**Priority:** P1 (Should Have)
**Traces To:** US-040

---

---

## 3. Non-Functional Requirements

### 3.1 Performance

#### NFR-001: Search Latency
The system SHALL complete hybrid search in <50ms for 1000 memories.

**Measurement:** P95 latency from query to results returned

**Priority:** P0 (Must Have)

---

#### NFR-002: Embedding Latency
The system SHALL complete embedding generation in <200ms.

**Measurement:** P95 latency from content to embedding returned

**Priority:** P0 (Must Have)

---

#### NFR-003: Session Restore Time
The system SHALL restore sessions in <1 second.

**Measurement:** Time from restore request to ready state

**Priority:** P1 (Should Have)

---

#### NFR-004: Memory Footprint
The system SHALL use <512MB RAM during normal operation.

**Measurement:** Peak RSS during typical session

**Priority:** P1 (Should Have)

---

#### NFR-005: Storage Efficiency
The system SHALL use <100MB disk per project (1000 memories).

**Measurement:** Database file size

**Priority:** P1 (Should Have)

---

#### NFR-006: Token Overhead
The system SHALL consume <2000 tokens for memory operations.

**Measurement:** Token count for skill + tool call + response

**Target:** 75% lower than pure MCP (~8000 tokens)

**Priority:** P0 (Must Have)

---

### 3.2 Reliability

#### NFR-010: Data Durability
The system SHALL not lose data on crash (WAL mode).

**Measurement:** Data integrity after kill -9

**Priority:** P0 (Must Have)

---

#### NFR-011: Graceful Degradation
The system SHALL function without embedding server.

**Measurement:** BM25-only mode operational

**Priority:** P0 (Must Have)

---

#### NFR-012: Error Recovery
The system SHALL recover from transient errors.

**Behavior:**
- Retry with exponential backoff
- Queue failed operations
- Clear error messages

**Priority:** P1 (Should Have)

---

### 3.3 Usability

#### NFR-020: Zero-Config Start
The system SHALL work with zero configuration for basic usage.

**Measurement:** Single command installation and immediate functionality

**Priority:** P0 (Must Have)

---

#### NFR-021: Clear Error Messages
The system SHALL provide actionable error messages.

**Examples:**
- "Embedding server not found. Run: ollama serve"
- "Memory not found: ID abc123"

**Priority:** P1 (Should Have)

---

#### NFR-022: Documentation
The system SHALL include comprehensive documentation.

**Documents:**
- README with quick start
- Installation guide
- Skill reference
- MCP API reference
- Hooks reference
- Troubleshooting guide

**Priority:** P1 (Should Have)

---

### 3.4 Security

#### NFR-030: No Credential Storage
The system SHALL never store credential-like content.

**Patterns to filter:**
- API keys (AWS_, OPENAI_, etc.)
- Passwords, tokens
- Private keys
- .env file contents

**Priority:** P0 (Must Have)

---

#### NFR-031: Local Network Only
The system SHALL bind to localhost only.

**Priority:** P0 (Must Have)

---

#### NFR-032: Input Validation
The system SHALL validate all inputs.

**Validations:**
- String length limits
- JSON schema validation
- Path traversal prevention
- SQL injection prevention

**Priority:** P0 (Must Have)

---

### 3.5 Compatibility

#### NFR-040: Node.js Version
The system SHALL run on Node.js 18+.

**Priority:** P0 (Must Have)

---

#### NFR-041: Platform Support
The system SHALL run on macOS, Linux, and Windows.

**Priority:** P0 (Must Have)

---

#### NFR-042: MCP SDK Compatibility
The system SHALL track MCP SDK stable releases.

**Priority:** P0 (Must Have)

---

#### NFR-043: Claude Code Compatibility
The system SHALL be compatible with Claude Code hooks and skills API.

**Priority:** P0 (Must Have)

---

### 3.6 Quality

#### NFR-050: Test Coverage
The system SHALL maintain >80% code coverage.

**Priority:** P1 (Should Have)

---

#### NFR-051: Memory Accuracy
The system SHALL achieve 70%+ memory operation accuracy.

**Measurement:** LoCoMo-style benchmark

**Priority:** P0 (Must Have)

---

#### NFR-052: Token Reduction
The system SHALL achieve 80%+ token reduction vs baseline.

**Measurement:** Before/after comparison on test sessions

**Priority:** P0 (Must Have)

---

#### NFR-053: Project Isolation
The system SHALL achieve <5% cross-project errors.

**Measurement:** Cross-project contamination test

**Priority:** P0 (Must Have)

---

---

## 4. Traceability Matrix

### Functional Requirements to User Stories

| Requirement | User Stories |
|-------------|--------------|
| SK-001 | US-001, US-002 |
| SK-002 | US-027, US-028 |
| SK-003 | US-029 |
| MCP-001 | US-003, US-004 |
| MCP-002 | US-005, US-006, US-007 |
| MCP-003 | US-020 |
| HK-001 | US-031, US-032 |
| HK-002 | US-013, US-014 |
| HK-003 | US-015 |
| HK-004 | US-016 |
| HK-005 | US-031 |
| HK-006 | US-034, US-035 |
| PL-001 | US-041 |
| PL-002 | US-042 |
| PL-003 | US-043 |
| FR-010 | US-006, US-007 |
| FR-011 | US-008, US-009 |
| FR-012 | US-010 |
| FR-020 | US-012 |
| FR-021 | US-013, US-014 |
| FR-022 | US-015, US-016 |
| FR-023 | US-017 |
| FR-030, FR-031, FR-032 | US-018 |
| FR-033 | US-019 |
| FR-040, FR-041 | US-021 |
| FR-042 | US-022 |
| FR-043 | US-023 |
| FR-050, FR-051 | US-024 |
| FR-052 | US-025 |
| FR-053 | US-026 |
| FR-060 | US-027, US-028 |
| FR-061 | US-029 |
| FR-062 | US-030 |
| FR-070 | US-031 |
| FR-071 | US-032 |
| FR-072 | US-033 |
| FR-080, FR-081 | US-034 |
| FR-082 | US-035 |
| FR-083 | US-036 |
| FR-090 | US-037 |
| FR-091 | US-038 |
| FR-092 | US-039 |
| FR-100, FR-101, FR-102 | US-040 |

---

## 5. Appendix

### A. Memory Type Definitions

```typescript
enum MemoryType {
  FACT = 'fact',           // Verified information
  PATTERN = 'pattern',     // Observed code pattern
  DECISION = 'decision',   // Architectural decision
  ERROR = 'error',         // Error resolution
  PREFERENCE = 'preference' // User preference
}
```

### B. Search Response Schema

```typescript
interface SearchResponse {
  memories: Memory[];
  searchStats: {
    vectorMatches: number;
    bm25Matches: number;
    fusedResults: number;
    latencyMs: number;
  };
}

interface Memory {
  id: string;
  content: string;
  type: MemoryType;
  confidence: number;
  citation: string;
  relevance: number;
  created: Date;
  accessed: Date;
}
```

### C. Core Memory Block Schema

```typescript
interface CoreMemory {
  persona: {
    content: string;
    lastUpdated: Date;
    source: 'claude.md' | 'user' | 'claude';
  };
  human: {
    content: string;
    lastUpdated: Date;
  };
  goals: {
    content: string;
    lastUpdated: Date;
  };
  project: {
    content: string;
    lastUpdated: Date;
    keyFiles: string[];
  };
}
```

### D. Hybrid Architecture Token Comparison

| Approach | Token Cost | Capability | Notes |
|----------|------------|------------|-------|
| Pure MCP | ~8,000 | Full computation | 14 tools, schema overhead |
| Pure Skill | ~100-5,000 | Limited | Can't do embeddings |
| **Hybrid** | **~2,000** | **Full computation** | 6 tools + skill guidance |

### E. Hook Event Reference

| Event | Matcher | Use Case |
|-------|---------|----------|
| SessionStart | - | Auto-restore |
| SessionEnd | - | Auto-save |
| PreToolUse | Tool name pattern | Intercept before |
| PostToolUse | Tool name pattern | Capture after |
| DirectoryChange | - | Project switch |
