# User Stories: claude-memory

## Document Information

| Field | Value |
|-------|-------|
| Version | 2.0 |
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

## Epic 1: Plugin Installation & Integration

### US-001: Single-Command Installation
**As a** Claude Code user,
**I want** to install claude-memory with a single command,
**So that** I can get started quickly without complex setup.

**Priority:** P0
**Traces To:** SK-001, PL-002

**Acceptance Criteria:**
- [ ] `/plugin install claude-memory` works
- [ ] Skill copied to ~/.claude/skills/
- [ ] MCP server configured in settings.json
- [ ] Hooks merged into settings
- [ ] Ollama model pulled if not present

**Story Points:** 5

---

### US-002: Skill Teaches Memory Patterns
**As a** Claude Code user,
**I want** Claude to understand when and how to use memory,
**So that** it stores and recalls information intelligently.

**Priority:** P0
**Traces To:** SK-001

**Acceptance Criteria:**
- [ ] SKILL.md teaches when to store (decisions, errors, patterns)
- [ ] SKILL.md teaches query formulation
- [ ] SKILL.md teaches memory type selection
- [ ] Progressive disclosure (metadata ~100 tokens, full ~2000)

**Story Points:** 5

---

### US-003: MCP Protocol Compliance
**As a** Claude Code user,
**I want** claude-memory to communicate reliably via MCP,
**So that** memory operations don't fail or cause errors.

**Priority:** P0
**Traces To:** MCP-001

**Acceptance Criteria:**
- [ ] JSON-RPC 2.0 messages handled correctly
- [ ] Errors return proper MCP error format
- [ ] No dropped messages under load
- [ ] Graceful handling of malformed requests

**Story Points:** 3

---

### US-004: Resource Exposure
**As a** Claude Code user,
**I want** to inspect memory state via MCP resources,
**So that** I can understand what's stored.

**Priority:** P1
**Traces To:** MCP-003

**Acceptance Criteria:**
- [ ] `memory://stats` shows statistics
- [ ] `memory://core` shows core memory blocks
- [ ] `memory://graph` shows knowledge graph summary
- [ ] Resources accessible via MCP protocol

**Story Points:** 3

---

### US-005: Discover Available Tools
**As a** Claude Code user,
**I want** to see what memory tools are available,
**So that** I know what capabilities I have.

**Priority:** P0
**Traces To:** MCP-002

**Acceptance Criteria:**
- [ ] 6 tools registered with descriptions
- [ ] Tool schemas define input/output
- [ ] Claude can list and describe tools
- [ ] Help text is clear and actionable

**Story Points:** 3

---

## Epic 2: Memory Storage Operations

### US-006: Store Project Facts
**As a** developer,
**I want** to store important facts about my project,
**So that** Claude remembers them in future sessions.

**Priority:** P0
**Traces To:** FR-010, MCP-002

**Acceptance Criteria:**
- [ ] `memory_store` accepts content and type
- [ ] Content is embedded for semantic search
- [ ] Stored with timestamp and project ID
- [ ] Returns confirmation with memory ID

**Example:**
```
Claude, remember that we use Zod for validation in this project.
> Stored memory: "This project uses Zod for validation" (fact)
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
> Recall: "This project uses Zod for validation" (relevance: 0.92)
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
> Finds memories mentioning "TS-001" exactly
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
> Deleted: "Express is the web framework" (reason: migrated to Fastify)
```

**Story Points:** 3

---

### US-011: Update Existing Memories
**As a** developer,
**I want** to update memories with new information,
**So that** I can correct or enhance existing facts.

**Priority:** P1
**Traces To:** SK-001 (skill orchestrates store + forget)

**Acceptance Criteria:**
- [ ] Skill orchestrates store + forget for updates
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
**I want** claude-memory to automatically sync my CLAUDE.md,
**So that** Claude knows my project conventions immediately.

**Priority:** P0
**Traces To:** FR-021, HK-002

**Acceptance Criteria:**
- [ ] Hook triggers on CLAUDE.md read
- [ ] Parsed and stored in core memory persona block
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
> Core memory (human) updated
```

**Story Points:** 5

---

### US-015: Long-Term Fact Storage
**As a** developer,
**I want** important facts stored permanently,
**So that** they persist across many sessions.

**Priority:** P0
**Traces To:** FR-022, HK-003

**Acceptance Criteria:**
- [ ] Facts stored in archival memory
- [ ] Include citations (source file + line)
- [ ] Searchable by semantic and keyword
- [ ] Hook logs file changes as facts

**Story Points:** 3

---

### US-016: Error Resolution Memory
**As a** developer,
**I want** Claude to remember how we solved errors,
**So that** it can help faster with similar issues.

**Priority:** P1
**Traces To:** FR-022, HK-004

**Acceptance Criteria:**
- [ ] Hook captures Bash errors automatically
- [ ] Error -> solution pairs stored
- [ ] Retrieved when similar errors occur
- [ ] Includes context (file, stack trace pattern)

**Example:**
```
Previously: "CORS error in API" -> "Add cors middleware"
Now: "Getting CORS blocked on /api/users"
> Recall: "Add cors middleware solved similar CORS error"
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
- [ ] RRF fusion combines results (k=60)
- [ ] Better recall than either alone

**Example:**
```
Query: "how to handle TS-001 validation"
> Semantic: finds validation-related memories
> BM25: finds memories with "TS-001" exactly
> RRF: combines both, ranks best matches first
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
**Traces To:** MCP-003

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
> UserService -> UserRepository -> Database
> UserService -> AuthMiddleware -> Session
```

**Story Points:** 5

---

## Epic 7: Context Engineering

### US-027: Automatic Context Compaction
**As a** developer,
**I want** claude-memory to automatically compact context when full,
**So that** I don't hit context limits mid-task.

**Priority:** P0
**Traces To:** FR-060, SK-002

**Acceptance Criteria:**
- [ ] Skill detects 95% context capacity
- [ ] Invokes compact.sh script
- [ ] Summarizes conversation history
- [ ] Extracts key facts to archival

**Story Points:** 8

---

### US-028: Preserve Key Decisions During Compact
**As a** developer,
**I want** important decisions preserved during compaction,
**So that** Claude doesn't forget critical context.

**Priority:** P0
**Traces To:** FR-060, SK-002

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
**Traces To:** FR-061, SK-003

**Acceptance Criteria:**
- [ ] Budget by category (core, working, archival, task)
- [ ] Current usage vs limits
- [ ] Warning when approaching limits
- [ ] Skill provides progressive disclosure

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

### US-031: Automatic Session Save
**As a** developer,
**I want** my session auto-saved when I exit,
**So that** I never lose my context.

**Priority:** P0
**Traces To:** FR-070, HK-005

**Acceptance Criteria:**
- [ ] Hook triggers on session end
- [ ] Persists full state automatically
- [ ] Includes working memory
- [ ] Includes core memory
- [ ] Includes conversation summary

**Story Points:** 5

---

### US-032: Automatic Session Restore
**As a** developer,
**I want** my previous session auto-restored when I start,
**So that** Claude has full context immediately.

**Priority:** P0
**Traces To:** FR-071, HK-001

**Acceptance Criteria:**
- [ ] Hook triggers on session start
- [ ] Working memory restored
- [ ] Core memory restored
- [ ] Summary injected to context

**Example:**
```
(session start)
> Restored: sess_abc123 (created 2026-01-16)
> Context: "We were implementing the user authentication flow..."
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
- [ ] Skill reads session storage
- [ ] Shows all sessions
- [ ] Includes creation time
- [ ] Includes summary/context preview

**Story Points:** 3

---

## Epic 9: Project Isolation

### US-034: Automatic Project Detection
**As a** developer,
**I want** claude-memory to auto-detect my project,
**So that** I don't need to configure anything.

**Priority:** P0
**Traces To:** FR-080, FR-081, HK-006

**Acceptance Criteria:**
- [ ] Detect git root or CLAUDE.md
- [ ] Create unique project hash
- [ ] Use separate database per project
- [ ] No manual configuration needed

**Story Points:** 3

---

### US-035: Automatic Project Switching
**As a** developer,
**I want** projects to switch automatically when I change directories,
**So that** I don't need to manually switch.

**Priority:** P0
**Traces To:** FR-082, HK-006

**Acceptance Criteria:**
- [ ] Hook detects directory change
- [ ] Saves current session first
- [ ] Loads target project memory
- [ ] Clear transition message

**Example:**
```
(cd to different project)
> Saved session for project-a
> Switched to project-b (47 memories)
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

## Epic 11: Plugin Distribution

### US-041: Plugin Manifest
**As a** plugin developer,
**I want** a standard manifest format,
**So that** claude-memory can be distributed as a package.

**Priority:** P0
**Traces To:** PL-001

**Acceptance Criteria:**
- [ ] `.claude-plugin/manifest.json` exists
- [ ] Defines skill, MCP, and hooks components
- [ ] Specifies dependencies
- [ ] Version tracking

**Story Points:** 3

---

### US-042: Repository Installation
**As a** developer,
**I want** to install from GitHub,
**So that** I can use development versions.

**Priority:** P0
**Traces To:** PL-002

**Acceptance Criteria:**
- [ ] `/plugin install github:user/claude-memory`
- [ ] Clones repository
- [ ] Runs install script
- [ ] Configures all components

**Example:**
```
/plugin install github:anthropics/claude-memory
> Cloning repository...
> Installing skill to ~/.claude/skills/memory/
> Configuring MCP server...
> Merging hooks...
> Pulling nomic-embed-text-v2-moe...
> Installation complete!
```

**Story Points:** 5

---

### US-043: Marketplace Distribution
**As a** developer,
**I want** claude-memory available in a marketplace,
**So that** discovery and installation is easy.

**Priority:** P2
**Traces To:** PL-003

**Acceptance Criteria:**
- [ ] `.claude-plugin/marketplace.json` exists
- [ ] Category and tags defined
- [ ] Screenshots provided
- [ ] Changelog maintained

**Story Points:** 3

---

## Epic 12: Hook Automation

### US-044: Error Learning Hook
**As a** developer,
**I want** errors captured automatically,
**So that** Claude learns from my mistakes.

**Priority:** P1
**Traces To:** HK-004

**Acceptance Criteria:**
- [ ] PostToolUse hook on Bash errors
- [ ] Extracts error message and context
- [ ] Stores as ERROR memory type
- [ ] Links to related code entities

**Story Points:** 3

---

### US-045: File Change Logging
**As a** developer,
**I want** file changes logged automatically,
**So that** Claude knows what was modified.

**Priority:** P1
**Traces To:** HK-003

**Acceptance Criteria:**
- [ ] PostToolUse hook on Edit|Write
- [ ] Logs file path and change summary
- [ ] Updates knowledge graph entities
- [ ] No manual action required

**Story Points:** 3

---

---

## Story Summary

### By Priority

| Priority | Count | Story Points |
|----------|-------|--------------|
| P0 (Must Have) | 28 | 127 |
| P1 (Should Have) | 15 | 60 |
| P2 (Nice to Have) | 2 | 8 |
| **Total** | **45** | **195** |

### By Epic

| Epic | Stories | Points |
|------|---------|--------|
| 1. Plugin Installation | 5 | 19 |
| 2. Memory Storage | 6 | 24 |
| 3. Memory Types | 6 | 28 |
| 4. Hybrid Search | 3 | 14 |
| 5. Embeddings | 3 | 11 |
| 6. Knowledge Graph | 3 | 18 |
| 7. Context Engineering | 4 | 19 |
| 8. Session Management | 3 | 13 |
| 9. Project Isolation | 3 | 13 |
| 10. Storage & Config | 4 | 14 |
| 11. Plugin Distribution | 3 | 11 |
| 12. Hook Automation | 2 | 6 |

---

## Traceability to Functional Requirements

| User Story | Functional Requirements |
|------------|------------------------|
| US-001 | SK-001, PL-002 |
| US-002 | SK-001 |
| US-003 | MCP-001 |
| US-004 | MCP-003 |
| US-005 | MCP-002 |
| US-006 | FR-010, MCP-002 |
| US-007 | FR-010 |
| US-008 | FR-011 |
| US-009 | FR-011 |
| US-010 | FR-012 |
| US-011 | SK-001 |
| US-012 | FR-020 |
| US-013 | FR-021, HK-002 |
| US-014 | FR-021 |
| US-015 | FR-022, HK-003 |
| US-016 | FR-022, HK-004 |
| US-017 | FR-023 |
| US-018 | FR-030, FR-031, FR-032 |
| US-019 | FR-033 |
| US-020 | MCP-003 |
| US-021 | FR-040, FR-041 |
| US-022 | FR-042 |
| US-023 | FR-043 |
| US-024 | FR-050, FR-051 |
| US-025 | FR-052 |
| US-026 | FR-053 |
| US-027 | FR-060, SK-002 |
| US-028 | FR-060, SK-002 |
| US-029 | FR-061, SK-003 |
| US-030 | FR-062 |
| US-031 | FR-070, HK-005 |
| US-032 | FR-071, HK-001 |
| US-033 | FR-072 |
| US-034 | FR-080, FR-081, HK-006 |
| US-035 | FR-082, HK-006 |
| US-036 | FR-083 |
| US-037 | FR-090 |
| US-038 | FR-091 |
| US-039 | FR-092 |
| US-040 | FR-100, FR-101, FR-102 |
| US-041 | PL-001 |
| US-042 | PL-002 |
| US-043 | PL-003 |
| US-044 | HK-004 |
| US-045 | HK-003 |

---

## Persona Mapping

| Persona | Key Stories |
|---------|-------------|
| Alex (Senior Dev) | US-006, US-008, US-018, US-027, US-031 |
| Sarah (Tech Lead) | US-020, US-024, US-030, US-036, US-039 |
| Jordan (OSS Maintainer) | US-034, US-035, US-036, US-032, US-042 |
| Morgan (AI-Curious Dev) | US-001, US-002, US-013, US-023, US-041 |

---

## Hybrid Architecture Alignment

This user stories document reflects the hybrid plugin architecture:

| Component | Related Stories |
|-----------|----------------|
| **Skill Layer** | US-002, US-011, US-027, US-028, US-029 |
| **MCP Server** | US-003, US-004, US-005, US-006, US-008, US-010 |
| **Hooks Layer** | US-013, US-015, US-016, US-031, US-032, US-034, US-035, US-044, US-045 |
| **Plugin Distribution** | US-001, US-041, US-042, US-043 |
