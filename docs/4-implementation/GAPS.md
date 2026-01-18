# Implementation Gaps Analysis

## Document Information

| Field | Value |
|-------|-------|
| Version | 1.0 |
| Date | 2026-01-18 |
| Status | Active |
| Coverage | P0: 93%, P1: 71%, P2: 30% |

---

## 1. Source Code Knowledge Gaps

### 1.1 No Language-Aware Memory Storage

**Current State:**
- Memories stored as plain text strings
- No awareness of programming language context
- Citations are just strings like `"src/auth/config.ts:15"`

**Gap:**
- Cannot filter memories by language (TypeScript, Python, Rust, etc.)
- Cannot return code-specific memories when working in a language context
- No syntax-aware embedding (code vs prose have different semantics)

**Proposed Enhancement:**
```typescript
interface MemoryCreateInput {
  content: string;
  type?: MemoryType;
  // NEW FIELDS
  language?: 'typescript' | 'python' | 'rust' | 'go' | 'javascript' | 'other';
  codeContext?: {
    filePath: string;
    startLine: number;
    endLine: number;
    symbolName?: string;  // Function, class, or variable name
    symbolType?: 'function' | 'class' | 'variable' | 'type' | 'module';
  };
}
```

**Impact:** Would allow queries like `memory_recall({ query: "authentication", language: "typescript" })`

---

### 1.2 No Code Entity Auto-Extraction

**Current State:**
- Knowledge graph entities must be created manually
- No parsing of code to extract functions, classes, imports

**Gap:**
- When storing `"UserService handles authentication"`, we don't auto-create a `UserService` entity
- No relationship extraction from code (imports, function calls)

**Proposed Enhancement:**
```typescript
// On memory_store, optionally parse citations for entities
function extractEntitiesFromCitation(citation: string): Entity[] {
  // Parse "src/services/UserService.ts:45"
  // -> Create FILE entity for UserService.ts
  // -> Optionally create FUNCTION entity if line range maps to a function
}
```

**User Story:** US-007 (Entity Extraction Suggestions) - marked P2

---

### 1.3 No Code Snippet Storage

**Current State:**
- Store descriptions of code, not actual code snippets
- No diff tracking or version awareness

**Gap:**
- Cannot recall "show me the authentication code pattern"
- Cannot track how code evolved over time

**Proposed Enhancement:**
```typescript
interface MemoryCreateInput {
  content: string;
  // NEW
  codeSnippet?: {
    code: string;
    language: string;
    hash: string;  // To detect changes
  };
}
```

---

### 1.4 No AST-Based Understanding

**Current State:**
- Text-based search only
- No understanding of code structure

**Gap:**
- Query "functions that call UserService" requires grep, not memory
- Cannot build call graphs from stored knowledge

**Proposed Enhancement:**
- Integrate with tree-sitter for language-agnostic parsing
- Store AST-derived relationships in knowledge graph

---

## 2. User Story Gaps (Not Implemented)

### 2.1 P0 Gaps (Critical)

| Story | Title | Gap | Effort |
|-------|-------|-----|--------|
| US-014 | Learn User Preferences with Approval | `preference` type exists but no approval UX flow | Medium |
| US-046 | Automatic Staleness Detection | Soft delete exists but no automated flagging | High |

**US-014 Detail:**
- Need: "I noticed you prefer X. Should I remember this?" flow
- Missing: Detection logic, approval prompt, feedback mechanism
- Fix: Add `memory_propose` tool that stores with `status: 'pending_approval'`

**US-046 Detail:**
- Need: Auto-flag memories not accessed in X sessions
- Missing: Access tracking across sessions, flagging job
- Fix: Add `flagged_at` column, background check on session start

---

### 2.2 P1 Gaps (Important)

| Story | Title | Gap | Effort |
|-------|-------|-----|--------|
| US-011 | Update Memory Atomically | `memory_update` tool exists but not fully tested | Low |
| US-017 | Flag Potentially Stale | No scheduled scan for stale memories | Medium |
| US-040 | Configure Behavior | Config file exists but no runtime reconfiguration | Medium |
| US-045 | Significant File Change | Hook exists but no significance filter | Medium |
| US-047 | Validate Memory on Recall | No file existence/content verification | Medium |
| US-048 | Confidence Decay | No feedback loop for wrong recalls | High |

---

### 2.3 P2 Gaps (Nice to Have)

| Story | Title | Gap |
|-------|-------|-----|
| US-004 | Resource Exposure | `memory://stats` resource not implemented |
| US-007 | Entity Extraction | Auto-extraction with human verification |
| US-020 | Inspect Search Results | Debug info in search response |
| US-025 | Historical Knowledge | Bi-temporal queries not exposed via tool |
| US-029 | Token Budget Visibility | No budget tracking |
| US-030 | Memory Health Check | No health endpoint |
| US-039 | Export and Backup | No JSON export |
| US-049 | Session Start Memory Diff | No file change detection |

---

## 3. Architectural Gaps

### 3.1 No Memory Relationships

**Current State:**
- Memories are independent records
- `memory_forget` doesn't link to superseding memory

**Gap:**
- Cannot express "Memory B supersedes Memory A"
- No version history for updated memories

**Proposed Fix:**
```sql
ALTER TABLE memories ADD COLUMN supersedes_id TEXT REFERENCES memories(id);
ALTER TABLE memories ADD COLUMN version INTEGER DEFAULT 1;
```

---

### 3.2 No Re-Embedding on Model Change

**Current State:**
- `selectModel()` allows model change
- Existing embeddings become incompatible

**Gap:**
- Mixed embedding dimensions cause search failures
- No migration path for existing memories

**Proposed Fix:**
- Track `embedding_model` per memory
- Add `reembed_all()` function
- Background job for re-embedding queue

---

### 3.3 No Deduplication Beyond Content Hash

**Current State:**
- Exact duplicate detection via SHA256 hash

**Gap:**
- Near-duplicate content stored separately
- "Uses PostgreSQL" and "We use PostgreSQL for database" both stored

**Proposed Fix:**
- Semantic similarity check before storing
- Threshold: If >0.95 cosine similarity, warn/merge

---

### 3.4 No Memory Statistics Resource

**Current State:**
- Count methods exist in repository
- Not exposed via MCP resource

**Gap:**
- Cannot query `memory://stats` for dashboard

**Proposed Fix:**
```typescript
server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
  if (request.params.uri === 'memory://stats') {
    return {
      contents: [{
        uri: 'memory://stats',
        mimeType: 'application/json',
        text: JSON.stringify({
          totalMemories: repo.countByProject(projectId),
          byType: repo.countByType(projectId),
          embeddingProvider: embeddingService.currentProvider,
          // ...
        })
      }]
    };
  }
});
```

---

### 3.5 Session Hooks Not Verified with Claude Code

**Current State:**
- `session-restore.sh` and `session-save.sh` scripts exist
- `hooks/settings.json` defines hook configuration

**Gap:**
- Not tested with actual Claude Code hook system
- Hook trigger events may differ from implementation

**Proposed Fix:**
- Test with Claude Code CLI
- Verify `PreToolUse` and `SessionEnd` events work

---

### 3.6 BM25 Tokenization is Basic

**Current State:**
- SQLite FTS5 default tokenizer
- No code-specific tokenization

**Gap:**
- `getUserById` not split into `get`, `User`, `By`, `Id`
- CamelCase and snake_case not handled

**Proposed Fix:**
```sql
CREATE VIRTUAL TABLE memories_fts USING fts5(
  content,
  tokenize = 'unicode61 tokenchars _'  -- Split on underscore
);
```
- Or use custom tokenizer for camelCase

---

### 3.7 No CLI for Manual Memory Management

**Current State:**
- MCP tools only accessible via Claude Code

**Gap:**
- Cannot inspect/manage memories without Claude
- No `claude-memory list`, `claude-memory search`, etc.

**Proposed Fix:**
- Add CLI wrapper around MCP tools
- `npx claude-memory search "authentication"`

---

## 4. Integration Gaps

### 4.1 Knowledge Graph Not Connected to memory_store

**Current State:**
- `memory_store` creates memories
- Entities/relations created separately

**Gap:**
- No automatic entity extraction from stored memories
- Knowledge graph requires manual population

**Proposed Fix:**
- Option in `memory_store`: `extractEntities: true`
- Parse citations and content for entity candidates

---

### 4.2 No Feedback Mechanism for Wrong Recalls

**Current State:**
- `memory_recall` returns results
- No way to mark "this was wrong"

**Gap:**
- Cannot learn from mistakes (US-048)
- Confidence doesn't decay

**Proposed Fix:**
```typescript
// New tool
{
  name: 'memory_feedback',
  inputSchema: {
    properties: {
      id: { type: 'string' },
      feedback: { enum: ['helpful', 'outdated', 'wrong'] },
    }
  }
}
```

---

### 4.3 No Context Budget Tracking

**Current State:**
- SKILL.md mentions "budget awareness"
- No actual token counting

**Gap:**
- Cannot enforce "recall 5-10 memories, not 50"
- No warning when approaching limits

**Proposed Fix:**
- Estimate tokens per memory (~100-200)
- Add `maxTokens` parameter to `memory_recall`

---

## 5. Priority Recommendations

### Immediate (P0 gaps)

1. **US-014**: Add preference approval flow
2. **US-046**: Add staleness flagging on session start

### Short-term (Source code knowledge)

3. **Language field**: Add `language` to memory schema
4. **Code context**: Add `codeContext` for file/line/symbol tracking
5. **Search by language**: Filter recalls by programming language

### Medium-term (Architecture)

6. **Memory relationships**: Supersedes/version tracking
7. **Re-embedding**: Handle model changes gracefully
8. **Stats resource**: Expose `memory://stats`

### Long-term (P2 features)

9. **Entity extraction**: Auto-suggest from citations
10. **CLI**: Standalone memory management tool
11. **Feedback loop**: Learn from wrong recalls

---

## 6. Summary

| Category | Gaps | Estimated Effort |
|----------|------|------------------|
| Source Code Knowledge | 4 | High |
| User Story (P0) | 2 | Medium |
| User Story (P1) | 6 | Medium |
| User Story (P2) | 8 | Low-Medium |
| Architectural | 7 | Medium-High |
| Integration | 3 | Medium |
| **Total** | **30** | |

### Critical Path

To make claude-memory production-ready:

1. Fix P0 gaps (US-014, US-046)
2. Add language/code context to memories
3. Implement memory relationships
4. Add feedback mechanism
5. Test with real Claude Code sessions
