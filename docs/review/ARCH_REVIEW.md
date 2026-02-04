# Architecture Review: claude-memory

Date: 2026-01-18
Reviewer: Codex (external review)
Scope: Architecture v2, SRS v2, storage/search, security controls, staleness, feedback

## Executive Summary
claude-memory v2 is a coherent local-first memory system with a clear architecture and a working end-to-end flow for storage, retrieval, versioning, and feedback. The primary risk is a gap between documented security controls and runtime enforcement. Additionally, the staleness detection system exists but is not wired into user flows, and content-change detection is effectively disabled because `sourceHash` is never recorded.

The system is production-adjacent for a single-user local tool, but it needs a short hardening pass to align implementation with the documented threat model and to ensure staleness features operate as designed.

## What Was Built
- **Local-first MCP server** using TypeScript and stdio transport.
- **SQLite storage** with FTS5 and manual vector similarity.
- **Hybrid search** (BM25 + vector + RRF fusion).
- **Language-aware memory fields** (language, structured code context).
- **Versioning and supersession** for memory updates.
- **Feedback loop** to adjust confidence and mark stale items.
- **Session save/restore** with core memory snapshots.
- **Staleness detection utilities** for access, missing source, low confidence, and content changes.

## Strengths
- **Clear data model and migrations**: schema evolution is explicit and backward-compatible.
- **Hybrid search design**: RRF fusion and filters (language, superseded, stale) provide flexible recall.
- **Local-first alignment**: the system stores and operates without external services by default.
- **Version history semantics**: supersession avoids mutating past data and supports audit/history.

## Key Gaps and Risks
1) **Security controls are documented but not enforced**
   - Credential filtering, path traversal checks, and storage limits are described but not implemented at tool boundaries.
   - Risk: sensitive data persistence, path abuse via citations, and unbounded growth.

2) **Staleness detection not integrated into runtime flow**
   - Detector exists but is never called from `session_restore` or any tool.
   - Risk: stale memories remain active, weakening trust in recall results.

3) **Content-change staleness is inert**
   - `sourceHash` is required by the detector, but it is never populated at store/update.
   - Risk: the most valuable staleness signal (source code drift) is never triggered.

4) **Supersession writes are not transactional**
   - Old memory is marked superseded before the new row is inserted.
   - Risk: write failure can leave dangling superseded markers and break version chains.

5) **`memory_update` ignores `language` in input**
   - The tool accepts a language update but does not pass it into the new version.
   - Risk: unexpected behavior for clients trying to correct language metadata.

## Prioritized Remediation (Short-Term)
1) **Enforce security controls at tool entry**
   - Add credential/sensitive-content filtering before `memory_store`.
   - Validate citation paths against project root; reject traversal/outside paths.
   - Add storage quotas (count or size) and a pruning policy.

2) **Wire staleness into session restore**
   - Run staleness detection on `session_restore`, return a report or alert.

3) **Persist `sourceHash`**
   - Compute file hash on store/update when citation is provided.
   - Record it in `code_context` so content-change detection can function.

4) **Wrap supersession in a transaction**
   - Insert new memory and update old memory within a single transaction.

5) **Pass `language` through on update**
   - Ensure `memory_update` uses input `language` for the new version.

## Architecture Fit vs. Requirements
- **SRS V2**: core features implemented, but staleness and security controls are partially implemented (utility code exists without runtime integration).
- **Threat Model**: control coverage is incomplete in runtime; needs enforcement to close gaps.

## Testing Gaps
- No tests for credential filtering, citation path validation, or storage limits.
- No tests covering staleness workflow integration or content-change detection.
- No tests for transactional supersession integrity.

## References Used
- SQLite FTS5 documentation (BM25 and rank behavior): https://sqlite.org/fts5.html
- Elastic RRF overview (reciprocal rank fusion): https://www.elastic.co/guide/en/elasticsearch/reference/current/rrf.html
- Local-first principles (ownership, offline-first): https://www.inkandswitch.com/essay/local-first/
- Project docs in repo: `docs/3-design/ARCHITECTURE_V2.md`, `docs/3-design/SECURITY_CONTROLS.md`, `docs/3-design/THREAT_MODEL.md`, `docs/2-requirements/SRS_V2.md`
