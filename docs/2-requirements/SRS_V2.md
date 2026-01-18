# Software Requirements Specification Extension: claude-memory v2.0

## Document Information

| Field | Value |
|-------|-------|
| Version | 2.0 |
| Date | 2026-01-18 |
| Status | **IMPLEMENTED** |
| Extends | SRS.md v2.0 |
| Purpose | Address gaps identified in GAPS.md |

## Implementation Status

| Category | Requirements | Implemented | Status |
|----------|--------------|-------------|--------|
| Source Code Knowledge | FR-V2-001 to FR-V2-004 | 4/4 | **Complete** |
| Memory Relationships | FR-V2-005 to FR-V2-007 | 3/3 | **Complete** |
| Feedback Loop | FR-V2-008 to FR-V2-011 | 4/4 | **Complete** |
| Staleness Detection | FR-V2-012 to FR-V2-017 | 6/6 | **Complete** |
| **Total** | **17** | **17** | **100%** |

### Implementation Commits
- Sprint 1 (74bb1a8): Core schema, language, versioning, feedback
- Sprint 2 (0b43155): Tools, search filters
- Sprint 3 (664b45f): Backfill, staleness detection
- Sprint 4 (96ed8b8): Content staleness, tests

## Overview

This document defines requirements for new features addressing implementation gaps:
1. **Source Code Knowledge** - Language-aware memory storage and retrieval
2. **Memory Relationships** - Versioning and supersession tracking
3. **Feedback Loop** - Learning from incorrect recalls
4. **Staleness Detection** - Automatic flagging of outdated memories

All requirements are **additive** to the existing SRS.md specification.

---

## 1. Source Code Knowledge Requirements

### FR-V2-001: Language Field Storage
The system SHALL store a `language` field with each memory indicating the programming language context.

**Input:**
- Optional `language` parameter on `memory_store`
- Auto-detection from citation file extension

**Supported Languages:**
- typescript, javascript, python, rust, go, java
- c, cpp, ruby, php, shell, sql
- markdown, json, yaml, other

**Detection Rules:**
| Extension | Language |
|-----------|----------|
| .ts, .tsx | typescript |
| .js, .jsx, .mjs | javascript |
| .py | python |
| .rs | rust |
| .go | go |
| .java | java |
| .c, .h | c |
| .cpp, .hpp, .cc | cpp |
| .rb | ruby |
| .php | php |
| .sh, .bash | shell |
| .sql | sql |
| .md | markdown |
| .json | json |
| .yaml, .yml | yaml |

**Priority:** P0 (Must Have)
**Traces To:** US-NEW-001, Gap 1.1

---

### FR-V2-002: Code Context Parsing
The system SHALL parse and store structured code context from citations.

**Input:** Citation string (e.g., `"src/services/UserService.ts:45-120"`)

**Output:** Structured JSON:
```json
{
  "filePath": "src/services/UserService.ts",
  "startLine": 45,
  "endLine": 120,
  "symbolName": "UserService",
  "symbolType": "class"
}
```

**Parsing Rules:**
1. Extract file path before first `:`
2. Parse line number(s) after `:`
3. Optionally infer symbol from content

**Priority:** P1 (Should Have)
**Traces To:** US-NEW-002, Gap 1.1

---

### FR-V2-003: Language-Filtered Search
The system SHALL support filtering `memory_recall` results by programming language.

**API Change:**
```typescript
memory_recall({
  query: "authentication",
  language: "typescript",  // NEW: optional filter
  limit: 10
})
```

**Behavior:**
- If `language` provided, filter results to matching language
- NULL language matches all (backward compatible)
- Language filter applied after hybrid search

**Performance:** <10ms additional latency

**Priority:** P0 (Must Have)
**Traces To:** US-NEW-005, Gap 1.1

---

### FR-V2-004: Language Backfill Migration
The system SHALL provide a migration to backfill `language` from existing citations.

**Migration Logic:**
```sql
UPDATE memories
SET language = CASE
    WHEN citation LIKE '%.ts:%' THEN 'typescript'
    WHEN citation LIKE '%.py:%' THEN 'python'
    -- ... (see DATABASE_V2.md for full mapping)
END
WHERE citation IS NOT NULL AND language IS NULL;
```

**Execution:** One-time migration on schema upgrade

**Priority:** P1 (Should Have)
**Traces To:** Gap 1.1, Migration V6

---

## 2. Memory Relationships Requirements

### FR-V2-005: Memory Versioning
The system SHALL track version numbers for memories.

**Schema Addition:**
- `version` INTEGER DEFAULT 1
- Auto-increment on update

**Behavior:**
- New memories start at version 1
- Updates create new version (version = old.version + 1)
- Version chain queryable

**Priority:** P0 (Must Have)
**Traces To:** US-011, Gap 3.1

---

### FR-V2-006: Memory Supersession
The system SHALL track supersession relationships between memories.

**Schema Addition:**
- `supersedes_id` TEXT REFERENCES memories(id)
- `superseded_by` TEXT
- `superseded_at` INTEGER

**Behavior:**
1. When `memory_update` called:
   - Create new memory with `supersedes_id = old.id`
   - Set old memory's `superseded_by = new.id`
   - Set old memory's `superseded_at = NOW()`
2. Superseded memories excluded from default search
3. Version history available via `includeSuperseded: true`

**API Change:**
```typescript
// memory_update now creates new version
memory_update({
  id: "old-memory-id",
  content: "Updated content"
})
// Returns: new memory with version = old.version + 1
```

**Priority:** P0 (Must Have)
**Traces To:** US-011, Gap 3.1

---

### FR-V2-007: Version History Query
The system SHALL support querying memory version history.

**API Option:**
```typescript
memory_recall({
  query: "authentication",
  includeSuperseded: true  // NEW: include old versions
})
```

**Result Enrichment:**
```json
{
  "memory": { ... },
  "versionInfo": {
    "version": 3,
    "supersedes": "uuid-v2",
    "supersededBy": null,
    "isLatest": true
  }
}
```

**Priority:** P1 (Should Have)
**Traces To:** Gap 3.1

---

## 3. Feedback Loop Requirements

### FR-V2-008: Feedback Tool
The system SHALL provide a `memory_feedback` MCP tool.

**Tool Definition:**
```typescript
{
  name: 'memory_feedback',
  description: 'Provide feedback on a recalled memory',
  inputSchema: {
    type: 'object',
    properties: {
      id: { type: 'string', format: 'uuid' },
      feedback: {
        type: 'string',
        enum: ['helpful', 'wrong', 'outdated', 'duplicate']
      },
      correction: {
        type: 'string',
        description: 'Corrected content (for wrong/outdated)'
      },
      duplicateOf: {
        type: 'string',
        description: 'Canonical memory ID (for duplicate)'
      }
    },
    required: ['id', 'feedback']
  }
}
```

**Priority:** P0 (Must Have)
**Traces To:** US-048, Gap 4.2

---

### FR-V2-009: Confidence Adjustment
The system SHALL adjust memory confidence based on feedback.

**Adjustment Rules:**
| Feedback | Delta | Bounds | Additional Action |
|----------|-------|--------|-------------------|
| helpful | +0.05 | max 1.0 | Increment access_count |
| wrong | -0.20 | min 0.1 | Flag for review |
| outdated | -0.30 | min 0.1 | Set flagged_at |
| duplicate | 0 | - | Link to canonical |

**Implementation:**
```sql
-- Trigger on feedback insert
UPDATE memories
SET confidence = MAX(0.1, MIN(1.0, confidence + :delta))
WHERE id = :memory_id;
```

**Priority:** P0 (Must Have)
**Traces To:** US-048, Gap 4.2

---

### FR-V2-010: Feedback Storage
The system SHALL persist feedback for analytics.

**Schema:** `memory_feedback` table (see DATABASE_V2.md)

**Fields:**
- id, memory_id, feedback_type
- correction (optional)
- duplicate_of (optional)
- confidence_delta
- created_at

**Queryable:** Aggregate feedback stats per memory

**Priority:** P1 (Should Have)
**Traces To:** Gap 4.2

---

### FR-V2-011: Correction Auto-Supersede
The system SHALL automatically create superseding memories from corrections.

**Behavior:**
When `memory_feedback` called with `feedback: 'wrong'` and `correction` provided:
1. Create new memory with corrected content
2. Set new memory's `supersedes_id = old.id`
3. Mark old memory as superseded

**Priority:** P1 (Should Have)
**Traces To:** US-048

---

## 4. Staleness Detection Requirements

### FR-V2-012: Access Staleness Detection
The system SHALL flag memories not accessed in recent sessions.

**Criteria:** Memory not accessed in last N sessions (default: 10)

**Detection:**
- Track `session_number` in sessions table
- Compare `accessed_at` to session history
- Flag if > 10 sessions without access

**Priority:** P0 (Must Have)
**Traces To:** US-046, Gap 2.1

---

### FR-V2-013: Source Staleness Detection
The system SHALL flag memories whose citation files no longer exist.

**Criteria:** Citation file path does not exist on filesystem

**Detection:**
- Parse file path from citation
- Check file existence on session restore
- Flag with reason "source_missing"

**Priority:** P1 (Should Have)
**Traces To:** US-047, Gap 2.1

---

### FR-V2-014: Content Staleness Detection
The system SHALL flag memories whose citation file content changed significantly.

**Criteria:**
- Citation file exists but content hash differs
- Line numbers no longer valid

**Detection:**
- Store optional content hash in code_context
- Compare on session restore
- Flag with reason "source_changed"

**Priority:** P2 (Nice to Have)
**Traces To:** US-047

---

### FR-V2-015: Staleness Flagging Schema
The system SHALL store staleness flags in the database.

**Schema Addition:**
- `flagged_at` INTEGER (timestamp when flagged)
- `flagged_reason` TEXT (why flagged)

**Flag Reasons:**
- access_stale: Not accessed recently
- source_missing: Citation file deleted
- source_changed: Citation file modified
- low_confidence: Confidence < 0.3

**Priority:** P0 (Must Have)
**Traces To:** US-046

---

### FR-V2-016: Staleness Report
The system SHALL generate a staleness report on session restore.

**Report Format:**
```
Memory Staleness Report
═══════════════════════════════════════
5 memories may need review:

Source Missing (2):
  - "Auth config in src/old/auth.ts" - file deleted
  - "API routes in routes.js" - file deleted

Source Changed (1):
  - "Database uses PostgreSQL" - db.ts modified

Not Accessed (2):
  - "Legacy API format" - 15 sessions ago
  - "Old error workaround" - 12 sessions ago

Run: memory_recall({ query: "stale:true" }) to review
```

**Priority:** P1 (Should Have)
**Traces To:** US-046

---

### FR-V2-017: Stale Memory Exclusion
The system SHALL exclude flagged-stale memories from default search.

**Behavior:**
- Default `memory_recall` excludes `flagged_at IS NOT NULL`
- Optional `includeStale: true` to include

**API Change:**
```typescript
memory_recall({
  query: "authentication",
  includeStale: true  // NEW: include flagged memories
})
```

**Priority:** P0 (Must Have)
**Traces To:** US-046

---

## 5. Non-Functional Requirements

### NFR-V2-001: Language Filter Performance
Language-filtered search SHALL complete in <10ms additional latency.

**Measurement:** Query with language filter vs without
**Target:** <10ms overhead

---

### NFR-V2-002: Version Chain Performance
Version history traversal SHALL complete in <20ms for chains up to 10 versions.

**Measurement:** Recursive CTE query time
**Target:** <20ms for 10-version chain

---

### NFR-V2-003: Staleness Scan Performance
Staleness scan SHALL complete in <100ms per 1000 memories.

**Measurement:** Full project staleness check
**Target:** <100ms/1000 memories

---

### NFR-V2-004: Backward Compatibility
All V2 changes SHALL be backward compatible with V1 data.

**Criteria:**
- Existing memories continue to work
- New fields have sensible defaults
- Old API calls still function

---

### NFR-V2-005: Migration Safety
All migrations SHALL be reversible with rollback scripts.

**Criteria:**
- Each migration has corresponding rollback
- Data preserved during rollback
- Tested in CI

---

## 6. Traceability Matrix

| Requirement | User Story | Gap | Database | Architecture |
|-------------|------------|-----|----------|--------------|
| FR-V2-001 | US-NEW-001 | 1.1 | Migration V2 | Section 1.1 |
| FR-V2-002 | US-NEW-002 | 1.1 | code_context column | Section 1.1 |
| FR-V2-003 | US-NEW-005 | 1.3 | idx_memories_language | Section 1.3 |
| FR-V2-004 | - | 1.1 | Migration V6 | - |
| FR-V2-005 | US-011 | 3.1 | version column | Section 2.1 |
| FR-V2-006 | US-011 | 3.1 | supersedes_id | Section 2.2 |
| FR-V2-007 | - | 3.1 | - | Section 2.3 |
| FR-V2-008 | US-048 | 4.2 | memory_feedback table | Section 3.1 |
| FR-V2-009 | US-048 | 4.2 | confidence_delta | Section 3.2 |
| FR-V2-010 | - | 4.2 | memory_feedback table | Section 3.1 |
| FR-V2-011 | US-048 | - | - | Section 3.2 |
| FR-V2-012 | US-046 | 2.1 | session_number | Section 4.2 |
| FR-V2-013 | US-047 | 2.1 | flagged_at | Section 4.2 |
| FR-V2-014 | US-047 | - | code_context | Section 4.2 |
| FR-V2-015 | US-046 | - | flagged_* columns | Section 4.1 |
| FR-V2-016 | US-046 | - | - | Section 4.3 |
| FR-V2-017 | US-046 | 2.1 | idx_memories_flagged | Section 4.2 |

---

## 7. New User Stories

### US-NEW-001: Language-Aware Storage
**As a** developer working in multiple languages,
**I want** memories to track programming language context,
**So that** I can recall language-specific knowledge.

**Acceptance Criteria:**
- Language auto-detected from citation extension
- Language can be manually specified
- Search filterable by language

**Priority:** P0

---

### US-NEW-002: Code Context Tracking
**As a** developer,
**I want** memories to store structured code context (file, lines, symbol),
**So that** I can navigate to the source easily.

**Acceptance Criteria:**
- Citation parsed into structured context
- Context includes filePath, startLine, endLine
- Symbol name and type extracted when possible

**Priority:** P1

---

### US-NEW-003: Memory Version History
**As a** developer,
**I want** to see how a memory evolved over time,
**So that** I can understand decision history.

**Acceptance Criteria:**
- Updates create new versions
- Old versions linked via supersedes_id
- History queryable with includeSuperseded flag

**Priority:** P1

---

### US-NEW-004: Feedback on Recalls
**As a** Claude Code user,
**I want** to mark recalled memories as helpful or wrong,
**So that** the system learns from mistakes.

**Acceptance Criteria:**
- memory_feedback tool available
- Confidence adjusted based on feedback
- Wrong memories flagged for review
- Corrections auto-create superseding memories

**Priority:** P0

---

### US-NEW-005: Language-Filtered Recall
**As a** developer working in TypeScript,
**I want** to recall only TypeScript-related memories,
**So that** results are relevant to my current context.

**Acceptance Criteria:**
- language parameter on memory_recall
- Filter applied to search results
- Performance <10ms overhead

**Priority:** P0

---

## 8. Acceptance Criteria Summary

### Source Code Knowledge
- [ ] Language auto-detected from 15+ file extensions
- [ ] Language manually specifiable on memory_store
- [ ] Code context parsed from citations
- [ ] Search filterable by language
- [ ] Backfill migration works for existing data

### Memory Relationships
- [ ] memory_update creates new version
- [ ] Old version marked superseded
- [ ] Version chain traversable
- [ ] Superseded excluded from default search

### Feedback Loop
- [ ] memory_feedback tool registered
- [ ] Confidence adjusted per rules
- [ ] Feedback persisted to memory_feedback table
- [ ] Corrections create superseding memories

### Staleness Detection
- [ ] Access staleness detected (10 sessions)
- [ ] Source staleness detected (file missing)
- [ ] Staleness report on session restore
- [ ] Stale excluded from default search
