# Scope: claude-memory

## Project Overview

**claude-memory** is a comprehensive MCP (Model Context Protocol) server providing persistent intelligent memory for Claude Code sessions. It combines proven patterns from existing solutions (mcp-memory-service, MemGPT/Letta, Mem0) with novel improvements in hybrid search, context engineering, and project isolation.

**Timeline**: 24 weeks (comprehensive implementation)

## In Scope

### 1. MCP Server Core

1. **Protocol Implementation**
   - Full MCP SDK integration (TypeScript)
   - JSON-RPC 2.0 compliance
   - stdio transport (Claude Code default)
   - Tool and resource exposure
   - Error handling per MCP spec

2. **14 MCP Tools**
   | Tool | Category | Description |
   |------|----------|-------------|
   | `memory_store` | Memory | Store fact/pattern/decision with auto-extraction |
   | `memory_recall` | Memory | Hybrid search retrieval with citations |
   | `memory_forget` | Memory | Soft-delete with provenance tracking |
   | `memory_update` | Memory | Update existing memory with conflict resolution |
   | `context_compact` | Context | Trigger summarization of current context |
   | `context_status` | Context | Show token usage, memory stats, health |
   | `session_save` | Session | Persist full session state |
   | `session_restore` | Session | Load previous session |
   | `session_list` | Session | List available sessions for project |
   | `graph_query` | Graph | Query knowledge graph relationships |
   | `graph_add` | Graph | Add entity/relation to graph |
   | `graph_visualize` | Graph | Get graph data for visualization |
   | `project_switch` | Project | Switch project context (isolation) |
   | `project_list` | Project | List known projects |

3. **MCP Resources**
   - `memory://stats` - Memory statistics and health
   - `memory://core` - Current core memory blocks
   - `memory://graph` - Knowledge graph summary

### 2. Memory System

1. **Working Memory** (Session-scoped)
   - Current task context buffer
   - Recent tool calls cache (last 10)
   - Scratchpad for temporary computations
   - Auto-cleared on session end
   - Token budget: 20% of context

2. **Core Memory** (MemGPT-style, self-editable)
   - **Persona block**: Project identity from CLAUDE.md parsing
   - **Human block**: User preferences, coding style
   - **Goals block**: Current objectives, constraints
   - **Project block**: Key files, patterns, architecture
   - Claude can self-edit during sessions
   - Token budget: 15% of context
   - Persisted per project

3. **Archival Memory** (Persistent, searchable)
   - Facts with citations (source file + line number)
   - Architectural decisions (ADR links)
   - Learned patterns (successful/failed approaches)
   - Error resolutions (problem → solution)
   - Confidence scores per memory
   - Temporal metadata (created, accessed, validated)

4. **Memory Consolidation** (Dream-inspired)
   - Decay scoring (older = lower relevance)
   - Association discovery (link related memories)
   - Compression (merge duplicates/similar)
   - Archival (move cold to long-term)
   - Cleanup (remove contradicted facts)
   - Trigger: Session end or 100+ operations

### 3. Hybrid Search System

1. **Vector Search**
   - Embedding-based semantic similarity
   - Cosine similarity scoring
   - Configurable top-k (default 10)
   - Async batch embedding support

2. **BM25 Keyword Search**
   - SQLite FTS5 integration
   - Term frequency ranking
   - Exact match capability
   - Boolean query support (AND, OR, NOT)

3. **Reciprocal Rank Fusion (RRF)**
   - k=60 (empirically optimal)
   - Combine vector + BM25 rankings
   - Handle mismatched score scales
   - Configurable weights (default 0.5/0.5)

4. **Re-ranking**
   - Recency boost (recent memories score higher)
   - Confidence weighting
   - Access frequency factor
   - Project isolation filter

### 4. Embeddings System

1. **Provider Abstraction**
   - Primary: Ollama (nomic-embed-text-v2-moe)
   - Fallback: LM Studio
   - Future: OpenAI, Cohere (optional cloud)

2. **nomic-embed-text-v2-moe Configuration**
   - 768 dimensions (full) or 256 (Matryoshka compressed)
   - 8192 token context length
   - MoE architecture (305M active params)
   - Multilingual support

3. **Embedding Cache**
   - SQLite BLOB storage
   - Content hash deduplication
   - Automatic invalidation on change
   - Pre-warming for CLAUDE.md, key files

4. **Graceful Degradation**
   - BM25-only mode if no embedding server
   - Clear error messages with setup instructions
   - Retry queue for transient failures

### 5. Knowledge Graph

1. **Entity Types**
   - Files (path, type, size, hash)
   - Functions (name, signature, location)
   - Types (name, definition, usage)
   - Decisions (description, rationale, date)
   - Errors (description, solution, context)

2. **Relationship Types**
   - `implements` (function → interface)
   - `depends_on` (file → file)
   - `satisfies` (code → requirement)
   - `calls` (function → function)
   - `contradicts` (fact → fact)
   - `supersedes` (decision → decision)

3. **Temporal Model** (Bi-temporal)
   - Event time: When fact was true
   - Ingestion time: When we learned it
   - Valid from/to for relationships
   - Historical queries supported

4. **Graph Operations**
   - `find_connected`: Get related entities
   - `shortest_path`: Find connection between entities
   - `get_subgraph`: Extract relevant portion
   - `add_entity`: Create new entity
   - `add_relation`: Create new relationship

### 6. Context Engineering

1. **Auto-Compact**
   - Trigger at 95% context window capacity
   - Recursive summarization of history
   - Extract key decisions/facts to archival
   - Replace verbose content with summary
   - Preserve essential context only

2. **Token Budget Management**
   - Category-based allocation:
     - Core memory: 15%
     - Working memory: 20%
     - Retrieved archival: 25%
     - Current task: 40%
   - Overflow handling (priority-based eviction)
   - Usage tracking and reporting

3. **State Isolation**
   - Structured runtime state schema
   - Selective field exposure to LLM
   - Project-specific boundaries
   - Context tagging

4. **Masking & Filtering**
   - Hide low-relevance retrieved content
   - Filter by task stage
   - Reduce noise, improve precision
   - Configurable thresholds

### 7. Project Isolation

1. **Project Identification**
   - SHA256 hash of git root or CLAUDE.md path
   - Fallback to directory name
   - Manual override via tool

2. **Separate Databases**
   - Location: `~/.claude-memory/<project-hash>/memory.db`
   - Complete isolation per project
   - No cross-project data access

3. **Context Validation**
   - Every memory tagged with project ID
   - Cross-project retrieval blocked
   - Warning on ambiguous content
   - Audit logging

4. **Project Management**
   - `project_switch`: Change active project
   - `project_list`: List known projects
   - Project metadata (name, path, stats)

### 8. Storage System

1. **SQLite Database**
   - Single file per project
   - WAL mode for concurrency
   - FTS5 for full-text search
   - BLOB for embeddings

2. **Schema**
   ```sql
   -- Core tables
   memories (id, content, embedding, metadata, created, accessed)
   core_memory (block, content, updated)
   sessions (id, state, created, resumed)

   -- Knowledge graph
   entities (id, type, name, properties, valid_from, valid_to)
   relations (source, target, type, properties, valid_from, valid_to)

   -- Consolidation
   consolidation_log (id, action, details, timestamp)

   -- Full-text search
   memories_fts (content) -- FTS5 virtual table
   ```

3. **Migrations**
   - Versioned schema changes
   - Automatic upgrade on start
   - Rollback capability
   - Data preservation

### 9. Configuration

1. **Settings File** (`~/.claude-memory/config.json`)
   ```json
   {
     "embedding": {
       "provider": "ollama",
       "model": "nomic-embed-text:v2",
       "dimensions": 256,
       "endpoint": "http://localhost:11434"
     },
     "search": {
       "vectorWeight": 0.5,
       "bm25Weight": 0.5,
       "rrfK": 60,
       "topK": 10
     },
     "context": {
       "autoCompactThreshold": 0.95,
       "coreBudget": 0.15,
       "workingBudget": 0.20,
       "archivalBudget": 0.25
     },
     "consolidation": {
       "decayRate": 0.1,
       "triggerThreshold": 100
     }
   }
   ```

2. **Environment Variables**
   - `CLAUDE_MEMORY_PATH`: Storage location
   - `CLAUDE_MEMORY_EMBEDDING_URL`: Embedding endpoint
   - `CLAUDE_MEMORY_DEBUG`: Enable debug logging

3. **Project Overrides**
   - `.claude-memory.json` in project root
   - Overrides global settings
   - Project-specific configuration

### 10. Documentation & Testing

1. **Documentation**
   - README with quick start
   - Installation guide
   - Configuration reference
   - API documentation (all tools)
   - Architecture overview
   - Troubleshooting guide

2. **Testing**
   - Unit tests (>80% coverage)
   - Integration tests (MCP protocol)
   - Benchmark suite (LoCoMo-style)
   - Performance tests (latency, throughput)

3. **Benchmarking**
   - Memory operation accuracy test
   - Token reduction measurement
   - Project isolation validation
   - Search quality evaluation

## Out of Scope

### Version 1.0

1. **Cloud Services**
   - Cloud-hosted memory
   - Sync between devices
   - Team/shared memory
   - Cloud embedding APIs (OpenAI, Cohere)

2. **Multi-User**
   - Authentication/authorization
   - User management
   - Shared knowledge bases
   - Collaboration features

3. **IDE Integrations**
   - VS Code extension
   - JetBrains plugin
   - Direct IDE integration (beyond MCP)

4. **Advanced AI**
   - Fine-tuning on project data
   - Autonomous memory curation
   - Predictive pre-fetching
   - Natural language graph queries

5. **External Integrations**
   - GitHub/GitLab integration
   - Jira/Linear integration
   - Documentation site indexing

### Future Versions

1. **v1.1: Cloud Optional**
   - Optional cloud embedding fallback
   - Cross-device sync
   - Backup/restore to cloud

2. **v2.0: Team Features**
   - Shared project memory
   - Team knowledge base
   - Access controls
   - Admin dashboard

3. **v2.1: IDE Extensions**
   - VS Code sidebar
   - Memory visualization
   - Real-time stats

## Success Criteria

### Quantitative (Must Achieve)

| Metric | Industry Best | Target | Method |
|--------|---------------|--------|--------|
| Memory accuracy | 53% | **70%+** | LoCoMo benchmark |
| Token reduction | 88% | **80%+** | Before/after test |
| Project isolation | "occasional" errors | **<5%** | Cross-project test |
| Search latency | 5ms | **<50ms** | Performance test |
| Embedding latency | - | **<200ms** | Performance test |
| Session restore | - | **<1s** | Cold start test |

### Qualitative

1. **Usability**
   - Single command installation
   - Zero-config for basic usage
   - Clear error messages
   - Comprehensive documentation

2. **Reliability**
   - No data loss on crash (WAL mode)
   - Graceful degradation without embedding server
   - Consistent cross-session behavior

3. **Performance**
   - Memory usage <512MB
   - Storage <100MB per project
   - Responsive under load

## Dependencies

### Runtime (Required)

| Package | Purpose | Version |
|---------|---------|---------|
| `@modelcontextprotocol/sdk` | MCP integration | Latest |
| `better-sqlite3` | Database | Latest |
| `natural` | BM25/NLP | Latest |

### Runtime (Optional)

| Package | Purpose | Fallback |
|---------|---------|----------|
| Ollama | Embeddings | LM Studio |
| LM Studio | Embeddings | BM25-only mode |

### Development

| Package | Purpose |
|---------|---------|
| TypeScript 5+ | Language |
| Vitest | Testing |
| ESLint + Prettier | Code quality |
| tsx | Development runner |

## Milestones

| Phase | Weeks | Deliverables |
|-------|-------|--------------|
| 1. Foundation | 1-4 | MCP server, SQLite, Ollama, basic tools |
| 2. Hybrid Search | 5-8 | Vector, BM25, RRF, benchmarks |
| 3. Memory System | 9-12 | Core/archival memory, sessions, consolidation |
| 4. Knowledge Graph | 13-16 | Entities, relations, temporal, graph tools |
| 5. Context Engineering | 17-20 | Auto-compact, budgets, isolation |
| 6. Polish | 21-24 | Optimization, benchmarks, docs, release |

## Risks Reference

See [RISKS.md](./RISKS.md) for comprehensive risk analysis.

## Constraints Reference

See [CONSTRAINTS.md](./CONSTRAINTS.md) for technical and business constraints.
