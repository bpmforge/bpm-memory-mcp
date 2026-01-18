import type { DatabaseConnection } from '../storage/database.js';
import type { Entity, Relation, RelationType } from '../types.js';
import { EntityType } from '../types.js';
import { EntityRepository } from './entities.js';
import { RelationRepository } from './relations.js';

export { EntityRepository } from './entities.js';
export { RelationRepository } from './relations.js';

export interface SubgraphResult {
  entities: Entity[];
  relations: Relation[];
  center: Entity;
  depth: number;
}

export interface PathResult {
  path: Entity[];
  relations: Relation[];
  length: number;
}

export interface ConnectedResult {
  entity: Entity;
  relations: Relation[];
  depth: number;
}

/**
 * Knowledge Graph Service - Unified graph operations
 */
export class KnowledgeGraph {
  private entities: EntityRepository;
  private relations: RelationRepository;

  constructor(private db: DatabaseConnection) {
    this.entities = new EntityRepository(db);
    this.relations = new RelationRepository(db);
  }

  /**
   * Get entity repository
   */
  get entityRepo(): EntityRepository {
    return this.entities;
  }

  /**
   * Get relation repository
   */
  get relationRepo(): RelationRepository {
    return this.relations;
  }

  /**
   * Find connected entities up to a depth
   */
  findConnected(
    entityId: string,
    projectId: string,
    depth: number = 2
  ): ConnectedResult[] {
    const visited = new Map<string, { entity: Entity; depth: number }>();
    const results: ConnectedResult[] = [];
    const queue: Array<{ id: string; level: number }> = [
      { id: entityId, level: 0 },
    ];

    while (queue.length > 0) {
      const current = queue.shift()!;
      if (visited.has(current.id) || current.level > depth) {
        continue;
      }

      const entity = this.entities.findById(current.id, projectId);
      if (!entity) continue;

      visited.set(current.id, { entity, depth: current.level });

      if (current.level < depth) {
        const relations = this.relations.findRelations(current.id, projectId);
        for (const rel of relations) {
          const nextId =
            rel.sourceId === current.id ? rel.targetId : rel.sourceId;
          if (!visited.has(nextId)) {
            queue.push({ id: nextId, level: current.level + 1 });
          }
        }
      }
    }

    // Build results
    for (const [id, info] of visited.entries()) {
      if (id === entityId) continue; // Skip the starting entity
      const relations = this.relations.findRelations(id, projectId);
      results.push({
        entity: info.entity,
        relations,
        depth: info.depth,
      });
    }

    return results.sort((a, b) => a.depth - b.depth);
  }

  /**
   * Find shortest path between two entities
   */
  findShortestPath(
    fromId: string,
    toId: string,
    projectId: string,
    maxDepth: number = 5
  ): PathResult | null {
    interface QueueItem {
      entityId: string;
      path: string[];
      relations: Relation[];
    }

    const visited = new Set<string>();
    const queue: QueueItem[] = [{ entityId: fromId, path: [fromId], relations: [] }];

    while (queue.length > 0) {
      const current = queue.shift()!;

      if (current.path.length > maxDepth + 1) {
        continue;
      }

      if (current.entityId === toId) {
        // Found path - build result
        const entities: Entity[] = [];
        for (const id of current.path) {
          const entity = this.entities.findById(id, projectId);
          if (entity) entities.push(entity);
        }

        return {
          path: entities,
          relations: current.relations,
          length: current.path.length - 1,
        };
      }

      if (visited.has(current.entityId)) {
        continue;
      }
      visited.add(current.entityId);

      // Explore neighbors
      const relations = this.relations.findRelations(
        current.entityId,
        projectId
      );
      for (const rel of relations) {
        const nextId =
          rel.sourceId === current.entityId ? rel.targetId : rel.sourceId;
        if (!visited.has(nextId)) {
          queue.push({
            entityId: nextId,
            path: [...current.path, nextId],
            relations: [...current.relations, rel],
          });
        }
      }
    }

    return null;
  }

  /**
   * Get subgraph around an entity
   */
  getSubgraph(
    entityId: string,
    projectId: string,
    radius: number = 2
  ): SubgraphResult | null {
    const center = this.entities.findById(entityId, projectId);
    if (!center) return null;

    const entityIds = this.relations.getConnectedIds(entityId, projectId, radius);
    const entities: Entity[] = [];
    const relationSet = new Set<string>();
    const relations: Relation[] = [];

    // Get all entities
    for (const id of entityIds) {
      const entity = this.entities.findById(id, projectId);
      if (entity) entities.push(entity);
    }

    // Get all relations between entities in subgraph
    for (const id of entityIds) {
      const rels = this.relations.findRelations(id, projectId);
      for (const rel of rels) {
        // Only include if both entities are in subgraph
        if (
          entityIds.has(rel.sourceId) &&
          entityIds.has(rel.targetId) &&
          !relationSet.has(rel.id)
        ) {
          relationSet.add(rel.id);
          relations.push(rel);
        }
      }
    }

    return {
      entities,
      relations,
      center,
      depth: radius,
    };
  }

  /**
   * Query entities and relations matching criteria
   */
  query(
    projectId: string,
    options: {
      entityType?: EntityType;
      relationType?: RelationType;
      entityName?: string;
      depth?: number;
    } = {}
  ): { entities: Entity[]; relations: Relation[] } {
    const { entityType, relationType, entityName } = options;

    let entities: Entity[] = [];

    // Find matching entities
    if (entityName) {
      const searchOpts: { type?: EntityType; limit?: number } = { limit: 50 };
      if (entityType) searchOpts.type = entityType;
      entities = this.entities.searchByName(entityName, projectId, searchOpts);
    } else if (entityType) {
      entities = this.entities.findByType(entityType, projectId, { limit: 50 });
    } else {
      // Get all active entities (limited)
      const types: EntityType[] = [
        EntityType.FILE,
        EntityType.FUNCTION,
        EntityType.TYPE,
        EntityType.DECISION,
        EntityType.ERROR,
      ];
      for (const type of types) {
        const typeEntities = this.entities.findByType(type, projectId, {
          limit: 10,
        });
        entities.push(...typeEntities);
      }
    }

    // Get relations for found entities
    const relationSet = new Set<string>();
    const relations: Relation[] = [];

    for (const entity of entities) {
      const rels = this.relations.findRelations(entity.id, projectId);
      for (const rel of rels) {
        if (relationType && rel.type !== relationType) continue;
        if (!relationSet.has(rel.id)) {
          relationSet.add(rel.id);
          relations.push(rel);
        }
      }
    }

    return { entities, relations };
  }

  /**
   * Get graph statistics
   */
  getStats(projectId: string): {
    entityCounts: Record<EntityType, number>;
    relationCounts: Record<RelationType, number>;
    totalEntities: number;
    totalRelations: number;
  } {
    const entityCounts = this.entities.countByProject(projectId);
    const relationCounts = this.relations.countByProject(projectId);

    const totalEntities = Object.values(entityCounts).reduce((a, b) => a + b, 0);
    const totalRelations = Object.values(relationCounts).reduce(
      (a, b) => a + b,
      0
    );

    return {
      entityCounts,
      relationCounts,
      totalEntities,
      totalRelations,
    };
  }
}
