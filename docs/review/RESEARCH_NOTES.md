# Research Notes: Robustness & Search

Date: 2026-01-18

## Search Retrieval Guidance
- **SQLite FTS5**: BM25 is the built-in ranking function; ordering is by ascending score. Consider documenting or exposing weighting for content vs metadata if additional columns are added later.
  - Source: https://sqlite.org/fts5.html
- **Reciprocal Rank Fusion (RRF)**: RRF combines multiple ranked lists with a tunable `k` parameter. Exposing `k` and per-source weights helps tune hybrid retrieval quality.
  - Source: https://www.elastic.co/guide/en/elasticsearch/reference/current/rrf.html

## Local-First Robustness
- Local-first emphasizes user data ownership, offline-first behavior, and long-term preservation. For claude-memory this implies explicit export/backup flows, predictable local storage, and clear deletion/retention controls.
  - Source: https://www.inkandswitch.com/essay/local-first/

## Notes on External Search
- Google Search results could not be fetched via `curl` due to JavaScript requirements and bot mitigation.
