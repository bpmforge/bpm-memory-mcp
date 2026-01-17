# Scope: claude-memory

## Project Overview

**claude-memory** is a **hybrid Claude Code plugin** providing persistent intelligent memory through the optimal combination of Skills, MCP Server, and Hooks. This architecture achieves 75% lower token overhead than pure MCP solutions while maintaining full computational capability.

**Timeline**: 24 weeks (comprehensive implementation)

**Architecture**: Skill + MCP + Hooks (Hybrid Plugin)

## Plugin Structure

```
claude-memory/
├── .claude-plugin/
│   ├── manifest.json           # Plugin metadata
│   └── marketplace.json        # Distribution info
├── skills/
│   └── memory/
│       ├── SKILL.md            # Memory skill (teaches Claude)
│       └── scripts/
│           ├── compact.sh      # Context summarization
│           └── validate.sh     # Memory validation
├── mcp/
│   └── memory-server/
│       ├── package.json
│       ├── tsconfig.json
│       └── src/
│           ├── index.ts        # MCP server entry
│           ├── embeddings/     # Ollama integration
│           ├── search/         # Hybrid search (Vector + BM25)
│           ├── storage/        # SQLite + FTS5
│           ├── graph/          # Knowledge graph
│           └── session/        # Session management
├── hooks/
│   └── settings.json           # Hook configurations
├── docs/
└── tests/
```

## In Scope

### 1. Skill Layer

#### SK-001: Memory Skill
A SKILL.md file that teaches Claude memory patterns.

**Teaches:**
1. When to store (decisions, errors, patterns, preferences)
2. How to query (effective search formulation)
3. Context engineering (when to compact, budget awareness)
4. Memory type selection (fact, pattern, decision, error)
5. Project isolation awareness

**Token Efficiency:**
- Metadata: ~100 tokens (always loaded)
- Full skill: ~2,000 tokens (loaded on memory task)
- Progressive disclosure

**File:** `skills/memory/SKILL.md`

---

#### SK-002: Skill Scripts
Helper scripts for skill operations.

**Scripts:**
| Script | Purpose |
|--------|---------|
| `compact.sh` | Summarize context, extract facts |
| `validate.sh` | Validate memory consistency |

**File:** `skills/memory/scripts/`

---

### 2. MCP Server Layer

#### MCP-001: Server Core
TypeScript MCP server for computational operations.

**Features:**
- MCP SDK integration
- stdio transport
- 6 focused tools (reduced from 14)
- Graceful error handling

**File:** `mcp/memory-server/src/index.ts`

---

#### MCP-002: MCP Tools (Reduced Set)
Six focused tools for computation-heavy operations.

| Tool | Purpose |
|------|---------|
| `memory_store` | Store with embedding + entity extraction |
| `memory_recall` | Hybrid search with citations |
| `memory_forget` | Soft-delete with provenance |
| `session_save` | Persist session state |
| `session_restore` | Load previous session |
| `graph_query` | Query entity relationships |

**Moved to Skill/Scripts:**
- `context_compact` → Skill + compact.sh
- `context_status` → Skill reads from storage
- `memory_update` → Skill orchestrates store + forget
- `session_list` → Skill reads from storage
- `graph_add` → Implicit in memory_store
- `graph_visualize` → Skill formats output
- `project_switch` → Hook on directory change
- `project_list` → Skill reads from storage

---

#### MCP-003: Embeddings Module
Local embedding generation via Ollama.

**Features:**
- Primary: Ollama (nomic-embed-text-v2-moe)
- Fallback: LM Studio
- 768 → 256 Matryoshka dimensions
- Content hash caching
- Batch processing

**File:** `mcp/memory-server/src/embeddings/`

---

#### MCP-004: Hybrid Search Module
Vector + BM25 search with RRF fusion.

**Features:**
- Vector search (cosine similarity)
- BM25 search (SQLite FTS5)
- RRF fusion (k=60, configurable weights)
- Re-ranking (recency, confidence, frequency)
- Project isolation filter

**File:** `mcp/memory-server/src/search/`

---

#### MCP-005: Storage Module
SQLite-based persistence.

**Features:**
- SQLite with WAL mode
- FTS5 for full-text search
- BLOB for embeddings
- Schema migrations
- Project-specific databases

**Schema:**
```sql
-- Core
memories (id, content, embedding, type, confidence, citations, project_id, created, accessed)
core_memory (project_id, block, content, updated)
sessions (id, project_id, state, created, resumed)

-- Knowledge Graph
entities (id, type, name, properties, valid_from, valid_to)
relations (source, target, type, properties, valid_from, valid_to)

-- Full-text Search
memories_fts (content) USING fts5
```

**Location:** `~/.claude-memory/<project-hash>/memory.db`

**File:** `mcp/memory-server/src/storage/`

---

#### MCP-006: Knowledge Graph Module
Entity and relationship management.

**Entity Types:**
- File, Function, Type, Decision, Error

**Relationship Types:**
- implements, depends_on, satisfies, calls, contradicts, supersedes

**Temporal Model:**
- Bi-temporal (event time + ingestion time)
- Valid from/to for relationships

**File:** `mcp/memory-server/src/graph/`

---

#### MCP-007: Session Module
Session state persistence.

**Features:**
- Full state serialization
- Working memory capture
- Core memory snapshot
- Conversation summary

**File:** `mcp/memory-server/src/session/`

---

#### MCP-008: Consolidation
Memory cleanup and optimization.

**Operations:**
- Decay scoring (age-based)
- Association discovery
- Duplicate merging
- Contradiction cleanup
- Archival of cold memories

**Trigger:** Session end or 100+ operations

**File:** `mcp/memory-server/src/consolidation/`

---

### 3. Hooks Layer

#### HK-001: Session Hooks
Automatic session management.

**PreToolUse Hooks:**
| Matcher | Action |
|---------|--------|
| SessionStart | Auto-restore previous session |
| Read(CLAUDE.md) | Sync to core memory |

**PostToolUse Hooks:**
| Matcher | Action |
|---------|--------|
| Edit\|Write | Log file change to memory |
| Bash(error) | Store error context |

**Custom Events:**
| Event | Action |
|-------|--------|
| ContextNearFull | Trigger auto-compact |
| SessionEnd | Auto-save session |

**File:** `hooks/settings.json`

---

#### HK-002: Project Hooks
Project isolation enforcement.

**Actions:**
- Detect project from git root or CLAUDE.md
- Switch database on project change
- Validate memory operations

---

### 4. Plugin Distribution

#### PL-001: Plugin Manifest
Standard plugin metadata.

**File:** `.claude-plugin/manifest.json`
```json
{
  "name": "claude-memory",
  "version": "1.0.0",
  "description": "Persistent intelligent memory for Claude Code",
  "author": "...",
  "components": {
    "skills": ["memory"],
    "mcp": ["memory-server"],
    "hooks": true
  }
}
```

---

#### PL-002: Installation
Single-command installation.

```bash
/plugin install claude-memory
```

**Or from repository:**
```bash
/plugin install github:user/claude-memory
```

---

### 5. Memory System

#### MEM-001: Working Memory
Session-scoped volatile memory.

**Contents:**
- Current task context
- Recent tool calls (last 10)
- Scratchpad

**Token Budget:** 20%

---

#### MEM-002: Core Memory (MemGPT-style)
Self-editable persistent blocks.

**Blocks:**
| Block | Source | Editable |
|-------|--------|----------|
| Persona | CLAUDE.md parsing | Yes |
| Human | User preferences | Yes |
| Goals | Current objectives | Yes |
| Project | Key files, patterns | Yes |

**Token Budget:** 15%

---

#### MEM-003: Archival Memory
Long-term searchable storage.

**Contents:**
- Facts with citations
- Patterns (success/failure)
- Decisions (ADRs)
- Error resolutions

---

#### MEM-004: Knowledge Graph
Structural relationships.

**Contents:**
- Code entities
- Relationships with temporal validity
- Requirement traceability

---

### 6. Context Engineering

#### CTX-001: Auto-Compact
Skill-triggered context compaction.

**Trigger:** 95% context capacity

**Process:**
1. Skill detects high usage
2. Skill invokes compact.sh
3. Script summarizes history
4. Key facts stored to archival
5. Summary replaces verbose content

---

#### CTX-002: Token Budget Management
Category-based allocation.

| Category | Budget |
|----------|--------|
| Core Memory | 15% |
| Working Memory | 20% |
| Retrieved Archival | 25% |
| Current Task | 40% |

---

#### CTX-003: Progressive Disclosure
Load details only when needed.

**Levels:**
1. Skill metadata (~100 tokens) - always
2. Full skill (~2000 tokens) - on memory task
3. Archival retrieval - on query

---

### 7. Configuration

#### CFG-001: Global Configuration
User-wide settings.

**File:** `~/.claude-memory/config.json`
```json
{
  "embedding": {
    "provider": "ollama",
    "model": "nomic-embed-text:v2",
    "dimensions": 256
  },
  "search": {
    "vectorWeight": 0.5,
    "bm25Weight": 0.5,
    "rrfK": 60
  }
}
```

---

#### CFG-002: Project Configuration
Project-specific overrides.

**File:** `.claude-memory.json` in project root

---

### 8. Documentation & Testing

#### DOC-001: Documentation
Comprehensive guides.

**Documents:**
- README (quick start)
- Installation guide
- Skill reference
- MCP API reference
- Hooks reference
- Troubleshooting

---

#### TST-001: Testing
Multi-level testing.

**Levels:**
- Unit tests (>80% coverage)
- Integration tests (MCP protocol)
- Skill tests (behavior validation)
- Hook tests (event handling)
- Benchmark suite (LoCoMo-style)

---

## Out of Scope

### Version 1.0

1. **Cloud Services**
   - Cloud-hosted memory
   - Cross-device sync
   - Team/shared memory

2. **Multi-User**
   - Authentication
   - User management
   - Shared knowledge bases

3. **IDE Extensions**
   - VS Code sidebar
   - JetBrains plugin

4. **Advanced AI**
   - Fine-tuning
   - Autonomous curation
   - Predictive pre-fetching

5. **External Integrations**
   - GitHub/GitLab
   - Jira/Linear

### Future Versions

1. **v1.1: Cloud Optional**
   - Cloud embedding fallback
   - Cross-device sync

2. **v2.0: Team Features**
   - Shared project memory
   - Team knowledge base

## Success Criteria

### Quantitative

| Metric | Industry Best | Target | Method |
|--------|---------------|--------|--------|
| Token overhead | ~8,000 (MCP) | **~2,000** | Hybrid architecture |
| Memory accuracy | 53% | **70%+** | LoCoMo benchmark |
| Token reduction | 88% | **80%+** | Before/after test |
| Project isolation | "occasional" | **<5%** | Cross-project test |
| Search latency | 5ms | **<50ms** | Performance test |
| Session restore | - | **<1s** | Cold start test |

### Qualitative

1. **Usability**
   - Single command install: `/plugin install claude-memory`
   - Zero-config for basic usage
   - Clear error messages

2. **Reliability**
   - No data loss on crash (WAL mode)
   - Graceful degradation (BM25-only without Ollama)

3. **Token Efficiency**
   - 75% lower overhead than pure MCP
   - Progressive skill loading

## Dependencies

### Runtime (Required)

| Package | Purpose |
|---------|---------|
| `@modelcontextprotocol/sdk` | MCP integration |
| `better-sqlite3` | Database |
| `natural` | BM25/NLP |

### Runtime (Optional)

| Package | Fallback |
|---------|----------|
| Ollama | BM25-only mode |
| LM Studio | Ollama fallback |

### Development

| Package | Purpose |
|---------|---------|
| TypeScript 5+ | Language |
| Vitest | Testing |
| ESLint + Prettier | Code quality |

## Milestones

| Phase | Weeks | Deliverables |
|-------|-------|--------------|
| 1. Foundation | 1-4 | Plugin structure, Skill, basic MCP, SQLite, Hooks |
| 2. Hybrid Search | 5-8 | Vector, BM25, RRF, skill query enhancement |
| 3. Memory System | 9-12 | Core/archival memory, session hooks, consolidation |
| 4. Knowledge Graph | 13-16 | Entities, relations, temporal, graph queries |
| 5. Context Engineering | 17-20 | Skill patterns, hook automation, token budgets |
| 6. Polish | 21-24 | Optimization, benchmarks, docs, marketplace |

## Risks Reference

See [RISKS.md](./RISKS.md) for comprehensive risk analysis.

## Constraints Reference

See [CONSTRAINTS.md](./CONSTRAINTS.md) for technical and business constraints.
