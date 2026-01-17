# Vision: claude-memory

## Executive Summary

**claude-memory** is an MCP (Model Context Protocol) server that provides persistent intelligent memory for Claude Code sessions. It combines the best features from existing solutions with novel improvements in hybrid search, context engineering, and project isolation.

Based on comprehensive research of competitors and academic literature, this system targets:
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

This represents significant room for improvement.

## Research Findings

### 1. Existing MCP Memory Servers

#### mcp-memory-service (doobidoo) - Market Leader
Source: [GitHub](https://github.com/doobidoo/mcp-memory-service)

**Features:**
- MiniLM-L6-v2 embeddings (ONNX)
- SQLite + Cloudflare hybrid storage
- 5ms local reads, 88% token reduction claimed
- Graph traversal tools
- OAuth 2.1, multi-client support
- v8.9.0, production-ready

**Gaps We Address:**
- No true hybrid search (vector + BM25 + RRF)
- Python-based (heavier runtime)
- Older embedding model (not nomic-embed-text-v2)
- No context engineering (auto-compact, summarization)

#### claude-memory-mcp (WhenMoon)
Source: [GitHub](https://github.com/WhenMoon-afk/claude-memory-mcp)

**Features:**
- FTS5 full-text search (no embeddings)
- TypeScript/Node.js
- Hybrid relevance scoring (recency + importance + frequency)
- <5ms reads

**Gaps We Address:**
- No embedding/semantic search
- No knowledge graph
- Limited memory types

### 2. Embedding Models (2026 State of Art)

Source: [BentoML Guide](https://www.bentoml.com/blog/a-guide-to-open-source-embedding-models), [Elephas Comparison](https://elephas.app/blog/best-embedding-models)

| Model | Dimensions | Context | Speed | Quality |
|-------|------------|---------|-------|---------|
| nomic-embed-text-v1 | 768 | 8192 | Medium | 86.2% top-5 |
| **nomic-embed-text-v2-moe** | 768→256 | 8192 | Fast | Best multilingual |
| mxbai-embed-large | 1024 | 512 | Fast | Good balance |
| ModernBERT-Embed | 768→256 | 8192 | Fast | Latest architecture |
| MiniLM-L6-v2 | 384 | 256 | Fastest | Baseline |

**Decision**: Use **nomic-embed-text-v2-moe** via Ollama
- MoE architecture (305M active / 475M total params)
- Matryoshka dimensions (768 → 256 for storage efficiency)
- Multilingual (100 languages)
- Best accuracy for code/technical content

### 3. Hybrid Search Best Practices

Source: [OpenSearch RRF](https://opensearch.org/blog/introducing-reciprocal-rank-fusion-hybrid-search/), [Elastic Guide](https://www.elastic.co/what-is/hybrid-search), [Weaviate](https://weaviate.io/blog/hybrid-search-explained)

**Why Hybrid Search:**
- Pure embedding search misses exact matches (e.g., "TS-01" identifiers)
- Pure keyword search misses semantic similarity
- Hybrid improves recall **15-30%** over single methods

**Reciprocal Rank Fusion (RRF):**
```
score(d) = Σ 1/(k + rank_i(d))
```
- k=60 is empirically optimal
- Handles mismatched score scales between vector and keyword
- Industry standard (OpenSearch, Elasticsearch, Weaviate, Google Vertex)

**Our Implementation:**
1. Vector search via embeddings (semantic)
2. BM25 search via SQLite FTS5 (keyword)
3. RRF fusion with k=60
4. Re-ranking by recency and confidence

### 4. Context Engineering (2025-2026 Paradigm)

Source: [LlamaIndex](https://www.llamaindex.ai/blog/context-engineering-what-it-is-and-techniques-to-consider), [FlowHunt](https://www.flowhunt.io/blog/context-engineering/), [LangChain](https://www.blog.langchain.com/context-engineering-for-agents/)

**Key Insight**: "Prompt engineering is out, context engineering is in" (Gartner, July 2025)

**Techniques We Implement:**

1. **Auto-Compact (Summarization)**
   - Trigger at 95% context window capacity
   - Recursive summarization of conversation history
   - Preserve key decisions, discard verbose content
   - Claude Code already does this - we enhance it

2. **State Isolation**
   - Structured schema for runtime state
   - Expose only relevant fields to LLM
   - Project-specific context boundaries

3. **Masking & Filtering**
   - Hide irrelevant retrieved content
   - Filter by task stage and relevance score
   - Reduce noise, improve precision

4. **Context Trimming**
   - Heuristic-based pruning (older = lower priority)
   - Token budget enforcement
   - Graceful degradation when over budget

### 5. Memory Systems Comparison

Source: [Letta](https://www.letta.com/blog/benchmarking-ai-agent-memory), [Mem0 Paper](https://arxiv.org/html/2504.19413v1)

| System | Architecture | Strengths | Weaknesses |
|--------|--------------|-----------|------------|
| Letta (MemGPT) | Core + Archival | Self-editing memory, OS metaphor | Complex setup |
| Mem0 | Two-phase pipeline | Production-ready, graph variant | Cloud-dependent defaults |
| mcp-memory-service | ONNX + SQLite | Fast, feature-rich | No hybrid search |
| **claude-memory** | Hybrid + Context Eng | Best of all + improvements | New (unproven) |

**What We Take:**
- From MemGPT: Core memory blocks (persona, human, working, scratchpad)
- From Mem0: Graph variant architecture (Mem0g)
- From mcp-memory-service: SQLite + ONNX approach, consolidation
- From research: RRF hybrid search, context engineering

### 6. RAG Best Practices (2025-2026)

Source: [EdenAI Guide](https://www.edenai.co/post/the-2025-guide-to-retrieval-augmented-generation-rag), [RAGFlow Review](https://ragflow.io/blog/rag-review-2025-from-rag-to-context)

**Key Innovations:**

1. **Long RAG**: Process sections/documents, not just chunks
2. **SELF-RAG**: Self-reflective retrieval decisions
3. **GraphRAG**: Knowledge graphs + vector search (99% precision claims)
4. **Query Augmentation**: Expand vague queries before retrieval

**Chunking Strategy:**
- sentence-transformers: better on single sentences
- text-embedding-ada-002 style: better on 256-512 token blocks
- **Our approach**: Adaptive chunking based on content type

## Proposed Solution

### Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                     claude-memory MCP Server                     │
│                        (TypeScript/Node.js)                      │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │                    Context Engine                         │   │
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────────┐   │   │
│  │  │ Auto-Compact│  │  Isolation  │  │ Token Budget    │   │   │
│  │  │ (95% trigger│  │  (Project   │  │ (Category-based │   │   │
│  │  │  summarize) │  │   boundaries│  │  allocation)    │   │   │
│  │  └─────────────┘  └─────────────┘  └─────────────────┘   │   │
│  └──────────────────────────────────────────────────────────┘   │
│                              │                                   │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │                    Memory System                          │   │
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────────┐   │   │
│  │  │   Session   │  │   Core      │  │    Archival     │   │   │
│  │  │   Memory    │  │   Memory    │  │    Memory       │   │   │
│  │  │             │  │             │  │                 │   │   │
│  │  │ - Working   │  │ - Persona   │  │ - Facts (with   │   │   │
│  │  │ - Scratch   │  │ - Human     │  │   citations)    │   │   │
│  │  │ - Recent    │  │ - Goals     │  │ - Patterns      │   │   │
│  │  │   tools     │  │ - Project   │  │ - Decisions     │   │   │
│  │  └─────────────┘  └─────────────┘  │ - Errors        │   │   │
│  │                                    └─────────────────┘   │   │
│  └──────────────────────────────────────────────────────────┘   │
│                              │                                   │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │                   Knowledge Graph                         │   │
│  │                                                           │   │
│  │  Entities: Files, Functions, Types, Decisions, Errors    │   │
│  │  Relations: implements, depends_on, satisfies, calls     │   │
│  │  Temporal: Bi-temporal model (event time + ingestion)    │   │
│  │  Traversal: find_connected, shortest_path, subgraph      │   │
│  └──────────────────────────────────────────────────────────┘   │
│                              │                                   │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │                    Hybrid Search                          │   │
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────────┐   │   │
│  │  │   Vector    │  │    BM25     │  │      RRF        │   │   │
│  │  │   Search    │  │   Search    │  │    Fusion       │   │   │
│  │  │ (nomic-v2)  │  │   (FTS5)    │  │    (k=60)       │   │   │
│  │  └──────┬──────┘  └──────┬──────┘  └────────┬────────┘   │   │
│  │         └────────────────┴──────────────────┘            │   │
│  └──────────────────────────────────────────────────────────┘   │
│                              │                                   │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │                    Embeddings                             │   │
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────────┐   │   │
│  │  │   Ollama    │  │  LM Studio  │  │    Cache        │   │   │
│  │  │  (primary)  │  │  (fallback) │  │  (SQLite BLOB)  │   │   │
│  │  │             │  │             │  │                 │   │   │
│  │  │ nomic-v2-moe│  │ nomic-v2    │  │ Content hash    │   │   │
│  │  │ 768→256 dim │  │             │  │ deduplication   │   │   │
│  │  └─────────────┘  └─────────────┘  └─────────────────┘   │   │
│  └──────────────────────────────────────────────────────────┘   │
│                              │                                   │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │                    Storage Layer                          │   │
│  │                                                           │   │
│  │  SQLite + FTS5 + WAL Mode                                │   │
│  │  - memories (content, embedding BLOB, metadata)          │   │
│  │  - entities (type, name, properties, temporal)           │   │
│  │  - relations (source, target, type, valid_from/to)       │   │
│  │  - sessions (state JSON, created, resumed)               │   │
│  │  - consolidation (merged, archived, decayed)             │   │
│  │                                                           │   │
│  │  Location: ~/.claude-memory/<project-hash>/memory.db     │   │
│  └──────────────────────────────────────────────────────────┘   │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### MCP Tools

| Tool | Purpose | Based On |
|------|---------|----------|
| `memory_store` | Store fact/pattern/decision with auto-extraction | Mem0, mcp-memory-service |
| `memory_recall` | Hybrid search retrieval with citations | Novel (RRF) |
| `memory_forget` | Soft-delete with provenance tracking | claude-memory-mcp |
| `memory_update` | Update existing memory with conflict resolution | Mem0 |
| `context_compact` | Trigger summarization of current context | Context engineering |
| `context_status` | Show token usage, memory stats | mcp-memory-service |
| `session_save` | Persist full session state | MemGPT/Letta |
| `session_restore` | Load previous session | MemGPT/Letta |
| `session_list` | List available sessions | Novel |
| `graph_query` | Query knowledge graph relationships | mcp-memory-service |
| `graph_add` | Add entity/relation to graph | Novel |
| `graph_visualize` | Get graph data for visualization | mcp-memory-service |
| `project_switch` | Switch project context (isolation) | Novel |
| `project_list` | List known projects | Novel |

### Memory Types

1. **Working Memory** (Session-scoped, volatile)
   - Current task context
   - Recent tool calls and results (last 10)
   - Temporary computations
   - Token budget: 20% of context

2. **Core Memory** (MemGPT-style, self-editable)
   - **Persona block**: Project identity from CLAUDE.md
   - **Human block**: User preferences (coding style, conventions)
   - **Goals block**: Current objectives and constraints
   - **Project block**: Key files, patterns, decisions
   - Token budget: 15% of context
   - Claude can edit these during sessions

3. **Archival Memory** (Persistent, searchable)
   - Validated facts with citations (source file + line)
   - Architectural decisions (linked to ADR docs)
   - Learned patterns (successful/failed approaches)
   - Error resolutions (problem → solution mappings)
   - Token budget: Retrieved on demand

4. **Knowledge Graph** (Structural, queryable)
   - Code entities (files, functions, types, modules)
   - Relationships with temporal validity
   - Requirement traceability (US-XXX → FR-XXX → Code)
   - Dependency graphs

### Context Engineering Pipeline

```
Input: Current context + retrieved memories
                    │
                    ▼
┌───────────────────────────────────────┐
│  1. Token Budget Check                │
│     - Calculate current usage         │
│     - If >95%, trigger auto-compact   │
└───────────────────────────────────────┘
                    │
                    ▼
┌───────────────────────────────────────┐
│  2. Auto-Compact (if triggered)       │
│     - Summarize conversation history  │
│     - Extract key decisions/facts     │
│     - Store in archival memory        │
│     - Replace verbose with summary    │
└───────────────────────────────────────┘
                    │
                    ▼
┌───────────────────────────────────────┐
│  3. Memory Retrieval                  │
│     - Hybrid search (vector + BM25)   │
│     - RRF fusion (k=60)               │
│     - Filter by project isolation     │
│     - Rank by recency + confidence    │
└───────────────────────────────────────┘
                    │
                    ▼
┌───────────────────────────────────────┐
│  4. Context Assembly                  │
│     - Core memory (always included)   │
│     - Top-k archival (by relevance)   │
│     - Working memory (current task)   │
│     - Token budget enforcement        │
└───────────────────────────────────────┘
                    │
                    ▼
┌───────────────────────────────────────┐
│  5. Isolation Check                   │
│     - Verify no cross-project mixing  │
│     - Warn if ambiguous content       │
│     - Log for debugging               │
└───────────────────────────────────────┘
                    │
                    ▼
Output: Optimized context for Claude
```

### Consolidation System (Dream-Inspired)

Based on mcp-memory-service's consolidation scheduler:

1. **Decay Scoring**: Older memories decay in relevance
2. **Association Discovery**: Link related memories
3. **Compression**: Merge similar memories
4. **Archival**: Move cold memories to long-term storage
5. **Cleanup**: Remove contradicted/superseded facts

Runs: On session end, or after 100+ memory operations

### Project Isolation (Novel Feature)

The #1 benchmark complaint. Our solution:

1. **Project Hash**: SHA256 of git root or CLAUDE.md path
2. **Separate Databases**: `~/.claude-memory/<hash>/memory.db`
3. **Context Tagging**: Every memory tagged with project ID
4. **Switch Command**: Explicit `project_switch` tool
5. **Validation**: Cross-project content blocked at retrieval

## Success Metrics

### Primary Metrics

| Metric | Industry Best | Our Target | Measurement |
|--------|---------------|------------|-------------|
| Memory operation accuracy | 53% | **70%+** | LoCoMo-style benchmark |
| Token reduction | 88% | **80%+** | Before/after comparison |
| Project isolation errors | "occasional" | **<5%** | Cross-project retrieval test |
| Search latency | 5ms | **<50ms** | Performance benchmark |

### Secondary Metrics

| Metric | Target | Measurement |
|--------|--------|-------------|
| Embedding latency | <200ms | Ollama API timing |
| Storage per project | <100MB | Disk usage |
| Memory accuracy (citation) | >95% | Verification test |
| Session restore time | <1s | Cold start benchmark |

## Technical Approach

### Phase 1: Foundation (Weeks 1-4)
- MCP server with TypeScript + MCP SDK
- SQLite storage with FTS5 + BLOB
- Ollama integration for nomic-embed-text-v2
- Basic memory_store/memory_recall

### Phase 2: Hybrid Search (Weeks 5-8)
- Vector search implementation
- BM25 search with FTS5
- RRF fusion (k=60)
- Search quality benchmarking

### Phase 3: Memory System (Weeks 9-12)
- Core memory (MemGPT-style blocks)
- Archival memory with citations
- Session save/restore
- Consolidation scheduler

### Phase 4: Knowledge Graph (Weeks 13-16)
- Entity extraction from code
- Relationship mapping
- Temporal versioning
- Graph query tools

### Phase 5: Context Engineering (Weeks 17-20)
- Auto-compact at 95% capacity
- Summarization pipeline
- Token budget management
- Project isolation enforcement

### Phase 6: Polish & Benchmark (Weeks 21-24)
- Performance optimization
- LoCoMo-style benchmark
- Documentation
- Release preparation

## Differentiation Summary

| Feature | mcp-memory-service | claude-memory-mcp | **claude-memory** |
|---------|-------------------|-------------------|-------------------|
| **Search** | Semantic only | FTS5 only | **Hybrid (Vector + BM25 + RRF)** |
| **Embeddings** | MiniLM-L6-v2 | None | **nomic-embed-text-v2-moe** |
| **Context Eng** | Basic | None | **Full (auto-compact, isolation)** |
| **Project Isolation** | Weak | Weak | **Strong (separate DBs, validation)** |
| **Memory Types** | 6 types | 3 types | **4 types (MemGPT-style)** |
| **Knowledge Graph** | Yes | No | **Yes (temporal)** |
| **Runtime** | Python | TypeScript | **TypeScript** |
| **Consolidation** | Yes | No | **Yes (enhanced)** |

## Conclusion

claude-memory addresses the gaps in existing MCP memory solutions:

1. **True Hybrid Search**: First MCP server with proper Vector + BM25 + RRF
2. **Latest Embeddings**: nomic-embed-text-v2-moe vs older models
3. **Context Engineering**: Auto-compact, summarization, budget management
4. **Strong Project Isolation**: Separate DBs, validation, explicit switching
5. **TypeScript Native**: Lighter than Python alternatives

By combining proven patterns from MemGPT, Mem0, mcp-memory-service, and academic research, we target:
- **70%+ accuracy** (vs 53% industry best)
- **80%+ token reduction**
- **<5% isolation errors**

This is a comprehensive 24-week project building the definitive memory solution for Claude Code.
