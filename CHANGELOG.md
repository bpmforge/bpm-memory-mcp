# Changelog

All notable changes to this project are documented here. Format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versioning follows
[Semantic Versioning](https://semver.org/).

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

## [1.0.0] — earlier

Initial release: hybrid memory (vector + BM25 with RRF fusion), knowledge graph
with bi-temporal entities/relations, Zettelkasten memory links, MemGPT-style
core memory, fact store with citations, sessions/goals/checkpoints, and local
embeddings (Ollama / LM Studio).
