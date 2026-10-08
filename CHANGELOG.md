# Changelog

All notable changes to this project are documented here. Format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versioning follows
[Semantic Versioning](https://semver.org/).

## [Unreleased]

### Fixed

- The MCP server advertised version `1.0.0`; it now reports `1.2.0`.
- `tests/benchmarks/real/*` resolved the repo from a hardcoded
  `/Users/...` path; they now resolve it relative to the test file.

### Removed

- `quality-test.sh` / `quality-test.py`: a local LM Studio chat-model quality
  script unrelated to this server, with machine-specific paths and LAN hosts.
- Dead `$schema` URLs in `.claude-plugin/*.json` and `hooks/settings.json`
  (they returned 404). Repository links there now point at
  `bpmforge/bpm-memory-mcp`.
- `.claude-plugin/manifest.json`, `.claude-plugin/marketplace.json` and
  `hooks/settings.json`: none matched Claude Code's plugin or hooks format
  (the hooks file listed `SessionStart` as a `PreToolUse` matcher) and nothing,
  including `install.sh`, read them. The `hooks/*.sh` scripts remain.

### Docs

- README: lists all 19 tools; documents the real embedding configuration
  (`~/.claude-memory/config.json`, Ollama default), environment variables,
  schema v13, the CLI, and the renamed `attest-claude` / `attest` installers.

## [1.2.0] — 2026-07-14

### Fixed

- **Embedder self-heal — semantic recall is no longer silently disabled for a
  whole session.** `EmbeddingService.initialize()` ran exactly once per project;
  if the embedding provider was unreachable at that instant (LM Studio still
  loading a model, or started after the MCP server), it returned `false` and
  every subsequent `memory_recall` fell back to keyword-only BM25 for the rest of
  the session — even though the vector corpus was fully embedded. `embed()` /
  `embedBatch()` now lazily retry initialization via a throttled `ensureReady()`
  (default once per 30 s, `reinitThrottleMs`), so a transient startup outage
  self-heals on the next embed instead of degrading recall silently. Diagnosed
  live: a fully-embedded 768-dim corpus was returning `vectorMatches: 0` because
  the running server's embedder was never re-probed after a startup miss.
  Regression test: `tests/unit/embedder-reinit.test.ts` (self-heal + throttle +
  no-op-when-ready).

### Added (previously merged, first tagged here)

The following were merged to `main` via reviewed PRs after v1.1.0 and are
released for the first time in this version:

- **T11.4 — Fleet scopes.** Per-memory visibility across `agent_local` / `team` /
  `global` / `restricted` scopes, with read-enforcement so feedback/recall can't
  cross a scope boundary (PR #6, incl. review #6 content-returning read gaps).
- **T11.3 — Quarantine scope + promotion** for web-derived facts (PR #5).
- **T23.6 — Standalone `memory-cli snapshot`** command (RC-2 DR).
- **T11.2 — Volatility-scaled recall scoring.**

### Ops

- Reconciled a dual-remote divergence: `origin` (Gitea) `main` was 4 commits
  behind `github` `main` (PRs #5/#6 merged on GitHub only). Both remotes are back
  in sync as of this release.

## [1.1.0] — 2026-06-23

### B1 — Memory Activation

Activated (and in two cases, repaired) the server's self-maintenance machinery
so memory improves itself autonomously — the sleep-time-consolidation +
bi-temporal lever from the *bridging-the-frontier-gap* research. The guiding
principle was "activate, don't rebuild": of five work items, two turned out to
be latent production bugs, two activated dormant code, and one was already
built. See `docs/B1_MEMORY_ACTIVATION.md` for the source-grounded map.

#### Fixed
- **`memory_consolidate` was non-functional (DOA).** `getActiveMemories()`
  selected `last_accessed_at` and `mergeDuplicates()` updated `delete_reason` —
  neither column exists (schema has `accessed_at` / `deleted_reason`), so the
  tool threw on its first statement and had never run. Fixed to the real column
  names; added a regression suite that runs the engine against the real schema.
- **Confidence decay over-decayed everything.** `applyConfidenceDecay` compared
  `Date.now()` (ms) against `accessed_at` (seconds), reading every memory as
  ~19,676 days old and decaying it to the floor on the first run. Now compared
  in seconds.

#### Added
- **Episodic→semantic consolidation (`persistSummaries`).** Each identified
  cluster is distilled into a persisted `pattern` memory carrying a centroid
  embedding (mean of its members' vectors, so it is recalled near them) and a
  `derived_from` provenance link to every source. Idempotent (deterministic
  content + `isDuplicateContent`); summaries are excluded from future passes
  (no summaries-of-summaries). Exposed via the `memory_consolidate` tool and the
  CLI (`--persist-summaries`).
- **Sleep-time consolidation scheduler.** Runs consolidation autonomously at the
  `session_save` boundary — opt-in (`CLAUDE_MEMORY_SLEEP_CONSOLIDATION=true`,
  default off), throttled to ≤1×/project/interval
  (`CLAUDE_MEMORY_CONSOLIDATION_INTERVAL_HOURS`, default 24) via a new
  `consolidation_runs` table (migration v10, restart-safe), and never allowed to
  break `session_save`.
- **`memory_history` tool.** Surfaces the previously-unreachable
  `getVersionHistory()`/`getLatestVersion()` — pass any id in a supersession
  chain and get the full version history, newest first.

#### Tests / coverage
- New `tests/unit/consolidation.test.ts` and
  `tests/unit/consolidation-scheduler.test.ts`; added a regression test that the
  autoLinker auto-creates a `contradicts` link on a negation-divergent pair
  (with the deliberate boundary that it links but does not auto-supersede).
  Suite: 300 passing.

## [1.0.0] — 2026-05-01

Initial release: hybrid memory (vector + BM25 with RRF fusion), knowledge graph
with bi-temporal entities/relations, Zettelkasten memory links, MemGPT-style
core memory, fact store with citations, sessions/goals/checkpoints, and local
embeddings (Ollama / LM Studio).

Built up from 2026-01-16 to 2026-05-01. The main steps in git history:

- V2: session management, core memory blocks, model config, hooks and
  plugin manifest, and V2 search filters.
- V3–V5: goal anchoring, task checkpoints, automatic memory linking, graph
  queries and proactive context assembly (`memory_context_assemble`).
- V9–V11: auto-extraction (`memory_auto_extract`), consolidation, and
  knowledge-graph population; security hardening (credential and path
  filtering).
- V12: token-budgeted context assembly, the standalone `memory-cli`, and
  `memory_reembed`.
- Schema v9: fact store columns and the `fact_store` / `fact_query` tools.
- Semantic near-duplicate detection at store time (cosine > 0.88 soft-deprecates
  older facts/preferences/patterns), a freshness burst for memories under
  5 minutes old, and faster fact decay. 275 tests passing.
