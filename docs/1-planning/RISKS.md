# Risks: claude-memory

## Risk Register

### R-001: Embedding Quality Degradation

**Category**: Technical
**Probability**: Medium
**Impact**: High
**Risk Score**: High

**Description**: Local embedding models (nomic-embed-text) may produce lower quality embeddings than cloud models (OpenAI ada-002), leading to poor semantic search results and irrelevant memory retrieval.

**Indicators**:
- Search results frequently miss relevant content
- User reports of "Claude forgot" despite stored memories
- Low precision/recall in retrieval benchmarks

**Mitigation**:
1. Benchmark multiple local models during development
2. Implement hybrid search (vector + BM25) to compensate
3. Allow configurable embedding providers
4. Add relevance feedback mechanism

**Contingency**: Fall back to keyword-only search if embedding quality unacceptable.

---

### R-002: Storage Bloat

**Category**: Technical
**Probability**: Medium
**Impact**: Medium
**Risk Score**: Medium

**Description**: Embedding vectors (768 dimensions × 4 bytes = 3KB per embedding) and accumulated memories may cause database to grow unboundedly, impacting performance and disk usage.

**Indicators**:
- Database size exceeds 500MB
- Query latency increases over time
- Disk space warnings

**Mitigation**:
1. Implement automatic pruning based on access frequency
2. Set configurable retention limits
3. Use compression for older embeddings
4. Provide manual cleanup tools

**Contingency**: Implement aggressive LRU eviction policy.

---

### R-003: Stale Memory Contamination

**Category**: Technical
**Probability**: High
**Impact**: High
**Risk Score**: Critical

**Description**: Outdated or incorrect memories may be surfaced, causing Claude to make wrong decisions or provide incorrect information based on stale context.

**Indicators**:
- User corrections of Claude's statements
- Conflicts between memory and current code state
- "Hallucinations" traceable to old memories

**Mitigation**:
1. Implement temporal decay function (older = lower weight)
2. Require citations for all retrieved memories
3. Add confidence scoring based on validation
4. Implement contradiction detection
5. Provide easy "forget" mechanism

**Contingency**: Clear project memory and rebuild from scratch.

---

### R-004: MCP Protocol Breaking Changes

**Category**: External
**Probability**: Low
**Impact**: Critical
**Risk Score**: High

**Description**: Anthropic may change the MCP protocol in ways that break compatibility, requiring significant rework.

**Indicators**:
- Claude Code update announcements
- MCP SDK version changes
- Integration test failures

**Mitigation**:
1. Pin to stable MCP SDK version
2. Abstract MCP layer for easier updates
3. Monitor Anthropic announcements
4. Participate in MCP community discussions

**Contingency**: Maintain compatibility shim for one major version back.

---

### R-005: Local Embedding Server Unavailability

**Category**: Operational
**Probability**: Medium
**Impact**: Medium
**Risk Score**: Medium

**Description**: Users may not have LM Studio or Ollama running, or the embedding server may crash, leaving the system unable to create new embeddings.

**Indicators**:
- Connection refused errors to embedding endpoint
- Timeout errors during embedding generation
- User reports of "memory not working"

**Mitigation**:
1. Graceful degradation to keyword-only search
2. Clear error messages with setup instructions
3. Embedding queue with retry logic
4. Cache embeddings aggressively

**Contingency**: Provide pre-computed embeddings for common patterns.

---

### R-006: Performance Degradation at Scale

**Category**: Technical
**Probability**: Medium
**Impact**: Medium
**Risk Score**: Medium

**Description**: As memory grows (thousands of facts, millions of tokens), search and retrieval may become too slow for interactive use.

**Indicators**:
- Search latency >500ms
- Memory recall adds noticeable delay
- Users disabling memory features

**Mitigation**:
1. Use SQLite indexes effectively
2. Implement approximate nearest neighbor (ANN) search
3. Batch and cache common queries
4. Partition by project/time

**Contingency**: Implement memory "compaction" to merge similar entries.

---

### R-007: Context Window Overflow

**Category**: Technical
**Probability**: Medium
**Impact**: High
**Risk Score**: High

**Description**: Memory injection may push essential content out of Claude's context window, making the situation worse instead of better.

**Indicators**:
- Claude loses track of current task
- Important files get truncated
- User explicitly asks Claude to "forget" memories

**Mitigation**:
1. Implement strict token budget management
2. Prioritize current task context over historical
3. Make memory injection configurable/disableable
4. Monitor context utilization

**Contingency**: Provide "minimal memory" mode with only critical facts.

---

### R-008: Data Loss or Corruption

**Category**: Technical
**Probability**: Low
**Impact**: Critical
**Risk Score**: Medium

**Description**: SQLite database may become corrupted due to crashes, disk issues, or bugs, resulting in loss of accumulated project knowledge.

**Indicators**:
- SQLite integrity check failures
- Query errors on previously working data
- Missing or garbled memories

**Mitigation**:
1. Use SQLite WAL mode for crash safety
2. Implement regular backups
3. Add database integrity checks
4. Provide export/import functionality

**Contingency**: Rebuild memory from git history and CLAUDE.md.

---

### R-009: Privacy/Security Concerns

**Category**: Security
**Probability**: Low
**Impact**: High
**Risk Score**: Medium

**Description**: Memory may inadvertently store sensitive information (credentials, PII, proprietary code) that users don't want persisted.

**Indicators**:
- User reports of sensitive data in memory
- Security audit findings
- Compliance concerns

**Mitigation**:
1. Never store content matching secret patterns (.env, credentials)
2. Implement content filtering before storage
3. Provide selective memory deletion
4. Document what is/isn't stored

**Contingency**: Implement full memory encryption at rest.

---

### R-010: Adoption Friction

**Category**: Business
**Probability**: Medium
**Impact**: Medium
**Risk Score**: Medium

**Description**: If setup is too complex or benefits not immediately obvious, users may not adopt the tool.

**Indicators**:
- Low download/install numbers
- High abandonment during setup
- Negative user feedback

**Mitigation**:
1. Zero-config default mode (works without embedding server)
2. One-line installation
3. Clear onboarding documentation
4. Visible token savings dashboard

**Contingency**: Simplify to MVP feature set.

---

## Risk Matrix

```
Impact
  ^
  │
H │  R-003   R-004   R-007
  │  Stale   MCP     Context
  │
M │  R-001   R-002   R-006   R-008   R-010
  │  Embed   Bloat   Perf    Data    Adopt
  │
L │                  R-005   R-009
  │                  Server  Privacy
  │
  └──────────────────────────────────────>
     L        M        H     Probability
```

## Risk Summary

| ID | Risk | Score | Owner | Status |
|----|------|-------|-------|--------|
| R-001 | Embedding Quality | High | Dev | Open |
| R-002 | Storage Bloat | Medium | Dev | Open |
| R-003 | Stale Memory | Critical | Dev | Open |
| R-004 | MCP Changes | High | Dev | Open |
| R-005 | Server Unavailable | Medium | Dev | Open |
| R-006 | Performance | Medium | Dev | Open |
| R-007 | Context Overflow | High | Dev | Open |
| R-008 | Data Loss | Medium | Dev | Open |
| R-009 | Privacy | Medium | Dev | Open |
| R-010 | Adoption | Medium | Dev | Open |

## Critical Risks Requiring Immediate Attention

1. **R-003 (Stale Memory)**: Must implement citation and decay from day one
2. **R-007 (Context Overflow)**: Token budget system is non-negotiable
3. **R-004 (MCP Changes)**: Abstract MCP layer for flexibility

## Risk Review Schedule

- **Weekly**: Review R-003, R-007 during development
- **Monthly**: Full risk register review
- **Per Release**: Update probabilities based on testing
