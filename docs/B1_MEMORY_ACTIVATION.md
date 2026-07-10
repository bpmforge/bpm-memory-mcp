# B1 — Memory Activation

Tracker for activating the dormant / broken self-maintenance machinery in this
server, so memory improves itself autonomously (the "sleep-time consolidation +
bi-temporal" lever from the *bridging-the-frontier-gap* research book in
`bpm-opencode-experts`). **Thesis: activate what exists, don't rebuild.**

## Source-grounded state (verified against code, not assumed)

| Capability | State | Evidence |
|---|---|---|
| Supersession versioning (`supersedes_id`/`superseded_by`/`version`) | **WIRED** | `storage/repository.ts` createMemory + `memory_update` |
| `getVersionChain()` / graph `getHistory()` | **DORMANT** | implemented in `repository.ts` / `graph/entities.ts`, never exposed as a tool |
| Bi-temporal `valid_from`/`valid_to` | **Graph-only** | on `entities`/`relations`; read only as `WHERE valid_to IS NULL` (no as-of queries). NOT on `memories`. |
| `memory_consolidate` (merge / decay / cluster) | **BROKEN → fixed in slice 1** | logic existed but SELECT'd non-existent columns → threw on first statement |
| Sleep-time / scheduled consolidation | **MISSING** | manual tool trigger only; no scheduler/boundary hook |
| Episodic→semantic persistence | **MISSING** | clusters produce a `suggestedSummary` string that is never stored |
| Contradiction detection | **WIRED (advisory)** | `validation/contradictions.ts` surfaces `suggestedAction`; never executed |
| Contradiction auto-resolution | **MISSING** | no handler acts on `suggestedAction` |

## Slices

- **Slice 1 — repair + characterize consolidation `[DONE]`**
  - Fixed two DOA column bugs: `last_accessed_at`→`accessed_at`,
    `delete_reason`→`deleted_reason` in `consolidation/index.ts`. The tool had
    never run successfully (threw `no such column` immediately).
  - Added `tests/unit/consolidation.test.ts` (11 tests): regression guard
    (runs against real schema), duplicate merge + dryRun, type-multiplier decay
    + floor + review-flag, cluster identification. 286 suite total, green.
- **Slice 1b — decay unit bug `[DONE]`**: `applyConfidenceDecay` compared
  `Date.now()` (ms) against `accessed_at` (seconds) → every real memory read as
  ~19,676 days old and decayed to the floor on the first run. Fixed to compare
  in seconds; added a regression test (real-timestamp memory stays fresh).
- **Slice 2 — episodic→semantic persistence `[DONE]`**: `persistSummaries`
  option distills each cluster into a persisted `pattern` memory with a
  **centroid embedding** (mean of members' vectors → recallable near them) and
  a `derived_from` provenance link to every source. Deterministic content +
  `isDuplicateContent` guard = idempotent; summaries are stamped
  `consolidation:summary` and excluded from future active sets (no
  summaries-of-summaries). Exposed via the `memory_consolidate` tool
  (`persistSummaries`) and CLI (`--persist-summaries`). 5 new tests (16 in the
  consolidation suite; 291 total green).
- **Slice 3 — sleep-time trigger `[DONE]`**: `ConsolidationScheduler` runs
  consolidation autonomously at the `session_save` boundary (the "going to
  sleep" moment). **Opt-in** via `CLAUDE_MEMORY_SLEEP_CONSOLIDATION=true`
  (default off), **throttled** to ≤1×/project/`CLAUDE_MEMORY_CONSOLIDATION_INTERVAL_HOURS`
  (default 24h) via a new `consolidation_runs` table (migration v10, survives
  restarts), runs with `persistSummaries`, and **never throws** — a failed
  consolidation cannot break `session_save`. The save response reports what it
  did. 7 tests (disabled / first-run+record / throttle / interval-elapsed /
  empty-project no-throw / fromEnv flag+interval). 298 total green.
- **Slice 4 — expose version history `[DONE]`**: `getVersionHistory()` /
  `getLatestVersion()` were implemented but unreachable (no tool). Added the
  lean read tool `memory_history` — pass *any* id in a chain; it resolves to the
  head then walks the full supersession history (newest-first), project scope
  with global fallback. Test documents the resolve-from-old-id contract.
  299 total green.
- **Slice 5 — contradiction auto-resolve `[DONE, scope corrected by Rule 9]`**:
  the map's "auto-resolution MISSING" was wrong. The `autoLinker` (run on every
  store) **already auto-creates `contradicts` links** when two highly-similar
  memories diverge on a negation pattern (`auto-linker.ts:224-228`,
  `createdBy:'system'`). Building the planned slice would have **reinvented**
  working code. The real gap was *coverage*: that path had no test. Added a
  regression test that a `contradicts` link is auto-created on a negation-
  divergent high-similarity pair. **Deliberate boundary (also asserted):**
  auto-resolution *links*, it does NOT auto-supersede/delete — deciding which
  fact wins is destructive and stays advisory (the `ContradictionDetector`'s
  `update` suggestedAction surfaces it for a human). 300 total green.
- **Slice 6 — run log (T2.1) `[DONE]`**: two of T2.1's three parts were already
  built by slice 2/3 above — `dryRun` report mode exists at both the service
  (`consolidation/index.ts`) and CLI (`cli.ts consolidate --dry-run`) layers,
  and the `memory_consolidate` MCP tool already exposes `dryRun` in its input
  schema (`index.ts`). Verified live post-build:
  `node mcp/memory-server/dist/cli.js consolidate --dry-run` prints
  `[DRY RUN] ...` and confirmed no writes. The real gap was the log appender:
  added `consolidation/run-log.ts` (`appendConsolidationLog`, JSONL, never
  throws) and wired it into `ConsolidationScheduler.maybeRun()` — one line per
  *attempted* autonomous run (`'ok'`/`'error'`; not `'disabled'`/`'throttled'`,
  which never touch the database). Default path
  `~/.claude-memory/logs/consolidation.log`, overridable via
  `CLAUDE_MEMORY_CONSOLIDATION_LOG_PATH`. 8 new tests (315 total green).
  **Env enable**: this repo carries no host config files — `env` is set per
  host wherever the MCP server is registered (e.g.
  `claude mcp add memory ... -e CLAUDE_MEMORY_SLEEP_CONSOLIDATION=true`), which
  is outside this repo's write scope. To enable on a host:
  `CLAUDE_MEMORY_SLEEP_CONSOLIDATION=true` (required),
  `CLAUDE_MEMORY_CONSOLIDATION_INTERVAL_HOURS=24` (optional, default 24),
  `CLAUDE_MEMORY_CONSOLIDATION_LOG_PATH=...` (optional, default above). It then
  fires automatically at the next `session_save` past the throttle interval —
  no separate cron/daemon needed.
  **Acceptance gap, honestly stated**: the ticket's "3 consecutive daily logged
  runs" bar needs real elapsed calendar days on a live host, and the ticket
  itself notes `.48` (the originally-named host) is unreachable pending H-5
  (host/network re-map, still `blocked(Brad decides LM topology)` as of
  2026-07-09). That part is **not verified here** — it can't be, in one
  session, on an unresolved host. What *is* verified: the appender is called
  on every attempted scheduler run (unit-tested), and a deterministic test
  (`logs 3 consecutive daily-throttled runs as 3 distinct lines`) simulates 3
  throttle-interval-elapsed runs by backdating `consolidation_runs.last_run_at`
  — same technique as the pre-existing "runs again once the interval has
  elapsed" test — and asserts 3 JSONL lines land. A manual end-to-end run
  against a real (non-`:memory:`) sqlite db post-`npm run build` also produced
  a real log line at the default path (see PR evidence). Once H-5 lands and a
  host is chosen, the remaining acceptance step is operational: enable the env
  var there and let 3 real `session_save` calls happen across days.

## Status: B1 memory-activation slices 1–6 complete

The "activate, don't rebuild" thesis held: of the six slices, **two were real
bugs** (consolidation was DOA + over-decaying), **two activated dormant code**
(persist summaries, expose history), **one was already built** (contradiction
linking, missing only a test), and **one (T2.1) was two-thirds already built**
(dry-run report mode) with the log appender as the real remaining gap. No
graph was rebuilt.

## Notes
- `npm run lint` is broken repo-wide (missing `typescript-eslint` dep in
  `eslint.config.js`) — pre-existing, unrelated to B1. Typecheck (`npm run
  typecheck`) is the working gate.
