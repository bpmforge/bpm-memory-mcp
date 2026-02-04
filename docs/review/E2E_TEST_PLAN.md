# E2E Test Plan: claude-memory v2

Date: 2026-01-18

## Goals
Validate end-to-end functionality for storage, retrieval, versioning, feedback, session lifecycle, staleness, and isolation. Confirm compliance with documented controls after remediation.

## Environment
- Local machine with Claude Code and MCP server (stdio).
- Test project repo with mixed-language files.
- Ollama or LM Studio running with an embedding model.

## Pre-conditions
- Fresh memory DB for the project.
- Test files in repo (e.g., `src/App.ts`, `README.md`).

## Core Scenarios
1) **Store + Recall**
- Store memory with `citation` and verify stored `language`/`codeContext`.
- Recall by query; verify language filter and default exclusion of superseded/stale.

2) **Versioning**
- Update a memory and verify new version is created.
- Verify old memory marked superseded.
- Verify version history is retrievable (if supported).

3) **Feedback Loop**
- Mark memory as `helpful` and verify confidence increases.
- Mark memory as `wrong` with correction; verify new version is created and old flagged stale.

4) **Session Save/Restore**
- Save session; restore and verify summary + core memory snapshot.
- Verify staleness report appears after restore (post-integration).

5) **Staleness: Content Change**
- Store a memory with code citation; modify file; run restore and verify stale detection.

6) **Project Isolation**
- Store memory in Project A; switch to Project B; verify recall does not cross.

## Negative Tests
- Store duplicate content; verify dedup short-circuits.
- Use a citation with path traversal (`../`) and verify it is rejected.
- Attempt to store content with secret-like patterns; verify rejection.

## Performance Sanity Checks
- Memory store < 200ms (excluding embedding generation).
- Memory recall < 50ms (small dataset).

## Acceptance Criteria
- All scenarios pass without errors.
- Security checks enforce expected behavior.
- Staleness detection surfaces actionable items.
- No cross-project leakage.

## Artifacts
- Capture JSON responses from MCP tool calls.
- Record timings for store/recall.
