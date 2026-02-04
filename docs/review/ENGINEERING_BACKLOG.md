# Engineering Backlog: claude-memory v2 Hardening

Date: 2026-01-18
Owner: TBD

## P0 - Security & Data Integrity
1) Enforce credential/sensitive-content filtering
- **Why**: Aligns runtime with SC-001/SC-009; prevents accidental secret storage.
- **Scope**: Add `containsCredentials()` check to `memory_store` entry. Decide on block vs warn.
- **Files**: `mcp/memory-server/src/index.ts`, new helper (e.g., `mcp/memory-server/src/security/credentials.ts`)
- **Tests**: Add unit tests for known patterns; add integration test to verify rejection.

2) Path traversal validation for citations
- **Why**: Aligns with SC-003; prevents referencing files outside project root.
- **Scope**: Validate citation file path against project root at store/update time.
- **Files**: `mcp/memory-server/src/index.ts`, new helper (e.g., `src/security/paths.ts`)
- **Tests**: Unit tests for path cases (`../`, absolute paths, symlinks if applicable).

3) Storage quotas / retention policy
- **Why**: Aligns with SC-011; avoids unbounded growth.
- **Scope**: Configurable max memory count per project; optional pruning by age/access.
- **Files**: `mcp/memory-server/src/storage/repository.ts`, config plumbing.
- **Tests**: Ensure pruning triggers and respects limits.

4) Supersession transaction
- **Why**: Prevent dangling superseded markers on partial failure.
- **Scope**: Wrap `createMemory` + supersession update in a single transaction when `supersedesId` is set.
- **Files**: `mcp/memory-server/src/storage/repository.ts`
- **Tests**: Simulate error during insert and validate rollback behavior.

## P1 - Staleness Workflow
5) Persist `sourceHash` for cited code
- **Why**: Enables content-change staleness detection.
- **Scope**: Compute file hash on store/update when citation is present and file exists; store in `codeContext.sourceHash`.
- **Files**: `mcp/memory-server/src/language/context.ts` or new helper; `mcp/memory-server/src/index.ts`.
- **Tests**: Unit tests for hash generation and persistence.

6) Wire staleness detection into session restore
- **Why**: Makes staleness detection visible to user.
- **Scope**: Run `StalenessDetector` in `session_restore`; return a report or count summary.
- **Files**: `mcp/memory-server/src/index.ts`, `mcp/memory-server/src/staleness/report.ts`.
- **Tests**: Integration test for session restore returning staleness info.

## P2 - Product Quality
7) Honor `language` input in `memory_update`
- **Why**: Tool contract mismatch.
- **Scope**: Apply input `language` to new version if provided.
- **Files**: `mcp/memory-server/src/index.ts`, `mcp/memory-server/src/storage/repository.ts`
- **Tests**: Unit test verifying language update propagates.

8) Optimize dedup before embedding
- **Why**: Avoid unnecessary embedding cost.
- **Scope**: Check duplication before embedding call in `memory_store`.
- **Files**: `mcp/memory-server/src/index.ts`
- **Tests**: Integration test ensures duplicate content short-circuits.

9) Make RRF tuning configurable
- **Why**: Improve search quality tuning.
- **Scope**: expose `rrfK`, `vectorWeight`, `bm25Weight` via config or tool args.
- **Files**: `mcp/memory-server/src/search/index.ts`, config plumbing.
- **Tests**: Unit tests for config passthrough.

## Dependencies
- P0 items should be done before widening usage or adding new features.
- Staleness workflow depends on `sourceHash` availability.

## Acceptance Criteria
- All P0 and P1 items merged with tests.
- Security controls in docs are reflected in code paths.
- Staleness detection generates a user-visible report in session restore.
