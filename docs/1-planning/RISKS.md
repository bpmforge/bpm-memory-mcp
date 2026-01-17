# Risks: claude-memory

## Risk Register

### R-001: Embedding Quality vs Competitors

**Category**: Technical
**Probability**: Medium
**Impact**: High
**Risk Score**: High

**Description**: nomic-embed-text-v2-moe may not outperform mcp-memory-service's MiniLM-L6-v2 on code-specific retrieval tasks, negating our differentiation claim.

**Research Finding**: According to [BentoML benchmarks](https://www.bentoml.com/blog/a-guide-to-open-source-embedding-models), nomic-embed-text v1 achieves 86.2% top-5 accuracy, but v2-moe is newer and less battle-tested.

**Indicators**:
- Search results miss obvious matches
- User reports of "Claude forgot" despite stored memories
- Benchmark scores below MiniLM baseline

**Mitigation**:
1. Benchmark both models during development
2. Hybrid search compensates for embedding weaknesses
3. Allow configurable model selection
4. Matryoshka dimensions (768→256) may lose precision

**Contingency**: Support MiniLM-L6-v2 as alternative option.

---

### R-002: Hybrid Search Complexity

**Category**: Technical
**Probability**: Medium
**Impact**: Medium
**Risk Score**: Medium

**Description**: RRF fusion with k=60 may not work optimally for our specific use case (code memories), requiring extensive tuning.

**Research Finding**: [OpenSearch](https://opensearch.org/blog/introducing-reciprocal-rank-fusion-hybrid-search/) notes "k can be tuned based on your specific use case" - suggesting one-size-fits-all may not work.

**Indicators**:
- Hybrid search performs worse than vector-only
- Keyword matches dominate inappropriately
- Tuning k doesn't improve results

**Mitigation**:
1. Start with k=60 (empirical standard)
2. Implement configurable weights (vector/BM25)
3. A/B test different configurations
4. Provide fallback to single-mode search

**Contingency**: Default to vector-only like competitors.

---

### R-003: Stale Memory Contamination (Critical)

**Category**: Technical
**Probability**: High
**Impact**: Critical
**Risk Score**: Critical

**Description**: Outdated memories cause wrong decisions. This is the #1 failure mode in memory systems.

**Research Finding**: [AIMultiple benchmark](https://research.aimultiple.com/memory-mcp/) found systems "occasionally mix information from different projects" - staleness is a known problem.

**Indicators**:
- User corrections of Claude's statements
- Conflicts between memory and current code
- "Hallucinations" traceable to old memories

**Mitigation**:
1. Temporal decay function (older = lower weight)
2. Mandatory citations for all memories
3. Confidence scoring based on validation
4. Contradiction detection between memories
5. Easy `memory_forget` with provenance
6. Consolidation system with cleanup

**Contingency**: Aggressive decay + manual cleanup tools.

---

### R-004: Context Window Overflow (Critical)

**Category**: Technical
**Probability**: High
**Impact**: High
**Risk Score**: Critical

**Description**: Memory injection pushes essential content out of Claude's context window, making the situation worse.

**Research Finding**: [LlamaIndex context engineering](https://www.llamaindex.ai/blog/context-engineering-what-it-is-and-techniques-to-consider) emphasizes "auto-compact at 95% capacity" as essential.

**Indicators**:
- Claude loses track of current task
- Important files truncated
- User asks to "forget" memories

**Mitigation**:
1. Strict token budget management (15/20/25/40%)
2. Auto-compact at 95% threshold
3. Priority-based eviction
4. Configurable memory injection
5. "Minimal memory" mode option

**Contingency**: Disable auto-injection, manual recall only.

---

### R-005: Project Isolation Failures

**Category**: Technical
**Probability**: Medium
**Impact**: High
**Risk Score**: High

**Description**: Despite separate databases, cross-project contamination still occurs.

**Research Finding**: [AIMultiple benchmark](https://research.aimultiple.com/memory-mcp/) identifies project isolation as the "#1 complaint" about existing systems.

**Indicators**:
- Wrong project memories surfaced
- User confusion about context
- Incorrect code suggestions from other projects

**Mitigation**:
1. Separate SQLite files per project
2. Project ID tagging on every memory
3. Validation at retrieval time
4. Explicit `project_switch` command
5. Warning on ambiguous queries
6. Audit logging

**Contingency**: Require explicit project selection at session start.

---

### R-006: Ollama/Embedding Server Unavailability

**Category**: Operational
**Probability**: Medium
**Impact**: Medium
**Risk Score**: Medium

**Description**: Users don't have Ollama running, or it crashes, breaking embedding functionality.

**Research Finding**: [mcp-memory-service](https://github.com/doobidoo/mcp-memory-service) uses ONNX embeddings to avoid this - we depend on external server.

**Indicators**:
- Connection refused errors
- Timeout during embedding
- "Memory not working" reports

**Mitigation**:
1. Graceful degradation to BM25-only
2. Clear error messages with setup instructions
3. Retry queue with exponential backoff
4. Health check endpoint
5. LM Studio as fallback provider

**Contingency**: Consider ONNX embeddings like mcp-memory-service.

---

### R-007: Performance at Scale

**Category**: Technical
**Probability**: Medium
**Impact**: Medium
**Risk Score**: Medium

**Description**: As memories grow (1000+ facts), search becomes too slow for interactive use.

**Research Finding**: [mcp-memory-service](https://github.com/doobidoo/mcp-memory-service) claims "5ms local reads" with optimized SQLite - we need similar performance.

**Indicators**:
- Search latency >500ms
- Memory operations delay responses
- Users disable memory

**Mitigation**:
1. SQLite indexes on all query fields
2. Embedding cache to avoid re-computation
3. Pagination for large results
4. Consolidation to reduce memory count
5. VACUUM on database periodically

**Contingency**: Implement memory limits with LRU eviction.

---

### R-008: MCP Protocol Changes

**Category**: External
**Probability**: Low
**Impact**: Critical
**Risk Score**: Medium

**Description**: Anthropic changes MCP protocol, breaking compatibility.

**Research Finding**: MCP is relatively new (2024) and still evolving.

**Indicators**:
- Claude Code updates break integration
- MCP SDK version changes
- Protocol deprecation notices

**Mitigation**:
1. Pin to stable MCP SDK version
2. Abstract MCP layer for easier updates
3. Monitor Anthropic announcements
4. Integration tests against multiple SDK versions

**Contingency**: Maintain compatibility with SDK n-1.

---

### R-009: Consolidation Causing Data Loss

**Category**: Technical
**Probability**: Low
**Impact**: High
**Risk Score**: Medium

**Description**: Aggressive consolidation (merging, archiving, cleanup) accidentally removes important memories.

**Research Finding**: [mcp-memory-service](https://github.com/doobidoo/mcp-memory-service) uses "dream-inspired consolidation" - novel but potentially risky.

**Indicators**:
- Important facts disappear
- User reports missing memories
- Consolidation log shows unexpected deletions

**Mitigation**:
1. Soft delete only (never hard delete)
2. Full consolidation log with before/after
3. Configurable aggressiveness
4. "Protected" flag for critical memories
5. Export/backup before consolidation

**Contingency**: Disable automatic consolidation, manual only.

---

### R-010: Memory Accuracy Claims Unverifiable

**Category**: Business
**Probability**: Medium
**Impact**: Medium
**Risk Score**: Medium

**Description**: We claim 70% accuracy target, but industry benchmarks are disputed (Letta vs Mem0 controversy).

**Research Finding**: [Letta blog](https://www.letta.com/blog/benchmarking-ai-agent-memory) disputes Mem0's LoCoMo results - benchmark methodology is contested.

**Indicators**:
- Different benchmarks give conflicting results
- Community questions our metrics
- Reproducibility issues

**Mitigation**:
1. Use multiple benchmarks (LoCoMo, custom)
2. Open-source our evaluation methodology
3. Provide reproducible test suite
4. Conservative claims with confidence intervals

**Contingency**: Focus on user-reported satisfaction over synthetic benchmarks.

---

### R-011: nomic-embed-text-v2-moe Availability

**Category**: External
**Probability**: Low
**Impact**: High
**Risk Score**: Medium

**Description**: nomic-embed-text-v2-moe may not be available in Ollama, or model changes break compatibility.

**Research Finding**: v2-moe is new (2026) and may have limited Ollama support initially.

**Indicators**:
- Model not found in Ollama
- Pull fails or takes too long
- Model output format changes

**Mitigation**:
1. Support multiple models (v1, v2, mxbai)
2. Document minimum model requirements
3. Test against Ollama releases
4. LM Studio as fallback

**Contingency**: Default to nomic-embed-text v1 (widely supported).

---

### R-012: TypeScript Performance vs Python

**Category**: Technical
**Probability**: Low
**Impact**: Medium
**Risk Score**: Low

**Description**: TypeScript/Node.js may be slower than Python for numerical operations (embeddings, similarity).

**Research Finding**: [mcp-memory-service](https://github.com/doobidoo/mcp-memory-service) uses Python with ONNX for performance.

**Indicators**:
- Similarity calculations slow
- High CPU usage during search
- Latency exceeds targets

**Mitigation**:
1. Use native SQLite for vector operations
2. Offload heavy math to embedding server
3. Cache computed similarities
4. Consider native addon for hot paths

**Contingency**: Acceptable tradeoff for ecosystem consistency.

---

### R-013: Auto-Compact Quality

**Category**: Technical
**Probability**: Medium
**Impact**: Medium
**Risk Score**: Medium

**Description**: Summarization during auto-compact loses important details.

**Research Finding**: [LlamaIndex](https://www.llamaindex.ai/blog/context-engineering-what-it-is-and-techniques-to-consider) notes "targeted summarization" is preferred over naive compression.

**Indicators**:
- Important decisions lost in summaries
- User re-explains after compaction
- Context quality degrades over session

**Mitigation**:
1. Extract key facts to archival before summarizing
2. Preserve decision points explicitly
3. Configurable summarization aggressiveness
4. Manual review option before compact

**Contingency**: Use simpler trimming (drop oldest) instead of summarization.

---

## Risk Matrix

```
Impact
  ^
  │
C │  R-003   R-004   R-008
  │  Stale   Context  MCP
  │
H │  R-001   R-005   R-009   R-011
  │  Embed   Isolate  Consol  Model
  │
M │  R-002   R-006   R-007   R-010   R-013
  │  Hybrid  Ollama  Scale   Bench   Compact
  │
L │                          R-012
  │                          Perf
  │
  └──────────────────────────────────────────>
     L        M        H        Probability
```

## Risk Summary by Priority

### Critical (Immediate Attention)
| ID | Risk | Mitigation Priority |
|----|------|-------------------|
| R-003 | Stale Memory | Citations, decay, cleanup |
| R-004 | Context Overflow | Token budgets, auto-compact |

### High
| ID | Risk | Mitigation Priority |
|----|------|-------------------|
| R-001 | Embedding Quality | Benchmark, hybrid search |
| R-005 | Project Isolation | Separate DBs, validation |
| R-008 | MCP Changes | Abstract layer, pin SDK |

### Medium
| ID | Risk | Mitigation Priority |
|----|------|-------------------|
| R-002 | Hybrid Complexity | Configurable, fallback |
| R-006 | Ollama Unavailable | Graceful degradation |
| R-007 | Performance | Indexes, caching |
| R-009 | Consolidation Loss | Soft delete, logging |
| R-010 | Benchmark Disputes | Multiple benchmarks |
| R-011 | Model Availability | Multi-model support |
| R-013 | Compact Quality | Extract before summarize |

### Low
| ID | Risk | Mitigation Priority |
|----|------|-------------------|
| R-012 | TS vs Python Perf | Acceptable tradeoff |

## Risk Review Schedule

- **Weekly**: R-003, R-004, R-005 (critical path)
- **Bi-weekly**: All high/medium risks
- **Monthly**: Full risk register review
- **Per Phase**: Update probabilities based on progress
