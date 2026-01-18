# Technology Stack: claude-memory

## Overview

claude-memory uses a TypeScript-based stack optimized for the Claude Code plugin ecosystem. The technology choices prioritize MCP SDK compatibility, local-first operation, minimal dependencies, and high performance for memory operations.

## Runtime Environment

| Component | Choice | Version | Rationale |
|-----------|--------|---------|-----------|
| Language | TypeScript | 5.5+ | MCP SDK requirement; type safety for complex data structures |
| Runtime | Node.js | 24.x LTS (Krypton) | Active LTS with security updates through April 2028; required for MCP |
| Package Manager | npm | 10.x | Standard for Node.js ecosystem; Claude Code compatibility |

## Data Storage

| Component | Choice | Version | Rationale |
|-----------|--------|---------|-----------|
| Database | SQLite | 3.51.2 | Zero-config, portable, crash-safe with WAL mode (TC-003) |
| SQLite Binding | better-sqlite3 | 12.6.x | Fastest synchronous SQLite for Node.js; FTS5 support |
| Full-Text Search | SQLite FTS5 | Built-in | BM25 ranking; no external dependency |
| Vector Storage | SQLite BLOB | Built-in | Embeddings stored as binary; no vector DB dependency |

## Embedding Infrastructure

| Component | Choice | Version | Rationale |
|-----------|--------|---------|-----------|
| Provider Abstraction | EmbeddingProvider interface | - | Unified API for multiple backends (FR-040) |
| Provider: Ollama | Ollama | Latest | Local-first; native API at localhost:11434 |
| Provider: LM Studio | LM Studio | Latest | Local-first; OpenAI-compatible API at localhost:1234 |
| Default Model | Auto-detected | - | First available embedding model from detected provider |

**Provider Auto-Detection (FR-044):**
```
Startup sequence:
1. Check Ollama at localhost:11434/api/tags
2. Check LM Studio at localhost:1234/v1/models
3. Use first responding provider
4. Filter models to embedding-capable (name contains "embed")
5. Select first available embedding model
6. User can override via config or /memory config command
```

**Supported Embedding Models:**
| Provider | Model Examples | Dimensions |
|----------|---------------|------------|
| Ollama | nomic-embed-text, mxbai-embed-large | 768, 1024 |
| LM Studio | text-embedding-nomic-embed-text-v1.5, text-embedding-qwen3-embedding-8b | 768, 4096 |

## Core Dependencies

| Package | Purpose | Version |
|---------|---------|---------|
| @modelcontextprotocol/sdk | MCP protocol implementation | 1.x (stable) |
| better-sqlite3 | SQLite database access | ^12.6.0 |
| zod | Schema validation (MCP SDK peer dependency) | ^3.25.0 |
| natural | BM25 tokenization and NLP utilities | ^7.0.0 |

## Development Dependencies

| Package | Purpose | Version |
|---------|---------|---------|
| typescript | Language compiler | ^5.5.0 |
| vitest | Test framework | ^2.0.0 |
| @types/better-sqlite3 | TypeScript definitions | ^7.6.13 |
| @types/node | Node.js type definitions | ^22.0.0 |
| eslint | Code linting | ^9.0.0 |
| prettier | Code formatting | ^3.4.0 |
| tsx | TypeScript execution for development | ^4.0.0 |

## Build & Test Tools

| Tool | Purpose |
|------|---------|
| tsc | TypeScript compilation |
| vitest | Unit and integration testing |
| eslint | Static code analysis |
| prettier | Code formatting |
| npm scripts | Build orchestration |

## Transport & Communication

| Component | Choice | Rationale |
|-----------|--------|-----------|
| MCP Transport | stdio | Claude Code default; simplest configuration |
| Hook Commands | Shell scripts | Cross-platform via bash/sh |
| Embedding API | HTTP localhost | Ollama (11434) or LM Studio (1234) |
| Provider Detection | HTTP health checks | Auto-detect available provider on startup |

## Directory Structure Conventions

```
claude-memory/
├── package.json           # npm configuration
├── tsconfig.json          # TypeScript configuration
├── .claude-plugin/        # Plugin manifest
├── skills/                # Skill layer (SKILL.md)
├── mcp/                   # MCP server source
│   └── memory-server/
│       └── src/
├── hooks/                 # Hook configurations
└── tests/                 # Test suites
```

## Decision Log

### Decision 1: TypeScript over JavaScript
- **Options Considered**: TypeScript, JavaScript, Rust
- **Decision**: TypeScript
- **Rationale**: MCP SDK is TypeScript-first; type safety critical for memory operations; Rust would require FFI complexity
- **Trade-offs**: Compilation step required; slightly larger bundle

### Decision 2: better-sqlite3 over sql.js
- **Options Considered**: better-sqlite3, sql.js, sqlite3 (async)
- **Decision**: better-sqlite3
- **Rationale**: Synchronous API simplifies MCP tool handlers; 10-15x faster than sql.js; native SQLite for FTS5
- **Trade-offs**: Requires native compilation; platform-specific binaries

### Decision 3: Multi-Provider Local Embeddings
- **Options Considered**: Ollama-only, LM Studio-only, OpenAI API, provider abstraction
- **Decision**: Provider abstraction with Ollama + LM Studio support
- **Rationale**:
  - Local-first (TC-002); no API costs (BC-002)
  - Users may have either Ollama or LM Studio already installed
  - Auto-detection eliminates manual configuration (FR-044)
  - Provider abstraction allows future providers without code changes
- **Trade-offs**: Slightly more complex embedding module; two API formats to support

### Decision 4: SQLite BLOB over Vector Database
- **Options Considered**: SQLite BLOB, Chroma, Qdrant, pgvector
- **Decision**: SQLite BLOB with manual cosine similarity
- **Rationale**: Zero external services (OC-001); single-file portable; 768-dim vectors fit easily
- **Trade-offs**: No ANN indexing; linear scan for vector search (acceptable for <10K memories)

### Decision 5: natural for BM25 over Custom Implementation
- **Options Considered**: natural, lunr.js, custom BM25
- **Decision**: natural
- **Rationale**: Mature NLP library; tokenization and stemming; well-tested BM25
- **Trade-offs**: Larger dependency; some unused features

### Decision 6: Vitest over Jest
- **Options Considered**: Vitest, Jest, Mocha
- **Decision**: Vitest
- **Rationale**: Native ESM support; faster execution; TypeScript-first; Vite ecosystem alignment
- **Trade-offs**: Newer ecosystem; fewer tutorials

## Version Compatibility Matrix

| Node.js | better-sqlite3 | MCP SDK | Status |
|---------|----------------|---------|--------|
| 24.x LTS | 12.6.x | 1.x | Recommended |
| 22.x LTS | 12.6.x | 1.x | Supported |
| 20.x LTS | 12.6.x | 1.x | Maintenance only |

## Security Considerations

- All dependencies from npm registry with lockfile
- No native modules except better-sqlite3 (prebuilt binaries available)
- Zod validation for all MCP tool inputs (SC-003)
- No cloud services or outbound network calls except localhost Ollama (SC-002)

## Performance Characteristics

| Operation | Target | Technology Enabler |
|-----------|--------|-------------------|
| Memory store | <200ms | SQLite WAL + async embedding |
| Memory recall | <50ms | SQLite FTS5 + BLOB vectors |
| Session restore | <1s | SQLite single-file read |
| Embedding generation | <200ms | Ollama local inference |

## Traces To Requirements

| Technology Choice | Functional Requirements | Non-Functional Requirements |
|-------------------|------------------------|----------------------------|
| TypeScript + MCP SDK | MCP-001, MCP-002 | NFR-042 |
| better-sqlite3 | FR-090, FR-091 | NFR-001, NFR-010 |
| Provider Abstraction | FR-040, FR-044, FR-045 | NFR-002, NFR-020 |
| Ollama Provider | FR-040, FR-041 | NFR-002, NFR-031 |
| LM Studio Provider | FR-040, FR-041 | NFR-002, NFR-031 |
| Model Discovery | FR-045, FR-046 | NFR-020 |
| Model Validation | FR-047 | NFR-020 |
| natural (BM25) | FR-031 | NFR-001 |
| SQLite FTS5 | FR-031 | NFR-001 |
