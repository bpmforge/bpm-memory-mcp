# Claude-Memory System Analysis

> A comprehensive analysis of the claude-memory system architecture, features, and implementation details.

## Executive Summary

Claude-memory is a hybrid plugin providing persistent intelligent memory for Claude Code through three integrated layers:
- **Skill Layer** (~2000 tokens): Teaches Claude when/how to use memory
- **MCP Server Layer**: Handles computation (embeddings, search, storage)
- **Hooks Layer**: Deterministic automation (session restore/save, error capture)

This achieves **75% lower token overhead** than pure MCP solutions.

---

## 1. Architecture Overview

### 1.1 Three-Layer Design

```
┌─────────────────────────────────────────────────────────────┐
│                      Claude Code                             │
├─────────────────────────────────────────────────────────────┤
│  Skill Layer        │  MCP Server Layer  │  Hooks Layer     │
│  (SKILL.md)         │  (6 tools)         │  (settings.json) │
│  ~2000 tokens       │  Computation       │  Automation      │
│  Teaching           │  Heavy lifting     │  Deterministic   │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                    Storage Layer                             │
│  SQLite + WAL │ FTS5 (BM25) │ Embeddings (Ollama/LM Studio) │
└─────────────────────────────────────────────────────────────┘
```

### 1.2 Project Isolation

Each project gets its own isolated database:
- **Project ID**: SHA256(git_root)[0:16]
- **Database Path**: `~/.claude-memory/{projectId}/memory.db`
- No cross-project data leakage

---

## 2. MCP Tools (6 Core Operations)

### 2.1 memory_store
**Purpose**: Store new memories with embeddings

**Input Parameters**:
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| content | string | Yes | Memory text (max 50,000 chars) |
| type | enum | No | fact, pattern, decision, error, preference |
| confidence | float | No | 0.0-1.0 (default 1.0) |
| citation | string | No | Source file:line reference |

**Processing Pipeline**:
1. Zod validation (content, type, confidence ranges)
2. Security checks:
   - Credential detection (regex patterns for secrets)
   - Path safety (citation must be within project)
   - Quota enforcement (<10,000 memories)
3. Language detection from citation file extension
4. Code context parsing from citation format
5. Source hash enrichment (SHA256 of cited file)
6. Embedding generation via Ollama/LM Studio
7. Duplicate check via content hash
8. Atomic database insert (with versioning if superseding)

**Output**: `{id, type, confidence, language, version}`

### 2.2 memory_recall
**Purpose**: Hybrid search (Vector + BM25 + RRF fusion)

**Input Parameters**:
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| query | string | Yes | Search query (max 1,000 chars) |
| type | enum | No | Filter by memory type |
| language | enum | No | Filter by programming language |
| limit | int | No | Results to return (1-50, default 10) |
| minConfidence | float | No | Minimum confidence threshold |
| includeStale | bool | No | Include flagged-stale memories |
| includeSuperseded | bool | No | Include old versions |

**Search Algorithm**:
```
Query → Parallel Execution
         ├── Vector Search (Cosine similarity) → Top 2×limit
         └── BM25 Search (FTS5) → Top 2×limit
              ↓
         RRF Fusion (k=60) → Sort by combined score
              ↓
         Return top `limit` results
```

**Output**:
```json
{
  "memories": [{
    "id": "uuid",
    "content": "...",
    "type": "decision",
    "confidence": 0.9,
    "citation": "src/file.ts:45",
    "relevance": 0.87,
    "language": "typescript",
    "version": 1,
    "isSuperseded": false,
    "isStale": false
  }],
  "stats": {
    "vectorMatches": 15,
    "bm25Matches": 12,
    "fusedResults": 10,
    "latencyMs": 145
  }
}
```

### 2.3 memory_forget
**Purpose**: Soft-delete with audit trail

**Input**: `{id: uuid, reason: string}`
**Behavior**: Sets `deleted_at` timestamp and `deleted_reason`, preserves record

### 2.4 memory_update
**Purpose**: Version memories via superseding

**Behavior**:
- Creates new memory entry (not in-place update)
- Links old → new via `supersedes_id`/`superseded_by`
- Preserves full version history

### 2.5 memory_feedback
**Purpose**: Adjust confidence based on feedback

**Feedback Types**:
| Type | Confidence Delta | Additional Action |
|------|-----------------|-------------------|
| helpful | +5% | None |
| wrong | -20% | Creates corrected memory if correction provided |
| outdated | -30% | Creates updated memory if correction provided |
| duplicate | 0% | Links to canonical memory |

### 2.6 session_save / session_restore
**Purpose**: Cross-session persistence

**session_save**:
- Serializes WorkingMemory + CoreMemory snapshot
- Stores conversation summary
- Auto-prunes old sessions (keeps 10 most recent)

**session_restore**:
- Loads latest session state
- Runs staleness detection (4 types)
- Returns staleness report

---

## 3. Hybrid Search System

### 3.1 Vector Search
**Algorithm**: Cosine similarity
```
similarity = dot(a, b) / (||a|| × ||b||)
```
**Complexity**: O(n × d) where n=memories, d=embedding dimensions
**Range**: 0-1 (1 = identical)

### 3.2 BM25 Search
**Implementation**: SQLite FTS5 (Full-Text Search 5)
**Index Table**: `memories_fts`
**Features**:
- Automatic tokenization and stemming
- Prefix matching support
- Score normalization to 0-1 range

### 3.3 RRF Fusion (Reciprocal Rank Fusion)
**Formula**:
```
score = vectorWeight/(k + rank_vector) + bm25Weight/(k + rank_bm25)
```
**Default k**: 60 (standard RRF constant)
**Default weights**: 0.5 each

**Strategy**:
- If only vector results available: use vector
- If only BM25 results available: use BM25
- If both: fuse with RRF

### 3.4 Re-ranking
**Type-Specific Decay Factors**:
| Type | Decay | Rationale |
|------|-------|-----------|
| error | 0.1 | Becomes stale quickly |
| decision | 0.3 | Context-dependent |
| preference | 0.4 | May change |
| pattern | 0.7 | Generally stable |
| fact | 0.9 | Persistent truths |

**Final Score**: `base_relevance + recency(0.2) + confidence(0.3) + access_freq(0.1)`

---

## 4. Embedding System

### 4.1 Provider Support
| Provider | Endpoint | Detection |
|----------|----------|-----------|
| Ollama | localhost:11434 | First priority |
| LM Studio | localhost:1234 | Fallback |

### 4.2 Caching
**Two-Tier Cache**:
1. **Memory Cache**: Up to 1,000 embeddings (LRU eviction)
2. **Database Cache**: Persistent in `memories.embedding` column

**Cache Key**: SHA256(content)

### 4.3 Graceful Degradation
If no embedding provider available:
- Vector search disabled
- BM25-only search continues working
- Memories stored without embeddings

---

## 5. Storage Layer

### 5.1 SQLite Configuration
```sql
PRAGMA journal_mode = WAL;          -- Crash-safe concurrent access
PRAGMA synchronous = NORMAL;        -- Balance durability/speed
PRAGMA cache_size = -64000;         -- 64MB cache
PRAGMA temp_store = MEMORY;         -- Temp operations in RAM
PRAGMA mmap_size = 268435456;       -- 256MB memory-mapped I/O
PRAGMA foreign_keys = ON;           -- Referential integrity
PRAGMA busy_timeout = 5000;         -- 5s wait for locks
```

### 5.2 Schema (V6)

**memories** (Primary table):
- `id` (UUID PK)
- `content`, `embedding` (BLOB), `type`, `confidence`
- `citation`, `project_id`, `content_hash`
- `created_at`, `accessed_at`, `access_count`
- `deleted_at`, `deleted_reason` (soft delete)
- V2: `language`, `code_context` (JSON), `version`
- V2: `supersedes_id`, `superseded_by`, `superseded_at`
- V2: `flagged_at`, `flagged_reason`, `embedding_model`

**memories_fts** (FTS5 index)

**core_memory** (MemGPT-style blocks):
- Blocks: persona, human, goals, project
- Per-project configuration

**sessions** (Persistence):
- State serialization (BLOB)
- Summary, timestamps, resume tracking

**entities** / **relations** (Knowledge graph):
- Bi-temporal (valid_from, valid_to)
- Relationship types: implements, depends_on, satisfies, calls, contradicts, supersedes

---

## 6. Language & Code Context

### 6.1 Supported Languages (16)
typescript, javascript, python, rust, go, java, c, cpp, ruby, php, shell, sql, markdown, json, yaml, other

### 6.2 Citation Parsing Formats
| Format | Result |
|--------|--------|
| `src/file.ts` | {filePath, startLine: 1} |
| `src/file.ts:45` | {filePath, startLine: 45} |
| `src/file.ts:45-120` | {filePath, startLine, endLine} |
| `src/file.ts:45:MyClass` | {filePath, startLine, symbolName} |

### 6.3 Symbol Type Inference
- PascalCase → class/type
- camelCase → function
- UPPER_CASE → constant

### 6.4 Source Hash Enrichment
- SHA256 of cited file stored at memory creation
- Enables detection when source code changes

---

## 7. Staleness Detection

### 7.1 Four Staleness Types

| Type | Detection | Threshold |
|------|-----------|-----------|
| Access Stale | Not accessed in N sessions | 10 sessions |
| Source Missing | Citation file doesn't exist | File not found |
| Low Confidence | Confidence below threshold | < 0.6 |
| Content Changed | Source hash differs | SHA256 mismatch |

### 7.2 Staleness Report
Generated on `session_restore`:
```json
{
  "accessStale": 5,
  "sourceMissing": 2,
  "lowConfidence": 3,
  "contentChanged": 1
}
```

---

## 8. Security Hardening

### 8.1 Credential Detection (SC-001)
Regex patterns for:
- Password/API key/secret/token key-value pairs
- Bearer tokens
- Private key headers (RSA, OpenSSH, EC, PGP)
- AWS credential patterns
- Database connection strings
- GitHub/GitLab tokens (gh/glpat prefixes)
- High-entropy strings (40+ alphanumeric chars)

### 8.2 Path Validation (SC-002)
- Citations must resolve within project root
- Prevents `../../../etc/passwd` attacks

### 8.3 Input Validation (SC-003)
- All inputs validated via Zod schemas
- Content: max 50,000 chars
- Query: max 1,000 chars
- Reason: max 500 chars
- UUIDs validated, enums constrained

### 8.4 Quota Enforcement
- Maximum 10,000 memories per project

---

## 9. Memory Types

| Type | Purpose | Decay | Example |
|------|---------|-------|---------|
| **fact** | Verified static truths | 0.9 | "The API uses OAuth2 authentication" |
| **pattern** | Recurring approaches | 0.7 | "Error handlers follow try-catch-log pattern" |
| **decision** | Choices with reasoning | 0.3 | "Chose PostgreSQL over MongoDB for ACID compliance" |
| **error** | Problems and solutions | 0.1 | "TypeError fix: check null before accessing property" |
| **preference** | User preferences | 0.4 | "User prefers functional over class components" |

---

## 10. Knowledge Graph

### 10.1 Entities
- Types: file, function, type, decision, error
- Bi-temporal validity (valid_from, valid_to)
- JSON properties bag

### 10.2 Relations
- Types: implements, depends_on, satisfies, calls, contradicts, supersedes
- Bidirectional queries (source→target, target→source)

### 10.3 Graph Operations
- `findConnected(entityId, depth)`: BFS traversal
- `findPath(sourceId, targetId)`: Shortest path

---

## 11. Hooks Layer

### 11.1 Session Restore Hook
**Trigger**: SessionStart
**Action**: Prompts Claude to call `session_restore()`

### 11.2 Error Tracker Hook
**Trigger**: Bash|Write|Edit tool results
**Pattern**: Detects "error|exception|failed" in output
**Action**: Suggests storing error to memory

### 11.3 Session Save Hook
**Trigger**: SessionEnd
**Action**: Prompts Claude to summarize and call `session_save()`

---

## 12. Performance Characteristics

| Metric | Value |
|--------|-------|
| Token overhead reduction | 75% vs pure MCP |
| Max memories/project | 10,000 |
| Search latency | 50-200ms typical |
| Memory per entry | ~200 bytes + 3-16KB embedding |
| Embedding cache | 1,000 entries in memory |
| SQLite timeout | 5,000ms |
| Content limit | 50,000 characters |
| Query limit | 1,000 characters |

---

## 13. V2 Enhancements Summary

| Feature | V1 | V2 |
|---------|----|----|
| Language tracking | No | Yes (16 languages) |
| Code context | No | Structured {file, line, symbol} |
| Versioning | No | Full version chain |
| Staleness detection | No | 4 types with flagging |
| Search filters | Basic | language, stale, superseded |
| Source hash | No | SHA256 for change detection |

---

## 14. Data Flow Summary

### Store Flow
```
Input → Validate → Security Check → Language Detect →
Code Context Parse → Embed → Dedup Check → Store
```

### Recall Flow
```
Query → Parallel [Vector, BM25] → RRF Fuse →
Re-rank → Update Stats → Return
```

### Session Flow
```
Start: session_restore → Load state → Staleness check
Work:  Store decisions/errors as discovered
End:   session_save → Serialize state → Prune old
```
