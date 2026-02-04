/**
 * Knowledge Graph Populator (V11)
 *
 * Automatically populates the knowledge graph when memories are stored:
 * - Extracts entities from memory citations (files, functions, types)
 * - Extracts entity mentions from memory content
 * - Creates or reuses existing entities
 * - Links memories to their related entities
 */

import { randomUUID } from 'crypto';
import type { DatabaseConnection } from '../storage/database.js';
import type { Memory, CodeContext } from '../types.js';
import { EntityType, RelationType, SymbolType } from '../types.js';
import { EntityRepository, type EntityCreateInput } from './entities.js';
import { RelationRepository } from './relations.js';

/**
 * Result of knowledge graph population for a memory
 */
export interface PopulationResult {
  entitiesCreated: Array<{
    id: string;
    type: EntityType;
    name: string;
    isNew: boolean;
  }>;
  relationsCreated: Array<{
    id: string;
    type: RelationType;
    targetEntityId: string;
    targetEntityName: string;
  }>;
  stats: {
    citationEntities: number;
    contentEntities: number;
    totalRelations: number;
  };
}

/**
 * Configuration for the populator
 */
export interface PopulatorConfig {
  /** Whether to extract entities from content (default: true) */
  extractFromContent: boolean;
  /** Minimum word length for potential entity names (default: 3) */
  minEntityNameLength: number;
  /** Maximum entities to extract from content (default: 5) */
  maxContentEntities: number;
}

const DEFAULT_CONFIG: PopulatorConfig = {
  extractFromContent: true,
  minEntityNameLength: 3,
  maxContentEntities: 5,
};

/**
 * Patterns for extracting entity mentions from content
 * Enhanced for V12 with better code detection
 */
const ENTITY_PATTERNS = {
  // File paths: src/foo/bar.ts, ./utils.js, etc.
  filePath: /(?:^|[\s`"'(])([a-zA-Z0-9_.-]+\/[a-zA-Z0-9_./+-]+\.[a-zA-Z]+)/g,

  // Function definitions: function name(), async function name(), const name = () =>
  functionDef: /(?:function\s+|async\s+function\s+|const\s+|let\s+|var\s+)([a-zA-Z_][a-zA-Z0-9_]*)\s*(?:=\s*(?:async\s*)?\(|[(<])/g,

  // Function calls: functionName(), ClassName.method()
  functionCall: /\b([a-zA-Z_][a-zA-Z0-9_]*)\s*\(/g,

  // Class definitions: class ClassName, export class ClassName
  classDef: /(?:^|export\s+)class\s+([A-Z][a-zA-Z0-9_]*)/gm,

  // Interface/Type definitions: interface IName, type TName
  typeDef: /(?:interface|type)\s+([A-Z][a-zA-Z0-9_]*)/g,

  // Class/Type references: ClassName, TypeName (PascalCase)
  className: /\b([A-Z][a-zA-Z0-9]+)(?:\s|$|[.,;:)<>])/g,

  // Method references: .methodName or ->methodName
  methodRef: /(?:\.|->)([a-zA-Z_][a-zA-Z0-9_]*)/g,

  // Import/require statements
  importPath: /(?:from|require)\s*[('"]([^'"]+)['"]/g,

  // Python function definitions: def function_name(
  pythonFunctionDef: /def\s+([a-zA-Z_][a-zA-Z0-9_]*)\s*\(/g,

  // Python class definitions: class ClassName:
  pythonClassDef: /class\s+([A-Z][a-zA-Z0-9_]*)\s*[:(]/g,

  // Go function definitions: func functionName( or func (r *Receiver) methodName(
  goFunctionDef: /func\s+(?:\([^)]*\)\s*)?([a-zA-Z_][a-zA-Z0-9_]*)\s*\(/g,

  // Rust function definitions: fn function_name( or pub fn function_name(
  rustFunctionDef: /(?:pub\s+)?fn\s+([a-zA-Z_][a-zA-Z0-9_]*)\s*[(<]/g,

  // Rust struct/enum definitions
  rustTypeDef: /(?:pub\s+)?(?:struct|enum)\s+([A-Z][a-zA-Z0-9_]*)/g,
};

/**
 * Common words to exclude from entity extraction
 */
const EXCLUDED_WORDS = new Set([
  // Common code words that aren't entities
  'Error', 'String', 'Number', 'Boolean', 'Object', 'Array', 'Map', 'Set',
  'Promise', 'Date', 'Math', 'JSON', 'Console', 'Window', 'Document',
  'Function', 'Symbol', 'BigInt', 'RegExp', 'Infinity', 'NaN', 'Null',
  'Undefined', 'True', 'False', 'This', 'Super', 'Class', 'Interface',
  'Type', 'Enum', 'Const', 'Let', 'Var', 'Import', 'Export', 'Default',
  'Return', 'Async', 'Await', 'Yield', 'Throw', 'Try', 'Catch', 'Finally',
  // Common English words that match PascalCase
  'The', 'This', 'That', 'These', 'Those', 'When', 'Where', 'Which',
  'What', 'How', 'Why', 'Before', 'After', 'During', 'Between',
]);

/**
 * Knowledge Graph Populator Service
 */
export class KnowledgeGraphPopulator {
  private entityRepo: EntityRepository;
  private relationRepo: RelationRepository;
  private config: PopulatorConfig;

  constructor(
    private db: DatabaseConnection,
    config: Partial<PopulatorConfig> = {}
  ) {
    this.entityRepo = new EntityRepository(db);
    this.relationRepo = new RelationRepository(db);
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Populate knowledge graph for a newly stored memory
   */
  async populateFromMemory(
    memory: Memory,
    codeContext: CodeContext | null
  ): Promise<PopulationResult> {
    const result: PopulationResult = {
      entitiesCreated: [],
      relationsCreated: [],
      stats: {
        citationEntities: 0,
        contentEntities: 0,
        totalRelations: 0,
      },
    };

    // 1. Extract entities from citation/codeContext
    if (codeContext) {
      await this.populateFromCodeContext(memory, codeContext, result);
    } else if (memory.citation) {
      // Parse citation if codeContext wasn't provided
      const parsed = this.parseCitation(memory.citation);
      if (parsed) {
        await this.populateFromCodeContext(memory, parsed, result);
      }
    }

    // 2. Extract entities from content
    if (this.config.extractFromContent) {
      await this.populateFromContent(memory, result);
    }

    result.stats.totalRelations = result.relationsCreated.length;
    return result;
  }

  /**
   * Populate entities from code context (citation)
   */
  private async populateFromCodeContext(
    memory: Memory,
    ctx: CodeContext,
    result: PopulationResult
  ): Promise<void> {
    // Create FILE entity for the file path
    const fileEntity = await this.findOrCreateEntity(
      EntityType.FILE,
      ctx.filePath,
      memory.projectId,
      {
        startLine: ctx.startLine,
        endLine: ctx.endLine,
        language: memory.language,
      }
    );

    result.entitiesCreated.push({
      id: fileEntity.id,
      type: EntityType.FILE,
      name: ctx.filePath,
      isNew: fileEntity.isNew,
    });

    // Link memory to file entity
    const fileRelation = this.createMemoryEntityRelation(
      memory.id,
      fileEntity.id,
      RelationType.DEPENDS_ON, // Memory depends on this file
      memory.projectId
    );

    if (fileRelation) {
      result.relationsCreated.push({
        id: fileRelation.id,
        type: RelationType.DEPENDS_ON,
        targetEntityId: fileEntity.id,
        targetEntityName: ctx.filePath,
      });
    }

    result.stats.citationEntities++;

    // Create FUNCTION/TYPE entity if symbol info is available
    if (ctx.symbolName && ctx.symbolType) {
      const entityType = this.symbolTypeToEntityType(ctx.symbolType);
      const symbolEntity = await this.findOrCreateEntity(
        entityType,
        ctx.symbolName,
        memory.projectId,
        {
          filePath: ctx.filePath,
          startLine: ctx.startLine,
          symbolType: ctx.symbolType,
        }
      );

      result.entitiesCreated.push({
        id: symbolEntity.id,
        type: entityType,
        name: ctx.symbolName,
        isNew: symbolEntity.isNew,
      });

      // Link memory to symbol entity
      const symbolRelation = this.createMemoryEntityRelation(
        memory.id,
        symbolEntity.id,
        RelationType.DEPENDS_ON,
        memory.projectId
      );

      if (symbolRelation) {
        result.relationsCreated.push({
          id: symbolRelation.id,
          type: RelationType.DEPENDS_ON,
          targetEntityId: symbolEntity.id,
          targetEntityName: ctx.symbolName,
        });
      }

      // Link symbol to file (symbol is in file)
      this.relationRepo.createRelation({
        sourceId: symbolEntity.id,
        targetId: fileEntity.id,
        type: RelationType.DEPENDS_ON,
        projectId: memory.projectId,
        properties: { relationship: 'defined_in' },
      });

      result.stats.citationEntities++;
    }
  }

  /**
   * Extract and populate entities from memory content
   */
  private async populateFromContent(
    memory: Memory,
    result: PopulationResult
  ): Promise<void> {
    const content = memory.content;
    const extractedEntities: Map<string, { type: EntityType; name: string }> = new Map();

    // Extract file paths
    for (const match of content.matchAll(ENTITY_PATTERNS.filePath)) {
      const filePath = match[1];
      if (filePath && this.isValidEntityName(filePath) && !this.isCitedFile(filePath, memory)) {
        extractedEntities.set(`file:${filePath}`, {
          type: EntityType.FILE,
          name: filePath,
        });
      }
    }

    // Extract class/type names (PascalCase)
    for (const match of content.matchAll(ENTITY_PATTERNS.className)) {
      const className = match[1];
      if (className && this.isValidClassName(className)) {
        extractedEntities.set(`type:${className}`, {
          type: EntityType.TYPE,
          name: className,
        });
      }
    }

    // Extract function names from function calls
    for (const match of content.matchAll(ENTITY_PATTERNS.functionCall)) {
      const funcName = match[1];
      if (funcName && this.isValidFunctionName(funcName)) {
        extractedEntities.set(`func:${funcName}`, {
          type: EntityType.FUNCTION,
          name: funcName,
        });
      }
    }

    // Limit entities from content
    let count = 0;
    for (const [, entity] of extractedEntities) {
      if (count >= this.config.maxContentEntities) break;

      const existingEntity = await this.findOrCreateEntity(
        entity.type,
        entity.name,
        memory.projectId,
        { extractedFromContent: true }
      );

      result.entitiesCreated.push({
        id: existingEntity.id,
        type: entity.type,
        name: entity.name,
        isNew: existingEntity.isNew,
      });

      // Link memory to extracted entity
      const relation = this.createMemoryEntityRelation(
        memory.id,
        existingEntity.id,
        RelationType.DEPENDS_ON,
        memory.projectId
      );

      if (relation) {
        result.relationsCreated.push({
          id: relation.id,
          type: RelationType.DEPENDS_ON,
          targetEntityId: existingEntity.id,
          targetEntityName: entity.name,
        });
      }

      result.stats.contentEntities++;
      count++;
    }
  }

  /**
   * Find existing entity or create new one
   */
  private async findOrCreateEntity(
    type: EntityType,
    name: string,
    projectId: string,
    properties: Record<string, unknown>
  ): Promise<{ id: string; isNew: boolean }> {
    // Try to find existing entity by name and type
    const existing = this.entityRepo.findByName(name, projectId);
    if (existing && existing.type === type) {
      return { id: existing.id, isNew: false };
    }

    // Create new entity
    const input: EntityCreateInput = {
      type,
      name,
      projectId,
      properties,
    };

    const entity = this.entityRepo.createEntity(input);
    return { id: entity.id, isNew: true };
  }

  /**
   * Create a relation between a memory and an entity
   * Uses a special table for memory-entity links
   */
  private createMemoryEntityRelation(
    memoryId: string,
    entityId: string,
    type: RelationType,
    projectId: string
  ): { id: string } | null {
    // Check if relation already exists
    const existing = this.db.instance
      .prepare(
        `SELECT id FROM memory_entity_links
         WHERE memory_id = ? AND entity_id = ?`
      )
      .get(memoryId, entityId) as { id: string } | undefined;

    if (existing) {
      return null;
    }

    // Create the link
    const id = randomUUID();
    const now = Math.floor(Date.now() / 1000);

    this.db.instance
      .prepare(
        `INSERT INTO memory_entity_links (id, memory_id, entity_id, relation_type, project_id, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run(id, memoryId, entityId, type, projectId, now);

    return { id };
  }

  /**
   * Parse a citation string to extract code context
   */
  private parseCitation(citation: string): CodeContext | null {
    // Format: path/to/file.ts:123 or path/to/file.ts:123-456
    const match = citation.match(/^([^:]+):(\d+)(?:-(\d+))?$/);
    if (!match) return null;

    const filePath = match[1];
    const startLine = parseInt(match[2]!, 10);
    const endLine = match[3] ? parseInt(match[3], 10) : undefined;

    if (!filePath) return null;

    const ctx: CodeContext = { filePath, startLine };
    if (endLine !== undefined) ctx.endLine = endLine;

    return ctx;
  }

  /**
   * Convert SymbolType to EntityType
   */
  private symbolTypeToEntityType(symbolType: SymbolType): EntityType {
    switch (symbolType) {
      case SymbolType.FUNCTION:
      case SymbolType.METHOD:
        return EntityType.FUNCTION;
      case SymbolType.CLASS:
      case SymbolType.TYPE:
        return EntityType.TYPE;
      default:
        return EntityType.FUNCTION;
    }
  }

  /**
   * Check if a file path is already the cited file (avoid duplication)
   */
  private isCitedFile(filePath: string, memory: Memory): boolean {
    if (!memory.citation) return false;
    return memory.citation.startsWith(filePath);
  }

  /**
   * Validate entity name
   */
  private isValidEntityName(name: string): boolean {
    return (
      name.length >= this.config.minEntityNameLength &&
      name.length <= 200 &&
      !name.includes('..') &&
      !name.startsWith('/')
    );
  }

  /**
   * Validate class name (PascalCase, not excluded)
   */
  private isValidClassName(name: string): boolean {
    return (
      name.length >= 2 &&
      name.length <= 50 &&
      /^[A-Z][a-zA-Z0-9]+$/.test(name) &&
      !EXCLUDED_WORDS.has(name)
    );
  }

  /**
   * Validate function name (not a keyword, reasonable length)
   */
  private isValidFunctionName(name: string): boolean {
    const keywords = new Set([
      'if', 'else', 'for', 'while', 'do', 'switch', 'case', 'break',
      'continue', 'return', 'function', 'class', 'new', 'delete',
      'typeof', 'instanceof', 'void', 'this', 'super', 'import',
      'export', 'default', 'const', 'let', 'var', 'try', 'catch',
      'finally', 'throw', 'async', 'await', 'yield', 'in', 'of',
    ]);

    return (
      name.length >= 2 &&
      name.length <= 50 &&
      !keywords.has(name) &&
      /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name)
    );
  }

  /**
   * Get entities linked to a memory
   */
  getLinkedEntities(memoryId: string, projectId: string): Array<{
    entityId: string;
    entityName: string;
    entityType: EntityType;
    relationType: RelationType;
  }> {
    const rows = this.db.instance
      .prepare(
        `SELECT mel.entity_id, mel.relation_type, e.name, e.type
         FROM memory_entity_links mel
         JOIN entities e ON mel.entity_id = e.id
         WHERE mel.memory_id = ? AND mel.project_id = ?`
      )
      .all(memoryId, projectId) as Array<{
        entity_id: string;
        relation_type: string;
        name: string;
        type: string;
      }>;

    return rows.map((r) => ({
      entityId: r.entity_id,
      entityName: r.name,
      entityType: r.type as EntityType,
      relationType: r.relation_type as RelationType,
    }));
  }

  /**
   * Get memories linked to an entity
   */
  getLinkedMemories(entityId: string, projectId: string): string[] {
    const rows = this.db.instance
      .prepare(
        `SELECT memory_id FROM memory_entity_links
         WHERE entity_id = ? AND project_id = ?`
      )
      .all(entityId, projectId) as Array<{ memory_id: string }>;

    return rows.map((r) => r.memory_id);
  }
}
