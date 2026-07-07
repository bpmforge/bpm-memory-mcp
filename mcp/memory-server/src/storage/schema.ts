/**
 * Database schema definitions for claude-memory
 * Based on DATABASE.md specifications
 */

export const CURRENT_VERSION = 11;

/**
 * Initial schema - Version 1
 */
export const SCHEMA_V1 = `
-- Schema version tracking
CREATE TABLE IF NOT EXISTS schema_version (
    version INTEGER PRIMARY KEY,
    applied_at INTEGER NOT NULL
);

-- Primary memory storage
CREATE TABLE IF NOT EXISTS memories (
    id TEXT PRIMARY KEY,
    content TEXT NOT NULL,
    embedding BLOB,
    type TEXT NOT NULL CHECK (type IN ('fact', 'pattern', 'decision', 'error', 'preference', 'goal', 'checkpoint')),
    confidence REAL NOT NULL DEFAULT 1.0 CHECK (confidence >= 0.0 AND confidence <= 1.0),
    citation TEXT,
    project_id TEXT NOT NULL,
    content_hash TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    accessed_at INTEGER NOT NULL,
    access_count INTEGER NOT NULL DEFAULT 0,
    deleted_at INTEGER,
    deleted_reason TEXT
);

CREATE INDEX IF NOT EXISTS idx_memories_project ON memories(project_id);
CREATE INDEX IF NOT EXISTS idx_memories_type ON memories(project_id, type);
CREATE INDEX IF NOT EXISTS idx_memories_hash ON memories(content_hash);
CREATE INDEX IF NOT EXISTS idx_memories_accessed ON memories(project_id, accessed_at DESC);
CREATE INDEX IF NOT EXISTS idx_memories_active ON memories(project_id, deleted_at);

-- Core memory (MemGPT-style blocks)
CREATE TABLE IF NOT EXISTS core_memory (
    project_id TEXT NOT NULL,
    block TEXT NOT NULL CHECK (block IN ('persona', 'human', 'goals', 'project')),
    content TEXT NOT NULL,
    source TEXT NOT NULL CHECK (source IN ('claude.md', 'user', 'claude')),
    updated_at INTEGER NOT NULL,
    PRIMARY KEY (project_id, block)
);

-- Sessions
CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    state BLOB NOT NULL,
    summary TEXT,
    created_at INTEGER NOT NULL,
    resumed_at INTEGER
);

CREATE INDEX IF NOT EXISTS idx_sessions_project ON sessions(project_id, created_at DESC);

-- Knowledge graph entities
CREATE TABLE IF NOT EXISTS entities (
    id TEXT PRIMARY KEY,
    type TEXT NOT NULL CHECK (type IN ('file', 'function', 'type', 'decision', 'error')),
    name TEXT NOT NULL,
    properties TEXT,
    project_id TEXT NOT NULL,
    valid_from INTEGER NOT NULL,
    valid_to INTEGER,
    created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_entities_project_type ON entities(project_id, type);
CREATE INDEX IF NOT EXISTS idx_entities_project_name ON entities(project_id, name);
CREATE INDEX IF NOT EXISTS idx_entities_temporal ON entities(project_id, valid_from, valid_to);

-- Knowledge graph relations
CREATE TABLE IF NOT EXISTS relations (
    id TEXT PRIMARY KEY,
    source_id TEXT NOT NULL REFERENCES entities(id),
    target_id TEXT NOT NULL REFERENCES entities(id),
    type TEXT NOT NULL CHECK (type IN ('implements', 'depends_on', 'satisfies', 'calls', 'contradicts', 'supersedes')),
    properties TEXT,
    valid_from INTEGER NOT NULL,
    valid_to INTEGER,
    created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_relations_source ON relations(source_id);
CREATE INDEX IF NOT EXISTS idx_relations_target ON relations(target_id);
CREATE INDEX IF NOT EXISTS idx_relations_type ON relations(type);

-- Memory-entity junction
CREATE TABLE IF NOT EXISTS memory_entities (
    memory_id TEXT NOT NULL REFERENCES memories(id),
    entity_id TEXT NOT NULL REFERENCES entities(id),
    confidence REAL NOT NULL DEFAULT 1.0,
    PRIMARY KEY (memory_id, entity_id)
);

-- Session-memory junction
CREATE TABLE IF NOT EXISTS session_memories (
    session_id TEXT NOT NULL REFERENCES sessions(id),
    memory_id TEXT NOT NULL REFERENCES memories(id),
    rank INTEGER NOT NULL,
    PRIMARY KEY (session_id, memory_id)
);

-- FTS5 virtual table for BM25 search
CREATE VIRTUAL TABLE IF NOT EXISTS memories_fts USING fts5(
    content,
    content='memories',
    content_rowid='rowid'
);

-- Triggers to keep FTS in sync
CREATE TRIGGER IF NOT EXISTS memories_ai AFTER INSERT ON memories BEGIN
    INSERT INTO memories_fts(rowid, content) VALUES (NEW.rowid, NEW.content);
END;

CREATE TRIGGER IF NOT EXISTS memories_ad AFTER DELETE ON memories BEGIN
    INSERT INTO memories_fts(memories_fts, rowid, content) VALUES('delete', OLD.rowid, OLD.content);
END;

CREATE TRIGGER IF NOT EXISTS memories_au AFTER UPDATE ON memories BEGIN
    INSERT INTO memories_fts(memories_fts, rowid, content) VALUES('delete', OLD.rowid, OLD.content);
    INSERT INTO memories_fts(rowid, content) VALUES (NEW.rowid, NEW.content);
END;
`;

/**
 * All migrations in order
 */
export const MIGRATIONS: Array<{ version: number; up: string; down: string }> = [
  {
    version: 1,
    up: SCHEMA_V1,
    down: `
      DROP TRIGGER IF EXISTS memories_au;
      DROP TRIGGER IF EXISTS memories_ad;
      DROP TRIGGER IF EXISTS memories_ai;
      DROP TABLE IF EXISTS memories_fts;
      DROP TABLE IF EXISTS session_memories;
      DROP TABLE IF EXISTS memory_entities;
      DROP TABLE IF EXISTS relations;
      DROP TABLE IF EXISTS entities;
      DROP TABLE IF EXISTS sessions;
      DROP TABLE IF EXISTS core_memory;
      DROP TABLE IF EXISTS memories;
      DROP TABLE IF EXISTS schema_version;
    `,
  },
  // V2: Source Code Knowledge - Language field
  {
    version: 2,
    up: `
      ALTER TABLE memories ADD COLUMN language TEXT;
      ALTER TABLE memories ADD COLUMN code_context TEXT;
      CREATE INDEX idx_memories_language ON memories(project_id, language);
    `,
    down: `
      DROP INDEX IF EXISTS idx_memories_language;
      -- Note: SQLite doesn't support DROP COLUMN directly
      -- Columns remain but are unused after rollback
    `,
  },
  // V3: Memory Versioning
  {
    version: 3,
    up: `
      ALTER TABLE memories ADD COLUMN version INTEGER DEFAULT 1;
      ALTER TABLE memories ADD COLUMN supersedes_id TEXT REFERENCES memories(id);
      ALTER TABLE memories ADD COLUMN superseded_by TEXT;
      ALTER TABLE memories ADD COLUMN superseded_at INTEGER;
      CREATE INDEX idx_memories_supersedes ON memories(supersedes_id);
      CREATE INDEX idx_memories_version ON memories(project_id, version);
    `,
    down: `
      DROP INDEX IF EXISTS idx_memories_version;
      DROP INDEX IF EXISTS idx_memories_supersedes;
      -- Note: SQLite doesn't support DROP COLUMN directly
    `,
  },
  // V4: Feedback System
  {
    version: 4,
    up: `
      CREATE TABLE IF NOT EXISTS memory_feedback (
        id TEXT PRIMARY KEY,
        memory_id TEXT NOT NULL REFERENCES memories(id),
        feedback_type TEXT NOT NULL CHECK (
          feedback_type IN ('helpful', 'wrong', 'outdated', 'duplicate')
        ),
        correction TEXT,
        duplicate_of TEXT REFERENCES memories(id),
        confidence_delta REAL NOT NULL,
        created_at INTEGER NOT NULL
      );
      CREATE INDEX idx_feedback_memory ON memory_feedback(memory_id);
      CREATE INDEX idx_feedback_type ON memory_feedback(feedback_type);
    `,
    down: `
      DROP INDEX IF EXISTS idx_feedback_type;
      DROP INDEX IF EXISTS idx_feedback_memory;
      DROP TABLE IF EXISTS memory_feedback;
    `,
  },
  // V5: Staleness Detection
  {
    version: 5,
    up: `
      ALTER TABLE memories ADD COLUMN flagged_at INTEGER;
      ALTER TABLE memories ADD COLUMN flagged_reason TEXT;
      ALTER TABLE memories ADD COLUMN embedding_model TEXT;
      ALTER TABLE sessions ADD COLUMN session_number INTEGER;
      CREATE INDEX idx_memories_flagged ON memories(project_id, flagged_at);
    `,
    down: `
      DROP INDEX IF EXISTS idx_memories_flagged;
      -- Note: SQLite doesn't support DROP COLUMN directly
    `,
  },
  // V6: Language Backfill - Populate language from existing citations
  {
    version: 6,
    up: `
      UPDATE memories
      SET language = CASE
        WHEN citation LIKE '%.ts:%' OR citation LIKE '%.tsx:%' THEN 'typescript'
        WHEN citation LIKE '%.js:%' OR citation LIKE '%.jsx:%' THEN 'javascript'
        WHEN citation LIKE '%.py:%' THEN 'python'
        WHEN citation LIKE '%.rs:%' THEN 'rust'
        WHEN citation LIKE '%.go:%' THEN 'go'
        WHEN citation LIKE '%.java:%' THEN 'java'
        WHEN citation LIKE '%.c:%' OR citation LIKE '%.h:%' THEN 'c'
        WHEN citation LIKE '%.cpp:%' OR citation LIKE '%.cc:%' OR citation LIKE '%.hpp:%' THEN 'cpp'
        WHEN citation LIKE '%.rb:%' THEN 'ruby'
        WHEN citation LIKE '%.php:%' THEN 'php'
        WHEN citation LIKE '%.sh:%' OR citation LIKE '%.bash:%' THEN 'shell'
        WHEN citation LIKE '%.sql:%' THEN 'sql'
        WHEN citation LIKE '%.md:%' THEN 'markdown'
        WHEN citation LIKE '%.json:%' THEN 'json'
        WHEN citation LIKE '%.yaml:%' OR citation LIKE '%.yml:%' THEN 'yaml'
        ELSE NULL
      END
      WHERE citation IS NOT NULL AND language IS NULL;
    `,
    down: `
      -- Backfill is idempotent, no rollback needed
      -- Language values remain but can be re-computed
    `,
  },
  // V7: Memory Links, Goals, and Checkpoints
  {
    version: 7,
    up: `
      -- Memory Links (Zettelkasten-style)
      CREATE TABLE IF NOT EXISTS memory_links (
        id TEXT PRIMARY KEY,
        source_id TEXT NOT NULL REFERENCES memories(id),
        target_id TEXT NOT NULL REFERENCES memories(id),
        link_type TEXT NOT NULL CHECK (
          link_type IN ('relates_to', 'contradicts', 'supports', 'extends', 'derived_from')
        ),
        strength REAL NOT NULL DEFAULT 1.0 CHECK (strength >= 0.0 AND strength <= 1.0),
        bidirectional INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL,
        created_by TEXT NOT NULL CHECK (created_by IN ('user', 'claude', 'system'))
      );

      CREATE INDEX IF NOT EXISTS idx_memory_links_source ON memory_links(source_id);
      CREATE INDEX IF NOT EXISTS idx_memory_links_target ON memory_links(target_id);
      CREATE INDEX IF NOT EXISTS idx_memory_links_type ON memory_links(link_type);

      -- Goal-specific fields on memories
      ALTER TABLE memories ADD COLUMN goal_status TEXT CHECK (
        goal_status IS NULL OR goal_status IN ('active', 'completed', 'abandoned')
      );
      ALTER TABLE memories ADD COLUMN goal_priority INTEGER CHECK (
        goal_priority IS NULL OR (goal_priority >= 1 AND goal_priority <= 5)
      );
      ALTER TABLE memories ADD COLUMN parent_goal_id TEXT REFERENCES memories(id);

      -- Checkpoint-specific fields
      ALTER TABLE memories ADD COLUMN checkpoint_data TEXT;

      -- Indexes for goals and checkpoints
      CREATE INDEX IF NOT EXISTS idx_memories_goal_status ON memories(project_id, goal_status);
      CREATE INDEX IF NOT EXISTS idx_memories_goal_priority ON memories(project_id, goal_priority);
      CREATE INDEX IF NOT EXISTS idx_memories_parent_goal ON memories(parent_goal_id);

      -- Update type constraint to allow goal and checkpoint
      -- Note: SQLite doesn't support ALTER CONSTRAINT, but new inserts will use new CHECK
    `,
    down: `
      DROP INDEX IF EXISTS idx_memories_parent_goal;
      DROP INDEX IF EXISTS idx_memories_goal_priority;
      DROP INDEX IF EXISTS idx_memories_goal_status;
      DROP INDEX IF EXISTS idx_memory_links_type;
      DROP INDEX IF EXISTS idx_memory_links_target;
      DROP INDEX IF EXISTS idx_memory_links_source;
      DROP TABLE IF EXISTS memory_links;
      -- Note: SQLite doesn't support DROP COLUMN directly
      -- Columns remain but are unused after rollback
    `,
  },
  // V8: Memory-Entity Links for Knowledge Graph Population
  {
    version: 8,
    up: `
      -- Create new memory_entity_links table with relation_type
      CREATE TABLE IF NOT EXISTS memory_entity_links (
        id TEXT PRIMARY KEY,
        memory_id TEXT NOT NULL REFERENCES memories(id),
        entity_id TEXT NOT NULL REFERENCES entities(id),
        relation_type TEXT NOT NULL CHECK (
          relation_type IN ('implements', 'depends_on', 'satisfies', 'calls', 'contradicts', 'supersedes')
        ),
        project_id TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        UNIQUE(memory_id, entity_id)
      );

      CREATE INDEX IF NOT EXISTS idx_mel_memory ON memory_entity_links(memory_id);
      CREATE INDEX IF NOT EXISTS idx_mel_entity ON memory_entity_links(entity_id);
      CREATE INDEX IF NOT EXISTS idx_mel_project ON memory_entity_links(project_id);

      -- Migrate existing data from memory_entities if any
      INSERT OR IGNORE INTO memory_entity_links (id, memory_id, entity_id, relation_type, project_id, created_at)
      SELECT
        lower(hex(randomblob(16))),
        me.memory_id,
        me.entity_id,
        'depends_on',
        m.project_id,
        strftime('%s', 'now')
      FROM memory_entities me
      JOIN memories m ON me.memory_id = m.id;
    `,
    down: `
      DROP INDEX IF EXISTS idx_mel_project;
      DROP INDEX IF EXISTS idx_mel_entity;
      DROP INDEX IF EXISTS idx_mel_memory;
      DROP TABLE IF EXISTS memory_entity_links;
    `,
  },
  // V9: Fact Store — Structured facts with citations for anti-hallucination research pipeline
  {
    version: 9,
    up: `
      -- Source metadata for research-backed facts
      ALTER TABLE memories ADD COLUMN source_url TEXT;
      ALTER TABLE memories ADD COLUMN source_title TEXT;
      ALTER TABLE memories ADD COLUMN source_type TEXT CHECK (
        source_type IS NULL OR source_type IN (
          'official_docs', 'engineering_blog', 'academic', 'news', 'forum', 'unknown'
        )
      );
      ALTER TABLE memories ADD COLUMN direct_quote TEXT;
      ALTER TABLE memories ADD COLUMN domain_tags TEXT;  -- JSON array of strings
      ALTER TABLE memories ADD COLUMN stale_after_days INTEGER;
      ALTER TABLE memories ADD COLUMN last_verified INTEGER;
      ALTER TABLE memories ADD COLUMN used_in TEXT;  -- JSON array of report/synthesis IDs
      ALTER TABLE memories ADD COLUMN extracted_by TEXT;  -- agent that extracted this fact

      -- Indexes for fact queries
      CREATE INDEX IF NOT EXISTS idx_memories_source_url ON memories(source_url);
      CREATE INDEX IF NOT EXISTS idx_memories_source_type ON memories(project_id, source_type);
      CREATE INDEX IF NOT EXISTS idx_memories_stale ON memories(project_id, stale_after_days, last_verified);
    `,
    down: `
      DROP INDEX IF EXISTS idx_memories_stale;
      DROP INDEX IF EXISTS idx_memories_source_type;
      DROP INDEX IF EXISTS idx_memories_source_url;
      -- Note: SQLite doesn't support DROP COLUMN directly
    `,
  },
  // V10: Sleep-time consolidation throttle state — one row per project tracking
  // the last autonomous consolidation run so it fires at most once per interval.
  {
    version: 10,
    up: `
      CREATE TABLE IF NOT EXISTS consolidation_runs (
        project_id TEXT PRIMARY KEY,
        last_run_at INTEGER NOT NULL,
        last_summary_count INTEGER NOT NULL DEFAULT 0
      );
    `,
    down: `
      DROP TABLE IF EXISTS consolidation_runs;
    `,
  },
  // V11: Temporal validity + volatility-scaled staleness for memories (T11.1).
  // entities/relations already carry valid_from/valid_to (V1) — this is the memories-
  // table counterpart, plus a volatility class and a general verified_at recency signal
  // that T11.2's recall scoring folds a staleness penalty from. Note: distinct from V9's
  // last_verified, which is specific to fact-store source verification for research
  // claims — verified_at here applies to every memory type, not just facts. Worth a
  // steward look at whether the two should eventually consolidate.
  {
    version: 11,
    up: `
      ALTER TABLE memories ADD COLUMN valid_from INTEGER;
      ALTER TABLE memories ADD COLUMN valid_to INTEGER;
      ALTER TABLE memories ADD COLUMN volatility TEXT NOT NULL DEFAULT 'slow' CHECK (
        volatility IN ('static', 'slow', 'volatile')
      );
      ALTER TABLE memories ADD COLUMN verified_at INTEGER;

      -- Backfill valid_from for existing rows so the temporal pair is queryable
      -- immediately, matching entities/relations' populated valid_from.
      UPDATE memories SET valid_from = created_at WHERE valid_from IS NULL;

      CREATE INDEX IF NOT EXISTS idx_memories_temporal ON memories(project_id, valid_from, valid_to);
      CREATE INDEX IF NOT EXISTS idx_memories_volatility ON memories(project_id, volatility, verified_at);
    `,
    down: `
      DROP INDEX IF EXISTS idx_memories_volatility;
      DROP INDEX IF EXISTS idx_memories_temporal;
      -- Note: SQLite doesn't support DROP COLUMN directly
    `,
  },
];
