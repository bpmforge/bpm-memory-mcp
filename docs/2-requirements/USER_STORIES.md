# User Stories: claude-memory

## Document Information

| Field | Value |
|-------|-------|
| Version | 3.0 |
| Date | 2026-01-17 |
| Status | Draft |
| Review | Critically analyzed from AI perspective |

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

**AI Analysis:** Necessary for adoption. Does not directly save tokens but enables the system.

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
- [ ] Skill MUST stay under 2000 tokens to maintain efficiency

**Story Points:** 5

**AI Analysis:** HIGH VALUE. Without guidance, I don't know when to store. The skill compounds savings across every recall. Token math: Skill load (2000) + recall (200) vs re-debugging (3000+) = 50%+ savings on repeated issues.

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

**AI Analysis:** Foundation. Required for anything to work.

---

### US-004: Resource Exposure
**As a** Claude Code user,
**I want** to inspect memory state via MCP resources,
**So that** I can understand what's stored.

**Priority:** P2 *(Changed from P1)*
**Traces To:** MCP-003

**Acceptance Criteria:**
- [ ] `memory://stats` shows statistics
- [ ] `memory://core` shows core memory blocks
- [ ] `memory://graph` shows knowledge graph summary
- [ ] Resources accessible via MCP protocol

**Story Points:** 3

**AI Analysis:** Debugging feature. I don't need to check "how many memories" in normal operation. Lowered to P2.

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

**AI Analysis:** Standard MCP requirement.

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

**AI Analysis:** HIGH VALUE. Core value proposition. Without memory: "What validation library?" (wasted turn). With memory: I just know. Token savings: 90% on repeated lookups (grep + read ~1000 tokens vs recall ~200 tokens).

---

### US-007: Entity Extraction Suggestions
**As a** developer,
**I want** claude-memory to suggest entities from stored content,
**So that** I can build a knowledge graph with human verification.

**Priority:** P2 *(Changed from P1, renamed from "Auto-Extract")*
**Traces To:** FR-010

**Acceptance Criteria:**
- [ ] Suggest file names as potential File entities
- [ ] Suggest function names as potential Function entities
- [ ] Suggest type names as potential Type entities
- [ ] **REQUIRE confirmation before creating entities**
- [ ] Track extraction confidence scores

**Story Points:** 5

**AI Analysis:** RISKY without human verification. NLP entity extraction is ~80% accurate on technical content. 20% wrong extractions pollute the graph. Changed to suggestions-with-confirmation model.

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

**AI Analysis:** HIGH VALUE. Essential for retrieval. "What validation library" must find "We use Zod" even without exact keyword match.

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

**AI Analysis:** HIGH VALUE. Code has identifiers (TS-001, FR-XXX) that need exact match. Semantic alone would miss these.

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

**AI Analysis:** VALID but relies on user telling me. Real problem: nobody remembers to tell me when things change. See US-046 (Staleness Detection) for automatic handling.

---

### US-011: Update Memory Atomically
**As a** developer,
**I want** to update memories in a single atomic operation,
**So that** I don't end up with contradictory information.

**Priority:** P1
**Traces To:** MCP-002 *(Changed: now MCP tool, not skill composition)*

**Acceptance Criteria:**
- [ ] `memory_update` MCP tool (atomic operation)
- [ ] Updates content and re-embeds in single transaction
- [ ] Marks old version as superseded (maintains history)
- [ ] Fails completely or succeeds completely (no partial state)

**Story Points:** 3

**AI Analysis:** REDESIGNED. Original "skill orchestrates store + forget" was non-atomic and risked inconsistent state. Now a proper atomic MCP tool.

---

## Epic 3: Memory Types

### US-012: Context Overflow Protection
**As a** developer,
**I want** essential context preserved when my session gets long,
**So that** I don't lose important information to context limits.

**Priority:** P0 *(Clarified purpose - was "Working Memory")*
**Traces To:** FR-020

**Acceptance Criteria:**
- [ ] Track essential items that must survive compaction
- [ ] Current task goals preserved
- [ ] Recent critical tool results cached
- [ ] Scratchpad for in-progress calculations
- [ ] Integrates with US-027 (compaction)

**Story Points:** 5

**AI Analysis:** CLARIFIED. Original was vague ("working memory for current task"). My context window IS working memory. This story is specifically about what survives COMPACTION - the essential bits that must be preserved when context is summarized.

---

### US-013: Project Identity from CLAUDE.md
**As a** developer,
**I want** claude-memory to parse my CLAUDE.md into structured blocks,
**So that** key project info is always accessible efficiently.

**Priority:** P1 *(Changed from P0)*
**Traces To:** FR-021, HK-002

**Acceptance Criteria:**
- [ ] Hook triggers on CLAUDE.md read
- [ ] Parsed into structured blocks (persona, guidelines, architecture)
- [ ] Stored in core memory for fast access
- [ ] Re-parsed only when file hash changes
- [ ] **Must not duplicate Claude Code's existing CLAUDE.md handling**

**Story Points:** 5

**AI Analysis:** QUESTIONABLE. Claude Code already reads CLAUDE.md. Need to verify this adds value beyond existing behavior. Lowered to P1 until value is proven.

---

### US-014: Learn User Preferences with Approval
**As a** developer,
**I want** Claude to notice my preferences and ask before remembering them,
**So that** it learns and adapts without feeling invasive.

**Priority:** P0
**Traces To:** FR-021

**Acceptance Criteria:**
- [ ] Claude can propose preference observations
- [ ] **User must approve before storing** ("I noticed you prefer X. Should I remember this?")
- [ ] User can review all learned preferences
- [ ] User can delete any preference
- [ ] Changes reflected immediately

**Example:**
```
Claude notices: "You've used single-line if statements 5 times without braces"
Claude asks: "Should I remember that you prefer single-line if statements without braces?"
User: "Yes"
> Core memory (human) updated
```

**Story Points:** 5

**AI Analysis:** REDESIGNED. Original could learn wrong patterns ("user hates comments" from one instance). Now requires explicit approval. High value WITH guardrails.

---

### US-015: Long-Term Fact Storage
**As a** developer,
**I want** important facts stored permanently with citations,
**So that** they persist across many sessions and are verifiable.

**Priority:** P0
**Traces To:** FR-022, HK-003

**Acceptance Criteria:**
- [ ] Facts stored in archival memory
- [ ] Include citations (source file + line)
- [ ] Searchable by semantic and keyword
- [ ] Hook logs significant file changes as facts

**Story Points:** 3

**AI Analysis:** HIGH VALUE. Citations make facts verifiable. "auth flow is at src/auth/flow.ts:45-120" - I can go verify this. Token savings: 80% vs grep + read every session.

---

### US-016: Error Resolution Memory
**As a** developer,
**I want** Claude to remember how we solved errors,
**So that** it can help faster with similar issues.

**Priority:** P0 *(Changed from P1)*
**Traces To:** FR-022, HK-004

**Acceptance Criteria:**
- [ ] Hook captures Bash errors automatically
- [ ] Error → solution pairs stored with context
- [ ] Retrieved when similar errors occur
- [ ] Includes context (file, command, stack trace pattern)
- [ ] Similarity matching considers error type, not just text

**Example:**
```
Previously: "CORS error on /api/users" → "Add cors middleware to express app"
Now: "CORS error on /api/products"
> Recall: "Similar CORS error solved before. Solution: Add cors middleware"
```

**Story Points:** 5

**AI Analysis:** EXTREMELY HIGH VALUE. Elevated to P0. Error debugging can take 5-10 turns. If I recall the pattern: 1-2 turns. Turn savings: 3-8 turns. Token savings: potentially 3000+ tokens per recurring error type.

---

### US-017: Flag Potentially Stale Memories
**As a** developer,
**I want** claude-memory to flag memories that may be outdated,
**So that** I can review and clean them up.

**Priority:** P1 *(Renamed from "Memory Consolidation", completely redesigned)*
**Traces To:** FR-023

**Acceptance Criteria:**
- [ ] Flag memories not accessed in X sessions as "potentially stale"
- [ ] Flag memories that may contradict newer ones
- [ ] Flag potential duplicates for review
- [ ] **Require human confirmation before any deletion or merge**
- [ ] Provide review interface: "3 memories may be stale. Review?"
- [ ] Never auto-delete without explicit approval

**Story Points:** 5

**AI Analysis:** COMPLETELY REDESIGNED. Original auto-consolidated (decay, merge, delete). This is DANGEROUS - could delete valid memories or merge distinct facts. New version FLAGS for human review. Safer.

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

**AI Analysis:** HIGH VALUE. Essential infrastructure. Without hybrid search, I miss relevant memories.

---

### US-019: Type-Aware Recency Ranking
**As a** developer,
**I want** recent memories ranked appropriately by type,
**So that** Claude uses current information without losing timeless facts.

**Priority:** P1
**Traces To:** FR-033

**Acceptance Criteria:**
- [ ] ERROR memories: strong recency decay (solutions evolve)
- [ ] FACT memories: weak/no recency decay (facts are timeless)
- [ ] PREFERENCE memories: weak recency decay (preferences are stable)
- [ ] DECISION memories: moderate decay (decisions can be revisited)
- [ ] Decay factors configurable per type

**Story Points:** 5 *(Increased from 3)*

**AI Analysis:** REDESIGNED. Original had uniform recency decay, which is wrong. "Database is PostgreSQL" doesn't decay. Error solutions might. Now type-aware.

---

### US-020: Inspect Search Results
**As a** developer,
**I want** to see how search results were ranked,
**So that** I can understand and tune behavior.

**Priority:** P2 *(Changed from P1)*
**Traces To:** MCP-003

**Acceptance Criteria:**
- [ ] Search stats in response
- [ ] Vector vs BM25 match counts
- [ ] Individual relevance scores
- [ ] Latency measurements

**Story Points:** 3

**AI Analysis:** LOW PRIORITY. Debugging feature. I don't care about match counts in normal operation. Lowered to P2.

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

**AI Analysis:** ESSENTIAL. No embeddings = no semantic search. Foundation.

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

**AI Analysis:** VALID. Standard optimization.

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

**AI Analysis:** HIGH VALUE. Reliability is critical. Graceful degradation means the system is always useful.

---

### US-050: Provider Auto-Detection
**As a** developer,
**I want** claude-memory to auto-detect available embedding providers,
**So that** setup is automatic and I don't have to manually configure endpoints.

**Priority:** P0 *(NEW)*
**Traces To:** FR-044

**Acceptance Criteria:**
- [ ] Check Ollama at localhost:11434 on startup
- [ ] Check LM Studio at localhost:1234 on startup
- [ ] Use first available provider automatically
- [ ] Support custom endpoints via config override
- [ ] Cache detection result for session

**Example:**
```
Embedding provider detected: LM Studio (http://127.0.0.1:1234)
```

**Story Points:** 3

**AI Analysis:** NEW - HIGH VALUE. Zero-config is critical for adoption. Users shouldn't need to know which port their embedding server uses.

---

### US-051: Model Discovery
**As a** developer,
**I want** to see available embedding models on my local providers,
**So that** I can choose the best one for my needs.

**Priority:** P0 *(NEW)*
**Traces To:** FR-045

**Acceptance Criteria:**
- [ ] Query provider's /v1/models endpoint
- [ ] Filter to embedding-capable models (by name pattern or capability)
- [ ] Display model name, dimensions if known
- [ ] Show currently selected model
- [ ] Support both Ollama and LM Studio API formats

**Example:**
```
Available embedding models on LM Studio:
  1. text-embedding-nomic-embed-text-v1.5 (768 dims)
  2. text-embedding-qwen3-embedding-8b (4096 dims)

Current: text-embedding-nomic-embed-text-v1.5
```

**Story Points:** 3

**AI Analysis:** NEW - HIGH VALUE. Users need visibility into what's available. Without this, they're guessing model names.

---

### US-052: Interactive Model Selection
**As a** developer,
**I want** an easy way to select which embedding model to use,
**So that** I can optimize for my hardware and quality needs without editing JSON.

**Priority:** P1 *(NEW)*
**Traces To:** FR-046

**Acceptance Criteria:**
- [ ] Skill command `/memory config` or MCP tool for configuration
- [ ] List detected providers and their status
- [ ] List available models from active provider
- [ ] Allow selection by number or name
- [ ] Persist selection to config file
- [ ] Warn if switching models (existing embeddings become incompatible)

**Example:**
```
> /memory config

Embedding Configuration
═══════════════════════════════════════

Detected Providers:
  ✓ LM Studio (http://127.0.0.1:1234)
  ✗ Ollama (not running)

Available Embedding Models:
  1. text-embedding-nomic-embed-text-v1.5 (768 dims)
  2. text-embedding-qwen3-embedding-8b (4096 dims)

Current: text-embedding-nomic-embed-text-v1.5

Select model [1-2] or press Enter to keep current: 2

⚠ Warning: Changing models will require re-embedding all memories.
  Existing: 47 memories (estimated 2 minutes to re-embed)

Proceed? [y/N]: y

Model changed to: text-embedding-qwen3-embedding-8b
Re-embedding in background... (use /memory status to check progress)
```

**Story Points:** 5

**AI Analysis:** NEW - HIGH VALUE. Config UX matters. Editing JSON files is error-prone and unfriendly. Interactive selection with warnings about re-embedding is the right approach.

---

### US-053: Model Validation on Setup
**As a** developer,
**I want** the system to validate my model choice works,
**So that** I don't get runtime errors during actual use.

**Priority:** P1 *(NEW)*
**Traces To:** FR-047

**Acceptance Criteria:**
- [ ] Test embedding generation with sample text on model selection
- [ ] Verify response includes valid vector
- [ ] Detect and report dimension count
- [ ] Warn if model not found or returns error
- [ ] Suggest alternatives from discovered models

**Example (success):**
```
Testing model: text-embedding-qwen3-embedding-8b
✓ Model responded in 145ms
✓ Vector dimensions: 4096
✓ Model validated successfully
```

**Example (failure):**
```
Testing model: nomic-embed-text-v99
✗ Model not found

Available models:
  - text-embedding-nomic-embed-text-v1.5
  - text-embedding-qwen3-embedding-8b
```

**Story Points:** 3

**AI Analysis:** NEW - HIGH VALUE. Fail fast principle. Better to catch config errors during setup than during actual memory operations.

---

## Epic 6: Knowledge Graph

### US-024: Track Code Entities
**As a** developer,
**I want** claude-memory to track significant code entities,
**So that** it understands code structure across sessions.

**Priority:** P2 *(Changed from P1)*
**Traces To:** FR-050, FR-051

**Acceptance Criteria:**
- [ ] File entities with paths (created manually or via hooks)
- [ ] Function entities with signatures
- [ ] Type entities with definitions
- [ ] Relationships between entities
- [ ] Clear staleness indicators when code changes

**Story Points:** 8

**AI Analysis:** QUESTIONABLE. LSP already tracks code symbols. This adds cross-session persistence but requires maintenance as code changes. High cost, moderate value. Lowered to P2.

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

**AI Analysis:** LOW VALUE. Rarely needed. Keep at P2, consider cutting if scope needs trimming.

---

### US-026: Explore Entity Relationships
**As a** developer,
**I want** to explore how entities are connected,
**So that** I can understand dependencies and impacts.

**Priority:** P2 *(Changed from P1)*
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

**AI Analysis:** MODERATE VALUE. I can grep/read to figure out dependencies. Graph is faster (~800 token savings) but may be stale. Lowered to P2.

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
- [ ] Preserves items marked essential (US-012)

**Story Points:** 8

**AI Analysis:** EXTREMELY HIGH VALUE. This is a major pain point. Without compaction, long sessions just END. With compaction, I can continue indefinitely. Could save entire session restarts (100k+ tokens over time).

---

### US-028: Preserve Key Decisions During Compact
**As a** developer,
**I want** important decisions preserved during compaction,
**So that** Claude doesn't forget critical context.

**Priority:** P0
**Traces To:** FR-060, SK-002

**Acceptance Criteria:**
- [ ] Decisions explicitly extracted before summarizing
- [ ] Stored in archival with DECISION type
- [ ] Cited in summary ("We decided to use PostgreSQL - see memory #123")
- [ ] Available for future recall

**Story Points:** 5

**AI Analysis:** HIGH VALUE. Essential companion to US-027. If I compact but lose "we chose PostgreSQL", that's a failure.

---

### US-029: Token Budget Visibility
**As a** developer,
**I want** to see how context budget is allocated,
**So that** I can understand what's using space.

**Priority:** P2 *(Changed from P1)*
**Traces To:** FR-061, SK-003

**Acceptance Criteria:**
- [ ] Budget by category (core, working, archival, task)
- [ ] Current usage vs limits
- [ ] Warning when approaching limits
- [ ] Skill provides progressive disclosure

**Story Points:** 3

**AI Analysis:** LOW PRIORITY. Debugging feature. Useful for troubleshooting but not normal operation. Lowered to P2.

---

### US-030: Memory and Context Health Check
**As a** developer,
**I want** to check the health of claude-memory,
**So that** I can diagnose issues.

**Priority:** P2 *(Changed from P1)*
**Traces To:** FR-062

**Acceptance Criteria:**
- [ ] Embedding server status
- [ ] Database health
- [ ] Memory counts by type
- [ ] Storage size
- [ ] Last consolidation time

**Story Points:** 3

**AI Analysis:** LOW PRIORITY. Ops/debugging feature. Lowered to P2.

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

**AI Analysis:** HIGH VALUE. Major UX improvement. Without: user re-explains context (2000+ tokens, 3-5 turns). With: instant continuation.

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

**AI Analysis:** HIGH VALUE. Paired with US-031. Turn savings: 2-5 turns per session start.

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

**AI Analysis:** MODERATE VALUE. Sometimes user wants specific past session, not just latest.

---

## Epic 9: Project Isolation

### US-034: Automatic Project Detection
**As a** developer,
**I want** claude-memory to auto-detect my project,
**So that** I don't need to configure anything.

**Priority:** P0
**Traces To:** FR-080, FR-081, HK-006

**Acceptance Criteria:**
- [ ] Detect git root as primary project boundary
- [ ] Fall back to CLAUDE.md location
- [ ] Fall back to working directory
- [ ] Create unique project hash
- [ ] Use separate database per project

**Story Points:** 3

**AI Analysis:** ESSENTIAL. Correctness requirement. Wrong project = wrong memories.

---

### US-035: Automatic Project Switching
**As a** developer,
**I want** projects to switch automatically when I change git repositories,
**So that** I don't need to manually switch.

**Priority:** P0
**Traces To:** FR-082, HK-006

**Acceptance Criteria:**
- [ ] Hook detects when git root changes
- [ ] **Project boundary = git repository root** (clarified)
- [ ] Within monorepo = single project (shared memories)
- [ ] Saves current session first
- [ ] Loads target project memory
- [ ] Clear transition message

**Example:**
```
(cd from ~/project-a to ~/project-b)
> Saved session for project-a
> Switched to project-b (47 memories)
```

**Story Points:** 5

**AI Analysis:** CLARIFIED. Original didn't define "project" clearly. Now explicit: git root = project boundary. Monorepo = one project.

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

**AI Analysis:** ESSENTIAL. Correctness requirement. "Uses Express" from project-a must not appear in project-b.

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

**AI Analysis:** ESSENTIAL. Foundation.

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

**AI Analysis:** VALID. Necessary for long-term maintenance.

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

**AI Analysis:** VALID for portability. P2 appropriate.

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

**AI Analysis:** VALID. Standard configuration feature.

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

**AI Analysis:** VALID for distribution.

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

**AI Analysis:** VALID for distribution.

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

**AI Analysis:** VALID for adoption. P2 appropriate.

---

## Epic 12: Hook Automation

### US-044: Error Learning Hook
**As a** developer,
**I want** errors captured automatically,
**So that** Claude learns from my mistakes.

**Priority:** P0 *(Changed from P1)*
**Traces To:** HK-004

**Acceptance Criteria:**
- [ ] PostToolUse hook on Bash errors
- [ ] Extracts error message and context
- [ ] Stores as ERROR memory type
- [ ] Links to related code entities

**Story Points:** 3

**AI Analysis:** HIGH VALUE. Elevated to P0. Automates what I'd do manually. Reduces friction.

---

### US-045: Significant File Change Logging
**As a** developer,
**I want** significant file changes logged automatically,
**So that** Claude knows what was modified.

**Priority:** P1
**Traces To:** HK-003

**Acceptance Criteria:**
- [ ] PostToolUse hook on Edit|Write
- [ ] **Filter: Only log new files, deleted files, and major refactors**
- [ ] Skip minor edits (single-line changes, formatting)
- [ ] Updates knowledge graph entities
- [ ] No manual action required

**Story Points:** 3

**AI Analysis:** REDESIGNED. Original logged EVERY edit = noise. If I edit 50 files in refactoring, that's 50 useless memories. Now filters for significant changes only.

---

## Epic 13: Memory Quality (NEW)

### US-046: Automatic Staleness Detection
**As a** developer,
**I want** memories automatically flagged when they may be stale,
**So that** I don't rely on outdated information.

**Priority:** P0 *(NEW)*
**Traces To:** FR-012

**Acceptance Criteria:**
- [ ] Flag memories not accessed in X sessions (configurable, default 10)
- [ ] Flag memories whose source file no longer exists
- [ ] Flag memories whose source file content has changed significantly
- [ ] Provide staleness review: "5 memories may be stale. Review?"
- [ ] User confirms before any deletion

**Story Points:** 5

**AI Analysis:** NEW - CRITICAL ADDITION. Original US-010 relied on user telling me to forget. But users don't remember. This automatically detects likely-stale memories. Prevents me from giving outdated info.

---

### US-047: Validate Memory on Recall
**As a** developer,
**I want** recalled facts optionally validated against current state,
**So that** I can trust the information is still accurate.

**Priority:** P1 *(NEW)*
**Traces To:** FR-011

**Acceptance Criteria:**
- [ ] When recalling a fact with file citation, optionally verify file exists
- [ ] When recalling a fact with line citation, check if content still matches
- [ ] Flag validated memories with "verified: true"
- [ ] Flag unverifiable memories with warning
- [ ] Configurable: always validate / never validate / ask

**Example:**
```
Recall: "Auth flow is in src/auth/flow.ts:45-120"
Validation: File exists, content matches stored summary
> Verified memory
```

**Story Points:** 5

**AI Analysis:** NEW - HIGH VALUE. Citations are only useful if they're still accurate. This validates that the file/line still contains what I think it does.

---

### US-048: Confidence Decay on Wrong Recalls
**As a** developer,
**I want** memory confidence to decrease when recalls prove wrong,
**So that** the system learns from mistakes.

**Priority:** P1 *(NEW)*
**Traces To:** FR-023

**Acceptance Criteria:**
- [ ] Track when recalled memory leads to wrong action
- [ ] User can mark recall as "wrong" or "outdated"
- [ ] Decrease confidence score for that memory
- [ ] Low-confidence memories ranked lower in future recalls
- [ ] Very low confidence triggers staleness flag

**Example:**
```
Recall: "Uses Express for web framework"
User: "That's outdated, we use Fastify now"
> Memory confidence: 0.9 → 0.3
> Memory flagged for review
```

**Story Points:** 5

**AI Analysis:** NEW - HIGH VALUE. Learning from mistakes. If I recall wrong info and user corrects me, that memory should be flagged/downranked.

---

### US-049: Session Start Memory Diff
**As a** developer,
**I want** to see what may have changed since my last session,
**So that** I'm aware of potential staleness upfront.

**Priority:** P2 *(NEW)*
**Traces To:** FR-071

**Acceptance Criteria:**
- [ ] On session restore, scan for changed source files
- [ ] List memories that reference changed files
- [ ] "Since last session: 3 source files changed, 5 memories may be affected"
- [ ] Optional: Review affected memories

**Story Points:** 3

**AI Analysis:** NEW - MODERATE VALUE. Proactive staleness awareness. Better to know upfront than to give wrong info and be corrected.

---

---

## Story Summary

### By Priority

| Priority | Count | Story Points |
|----------|-------|--------------|
| P0 (Must Have) | 29 | 140 |
| P1 (Should Have) | 14 | 61 |
| P2 (Nice to Have) | 10 | 36 |
| **Total** | **53** | **237** |

### By Epic

| Epic | Stories | Points |
|------|---------|--------|
| 1. Plugin Installation | 5 | 19 |
| 2. Memory Storage | 6 | 24 |
| 3. Memory Types | 6 | 28 |
| 4. Hybrid Search | 3 | 16 |
| 5. Embeddings | 7 | 25 |
| 6. Knowledge Graph | 3 | 18 |
| 7. Context Engineering | 4 | 19 |
| 8. Session Management | 3 | 13 |
| 9. Project Isolation | 3 | 13 |
| 10. Storage & Config | 4 | 14 |
| 11. Plugin Distribution | 3 | 11 |
| 12. Hook Automation | 2 | 6 |
| 13. Memory Quality | 4 | 18 |

---

## Changes from v2.0

### Stories Modified
| Story | Change | Rationale |
|-------|--------|-----------|
| US-004 | P1 → P2 | Debugging feature, not needed for normal operation |
| US-007 | P1 → P2, renamed | Entity extraction needs human verification, risky to auto-extract |
| US-011 | Redesigned | Changed from skill composition to atomic MCP tool |
| US-012 | Clarified | Renamed to "Context Overflow Protection", clarified purpose |
| US-013 | P0 → P1 | May duplicate Claude Code's existing behavior |
| US-014 | Redesigned | Added required user approval before learning |
| US-016 | P1 → P0 | Error resolution is extremely high value |
| US-017 | Completely redesigned | Changed from auto-consolidation to flagging with human review |
| US-019 | Redesigned | Changed from uniform decay to type-aware decay |
| US-020 | P1 → P2 | Debugging feature |
| US-024 | P1 → P2 | Overlaps with LSP, high maintenance cost |
| US-026 | P1 → P2 | Can grep/read instead, graph may be stale |
| US-029 | P1 → P2 | Debugging feature |
| US-030 | P1 → P2 | Debugging feature |
| US-035 | Clarified | Defined "project" = git root boundary |
| US-044 | P1 → P0 | Automates high-value error capture |
| US-045 | Redesigned | Added significance filtering to avoid noise |

### Stories Added
| Story | Priority | Rationale |
|-------|----------|-----------|
| US-046: Staleness Detection | P0 | Critical - can't rely on users to tell me when things change |
| US-047: Validate on Recall | P1 | Citations only useful if verified current |
| US-048: Confidence Decay | P1 | Learn from wrong recalls |
| US-049: Session Start Diff | P2 | Proactive staleness awareness |
| US-050: Provider Auto-Detection | P0 | Zero-config setup - auto-detect Ollama or LM Studio |
| US-051: Model Discovery | P0 | Visibility into available embedding models |
| US-052: Interactive Model Selection | P1 | Easy UX for model selection without editing JSON |
| US-053: Model Validation | P1 | Fail-fast validation of model configuration |

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
| US-011 | MCP-002 |
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
| US-046 | FR-012 |
| US-047 | FR-011 |
| US-048 | FR-023 |
| US-049 | FR-071 |
| US-050 | FR-044 |
| US-051 | FR-045 |
| US-052 | FR-046 |
| US-053 | FR-047 |

---

## Persona Mapping

| Persona | Key Stories |
|---------|-------------|
| Alex (Senior Dev) | US-006, US-008, US-016, US-027, US-031, US-046 |
| Sarah (Tech Lead) | US-017, US-024, US-030, US-036, US-039, US-048 |
| Jordan (OSS Maintainer) | US-034, US-035, US-036, US-032, US-042, US-049 |
| Morgan (AI-Curious Dev) | US-001, US-002, US-014, US-023, US-041, US-047 |

---

## AI Analysis Summary

### Highest Value Stories (from Claude's perspective)
1. **US-027/028**: Context compaction - extends session lifetime indefinitely
2. **US-016**: Error resolution - 3-8 turns saved per recurring error
3. **US-031/032**: Session save/restore - 2-5 turns saved per session start
4. **US-046**: Staleness detection - prevents wrong information
5. **US-006/008/009**: Store and search - core value proposition (80%+ token savings)

### Stories That Needed Major Revision
1. **US-017**: Auto-consolidation was dangerous (could delete valid data)
2. **US-014**: Learning without approval was invasive
3. **US-007**: Auto-extraction without verification creates bad data
4. **US-045**: Logging every edit creates noise

### Key Insight
Memory systems fail not from lack of storage but from **staleness and noise**. The new Epic 13 (Memory Quality) addresses this directly.
