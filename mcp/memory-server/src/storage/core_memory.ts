import type { DatabaseConnection } from './database.js';
import type { CoreMemory, CoreMemoryBlock } from '../types.js';

type BlockName = 'persona' | 'human' | 'goals' | 'project';
type BlockSource = 'claude.md' | 'user' | 'claude';

interface CoreMemoryRow {
  project_id: string;
  block: string;
  content: string;
  source: string;
  updated_at: number;
}

/**
 * Core Memory Repository - MemGPT-style self-editable memory blocks
 */
export class CoreMemoryRepository {
  constructor(private db: DatabaseConnection) {}

  /**
   * Get all core memory blocks for a project
   */
  getCoreMemory(projectId: string): CoreMemory {
    const rows = this.db.instance
      .prepare('SELECT * FROM core_memory WHERE project_id = ?')
      .all(projectId) as CoreMemoryRow[];

    // Build core memory with defaults for missing blocks
    const blocks = new Map<string, CoreMemoryRow>();
    for (const row of rows) {
      blocks.set(row.block, row);
    }

    return {
      persona: this.rowToBlock(blocks.get('persona')),
      human: this.rowToBlock(blocks.get('human')),
      goals: this.rowToBlock(blocks.get('goals')),
      project: {
        ...this.rowToBlock(blocks.get('project')),
        keyFiles: this.extractKeyFiles(blocks.get('project')?.content),
      },
    };
  }

  /**
   * Get a single core memory block
   */
  getBlock(projectId: string, block: BlockName): CoreMemoryBlock | null {
    const row = this.db.instance
      .prepare('SELECT * FROM core_memory WHERE project_id = ? AND block = ?')
      .get(projectId, block) as CoreMemoryRow | undefined;

    return row ? this.rowToBlock(row) : null;
  }

  /**
   * Update a core memory block
   */
  updateBlock(
    projectId: string,
    block: BlockName,
    content: string,
    source: BlockSource
  ): void {
    const now = Math.floor(Date.now() / 1000);

    this.db.instance
      .prepare(
        `INSERT INTO core_memory (project_id, block, content, source, updated_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT (project_id, block)
         DO UPDATE SET content = ?, source = ?, updated_at = ?`
      )
      .run(projectId, block, content, source, now, content, source, now);
  }

  /**
   * Initialize core memory blocks with defaults
   */
  initializeDefaults(projectId: string): void {
    const defaults: Array<{ block: BlockName; content: string }> = [
      {
        block: 'persona',
        content: 'I am Claude, an AI assistant helping with software development.',
      },
      {
        block: 'human',
        content: 'The user is a software developer.',
      },
      {
        block: 'goals',
        content: 'Help the user with their coding tasks efficiently.',
      },
      {
        block: 'project',
        content: 'No project context loaded yet.',
      },
    ];

    const now = Math.floor(Date.now() / 1000);

    this.db.transaction(() => {
      for (const { block, content } of defaults) {
        // Only insert if not exists
        this.db.instance
          .prepare(
            `INSERT OR IGNORE INTO core_memory (project_id, block, content, source, updated_at)
             VALUES (?, ?, ?, 'claude', ?)`
          )
          .run(projectId, block, content, now);
      }
    });
  }

  /**
   * Check if core memory is initialized for a project
   */
  isInitialized(projectId: string): boolean {
    const result = this.db.instance
      .prepare('SELECT COUNT(*) as count FROM core_memory WHERE project_id = ?')
      .get(projectId) as { count: number };

    return result.count >= 4;
  }

  /**
   * Update project block from CLAUDE.md content
   */
  updateFromClaudeMd(projectId: string, claudeMdContent: string): void {
    // Extract project description and key files from CLAUDE.md
    const projectInfo = this.parseClaudeMd(claudeMdContent);
    this.updateBlock(projectId, 'project', projectInfo, 'claude.md');
  }

  /**
   * Parse CLAUDE.md content to extract project info
   */
  private parseClaudeMd(content: string): string {
    // Extract description section
    const descMatch = content.match(/##\s*Description\s*\n([\s\S]*?)(?=\n##|$)/i);
    const description = descMatch?.[1]?.trim() ?? '';

    // Extract key decisions
    const decisionsMatch = content.match(/##\s*Key Decisions\s*\n([\s\S]*?)(?=\n##|$)/i);
    const decisions = decisionsMatch?.[1]?.trim() ?? '';

    // Build project summary
    const parts = [];
    if (description) parts.push(`Description: ${description}`);
    if (decisions) parts.push(`Key Decisions: ${decisions}`);

    return parts.join('\n\n') || 'Project context from CLAUDE.md';
  }

  /**
   * Extract key files from project content
   */
  private extractKeyFiles(content: string | undefined): string[] {
    if (!content) return [];

    // Match file paths in the content
    const filePattern = /(?:^|\s)([a-zA-Z0-9_\-./]+\.[a-zA-Z0-9]+)(?:\s|$|,|:)/g;
    const files = new Set<string>();

    let match;
    while ((match = filePattern.exec(content)) !== null) {
      const file = match[1];
      if (file && !file.startsWith('.') && file.includes('/')) {
        files.add(file);
      }
    }

    return Array.from(files).slice(0, 10); // Limit to 10 key files
  }

  /**
   * Convert database row to CoreMemoryBlock
   */
  private rowToBlock(row: CoreMemoryRow | undefined): CoreMemoryBlock {
    if (!row) {
      return {
        content: '',
        lastUpdated: new Date(),
        source: 'claude',
      };
    }

    return {
      content: row.content,
      lastUpdated: new Date(row.updated_at * 1000),
      source: row.source as 'claude.md' | 'user' | 'claude',
    };
  }
}
