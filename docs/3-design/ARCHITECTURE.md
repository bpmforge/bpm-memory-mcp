# System Architecture: claude-memory

## Overview

claude-memory is a hybrid Claude Code plugin that combines three extension mechanisms to achieve 75% lower token overhead than pure MCP solutions:

1. **Skill Layer**: Teaches Claude memory patterns (~2000 tokens when active)
2. **MCP Server**: Handles computation-heavy operations (embeddings, search, storage)
3. **Hooks Layer**: Provides deterministic automation (session management, error capture)

This architecture separates concerns optimally: Skills teach behavior, MCP computes, Hooks automate.

## System Context Diagram

```mermaid
flowchart TD
    User([Developer]) --> CC[Claude Code]
    CC --> Skill[Skill Layer<br/>SKILL.md]
    CC --> MCP[MCP Server<br/>memory-server]
    CC --> Hooks[Hooks Layer<br/>settings.json]

    Skill -->|Teaches patterns| CC
    MCP -->|Tools & Resources| CC
    Hooks -->|Events| MCP

    MCP --> Provider[Provider<br/>Abstraction]
    Provider --> Ollama[Ollama<br/>:11434]
    Provider --> LMStudio[LM Studio<br/>:1234]
    MCP --> Storage[(SQLite<br/>per-project)]

    subgraph External ["Embedding Providers (Auto-Detected)"]
        Ollama
        LMStudio
    end

    subgraph Local ["Local Storage"]
        Storage
    end
```

## Component Architecture

```mermaid
flowchart TD
    subgraph Plugin ["claude-memory Plugin"]
        subgraph SkillLayer ["Skill Layer (~100-2000 tokens)"]
            SKILL[SKILL.md]
            Scripts[compact.sh<br/>validate.sh]
        end

        subgraph MCPLayer ["MCP Server Layer"]
            Server[MCP Server<br/>index.ts]

            subgraph Tools ["6 MCP Tools"]
                T1[memory_store]
                T2[memory_recall]
                T3[memory_forget]
                T4[session_save]
                T5[session_restore]
                T6[graph_query]
            end

            subgraph Modules ["Core Modules"]
                subgraph EmbedMod ["Embeddings Module"]
                    Embed[Provider<br/>Abstraction]
                    OllamaP[Ollama<br/>Provider]
                    LMStudioP[LM Studio<br/>Provider]
                    Discovery[Model<br/>Discovery]
                end
                Search[Hybrid Search<br/>Vector + BM25 + RRF]
                Store[Storage<br/>SQLite + FTS5]
                Graph[Knowledge Graph<br/>Entities + Relations]
                Session[Session Manager]
                Consolidate[Consolidation]
            end
        end

        subgraph HooksLayer ["Hooks Layer"]
            PreTool[PreToolUse Hooks]
            PostTool[PostToolUse Hooks]
            Lifecycle[Lifecycle Hooks]
        end
    end

    Server --> Tools
    Tools --> Modules
    Embed --> Search
    Search --> Store
    Graph --> Store
    Session --> Store
    Consolidate --> Store

    PreTool -->|session-restore| Session
    PostTool -->|log-change| Store
    Lifecycle -->|session-save| Session
```

## Layer Descriptions

### Skill Layer (Teaching)

**Responsibility**: Teach Claude when and how to use memory effectively

**Components:**
| Component | File | Purpose |
|-----------|------|---------|
| Memory Skill | `skills/memory/SKILL.md` | Pattern recognition for memory operations |
| Compact Script | `skills/memory/scripts/compact.sh` | Context summarization helper |
| Validate Script | `skills/memory/scripts/validate.sh` | Memory consistency checker |

**Token Efficiency:**
- Metadata: ~100 tokens (always loaded with skill directory)
- Full skill: ~2000 tokens (loaded when memory task detected)
- Progressive disclosure minimizes overhead

**Traces To:** SK-001, SK-002, SK-003

### MCP Server Layer (Computation)

**Responsibility**: Handle computation-heavy operations that cannot be done in Skills

**Components:**
| Component | Directory | Purpose |
|-----------|-----------|---------|
| Server Core | `mcp/memory-server/src/index.ts` | MCP protocol handling |
| Embeddings | `mcp/memory-server/src/embeddings/` | Multi-provider abstraction (Ollama, LM Studio) |
| Search | `mcp/memory-server/src/search/` | Hybrid Vector+BM25+RRF |
| Storage | `mcp/memory-server/src/storage/` | SQLite + FTS5 |
| Graph | `mcp/memory-server/src/graph/` | Entity/relation management |
| Session | `mcp/memory-server/src/session/` | Session state persistence |
| Consolidation | `mcp/memory-server/src/consolidation/` | Memory cleanup |

**Embeddings Module Detail:**
| File | Purpose | FR |
|------|---------|-----|
| `index.ts` | Provider abstraction & auto-detection | FR-040, FR-044 |
| `ollama.ts` | Ollama API client (native format) | FR-041 |
| `lmstudio.ts` | LM Studio client (OpenAI-compatible) | FR-041 |
| `discovery.ts` | Model discovery & filtering | FR-045 |
| `validation.ts` | Model validation on selection | FR-047 |
| `cache.ts` | Embedding cache by content hash | FR-042 |

**Tools (6 focused tools):**
| Tool | Purpose | FR |
|------|---------|-----|
| memory_store | Store with embedding + entity extraction | FR-010 |
| memory_recall | Hybrid search with citations | FR-011 |
| memory_forget | Soft-delete with provenance | FR-012 |
| session_save | Persist session state | FR-070 |
| session_restore | Load previous session | FR-071 |
| graph_query | Query entity relationships | FR-053 |

**Traces To:** MCP-001, MCP-002, MCP-003

### Hooks Layer (Automation)

**Responsibility**: Deterministic automation for critical operations

**Components:**
| Hook Type | Matcher | Action | HK |
|-----------|---------|--------|-----|
| PreToolUse | SessionStart | Auto-restore session | HK-001 |
| PreToolUse | Read(CLAUDE.md) | Sync to core memory | HK-002 |
| PreToolUse | DirectoryChange | Project switch | HK-006 |
| PostToolUse | Edit\|Write | Log file changes | HK-003 |
| PostToolUse | Bash(error) | Capture errors | HK-004 |
| SessionEnd | - | Auto-save session | HK-005 |

**Traces To:** HK-001 through HK-006

### Data Layer (Storage)

**Responsibility**: Persistent storage with project isolation

**Location:** `~/.claude-memory/<project-hash>/memory.db`

**Components:**
- SQLite database with WAL mode
- FTS5 virtual table for BM25 search
- BLOB columns for embedding vectors
- Separate database per project (FR-081)

**Traces To:** FR-090, FR-091, FR-080

## Key Workflows

### Workflow 1: Memory Store

```mermaid
sequenceDiagram
    participant U as User
    participant C as Claude Code
    participant S as Skill
    participant M as MCP Server
    participant P as Provider
    participant D as SQLite

    U->>C: "Remember: we use Zod for validation"
    C->>S: Load SKILL.md (if not loaded)
    S-->>C: Pattern: store fact
    C->>M: memory_store(content, type=fact)
    M->>P: embed(content)
    Note over P: Ollama or LM Studio<br/>(auto-detected)
    P-->>M: Vector [768-4096]
    M->>M: Extract entities (Zod, validation)
    M->>D: INSERT memories + entities
    D-->>M: memory_id
    M-->>C: {id, confirmation}
    C-->>U: "Stored: we use Zod for validation"
```

### Workflow 2: Memory Recall (Hybrid Search)

```mermaid
sequenceDiagram
    participant U as User
    participant C as Claude Code
    participant M as MCP Server
    participant P as Provider
    participant D as SQLite

    U->>C: "What validation library do we use?"
    C->>M: memory_recall(query)
    M->>P: embed(query)
    Note over P: Uses same provider<br/>as memory_store
    P-->>M: Vector [768-4096]

    par Vector Search
        M->>D: Cosine similarity (top-k)
        D-->>M: Vector results
    and BM25 Search
        M->>D: FTS5 MATCH query
        D-->>M: BM25 results
    end

    M->>M: RRF fusion (k=60)
    M->>M: Re-rank (recency, confidence)
    M-->>C: [{content, relevance, citation}]
    C-->>U: "We use Zod for validation (stored 2026-01-16)"
```

### Workflow 3: Session Restore (Hook-Driven)

```mermaid
sequenceDiagram
    participant CC as Claude Code
    participant H as Hook
    participant M as MCP Server
    participant D as SQLite

    CC->>H: SessionStart event
    H->>M: claude-memory session-restore
    M->>D: SELECT latest session
    D-->>M: {working_memory, core_memory, summary}
    M->>M: Deserialize state
    M-->>H: Session restored
    H-->>CC: Inject context summary
    Note over CC: Claude now has previous context
```

### Workflow 4: Project Switch (Hook-Driven)

```mermaid
sequenceDiagram
    participant U as User
    participant CC as Claude Code
    participant H as Hook
    participant M as MCP Server

    U->>CC: cd ~/project-b
    CC->>H: DirectoryChange event
    H->>M: claude-memory project-switch
    M->>M: Detect git root (project-b)
    M->>M: Calculate project hash
    M->>M: Save current session (project-a)
    M->>M: Switch to project-b database
    M->>M: Load project-b core memory
    M-->>H: Switched to project-b
    H-->>CC: "Switched to project-b (47 memories)"
```

### Workflow 5: Auto-Compact (Skill + Script)

```mermaid
sequenceDiagram
    participant C as Claude Code
    participant S as Skill
    participant Sc as compact.sh
    participant M as MCP Server
    participant D as SQLite

    C->>S: Context at 95% capacity
    S->>Sc: Execute compact.sh
    Sc->>Sc: Summarize conversation
    Sc->>Sc: Extract key decisions
    Sc->>M: memory_store(decisions, type=decision)
    M->>D: Store decisions
    Sc-->>S: Summary text
    S-->>C: Replace verbose context with summary
    Note over C: Context reduced to ~50%
```

### Workflow 6: Provider Auto-Detection (Startup)

```mermaid
sequenceDiagram
    participant M as MCP Server
    participant D as Discovery
    participant O as Ollama
    participant L as LM Studio
    participant C as Config

    M->>D: detectProviders()

    par Check Ollama
        D->>O: GET localhost:11434/api/tags
        O-->>D: {models: [...]} or timeout
    and Check LM Studio
        D->>L: GET localhost:1234/v1/models
        L-->>D: {data: [...]} or timeout
    end

    D->>D: Filter embedding-capable models
    D->>D: Select first available provider
    D->>C: Load saved preferences (if any)
    D-->>M: ActiveProvider + SelectedModel
    Note over M: Ready for embedding operations
```

### Workflow 7: Model Configuration (/memory config)

```mermaid
sequenceDiagram
    participant U as User
    participant C as Claude Code
    participant S as Skill
    participant M as MCP Server
    participant D as Discovery
    participant V as Validation
    participant DB as SQLite

    U->>C: /memory config
    C->>S: Load config skill
    S->>M: listProviders()
    M->>D: getAvailableProviders()
    D-->>M: [{ollama: offline}, {lmstudio: online}]
    M->>D: listModels("lmstudio")
    D-->>M: [nomic-v1.5, qwen3-8b]
    M-->>S: Provider/model list
    S-->>C: Display options
    C-->>U: "Select model [1-2]:"
    U->>C: "2"
    C->>M: selectModel("qwen3-8b")
    M->>V: validateModel("qwen3-8b")
    V->>V: Test embedding generation
    V-->>M: {valid: true, dims: 4096}
    M->>DB: Count existing memories
    DB-->>M: 47 memories
    M-->>C: Warning: re-embedding required
    C-->>U: "⚠ 47 memories need re-embedding. Proceed?"
    U->>C: "y"
    M->>M: Save config + queue re-embedding
    M-->>C: "Model changed, re-embedding in background"
```

## Module Structure

```
claude-memory/
├── .claude-plugin/
│   ├── manifest.json           # Plugin metadata (PL-001)
│   └── marketplace.json        # Distribution info (PL-003)
│
├── skills/
│   └── memory/
│       ├── SKILL.md            # Memory patterns (~2000 tokens)
│       └── scripts/
│           ├── compact.sh      # Context compaction
│           └── validate.sh     # Memory validation
│
├── mcp/
│   └── memory-server/
│       ├── package.json
│       ├── tsconfig.json
│       └── src/
│           ├── index.ts            # MCP server entry
│           ├── types.ts            # Shared types
│           ├── config.ts           # Configuration loading
│           │
│           ├── embeddings/
│           │   ├── index.ts        # Provider abstraction & auto-detection
│           │   ├── types.ts        # EmbeddingProvider interface
│           │   ├── ollama.ts       # Ollama client (native API)
│           │   ├── lmstudio.ts     # LM Studio client (OpenAI-compatible)
│           │   ├── discovery.ts    # Model discovery & filtering
│           │   ├── validation.ts   # Model validation on selection
│           │   └── cache.ts        # Embedding cache by content hash
│           │
│           ├── search/
│           │   ├── index.ts        # Search orchestration
│           │   ├── vector.ts       # Cosine similarity
│           │   ├── bm25.ts         # BM25 via FTS5
│           │   └── rrf.ts          # Reciprocal Rank Fusion
│           │
│           ├── storage/
│           │   ├── index.ts        # Storage abstraction
│           │   ├── database.ts     # SQLite connection
│           │   ├── schema.ts       # Table definitions
│           │   ├── migrations.ts   # Schema migrations
│           │   └── repository.ts   # CRUD operations
│           │
│           ├── graph/
│           │   ├── index.ts        # Graph operations
│           │   ├── entities.ts     # Entity management
│           │   ├── relations.ts    # Relationship management
│           │   └── temporal.ts     # Bi-temporal queries
│           │
│           ├── session/
│           │   ├── index.ts        # Session management
│           │   ├── state.ts        # State serialization
│           │   └── restore.ts      # Session restoration
│           │
│           ├── consolidation/
│           │   ├── index.ts        # Consolidation orchestration
│           │   ├── decay.ts        # Confidence decay
│           │   └── cleanup.ts      # Duplicate/stale removal
│           │
│           └── tools/
│               ├── memory_store.ts
│               ├── memory_recall.ts
│               ├── memory_forget.ts
│               ├── session_save.ts
│               ├── session_restore.ts
│               └── graph_query.ts
│
├── hooks/
│   └── settings.json           # Hook configurations
│
├── tests/
│   ├── unit/
│   ├── integration/
│   └── benchmark/
│
└── docs/
    └── 3-design/               # This document
```

## Design Patterns

| Pattern | Usage | Rationale |
|---------|-------|-----------|
| Repository | `storage/repository.ts` | Abstracts data access; testability |
| Strategy | `embeddings/index.ts` | Swappable embedding providers |
| Facade | `search/index.ts` | Unified search interface over vector + BM25 |
| Observer | Hooks layer | Decouple events from handlers |
| Factory | Tool handlers | Consistent tool response creation |

## Error Handling Strategy

### Layer-Specific Handling

| Layer | Error Type | Handling |
|-------|------------|----------|
| Skill | Bash errors | Scripts return exit codes; skill interprets |
| MCP | Tool errors | JSON-RPC error response with code/message |
| Hooks | Command failures | Log and continue; don't block Claude |
| Storage | SQLite errors | Transaction rollback; clear error message |
| Embeddings | Server unavailable | Graceful degradation to BM25-only |

### Error Flow

```mermaid
flowchart TD
    Error[Error Occurs] --> Type{Error Type?}

    Type -->|Embedding Server| Degrade[Degrade to BM25]
    Type -->|SQLite| Rollback[Rollback Transaction]
    Type -->|MCP Protocol| JsonRpc[JSON-RPC Error]
    Type -->|Hook| Log[Log and Continue]

    Degrade --> Warn[Warn User]
    Rollback --> Retry[Retry or Report]
    JsonRpc --> Claude[Claude Sees Error]
    Log --> Continue[Continue Operation]
```

**Traces To:** NFR-011, NFR-012, NFR-021

## Configuration Management

### Configuration Hierarchy

```mermaid
flowchart LR
    Defaults[Built-in Defaults]
    Global[~/.claude-memory/config.json]
    Project[.claude-memory.json]
    Env[Environment Variables]

    Defaults --> Global --> Project --> Env
```

### Configuration Sources

| Source | Location | Priority |
|--------|----------|----------|
| Defaults | Compiled into code | Lowest |
| Global | `~/.claude-memory/config.json` | Low |
| Project | `.claude-memory.json` | Medium |
| Environment | `CLAUDE_MEMORY_*` | Highest |

**Traces To:** FR-100, FR-101, FR-102, DC-002

## Resource Boundaries

### Memory Allocation

| Component | Budget | Notes |
|-----------|--------|-------|
| Core Memory | 15% | MemGPT-style blocks |
| Working Memory | 20% | Session-scoped volatile |
| Archival Retrieval | 25% | From SQLite on query |
| Current Task | 40% | User's active work |

**Traces To:** FR-061

### Storage Boundaries

| Resource | Limit | Rationale |
|----------|-------|-----------|
| Database per project | 100MB target | NFR-005 |
| Embedding cache | By content hash | Avoid recomputation |
| Session history | Last 10 | Reasonable recovery |

## Cross-Cutting Concerns

### Logging

- Structured JSON logs for debugging
- Configurable verbosity levels
- No sensitive data in logs (SC-001)

### Observability

- Token usage tracking per operation
- Search latency metrics
- Memory statistics (count, size, types)

**Traces To:** DC-003

### Project Isolation

- SHA256 hash of git root for project ID
- Separate SQLite database per project
- Validation at every storage operation

**Traces To:** FR-080, FR-081, FR-083

## Deployment Model

```mermaid
flowchart LR
    subgraph User Machine
        CC[Claude Code]
        Plugin[claude-memory Plugin]
        Ollama[Ollama Server]
        Storage[(~/.claude-memory/)]
    end

    CC <-->|stdio| Plugin
    Plugin -->|HTTP localhost| Ollama
    Plugin -->|File I/O| Storage
```

- Single-machine deployment
- No cloud dependencies
- Ollama runs as separate process (user-managed)
- All data stored locally

**Traces To:** TC-002, OC-001, SC-002
