# bpm-memory-mcp

LLM-agnostic cross-session memory MCP. Agents store decisions, constraints, patterns, and bug root causes — future sessions restore them. Works with Claude Code, OpenCode, or any MCP client.

## The 3-call workflow

```
session_restore()                                    # session start — load prior context
memory_store({ content, type, confidence, citation }) # when you discover something worth keeping
session_save({ summary: "..." })                     # session end — persist what happened
```

## All 19 tools

| Tool | Purpose |
|------|---------|
| `session_restore` | Load prior memories for the current project |
| `session_save` | Persist a session summary |
| `memory_store` | Store a memory (fact, decision, pattern, error, preference) |
| `memory_recall` | Hybrid search — vector + BM25 + link traversal |
| `memory_feedback` | Rate a recalled memory (helpful / wrong / outdated / duplicate) to tune future results |
| `memory_forget` | Soft-delete a memory, with a reason |
| `memory_update` | Update an existing memory (creates a new version in its supersession chain) |
| `memory_history` | Show the version history of a memory, newest first |
| `memory_link` | Link related memories and run graph queries (contradictions, chains, clusters, entities) |
| `memory_consolidate` | Merge duplicates, decay unused memories, summarize clusters |
| `memory_context_assemble` | Assemble relevant context for a prompt |
| `memory_auto_extract` | Auto-extract memories from conversation text |
| `memory_reembed` | Re-generate embeddings with the current embedding model |
| `memory_migrate` | Move or copy a memory between scopes/projects |
| `memory_list_projects` | List projects that have memory databases, with sizes and counts |
| `fact_store` | Store a structured fact with source tracking |
| `fact_query` | Query the fact store |
| `goal_anchor` | Anchor a goal to be injected at context boundaries |
| `checkpoint_task` | Checkpoint task progress for resume |

## Memory types

| Type | Use for |
|------|---------|
| `decision` | Architectural choices — why X was chosen over Y |
| `fact` | Static truths — constraints, versions, env details |
| `pattern` | Recurring code patterns in this project |
| `error` | Bugs and their root causes |
| `preference` | User/team preferences |

## Search

Hybrid search with Reciprocal Rank Fusion (k=60): **vector (35%) + BM25 (35%) + link traversal (30%)** when linked memories are found, otherwise vector + BM25 at 50/50. A volatility-scaled staleness penalty is applied to the fused score.

**BM25 keyword search works with no embedding setup at all.** Vector search is optional: without an embedder, memories are stored without vectors and recall is keyword-only. The server re-probes the embedder (at most every 30 s), so starting one later turns vector recall on without a restart.

### Embedding setup

The server reads its embedder from `~/.claude-memory/config.json`. With no config file it uses **Ollama** at `http://localhost:11434` with `nomic-embed-text` (768 dimensions).

**Default: Ollama (free, local)**
1. Install [Ollama](https://ollama.com) and run `ollama pull nomic-embed-text`
2. No config needed

**LM Studio, another model, or a remote server** — create `~/.claude-memory/config.json`:
```json
{
  "embedding": {
    "provider": "lmstudio",
    "endpoint": "http://localhost:1234",
    "model": "text-embedding-nomic-embed-text-v1.5",
    "dimensions": 768
  },
  "version": 1
}
```
`provider` is `ollama` or `lmstudio`. `endpoint` is the server root — the client appends `/v1/embeddings` (LM Studio) or `/api/embeddings` (Ollama) itself, so a remote host such as `http://192.168.1.x:1234` works too. No API key is sent, so hosted APIs that require one (e.g. OpenAI) are not supported.

> **Provider-sticky:** Changing the embedding model requires re-embedding stored memories. Run `memory_reembed()` after switching models.

### Environment variables

| Variable | Default | Purpose |
|----------|---------|---------|
| `CLAUDE_PROJECT_ROOT` | `cwd` | Project whose memory database is used |
| `MEMORY_AGENT_ID` | _(unset)_ | Default writer/reader agent id for fleet-scoped memories |
| `MEMORY_TEAM_ID` | _(unset)_ | Default writer/reader team id for `team`-visibility memories |
| `CLAUDE_MEMORY_SLEEP_CONSOLIDATION` | `false` | Set to `true` to run consolidation automatically on `session_save` |
| `CLAUDE_MEMORY_CONSOLIDATION_INTERVAL_HOURS` | `24` | Minimum hours between automatic consolidation runs per project |
| `CLAUDE_MEMORY_CONSOLIDATION_LOG_PATH` | `~/.claude-memory/logs/consolidation.log` | Consolidation run log |

Memory databases live under `~/.claude-memory/<project-id>/memory.db`, where `<project-id>` is the first 16 hex characters of the SHA-256 of the project root path.

## Schema v13

- Semantic deduplication at store time
- Freshness burst (recent memories rank higher)
- Fact decay (confidence degrades on stale entries)
- Link traversal for relationship-aware recall
- Sleep-time consolidation run tracking (v10)
- Temporal validity + volatility fields, used for staleness-scaled recall (v11)
- Quarantine scope + promotion for web-derived facts (v12)
- Fleet scopes: `agent_local` / `team` / `global` / `restricted` visibility (v13)
- 417 tests

## CLI

`npm run build` also produces `memory-cli` (`node mcp/memory-server/dist/cli.js`): `list`, `search`, `delete`, `export`, `import`, `snapshot`, `stats`, `consolidate`, `projects`. Run `memory-cli help` for options.

## Install

Handled automatically by the `install.sh` of [`attest-claude`](https://github.com/bpmforge/attest-claude) (Claude Code; installed by default, skip with `--no-memory`) or [`attest`](https://github.com/bpmforge/attest) (OpenCode; opt in with `--memory`).

**Manual:**
```bash
git clone https://github.com/bpmforge/bpm-memory-mcp.git ~/Code/bpm-memory-mcp
cd ~/Code/bpm-memory-mcp && npm ci && npm run build

# Claude Code
claude mcp add memory node ~/Code/bpm-memory-mcp/mcp/memory-server/dist/index.js

# OpenCode — add to opencode.json under "mcp":
# "memory": { "type": "local", "command": ["node", "~/Code/bpm-memory-mcp/mcp/memory-server/dist/index.js"], "enabled": true }
```

## Full protocol

See `agents/shared/MEMORY_PRIMER.md` in [attest-claude](https://github.com/bpmforge/attest-claude/blob/main/agents/shared/MEMORY_PRIMER.md) or [attest](https://github.com/bpmforge/attest/blob/main/agents/shared/MEMORY_PRIMER.md).

## Requirements

- Node 22+ (enforced by `.npmrc` `engine-strict`)

## License

MIT. See [LICENSE](LICENSE).
