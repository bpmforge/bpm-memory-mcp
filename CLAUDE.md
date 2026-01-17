# Project: claude-memory

## Description
A hybrid Claude Code plugin providing persistent intelligent memory through the optimal combination of Skills, MCP Server, and Hooks. Features local embeddings (Ollama), hybrid search (vector + BM25 with RRF fusion), knowledge graph with temporal awareness, and context compression. Achieves 75% lower token overhead than pure MCP solutions while maintaining full computational capability.

## SDLC State
- Current Phase: 2 (Requirements)
- Phases Completed: [0, 1]
- Last Updated: 2026-01-16

## Phase Approvals
| Phase | Status | Approved By | Date |
|-------|--------|-------------|------|
| 0 | Approved | @user | 2026-01-16 |
| 1 | Approved | @user | 2026-01-16 |
| 2 | Pending | - | - |
| 3 | Pending | - | - |
| 4 | Pending | - | - |

## Key Decisions
- **Architecture**: Hybrid Plugin (Skill + MCP + Hooks) for 75% lower token overhead
- **Skill Layer**: SKILL.md teaches Claude when/how to use memory (~2000 tokens)
- **MCP Server**: 6 focused tools (memory_store, memory_recall, memory_forget, session_save, session_restore, graph_query)
- **Hooks Layer**: Deterministic automation (session restore/save, project switch, error capture)
- **Embeddings**: Local-first (Ollama with nomic-embed-text-v2-moe)
- **Storage**: SQLite with BLOB for vectors, FTS5 for BM25
- **Search**: Hybrid (Vector + BM25 with RRF fusion, k=60)
- **Memory Types**: Working (20%), Core/MemGPT-style (15%), Archival (25%), Task (40%)
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
- Exceed 6 MCP tools (keep token overhead low)

### DO
- Follow MCP SDK conventions exactly
- Use SQLite for all persistence (simple, portable)
- Implement hybrid search from day one
- Test with real Claude Code sessions
- Keep skill under 2000 tokens when fully loaded
- Use hooks for deterministic automation

## Architecture Overview
```
claude-memory/
├── .claude-plugin/
│   ├── manifest.json     # Plugin metadata
│   └── marketplace.json  # Distribution info
├── skills/
│   └── memory/
│       ├── SKILL.md      # Memory skill (teaches Claude)
│       └── scripts/
│           ├── compact.sh    # Context summarization
│           └── validate.sh   # Memory validation
├── mcp/
│   └── memory-server/
│       └── src/
│           ├── index.ts      # MCP server entry
│           ├── embeddings/   # Ollama integration
│           ├── search/       # Hybrid search (Vector + BM25)
│           ├── storage/      # SQLite + FTS5
│           ├── graph/        # Knowledge graph
│           └── session/      # Session management
├── hooks/
│   └── settings.json     # Hook configurations
├── tests/
└── docs/
```
