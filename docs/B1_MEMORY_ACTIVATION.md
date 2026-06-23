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
- **Slice 2 — episodic→semantic persistence (NEXT)**: have consolidation
  *persist* a cluster summary as a `pattern`/`fact` semantic memory, linked to
  its episodic sources (provenance via existing `memory_links`), behind a
  `persistSummaries` option. Tests alongside.
- **Slice 3 — sleep-time trigger**: run consolidation autonomously at a natural
  "sleep" boundary (on `session_save`), throttled (≤1×/project/interval) and
  flag-gated, emitting a report. Default conservative thresholds.
- **Slice 4 — expose version history**: surface `getVersionChain()` as a lean
  read tool (`memory_history`) so supersession chains are inspectable.
- **Slice 5 — gated contradiction auto-resolve**: execute high-confidence
  `suggestedAction` (auto-link `contradicts`; supersede on value-conflict) with
  a conservative default + opt-out.

## Notes
- `npm run lint` is broken repo-wide (missing `typescript-eslint` dep in
  `eslint.config.js`) — pre-existing, unrelated to B1. Typecheck (`npm run
  typecheck`) is the working gate.
