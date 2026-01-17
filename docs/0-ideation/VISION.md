# Vision: claude-memory

## Executive Summary

**claude-memory** is a **hybrid Claude Code plugin** that provides persistent intelligent memory through the optimal combination of Skills, MCP Server, and Hooks. This architecture achieves significantly lower token overhead than pure MCP solutions while maintaining full computational capability.

Based on comprehensive research of extension mechanisms and competitors:
- **75% lower token overhead** than pure MCP (~2k vs ~8k tokens)
- **80%+ token reduction** through intelligent context management
- **70%+ memory operation accuracy** (vs 53% industry best)
- **<5% project isolation errors** (vs "occasional" in competitors)
- **Cross-session continuity** preserving decisions, patterns, and project knowledge

## Problem Statement

### The Current Pain

When working with Claude Code on complex projects, critical inefficiencies occur:

1. **Redundant File Reading**: Claude re-reads the same files multiple times per session
2. **Context Loss Between Sessions**: Each new session starts from zero
3. **Token Waste**: 70%+ of tokens spent on context that could be cached
4. **No Learning**: Claude doesn't learn project-specific patterns
5. **Project Mixing**: Memory systems "occasionally mix information from different projects" (benchmark finding)

### Industry Benchmark Reality

According to [AIMultiple MCP Memory Benchmarks (2026)](https://research.aimultiple.com/memory-mcp/):
- Best MCP memory server accuracy: **53%** (Handrails)
- Memory recall after session breaks is **inconsistent**
- Project isolation is the **#1 complaint**

### Pure MCP Token Problem

According to [Armin Ronacher's analysis](https://lucumr.pocoo.org/2025/12/13/skills-vs-mcp/):
> "The Sentry MCP is probably one of the better designed MCPs out there, but when loaded into the context right away it loses around 8k tokens out of the box."

This token overhead significantly reduces context available for actual work.

## Research Findings

### 1. Skills vs MCP Analysis

Source: [Skills Explained](https://claude.com/blog/skills-explained), [Simon Willison](https://simonwillison.net/2025/Oct/16/claude-skills/), [Armin Ronacher](https://lucumr.pocoo.org/2025/12/13/skills-vs-mcp/)

**Key Insight**: Skills and MCP are complementary, not competitive.

| Aspect | Skills | MCP |
|--------|--------|-----|
| Purpose | Teach Claude **how** to do things | Connect Claude to **external data/tools** |
| Token Cost | ~100 tokens (metadata), <5k when loaded | ~8k+ tokens per server |
| Complexity | Markdown + optional scripts | Full protocol specification |
| Best For | Procedures, workflows, patterns | Computation, storage, APIs |

**From [Claude's official guidance](https://www.claude.com/blog/extending-claude-capabilities-with-skills-mcp-servers):**
> "MCP server = 'Claude, here are the keys to the filing cabinet.' Skill = 'Claude, here's exactly how to organise what's inside.'"

**From [Simon Willison](https://simonwillison.net/2025/Oct/16/claude-skills/):**
> "Claude Skills are awesome, maybe a bigger deal than MCP... Almost everything I might achieve with an MCP can be handled by a CLI tool instead."

### 2. Hooks for Deterministic Behavior

Source: [Hooks Guide](https://code.claude.com/docs/en/hooks-guide)

Hooks provide **deterministic control** - they always run, unlike LLM-driven tool calls.

**Key Events:**
- `PreToolUse`: Before tool execution (can modify input)
- `PostToolUse`: After tool completion
- Session lifecycle events

**Use Cases for Memory:**
- Auto-restore session on start
- Auto-save before context clear
- Log significant operations

### 3. Plugin Distribution

Source: [Claude Code Plugins](https://claude.com/blog/claude-code-plugins)

Plugins package Skills, MCP servers, Hooks, and sub-agents for easy distribution:
```bash
/plugin install claude-memory
```

### 4. Existing MCP Memory Servers

#### mcp-memory-service (doobidoo) - Market Leader
Source: [GitHub](https://github.com/doobidoo/mcp-memory-service)

**Features:**
- MiniLM-L6-v2 embeddings (ONNX)
- SQLite + Cloudflare hybrid storage
- 5ms local reads, 88% token reduction claimed
- Graph traversal tools
- v8.9.0, production-ready

**Gaps We Address:**
- High token overhead (pure MCP)
- No skill-based context engineering
- No hooks for deterministic behavior

### 5. Embedding Models (2026 State of Art)

Source: [BentoML Guide](https://www.bentoml.com/blog/a-guide-to-open-source-embedding-models)

| Model | Dimensions | Context | Quality |
|-------|------------|---------|---------|
| **nomic-embed-text-v2-moe** | 768→256 | 8192 | Best multilingual |
| mxbai-embed-large | 1024 | 512 | Good balance |
| MiniLM-L6-v2 | 384 | 256 | Baseline |

**Decision**: Use **nomic-embed-text-v2-moe** via Ollama

### 6. Hybrid Search Best Practices

Source: [OpenSearch RRF](https://opensearch.org/blog/introducing-reciprocal-rank-fusion-hybrid-search/)

**Reciprocal Rank Fusion (RRF):**
```
score(d) = Σ 1/(k + rank_i(d))
```
- k=60 is empirically optimal
- Hybrid improves recall **15-30%** over single methods

### 7. Context Engineering Paradigm

Source: [LlamaIndex](https://www.llamaindex.ai/blog/context-engineering-what-it-is-and-techniques-to-consider)

**Key Insight**: "Prompt engineering is out, context engineering is in" (Gartner, July 2025)

**Techniques:**
1. Auto-compact at 95% context capacity
2. State isolation between projects
3. Progressive disclosure (load details only when needed)

## Proposed Solution: Hybrid Plugin Architecture

### Why Hybrid?

| Approach | Token Cost | Capability | Our Choice |
|----------|------------|------------|------------|
| Pure MCP | ~8,000 | Full computation | ❌ Too expensive |
| Pure Skill | ~100-5,000 | Limited (no computation) | ❌ Can't do embeddings |
| **Hybrid (Skill + MCP + Hooks)** | **~2,000** | **Full computation** | ✅ Best of both |

### Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────────┐
│                        claude-memory Plugin                              │
│                    (Install: /plugin install claude-memory)              │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  ┌────────────────────────────────────────────────────────────────────┐ │
│  │                         SKILL LAYER                                 │ │
│  │                    (~100-2000 tokens when active)                   │ │
│  │                                                                     │ │
│  │  skills/memory/SKILL.md                                            │ │
│  │  ┌─────────────────────────────────────────────────────────────┐   │ │
│  │  │  Teaches Claude:                                             │   │ │
│  │  │  • When to store memories (decisions, errors, patterns)     │   │ │
│  │  │  • How to formulate effective recall queries                │   │ │
│  │  │  • Context engineering patterns (when to compact)           │   │ │
│  │  │  • Memory type selection (fact vs pattern vs decision)      │   │ │
│  │  │  • Project isolation awareness                              │   │ │
│  │  └─────────────────────────────────────────────────────────────┘   │ │
│  │                                                                     │ │
│  │  skills/memory/scripts/                                            │ │
│  │  ├── compact.sh      # Context summarization helper                │ │
│  │  └── validate.sh     # Memory validation                           │ │
│  └────────────────────────────────────────────────────────────────────┘ │
│                                    │                                     │
│                                    ▼                                     │
│  ┌────────────────────────────────────────────────────────────────────┐ │
│  │                         MCP SERVER                                  │ │
│  │                    (Computational heavy lifting)                    │ │
│  │                                                                     │ │
│  │  mcp/memory-server/                                                │ │
│  │  ┌─────────────────────────────────────────────────────────────┐   │ │
│  │  │                                                              │   │ │
│  │  │  ┌─────────────┐  ┌─────────────┐  ┌──────────────────┐    │   │ │
│  │  │  │  Embeddings │  │   Search    │  │     Storage      │    │   │ │
│  │  │  │  (Ollama)   │  │ (Hybrid RRF)│  │    (SQLite)      │    │   │ │
│  │  │  └─────────────┘  └─────────────┘  └──────────────────┘    │   │ │
│  │  │                                                              │   │ │
│  │  │  ┌─────────────┐  ┌─────────────┐  ┌──────────────────┐    │   │ │
│  │  │  │  Knowledge  │  │   Session   │  │   Consolidation  │    │   │ │
│  │  │  │    Graph    │  │  Management │  │    (Cleanup)     │    │   │ │
│  │  │  └─────────────┘  └─────────────┘  └──────────────────┘    │   │ │
│  │  │                                                              │   │ │
│  │  └─────────────────────────────────────────────────────────────┘   │ │
│  │                                                                     │ │
│  │  MCP Tools (minimal, focused):                                     │ │
│  │  • memory_store    • memory_recall   • memory_forget               │ │
│  │  • session_save    • session_restore • graph_query                 │ │
│  └────────────────────────────────────────────────────────────────────┘ │
│                                    │                                     │
│                                    ▼                                     │
│  ┌────────────────────────────────────────────────────────────────────┐ │
│  │                         HOOKS LAYER                                 │ │
│  │                    (Deterministic automation)                       │ │
│  │                                                                     │ │
│  │  hooks/settings.json                                               │ │
│  │  ┌─────────────────────────────────────────────────────────────┐   │ │
│  │  │  PreToolUse:                                                 │   │ │
│  │  │  • SessionStart → Auto-restore previous session              │   │ │
│  │  │  • Read(CLAUDE.md) → Sync to core memory                    │   │ │
│  │  │                                                              │   │ │
│  │  │  PostToolUse:                                                │   │ │
│  │  │  • Edit|Write → Log file changes to memory                  │   │ │
│  │  │  • Bash(error) → Store error context for future             │   │ │
│  │  │                                                              │   │ │
│  │  │  Custom Events:                                              │   │ │
│  │  │  • ContextNearFull → Trigger auto-compact                   │   │ │
│  │  │  • SessionEnd → Auto-save session state                     │   │ │
│  │  └─────────────────────────────────────────────────────────────┘   │ │
│  └────────────────────────────────────────────────────────────────────┘ │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                         STORAGE LAYER                                    │
│                                                                          │
│  ~/.claude-memory/<project-hash>/                                       │
│  ├── memory.db          # SQLite + FTS5 + embeddings                    │
│  ├── sessions/          # Saved session states                          │
│  └── config.json        # Project-specific settings                     │
│                                                                          │
│  SQLite Tables:                                                          │
│  • memories (content, embedding BLOB, type, confidence, citations)      │
│  • core_memory (persona, human, goals, project blocks)                  │
│  • entities (files, functions, types, decisions)                        │
│  • relations (implements, depends_on, calls, contradicts)               │
│  • sessions (state JSON, created, resumed)                              │
└─────────────────────────────────────────────────────────────────────────┘
```

### Component Responsibilities

#### 1. Skill Layer (Teaching Claude)

**File:** `skills/memory/SKILL.md`

**Teaches Claude:**
- **When to Store**: Recognize decisions, errors, patterns worth remembering
- **How to Query**: Formulate effective search queries for hybrid retrieval
- **Context Engineering**: When to trigger compaction, how to manage budgets
- **Memory Types**: Choose between fact, pattern, decision, error
- **Isolation**: Maintain project boundaries

**Token Efficiency:**
- Metadata: ~100 tokens (always loaded)
- Full skill: ~2,000 tokens (loaded when memory task detected)
- Progressive disclosure: Details load only when needed

#### 2. MCP Server (Computation)

**Directory:** `mcp/memory-server/`

**Handles:**
- **Embeddings**: Generate via Ollama (nomic-embed-text-v2-moe)
- **Hybrid Search**: Vector + BM25 + RRF fusion (k=60)
- **Storage**: SQLite with FTS5, BLOB for embeddings
- **Knowledge Graph**: Entities, relations, temporal queries
- **Sessions**: Save/restore full session state
- **Consolidation**: Decay, merge, cleanup

**Tools (Reduced Set):**
| Tool | Purpose |
|------|---------|
| `memory_store` | Store with embedding + entity extraction |
| `memory_recall` | Hybrid search with citations |
| `memory_forget` | Soft-delete with provenance |
| `session_save` | Persist session state |
| `session_restore` | Load previous session |
| `graph_query` | Query entity relationships |

Note: Context engineering (compact, status) moved to Skill + Scripts.

#### 3. Hooks Layer (Automation)

**File:** `hooks/settings.json`

**Deterministic Behaviors:**
- **Session Auto-Restore**: On session start, restore previous state
- **CLAUDE.md Sync**: When CLAUDE.md read, sync to core memory
- **Change Logging**: Log file edits to memory automatically
- **Error Capture**: Store error contexts for future reference
- **Auto-Save**: Save session before context clear

**Why Hooks:**
> "Hooks provide deterministic control over Claude Code's behavior, ensuring certain actions always happen rather than relying on the LLM to choose to run them."

### Memory Types (Unchanged)

1. **Working Memory** (Session-scoped, volatile)
   - Current task context
   - Recent tool calls (last 10)
   - Token budget: 20%

2. **Core Memory** (MemGPT-style, self-editable)
   - Persona, Human, Goals, Project blocks
   - Token budget: 15%
   - Claude can edit during sessions

3. **Archival Memory** (Persistent, searchable)
   - Facts with citations
   - Patterns, decisions, errors
   - Retrieved on demand

4. **Knowledge Graph** (Structural)
   - Code entities and relationships
   - Temporal versioning

### Context Engineering Pipeline

```
Session Start
      │
      ▼
┌─────────────────────────────────┐
│  HOOK: Auto-Restore             │
│  • Load previous session        │
│  • Inject core memory           │
└─────────────────────────────────┘
      │
      ▼
┌─────────────────────────────────┐
│  SKILL: Progressive Loading     │
│  • Metadata only (~100 tokens)  │
│  • Full load on memory task     │
└─────────────────────────────────┘
      │
      ▼
┌─────────────────────────────────┐
│  User Interaction               │
│                                 │
│  SKILL recognizes:              │
│  • "Remember this" → store      │
│  • Pattern worth saving → store │
│  • Question → recall            │
│  • Near limit → compact         │
└─────────────────────────────────┘
      │
      ▼
┌─────────────────────────────────┐
│  MCP: Computation               │
│  • Embed content                │
│  • Hybrid search                │
│  • Store to SQLite              │
└─────────────────────────────────┘
      │
      ▼
┌─────────────────────────────────┐
│  HOOK: Post-Operation           │
│  • Log changes                  │
│  • Update access counts         │
└─────────────────────────────────┘
      │
      ▼
Session End
      │
      ▼
┌─────────────────────────────────┐
│  HOOK: Auto-Save                │
│  • Save session state           │
│  • Trigger consolidation        │
└─────────────────────────────────┘
```

### Project Isolation

The #1 benchmark complaint. Our solution:

1. **Project Hash**: SHA256 of git root or CLAUDE.md path
2. **Separate Databases**: `~/.claude-memory/<hash>/memory.db`
3. **Skill Awareness**: Skill teaches Claude about isolation
4. **Hook Validation**: Hooks verify project context on operations

## Success Metrics

### Primary Metrics

| Metric | Industry Best | Our Target | Method |
|--------|---------------|------------|--------|
| Token overhead | ~8,000 (pure MCP) | **~2,000** | Hybrid architecture |
| Memory accuracy | 53% | **70%+** | LoCoMo benchmark |
| Token reduction | 88% | **80%+** | Before/after test |
| Project isolation | "occasional" errors | **<5%** | Cross-project test |

### Secondary Metrics

| Metric | Target | Method |
|--------|--------|--------|
| Search latency | <50ms | Performance test |
| Session restore | <1s | Cold start test |
| Storage per project | <100MB | Disk usage |

## Technical Approach

### Phase 1: Foundation (Weeks 1-4)
- Plugin structure with Skill + MCP + Hooks
- SQLite storage with FTS5
- Ollama embedding integration
- Basic memory_store/memory_recall

### Phase 2: Hybrid Search (Weeks 5-8)
- Vector search implementation
- BM25 search with FTS5
- RRF fusion (k=60)
- Skill-based query enhancement

### Phase 3: Memory System (Weeks 9-12)
- Core memory (MemGPT-style blocks)
- Session management with hooks
- Consolidation scheduler

### Phase 4: Knowledge Graph (Weeks 13-16)
- Entity extraction
- Relationship mapping
- Graph query tools

### Phase 5: Context Engineering (Weeks 17-20)
- Skill-based pattern recognition
- Hook-based automation
- Token budget management

### Phase 6: Polish (Weeks 21-24)
- Optimization
- Benchmarking
- Documentation
- Plugin marketplace submission

## Differentiation Summary

| Feature | mcp-memory-service | Pure MCP | **claude-memory (Hybrid)** |
|---------|-------------------|----------|----------------------------|
| Token overhead | ~8k | ~8k | **~2k** |
| Search | Semantic only | Varies | **Hybrid (Vector + BM25 + RRF)** |
| Context engineering | Basic | None | **Skill-based (full)** |
| Automation | Manual | Manual | **Hook-driven** |
| Distribution | pip install | npm | **Plugin marketplace** |
| Project isolation | Weak | Weak | **Strong (Skill-aware + Hooks)** |

## Conclusion

The hybrid plugin architecture addresses the fundamental tradeoff in Claude Code extensions:

1. **Skills** provide low-token teaching (~100-2000 tokens)
2. **MCP Server** provides full computation (embeddings, search, storage)
3. **Hooks** provide deterministic automation (auto-save, auto-restore)
4. **Plugin** provides easy distribution (`/plugin install`)

This achieves:
- **75% lower token overhead** than pure MCP
- **Full computational capability** for embeddings and search
- **Deterministic behavior** for critical operations
- **Easy installation** via plugin marketplace

By combining proven patterns from the Skills ecosystem, MCP protocol, and Hook system, we build the definitive memory solution for Claude Code.
