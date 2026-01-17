# User Stories: claude-memory

## Document Information

| Field | Value |
|-------|-------|
| Version | 1.0 |
| Date | 2026-01-16 |
| Status | Draft |

## Story Format

Each user story follows the format:
> As a [persona], I want [goal] so that [benefit].

Stories are prioritized as:
- **P0**: Must Have (core functionality)
- **P1**: Should Have (important features)
- **P2**: Nice to Have (enhancements)

---

## Epic 1: Core MCP Integration

### US-001: Connect to Claude Code
**As a** Claude Code user,
**I want** claude-memory to integrate seamlessly with Claude Code,
**So that** I can use memory features without leaving my workflow.

**Priority:** P0
**Traces To:** FR-001

**Acceptance Criteria:**
- [ ] Server starts with `npx claude-memory`
- [ ] Registers with Claude Code via MCP
- [ ] Tools appear in Claude's available tools
- [ ] No manual configuration required

**Story Points:** 5

---

### US-002: Reliable Protocol Communication
**As a** Claude Code user,
**I want** claude-memory to communicate reliably with Claude,
**So that** memory operations don't fail or cause errors.

**Priority:** P0
**Traces To:** FR-001

**Acceptance Criteria:**
- [ ] JSON-RPC 2.0 messages handled correctly
- [ ] Errors return proper MCP error format
- [ ] No dropped messages under load
- [ ] Graceful handling of malformed requests

**Story Points:** 3

---

### US-003: Discover Available Tools
**As a** Claude Code user,
**I want** to see what memory tools are available,
**So that** I know what capabilities I have.

**Priority:** P0
**Traces To:** FR-002

**Acceptance Criteria:**
- [ ] All 14 tools registered with descriptions
- [ ] Tool schemas define input/output
- [ ] Claude can list and describe tools
- [ ] Help text is clear and actionable

**Story Points:** 3

---

### US-004: Use Memory Tools in Prompts
**As a** Claude Code user,
**I want** Claude to automatically use memory tools when helpful,
**So that** I don't have to explicitly request memory operations.

**Priority:** P0
**Traces To:** FR-002

**Acceptance Criteria:**
- [ ] Claude recalls relevant memories automatically
- [ ] Claude stores important facts without prompting
- [ ] Tools integrate naturally in conversation
- [ ] No intrusive memory notifications

**Story Points:** 5

---

### US-005: Tool Error Handling
**As a** Claude Code user,
**I want** memory tool errors to be handled gracefully,
**So that** errors don't disrupt my workflow.

**Priority:** P0
**Traces To:** FR-002

**Acceptance Criteria:**
- [ ] Errors include actionable messages
- [ ] Failed tools don't crash the server
- [ ] Claude can retry failed operations
- [ ] Degraded mode for persistent issues

**Story Points:** 3

---

## Epic 2: Memory Storage Operations

### US-006: Store Project Facts
**As a** developer,
**I want** to store important facts about my project,
**So that** Claude remembers them in future sessions.

**Priority:** P0
**Traces To:** FR-010

**Acceptance Criteria:**
- [ ] `memory_store` accepts content and type
- [ ] Content is embedded for semantic search
- [ ] Stored with timestamp and project ID
- [ ] Returns confirmation with memory ID

**Example:**
```
Claude, remember that we use Zod for validation in this project.
→ Stored memory: "This project uses Zod for validation" (fact)
```

**Story Points:** 5

---

### US-007: Auto-Extract Entities
**As a** developer,
**I want** claude-memory to automatically extract entities from stored content,
**So that** I can build a knowledge graph without manual effort.

**Priority:** P1
**Traces To:** FR-010

**Acceptance Criteria:**
- [ ] File names extracted as File entities
- [ ] Function names extracted as Function entities
- [ ] Type names extracted as Type entities
- [ ] Relationships inferred from context

**Story Points:** 5

---

### US-008: Search Memories Semantically
**As a** developer,
**I want** to search my memories using natural language,
**So that** I can find relevant information without exact keywords.

**Priority:** P0
**Traces To:** FR-011

**Acceptance Criteria:**
- [ ] `memory_recall` accepts natural language query
- [ ] Returns semantically similar memories
- [ ] Results sorted by relevance
- [ ] Includes confidence scores

**Example:**
```
What validation library do we use?
→ Recall: "This project uses Zod for validation" (relevance: 0.92)
```

**Story Points:** 5

---

### US-009: Search Memories by Keyword
**As a** developer,
**I want** to search memories by exact keywords,
**So that** I can find specific identifiers or terms.

**Priority:** P0
**Traces To:** FR-011

**Acceptance Criteria:**
- [ ] BM25 search for exact term matching
- [ ] Boolean operators (AND, OR, NOT)
- [ ] Finds code identifiers accurately
- [ ] Combined with semantic via RRF

**Example:**
```
memory_recall "TS-001"
→ Finds memories mentioning "TS-001" exactly
```

**Story Points:** 3

---

### US-010: Forget Outdated Information
**As a** developer,
**I want** to remove memories that are no longer accurate,
**So that** Claude doesn't use outdated information.

**Priority:** P0
**Traces To:** FR-012

**Acceptance Criteria:**
- [ ] `memory_forget` by ID or query
- [ ] Soft delete (recoverable)
- [ ] Records reason for deletion
- [ ] Excluded from future searches

**Example:**
```
Forget that we use Express - we migrated to Fastify.
→ Deleted: "Express is the web framework" (reason: migrated to Fastify)
```

**Story Points:** 3

---

### US-011: Update Existing Memories
**As a** developer,
**I want** to update memories with new information,
**So that** I can correct or enhance existing facts.

**Priority:** P1
**Traces To:** FR-013

**Acceptance Criteria:**
- [ ] `memory_update` by ID
- [ ] Updates content and re-embeds
- [ ] Can mark as superseding old version
- [ ] Conflict resolution (newer wins)

**Story Points:** 3

---

## Epic 3: Memory Types

### US-012: Working Memory for Current Task
**As a** developer,
**I want** Claude to maintain working memory during my session,
**So that** it doesn't forget what we discussed earlier.

**Priority:** P0
**Traces To:** FR-020

**Acceptance Criteria:**
- [ ] Recent tool calls cached
- [ ] Current task context maintained
- [ ] Scratchpad for temporary data
- [ ] Cleared on session end

**Story Points:** 5

---

### US-013: Project Persona from CLAUDE.md
**As a** developer,
**I want** claude-memory to automatically load my CLAUDE.md,
**So that** Claude knows my project conventions immediately.

**Priority:** P0
**Traces To:** FR-021

**Acceptance Criteria:**
- [ ] CLAUDE.md parsed on first access
- [ ] Stored in core memory persona block
- [ ] Re-parsed when file changes
- [ ] Included in every response context

**Story Points:** 5

---

### US-014: Self-Editing Core Memory
**As a** developer,
**I want** Claude to update its understanding of my preferences,
**So that** it learns and adapts over time.

**Priority:** P0
**Traces To:** FR-021

**Acceptance Criteria:**
- [ ] Claude can edit persona, human, goals, project blocks
- [ ] Edits persisted per project
- [ ] User can review/edit blocks
- [ ] Changes reflected immediately

**Example:**
```
Claude learns: "User prefers single-line if statements without braces"
→ Core memory (human) updated
```

**Story Points:** 5

---

### US-015: Long-Term Fact Storage
**As a** developer,
**I want** important facts stored permanently,
**So that** they persist across many sessions.

**Priority:** P0
**Traces To:** FR-022

**Acceptance Criteria:**
- [ ] Facts stored in archival memory
- [ ] Include citations (source file + line)
- [ ] Searchable by semantic and keyword
- [ ] Survive server restarts

**Story Points:** 3

---

### US-016: Error Resolution Memory
**As a** developer,
**I want** Claude to remember how we solved errors,
**So that** it can help faster with similar issues.

**Priority:** P1
**Traces To:** FR-022

**Acceptance Criteria:**
- [ ] Error → solution pairs stored
- [ ] Retrieved when similar errors occur
- [ ] Includes context (file, stack trace pattern)
- [ ] Ranked by relevance to current error

**Example:**
```
Previously: "CORS error in API" → "Add cors middleware"
Now: "Getting CORS blocked on /api/users"
→ Recall: "Add cors middleware solved similar CORS error"
```

**Story Points:** 5

---

### US-017: Memory Consolidation
**As a** developer,
**I want** claude-memory to clean up and organize memories,
**So that** storage stays efficient and relevant.

**Priority:** P1
**Traces To:** FR-023

**Acceptance Criteria:**
- [ ] Old memories decay in relevance
- [ ] Duplicate memories merged
- [ ] Contradicted facts marked/removed
- [ ] Runs automatically on session end

**Story Points:** 5

---

## Epic 4: Hybrid Search

### US-018: Best-of-Both-Worlds Search
**As a** developer,
**I want** search to find both semantic matches AND exact keywords,
**So that** I don't miss relevant memories.

**Priority:** P0
**Traces To:** FR-030, FR-031, FR-032

**Acceptance Criteria:**
- [ ] Vector search for semantic similarity
- [ ] BM25 for exact keyword matching
- [ ] RRF fusion combines results
- [ ] Better recall than either alone

**Example:**
```
Query: "how to handle TS-001 validation"
→ Semantic: finds validation-related memories
→ BM25: finds memories with "TS-001" exactly
→ RRF: combines both, ranks best matches first
```

**Story Points:** 8

---

### US-019: Recency-Aware Search
**As a** developer,
**I want** recent memories to rank higher,
**So that** Claude uses the most current information.

**Priority:** P1
**Traces To:** FR-033

**Acceptance Criteria:**
- [ ] Recent memories boosted in ranking
- [ ] Decay factor configurable
- [ ] Old memories still findable
- [ ] Access frequency also considered

**Story Points:** 3

---

### US-020: Inspect Search Results
**As a** developer,
**I want** to see how search results were ranked,
**So that** I can understand and tune behavior.

**Priority:** P1
**Traces To:** FR-003

**Acceptance Criteria:**
- [ ] Search stats in response
- [ ] Vector vs BM25 match counts
- [ ] Individual relevance scores
- [ ] Latency measurements

**Story Points:** 3

---

## Epic 5: Embeddings

### US-021: Local Embedding Generation
**As a** developer,
**I want** embeddings generated locally via Ollama,
**So that** my data stays private and there's no API cost.

**Priority:** P0
**Traces To:** FR-040, FR-041

**Acceptance Criteria:**
- [ ] Connects to Ollama on localhost
- [ ] Uses nomic-embed-text-v2-moe model
- [ ] Generates 768 or 256-dim vectors
- [ ] Supports LM Studio as fallback

**Story Points:** 5

---

### US-022: Embedding Caching
**As a** developer,
**I want** embeddings cached to avoid recomputation,
**So that** repeated content is fast.

**Priority:** P0
**Traces To:** FR-042

**Acceptance Criteria:**
- [ ] Embeddings stored in SQLite BLOB
- [ ] Keyed by content hash
- [ ] Cache hit avoids API call
- [ ] Invalidated on content change

**Story Points:** 3

---

### US-023: Work Without Embedding Server
**As a** developer,
**I want** claude-memory to work even if Ollama isn't running,
**So that** I can still use basic features.

**Priority:** P0
**Traces To:** FR-043

**Acceptance Criteria:**
- [ ] Detect embedding server unavailable
- [ ] Fall back to BM25-only search
- [ ] Clear warning message with instructions
- [ ] Queue embeddings for later generation

**Example:**
```
Warning: Embedding server not available. Using keyword search only.
To enable semantic search, run: ollama serve
```

**Story Points:** 3

---

## Epic 6: Knowledge Graph

### US-024: Track Code Entities
**As a** developer,
**I want** claude-memory to track entities in my codebase,
**So that** it understands code structure.

**Priority:** P1
**Traces To:** FR-050, FR-051

**Acceptance Criteria:**
- [ ] File entities with paths
- [ ] Function entities with signatures
- [ ] Type entities with definitions
- [ ] Relationships between entities

**Story Points:** 8

---

### US-025: Historical Knowledge Queries
**As a** developer,
**I want** to query what was true at a past point in time,
**So that** I can understand how decisions evolved.

**Priority:** P2
**Traces To:** FR-052

**Acceptance Criteria:**
- [ ] Bi-temporal model (event + ingestion time)
- [ ] Query: "What did we think on date X?"
- [ ] Valid from/to on relationships
- [ ] Changes visible over time

**Story Points:** 5

---

### US-026: Explore Entity Relationships
**As a** developer,
**I want** to explore how entities are connected,
**So that** I can understand dependencies and impacts.

**Priority:** P1
**Traces To:** FR-053

**Acceptance Criteria:**
- [ ] `graph_query` finds connected entities
- [ ] `shortest_path` between entities
- [ ] `get_subgraph` extracts portion
- [ ] Visualizable output format

**Example:**
```
graph_query "find_connected" entity="UserService" depth=2
→ UserService → UserRepository → Database
→ UserService → AuthMiddleware → Session
```

**Story Points:** 5

---

## Epic 7: Context Engineering

### US-027: Automatic Context Compaction
**As a** developer,
**I want** claude-memory to automatically compact context when full,
**So that** I don't hit context limits mid-task.

**Priority:** P0
**Traces To:** FR-060

**Acceptance Criteria:**
- [ ] Trigger at 95% context capacity
- [ ] Summarize conversation history
- [ ] Extract key facts to archival
- [ ] Replace verbose with summary

**Story Points:** 8

---

### US-028: Preserve Key Decisions During Compact
**As a** developer,
**I want** important decisions preserved during compaction,
**So that** Claude doesn't forget critical context.

**Priority:** P0
**Traces To:** FR-060

**Acceptance Criteria:**
- [ ] Decisions explicitly extracted
- [ ] Stored in archival before summarizing
- [ ] Cited in summary
- [ ] Available for future recall

**Story Points:** 5

---

### US-029: Token Budget Visibility
**As a** developer,
**I want** to see how context budget is allocated,
**So that** I can understand what's using space.

**Priority:** P1
**Traces To:** FR-061

**Acceptance Criteria:**
- [ ] Budget by category (core, working, archival, task)
- [ ] Current usage vs limits
- [ ] Warning when approaching limits
- [ ] Available via `context_status`

**Story Points:** 3

---

### US-030: Memory and Context Health Check
**As a** developer,
**I want** to check the health of claude-memory,
**So that** I can diagnose issues.

**Priority:** P1
**Traces To:** FR-062

**Acceptance Criteria:**
- [ ] Embedding server status
- [ ] Database health
- [ ] Memory counts by type
- [ ] Storage size
- [ ] Last consolidation time

**Story Points:** 3

---

## Epic 8: Session Management

### US-031: Save Session State
**As a** developer,
**I want** to save my current session,
**So that** I can continue later where I left off.

**Priority:** P0
**Traces To:** FR-070

**Acceptance Criteria:**
- [ ] `session_save` persists full state
- [ ] Includes working memory
- [ ] Includes core memory
- [ ] Includes conversation summary

**Example:**
```
session_save
→ Session saved: sess_abc123 (2026-01-16 14:30)
```

**Story Points:** 5

---

### US-032: Restore Previous Session
**As a** developer,
**I want** to restore a previous session,
**So that** Claude has full context immediately.

**Priority:** P0
**Traces To:** FR-071

**Acceptance Criteria:**
- [ ] `session_restore` loads state
- [ ] Working memory restored
- [ ] Core memory restored
- [ ] Summary injected to context

**Example:**
```
session_restore
→ Restored: sess_abc123 (created 2026-01-16)
→ Context: "We were implementing the user authentication flow..."
```

**Story Points:** 5

---

### US-033: List Available Sessions
**As a** developer,
**I want** to see what sessions are available,
**So that** I can choose which to restore.

**Priority:** P1
**Traces To:** FR-072

**Acceptance Criteria:**
- [ ] `session_list` shows all sessions
- [ ] Includes creation time
- [ ] Includes summary/context preview
- [ ] Most recent first

**Story Points:** 3

---

## Epic 9: Project Isolation

### US-034: Automatic Project Detection
**As a** developer,
**I want** claude-memory to auto-detect my project,
**So that** I don't need to configure anything.

**Priority:** P0
**Traces To:** FR-080, FR-081

**Acceptance Criteria:**
- [ ] Detect git root or CLAUDE.md
- [ ] Create unique project hash
- [ ] Use separate database per project
- [ ] No manual configuration needed

**Story Points:** 3

---

### US-035: Switch Between Projects
**As a** developer,
**I want** to switch between projects,
**So that** I can work on multiple codebases.

**Priority:** P0
**Traces To:** FR-082

**Acceptance Criteria:**
- [ ] `project_switch` changes active project
- [ ] Saves current session first
- [ ] Loads target project memory
- [ ] Clear transition message

**Example:**
```
project_switch path="/Users/me/other-project"
→ Saved session for project-a
→ Switched to project-b (47 memories)
```

**Story Points:** 5

---

### US-036: No Cross-Project Contamination
**As a** developer,
**I want** project memories to be completely isolated,
**So that** one project's context doesn't leak to another.

**Priority:** P0
**Traces To:** FR-083

**Acceptance Criteria:**
- [ ] Memories tagged with project ID
- [ ] Cross-project retrieval blocked
- [ ] Validation at search time
- [ ] <5% contamination rate in tests

**Story Points:** 5

---

## Epic 10: Storage and Configuration

### US-037: Reliable SQLite Storage
**As a** developer,
**I want** claude-memory to use reliable storage,
**So that** I don't lose my memories.

**Priority:** P0
**Traces To:** FR-090

**Acceptance Criteria:**
- [ ] SQLite with WAL mode
- [ ] Crash-safe (no data loss)
- [ ] Automatic recovery
- [ ] Optimized pragmas for performance

**Story Points:** 3

---

### US-038: Database Schema Upgrades
**As a** developer,
**I want** database upgrades to be automatic,
**So that** updates don't break my data.

**Priority:** P1
**Traces To:** FR-091

**Acceptance Criteria:**
- [ ] Schema version tracked
- [ ] Automatic migration on start
- [ ] Data preserved during migration
- [ ] Rollback if migration fails

**Story Points:** 5

---

### US-039: Export and Backup Data
**As a** developer,
**I want** to export my memory data,
**So that** I can back it up or migrate.

**Priority:** P2
**Traces To:** FR-092

**Acceptance Criteria:**
- [ ] Export to JSON format
- [ ] Import from JSON
- [ ] Selective export by type
- [ ] Database file backup

**Story Points:** 3

---

### US-040: Configure Behavior
**As a** developer,
**I want** to customize claude-memory behavior,
**So that** it fits my workflow.

**Priority:** P1
**Traces To:** FR-100, FR-101, FR-102

**Acceptance Criteria:**
- [ ] Global config in `~/.claude-memory/config.json`
- [ ] Project override in `.claude-memory.json`
- [ ] Environment variable support
- [ ] Sensible defaults for everything

**Story Points:** 3

---

## Story Summary

### By Priority

| Priority | Count | Story Points |
|----------|-------|--------------|
| P0 (Must Have) | 26 | 112 |
| P1 (Should Have) | 12 | 49 |
| P2 (Nice to Have) | 2 | 8 |
| **Total** | **40** | **169** |

### By Epic

| Epic | Stories | Points |
|------|---------|--------|
| 1. Core MCP | 5 | 19 |
| 2. Memory Storage | 6 | 24 |
| 3. Memory Types | 6 | 28 |
| 4. Hybrid Search | 3 | 14 |
| 5. Embeddings | 3 | 11 |
| 6. Knowledge Graph | 3 | 18 |
| 7. Context Engineering | 4 | 19 |
| 8. Session Management | 3 | 13 |
| 9. Project Isolation | 3 | 13 |
| 10. Storage & Config | 4 | 14 |

---

## Traceability to Functional Requirements

| User Story | Functional Requirements |
|------------|------------------------|
| US-001 | FR-001 |
| US-002 | FR-001 |
| US-003 | FR-002 |
| US-004 | FR-002 |
| US-005 | FR-002 |
| US-006 | FR-010 |
| US-007 | FR-010 |
| US-008 | FR-011 |
| US-009 | FR-011 |
| US-010 | FR-012 |
| US-011 | FR-013 |
| US-012 | FR-020 |
| US-013 | FR-021 |
| US-014 | FR-021 |
| US-015 | FR-022 |
| US-016 | FR-022 |
| US-017 | FR-023 |
| US-018 | FR-030, FR-031, FR-032 |
| US-019 | FR-033 |
| US-020 | FR-003 |
| US-021 | FR-040, FR-041 |
| US-022 | FR-042 |
| US-023 | FR-043 |
| US-024 | FR-050, FR-051 |
| US-025 | FR-052 |
| US-026 | FR-053 |
| US-027 | FR-060 |
| US-028 | FR-060 |
| US-029 | FR-061 |
| US-030 | FR-062 |
| US-031 | FR-070 |
| US-032 | FR-071 |
| US-033 | FR-072 |
| US-034 | FR-080, FR-081 |
| US-035 | FR-082 |
| US-036 | FR-083 |
| US-037 | FR-090 |
| US-038 | FR-091 |
| US-039 | FR-092 |
| US-040 | FR-100, FR-101, FR-102 |

---

## Persona Mapping

| Persona | Key Stories |
|---------|-------------|
| Alex (Senior Dev) | US-006, US-008, US-018, US-027, US-031 |
| Sarah (Tech Lead) | US-020, US-024, US-030, US-036, US-039 |
| Jordan (OSS Maintainer) | US-034, US-035, US-036, US-032 |
| Morgan (AI-Curious Dev) | US-001, US-004, US-013, US-023 |
