/**
 * Database schema definitions for claude-memory
 * Based on DATABASE.md specifications
 */

export const CURRENT_VERSION = 1;

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
    type TEXT NOT NULL CHECK (type IN ('fact', 'pattern', 'decision', 'error', 'preference')),
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
];
