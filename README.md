# bpm-memory-mcp

LLM-agnostic cross-session memory MCP. Agents store decisions, constraints, patterns, and bug root causes — future sessions restore them. Works with Claude Code, OpenCode, or any MCP client.

## The 3-call workflow

```
session_restore()                                    # session start — load prior context
memory_store({ content, type, confidence, citation }) # when you discover something worth keeping
session_save({ summary: "..." })                     # session end — persist what happened
```

## All 14 tools

| Tool | Purpose |
|------|---------|
| `session_restore` | Load prior memories for the current project |
| `session_save` | Persist a session summary |
| `memory_store` | Store a memory (fact, decision, pattern, error, preference) |
| `memory_recall` | Hybrid search — vector + BM25 + link traversal |
| `memory_forget` | Remove a memory |
| `memory_update` | Update an existing memory |
| `memory_link` | Link two related memories |
| `memory_consolidate` | Merge near-duplicate memories |
| `memory_context_assemble` | Assemble relevant context for a prompt |
| `memory_auto_extract` | Auto-extract memories from conversation text |
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

Hybrid search with Reciprocal Rank Fusion: **vector (35%) + BM25 (35%) + link traversal (30%)**.

**BM25 keyword search works with no embedding setup at all.** Vector search is optional.

### Embedding setup

**Default: LM Studio (free, local)**
1. Download [LM Studio](https://lmstudio.ai) and load `nomic-ai/nomic-embed-text-v1.5-GGUF`
2. No config needed — defaults to `http://localhost:1234`

**Alternative model:**
```bash
export LM_STUDIO_URL="http://localhost:1234"
export LM_STUDIO_MODEL="CompendiumLabs/bge-large-en-v1.5-gguf"  # any model
```

**OpenAI embeddings:**
```bash
export LM_STUDIO_URL="https://api.openai.com/v1"
export LM_STUDIO_MODEL="text-embedding-3-small"
export OPENAI_API_KEY="sk-..."
```

**Remote LM Studio server:**
```bash
export LM_STUDIO_URL="http://192.168.1.x:1234"
```

**No embeddings (BM25 only):**
```bash
export EMBEDDING_PROVIDER=none
```

> **Provider-sticky:** Changing the embedding model requires re-embedding stored memories. Run `memory_reembed()` after switching models.

## Schema v9

- Semantic deduplication at store time
- Freshness burst (recent memories rank higher)
- Fact decay (confidence degrades on stale entries)
- Link traversal for relationship-aware recall
- 275 tests

## Install

Handled automatically by `claude-experts` or `bpm-opencode-experts` `install.sh --memory`.

**Manual:**
```bash
git clone https://github.com/bpmforge/bpm-memory-mcp.git ~/Code/bpm-memory-mcp
cd ~/Code/bpm-memory-mcp && npm install && npm run build

# Claude Code
claude mcp add memory node ~/Code/bpm-memory-mcp/mcp/memory-server/dist/index.js

# OpenCode — add to opencode.json under "mcp":
# "memory": { "type": "local", "command": ["node", "~/Code/bpm-memory-mcp/mcp/memory-server/dist/index.js"], "enabled": true }
```

## Full protocol

See `agents/shared/MEMORY_PRIMER.md` in [claude-experts](https://github.com/bpmforge/claude-experts) or [bpm-opencode-experts](https://github.com/bpmforge/bpm-opencode-experts).

## License

MIT
