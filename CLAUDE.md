# Project: claude-memory

## Description
An MCP (Model Context Protocol) server providing persistent intelligent memory for Claude Code sessions. Features local embeddings, hybrid search (vector + BM25), knowledge graph with temporal awareness, and context compression. Designed to dramatically reduce token usage, eliminate redundant file reads, and maintain context across sessions.

## SDLC State
- Current Phase: 0 (Ideation)
- Phases Completed: []
- Last Updated: 2026-01-16

## Phase Approvals
| Phase | Status | Approved By | Date |
|-------|--------|-------------|------|
| 0 | Pending | - | - |
| 1 | Pending | - | - |
| 2 | Pending | - | - |
| 3 | Pending | - | - |
| 4 | Pending | - | - |

## Key Decisions
- **Type**: MCP Server (Claude Code native integration)
- **Embeddings**: Local-first (LM Studio, Ollama with nomic-embed-text)
- **Storage**: SQLite with BLOB for vectors
- **Search**: Hybrid (Vector similarity + BM25 keyword with RRF fusion)
- **Memory Types**: Session (working), Archival (long-term), Knowledge Graph
- **Tech Stack**: TypeScript (MCP SDK compatibility)

## Research Sources
- GitHub Copilot Memory: 7% PR merge rate increase
- Anthropic Context Editing: 84% token reduction
- Mem0: 26% accuracy boost, 90% token reduction
- agent-forge: Context compression patterns
- opencode-llm-assist: Full RAG stack implementation

## AI Coding Guidelines

### DO NOT
- Add unnecessary abstractions
- Over-engineer embedding strategies
- Create complex caching without benchmarks

### DO
- Follow MCP SDK conventions exactly
- Use SQLite for all persistence (simple, portable)
- Implement hybrid search from day one
- Test with real Claude Code sessions

## Architecture Overview
```
claude-memory/
├── src/
│   ├── mcp/           # MCP server, tools, handlers
│   ├── memory/        # Session, archival, compressor
│   ├── knowledge/     # Graph, extractor, temporal
│   ├── embeddings/    # LM Studio, Ollama, cache
│   ├── search/        # Vector, BM25, hybrid (RRF)
│   ├── context/       # Optimizer, budget, compression
│   └── storage/       # SQLite adapter, migrations
├── tests/
└── docs/
```
