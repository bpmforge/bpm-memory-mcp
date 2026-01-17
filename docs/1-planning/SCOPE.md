# Scope: claude-memory

## Project Overview

**claude-memory** is an MCP (Model Context Protocol) server that provides persistent intelligent memory for Claude Code sessions, enabling dramatic reductions in token usage and elimination of redundant file reads.

## In Scope

### Core Memory System

1. **Session Memory**
   - Working memory for current task context
   - Scratchpad for temporary computations
   - Recent tool calls and results cache
   - Automatic cleanup on session end

2. **Archival Memory**
   - Persistent fact storage with citations
   - Architectural decisions (ADRs)
   - Learned patterns (successful/failed approaches)
   - Error resolutions and fixes
   - Vector embeddings for semantic search

3. **Core Memory (MemGPT-style)**
   - Project persona block (from CLAUDE.md)
   - User preferences block (coding style, conventions)
   - Current goals block (active task context)
   - Editable by Claude during sessions

4. **Knowledge Graph**
   - Code entities (files, functions, types, modules)
   - Relationships (implements, depends_on, satisfies, calls)
   - Temporal versioning (bi-temporal model)
   - Requirement traceability (US-XXX → FR-XXX → Code)

### Search & Retrieval

1. **Vector Search**
   - Embedding-based semantic similarity
   - Cosine similarity scoring
   - Configurable top-k retrieval
   - Support for multiple embedding models

2. **BM25 Keyword Search**
   - Term frequency-based ranking
   - Exact match capability
   - Code identifier search (function names, types)
   - Boolean query support

3. **Hybrid Search**
   - Reciprocal Rank Fusion (RRF) combining
   - Configurable vector/keyword weights
   - Re-ranking based on recency and confidence
   - Filtering by entity type, time range

### Embeddings

1. **Local Embedding Providers**
   - LM Studio integration (primary)
   - Ollama integration (fallback)
   - nomic-embed-text model (768 dimensions)
   - Batch embedding support

2. **Embedding Cache**
   - SQLite-based persistence
   - Content hash deduplication
   - Automatic invalidation on content change
   - Pre-warming for known files

### Context Optimization

1. **Compression Pipeline**
   - Deduplication of repeated content
   - Summarization of large files
   - Relevance filtering
   - Smart expansion on demand

2. **Token Budget Management**
   - Category-based allocation
   - Priority-based selection
   - Overflow handling
   - Usage tracking and reporting

### MCP Integration

1. **MCP Tools**
   - `memory_store`: Store facts, patterns, decisions
   - `memory_recall`: Retrieve relevant context
   - `memory_forget`: Remove outdated information
   - `context_optimize`: Compress current context
   - `session_save`: Persist session state
   - `session_restore`: Load previous session
   - `graph_query`: Query knowledge relationships

2. **MCP Resources**
   - Memory statistics
   - Token usage metrics
   - Knowledge graph visualization data

### Storage

1. **SQLite Database**
   - Single-file persistence
   - BLOB storage for embeddings
   - Full-text search indexes
   - Migration support

2. **Data Model**
   - Facts table (content, embedding, metadata)
   - Entities table (type, name, properties)
   - Relations table (source, target, type, temporal)
   - Sessions table (state, timestamp)

### Configuration

1. **Settings**
   - Embedding provider selection
   - Token budget limits
   - Search parameters
   - Storage location

2. **Project Integration**
   - CLAUDE.md parsing
   - .gitignore awareness
   - Project root detection

## Out of Scope

### Version 1.0

1. **Cloud Services**
   - Cloud-hosted memory service
   - Remote embedding APIs (OpenAI, Cohere)
   - Sync between devices
   - Team/shared memory

2. **Multi-User**
   - User authentication
   - Permission management
   - Shared knowledge bases
   - Collaboration features

3. **IDE Integrations**
   - VS Code extension
   - JetBrains plugin
   - Vim/Neovim plugin
   - Direct IDE integration (beyond MCP)

4. **Advanced AI**
   - Fine-tuning on project data
   - Custom model training
   - Autonomous memory curation
   - Predictive pre-fetching

5. **Complex Queries**
   - Natural language to graph query
   - Multi-hop reasoning
   - Inference over knowledge graph
   - Automated fact verification

6. **External Integrations**
   - GitHub/GitLab integration
   - Jira/Linear integration
   - Documentation site indexing
   - API documentation parsing

### Future Versions (Post 1.0)

1. **Cloud Option** (v1.1)
   - Optional cloud embedding fallback
   - Cloud sync for cross-device

2. **Team Features** (v2.0)
   - Shared project memory
   - Team knowledge base
   - Access controls

3. **IDE Extensions** (v2.0)
   - VS Code sidebar
   - Memory visualization

## Success Criteria

### Quantitative

| Metric | Target | Measurement |
|--------|--------|-------------|
| Token reduction | ≥80% | Before/after comparison |
| File re-reads | ≤20% of baseline | Tool call analysis |
| Search latency | <100ms | Performance benchmark |
| Embedding latency | <200ms | Performance benchmark |
| Storage overhead | <100MB/project | Disk usage |
| Memory accuracy | ≥95% | Citation verification |

### Qualitative

1. **Usability**
   - Single command installation
   - Zero-config for basic usage
   - Clear error messages
   - Comprehensive documentation

2. **Reliability**
   - No data loss on crash
   - Graceful degradation without embedding server
   - Consistent behavior across sessions

3. **Integration**
   - Seamless Claude Code experience
   - No workflow disruption
   - Transparent operation

## Assumptions

1. **User Environment**
   - Node.js 18+ installed
   - SQLite available (bundled)
   - Local embedding server optional but recommended
   - Sufficient disk space (100MB-1GB)

2. **Claude Code**
   - MCP support stable and documented
   - Tool interface remains consistent
   - Resource interface available

3. **Embedding Providers**
   - LM Studio or Ollama accessible locally
   - nomic-embed-text model available
   - Reasonable embedding latency (<500ms)

## Dependencies

### Runtime

| Dependency | Purpose | Version |
|------------|---------|---------|
| Node.js | Runtime | ≥18.0 |
| @modelcontextprotocol/sdk | MCP integration | Latest |
| better-sqlite3 | Database | Latest |
| natural | BM25 search | Latest |

### Development

| Dependency | Purpose | Version |
|------------|---------|---------|
| TypeScript | Language | ≥5.0 |
| Vitest | Testing | Latest |
| ESLint | Linting | Latest |
| Prettier | Formatting | Latest |

### Optional

| Dependency | Purpose | Fallback |
|------------|---------|----------|
| LM Studio | Embeddings | Ollama |
| Ollama | Embeddings | Disabled |

## Constraints Reference

See [CONSTRAINTS.md](./CONSTRAINTS.md) for detailed technical and business constraints.

## Risks Reference

See [RISKS.md](./RISKS.md) for identified risks and mitigation strategies.
