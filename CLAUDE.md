# Project: bpm-memory-mcp

(npm package name: `claude-memory`)

## Description
LLM-agnostic cross-session memory MCP server, used from Claude Code, OpenCode or any MCP client, plus a memory skill and optional hook scripts. Features local embeddings (Ollama or LM Studio), hybrid search (vector + BM25 + link traversal with RRF fusion), a knowledge graph with temporal awareness, and context compression. The Skill + MCP + Hooks split is meant to keep token overhead well below a pure-MCP design.

## SDLC State (as last recorded, 2026-01-17)
- Current Phase: 4 (Implementation)
- Phases Completed: [0, 1, 2, 3]
- Last Updated: 2026-01-17

Released since: 1.0.0 and 1.2.0 (see `CHANGELOG.md`).

## Phase Approvals
| Phase | Status | Approved By | Date |
|-------|--------|-------------|------|
| 0 | Approved | @user | 2026-01-16 |
| 1 | Approved | @user | 2026-01-16 |
| 2 | Approved | @user | 2026-01-17 |
| 3 | Approved | @user | 2026-01-17 |
| 4 | Pending | - | - |

## Key Decisions
- **Architecture**: Hybrid (Skill + MCP + Hooks) to keep token overhead low
- **Skill Layer**: `skills/memory/SKILL.md` teaches Claude when/how to use memory (~2000 tokens)
- **MCP Server**: 19 tools (listed in `README.md`): `session_restore`, `session_save`, `memory_store`, `memory_recall`, `memory_feedback`, `memory_forget`, `memory_update`, `memory_history`, `memory_link`, `memory_consolidate`, `memory_context_assemble`, `memory_auto_extract`, `memory_reembed`, `memory_migrate`, `memory_list_projects`, `fact_store`, `fact_query`, `goal_anchor`, `checkpoint_task`
- **Hooks Layer**: shell scripts in `hooks/` (session restore/save, project switch, error capture, memory extraction, goal check). Nothing in this repo registers them; wire them into Claude Code's own hooks settings if wanted
- **Embeddings**: Local-first, Ollama or LM Studio. The server reads `~/.claude-memory/config.json` and defaults to Ollama `nomic-embed-text`; the CLI auto-detects. Without an embedder, recall is BM25-only
- **Storage**: SQLite with BLOB for vectors, FTS5 for BM25; one database per project under `~/.claude-memory/<project-id>/memory.db`; schema version 13
- **Search**: Hybrid RRF fusion (k=60): vector 35% + BM25 35% + links 30% when linked memories exist, else vector + BM25 50/50, with a volatility-scaled staleness penalty
- **Memory Types**: `fact`, `pattern`, `decision`, `error`, `preference` (plus internal `goal` and `checkpoint`); sessions keep working memory and core memory
- **Tech Stack**: TypeScript (MCP SDK compatibility), Node 22+

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
- Add MCP tools without a clear need: there are already 19, and every tool definition costs tokens in each session

### DO
- Follow MCP SDK conventions exactly
- Use SQLite for all persistence (simple, portable)
- Keep hybrid search (vector + BM25) working, including the keyword-only path
- Test with real Claude Code sessions
- Keep skill under 2000 tokens when fully loaded
- Use hooks for deterministic automation

## Validation

```bash
npm ci
npm run build       # tsc -p mcp/memory-server/tsconfig.json
npm run typecheck
npm test            # vitest: 417 tests in 29 files
npm run lint        # eslint; currently reports existing errors (187 as of 2026-10-08)
```

Benchmarks are separate: `npm run bench` (and `bench:*` variants).

## Architecture Overview
```
bpm-memory-mcp/
├── skills/
│   └── memory/
│       ├── SKILL.md          # Memory skill (teaches Claude)
│       └── scripts/
│           └── compact.sh    # Context summarization
├── mcp/
│   └── memory-server/
│       └── src/
│           ├── index.ts      # MCP server entry (all 19 tools)
│           ├── cli.ts        # memory-cli
│           ├── embeddings/   # Ollama + LM Studio providers, config, cache
│           ├── search/       # Hybrid search (Vector + BM25 + links, RRF)
│           ├── storage/      # SQLite + FTS5, schema and migrations
│           ├── graph/        # Knowledge graph
│           ├── linking/      # Memory links
│           ├── consolidation/
│           ├── extraction/   # Auto-extraction
│           ├── fleet/        # Agent/team visibility scopes
│           ├── quarantine/   # Web-derived fact quarantine
│           ├── staleness/    # Volatility-scaled staleness
│           ├── goals/, checkpoint/, backup/, security/,
│           └── validation/, language/, utils/
├── hooks/                    # Hook scripts (*.sh)
├── tests/                    # unit/, integration/, e2e/, benchmarks/
└── docs/
```
