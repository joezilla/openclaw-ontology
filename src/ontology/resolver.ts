import type {
  OntologyDefinition,
  OntologyEntity,
  OntologyGraph,
  OntologyMetric,
  OntologyDimension,
  ResolvedJoin,
} from "./types.js";

/**
 * Build the ontology graph from a definition.
 * Creates lookup maps, resolves joins, and builds adjacency for path-finding.
 */
export function buildOntologyGraph(def: OntologyDefinition): OntologyGraph {
  const entityMap = new Map<string, OntologyEntity>();
  const metricMap = new Map<string, OntologyMetric>();
  const dimensionMap = new Map<string, OntologyDimension>();
  const adjacency = new Map<string, Set<string>>();

  for (const entity of def.entities) {
    entityMap.set(entity.id, entity);
    adjacency.set(entity.id, new Set());
  }

  for (const metric of def.metrics) {
    metricMap.set(metric.id, metric);
  }

  for (const dim of def.dimensions) {
    dimensionMap.set(dim.id, dim);
  }

  // Resolve relationships into joins
  const joins: ResolvedJoin[] = [];
  for (const rel of def.relationships) {
    const [fromEntity, fromColumn] = rel.from.split(".");
    const [toEntity, toColumn] = rel.to.split(".");

    if (!fromEntity || !fromColumn || !toEntity || !toColumn) {
      continue;
    }

    joins.push({
      fromEntity,
      fromColumn,
      toEntity,
      toColumn,
      relationship: rel,
    });

    // Bidirectional adjacency
    adjacency.get(fromEntity)?.add(toEntity);
    adjacency.get(toEntity)?.add(fromEntity);
  }

  return {
    definition: def,
    entityMap,
    metricMap,
    dimensionMap,
    joins,
    adjacency,
  };
}

/**
 * Find the shortest join path between two entities using BFS.
 * Returns the sequence of joins needed, or empty array if no path.
 */
export function findJoinPath(
  graph: OntologyGraph,
  fromEntity: string,
  toEntity: string,
): ResolvedJoin[] {
  if (fromEntity === toEntity) {
    return [];
  }

  // BFS
  const visited = new Set<string>([fromEntity]);
  const parent = new Map<string, { entity: string; join: ResolvedJoin }>();
  const queue: string[] = [fromEntity];

  while (queue.length > 0) {
    const current = queue.shift()!;

    if (current === toEntity) {
      // Reconstruct path
      const path: ResolvedJoin[] = [];
      let node = toEntity;
      while (parent.has(node)) {
        const p = parent.get(node)!;
        path.unshift(p.join);
        node = p.entity;
      }
      return path;
    }

    const neighbors = graph.adjacency.get(current);
    if (!neighbors) {
      continue;
    }

    for (const neighbor of neighbors) {
      if (visited.has(neighbor)) {
        continue;
      }
      visited.add(neighbor);

      // Find the join connecting current to neighbor
      const join = graph.joins.find(
        (j) =>
          (j.fromEntity === current && j.toEntity === neighbor) ||
          (j.toEntity === current && j.fromEntity === neighbor),
      );

      if (join) {
        parent.set(neighbor, { entity: current, join });
        queue.push(neighbor);
      }
    }
  }

  return []; // No path found
}
