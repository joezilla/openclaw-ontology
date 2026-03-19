import type { OntologyGraph, OntologyDimension, ResolvedJoin } from "../ontology/types.js";
import { findJoinPath } from "../ontology/resolver.js";

type ParsedDimension = {
  dim: OntologyDimension;
  granularity?: string;
};

export type QueryPlan = {
  sql: string;
  params: Record<string, unknown>;
  joins: ResolvedJoin[];
  explanation: string;
};

export type QueryOptions = {
  entityId: string;
  metrics?: string[];
  dimensions?: string[];
  filters?: string[];
  orderBy?: string;
  limit?: number;
};

/**
 * Plan a SQL query based on ontology graph and structured query options.
 * Resolves joins, builds SELECT/GROUP BY/WHERE clauses.
 */
export function planQuery(graph: OntologyGraph, options: QueryOptions): QueryPlan {
  const { entityId, metrics = [], dimensions = [], filters = [], orderBy, limit } = options;

  const primaryEntity = graph.entityMap.get(entityId);
  if (!primaryEntity) {
    throw new Error(`Entity "${entityId}" not found in ontology`);
  }

  const source = graph.definition.source;
  const tablePrefix = source.catalog && source.schema
    ? `${source.catalog}.${source.schema}.`
    : source.schema
      ? `${source.schema}.`
      : "";

  // Parse dimension strings — support "dimId:granularity" syntax
  const parsedDimensions: ParsedDimension[] = dimensions.map((dimStr) => {
    const [baseId, granularity] = dimStr.split(":");
    const dim = graph.dimensionMap.get(baseId!);
    if (!dim) {
      throw new Error(`Dimension "${baseId}" not found in ontology`);
    }
    if (granularity) {
      if (!dim.granularities || dim.granularities.length === 0) {
        throw new Error(`Dimension "${baseId}" does not support granularities`);
      }
      if (!dim.granularities.includes(granularity as any)) {
        throw new Error(`Invalid granularity "${granularity}" for dimension "${baseId}". Allowed: ${dim.granularities.join(", ")}`);
      }
    }
    return { dim, granularity };
  });

  // Collect all required joins
  const allJoins: ResolvedJoin[] = [];
  const joinedEntities = new Set<string>([entityId]);

  // Track which entities we need for dimensions
  for (const { dim } of parsedDimensions) {
    if (dim.entity !== entityId && !joinedEntities.has(dim.entity)) {
      const path = findJoinPath(graph, entityId, dim.entity);
      if (path.length === 0) {
        throw new Error(`No join path from "${entityId}" to "${dim.entity}" for dimension "${dim.id}"`);
      }
      for (const join of path) {
        if (!allJoins.some((j) => j.relationship.id === join.relationship.id)) {
          allJoins.push(join);
        }
        joinedEntities.add(join.fromEntity);
        joinedEntities.add(join.toEntity);
      }
    }
  }

  // Build table aliases
  const entityAliases = new Map<string, string>();
  entityAliases.set(entityId, "e1");
  let aliasCounter = 2;
  for (const join of allJoins) {
    if (!entityAliases.has(join.fromEntity)) {
      entityAliases.set(join.fromEntity, `e${aliasCounter++}`);
    }
    if (!entityAliases.has(join.toEntity)) {
      entityAliases.set(join.toEntity, `e${aliasCounter++}`);
    }
  }

  // Build SELECT columns
  const selectParts: string[] = [];
  const groupByParts: string[] = [];

  // Add dimensions to SELECT
  for (const { dim, granularity } of parsedDimensions) {
    const alias = entityAliases.get(dim.entity)!;
    const colRef = `${alias}.${dim.column}`;
    if (granularity) {
      const truncExpr = `DATE_TRUNC('${granularity}', ${colRef})`;
      selectParts.push(`${truncExpr} AS ${dim.column}_${granularity}`);
      groupByParts.push(truncExpr);
    } else {
      selectParts.push(`${colRef} AS ${dim.column}`);
      groupByParts.push(colRef);
    }
  }

  // Add metrics to SELECT
  for (const metricId of metrics) {
    const metric = graph.metricMap.get(metricId);
    if (!metric) {
      throw new Error(`Metric "${metricId}" not found in ontology`);
    }
    // Replace bare column refs with aliased refs
    const alias = entityAliases.get(metric.entity) ?? entityAliases.get(entityId)!;
    const expr = prefixColumnRefs(metric.expression, alias, primaryEntity.columns.map((c) => c.name));
    selectParts.push(`${expr} AS ${metricId}`);
  }

  // If no explicit selections, select all columns from primary entity
  if (selectParts.length === 0) {
    const alias = entityAliases.get(entityId)!;
    selectParts.push(`${alias}.*`);
  }

  // Build FROM clause
  const primaryAlias = entityAliases.get(entityId)!;
  let fromClause = `${tablePrefix}${primaryEntity.table} ${primaryAlias}`;

  // Build JOIN clauses
  for (const join of allJoins) {
    const fromAlias = entityAliases.get(join.fromEntity)!;
    const toAlias = entityAliases.get(join.toEntity)!;
    const toEntity = graph.entityMap.get(join.toEntity)!;
    fromClause += `\n  JOIN ${tablePrefix}${toEntity.table} ${toAlias} ON ${fromAlias}.${join.fromColumn} = ${toAlias}.${join.toColumn}`;
  }

  // Build WHERE clause
  const whereParts: string[] = [];

  // Add metric filters
  for (const metricId of metrics) {
    const metric = graph.metricMap.get(metricId);
    if (metric?.filters) {
      for (const f of metric.filters) {
        const alias = entityAliases.get(metric.entity) ?? primaryAlias;
        whereParts.push(prefixColumnRefs(f, alias, primaryEntity.columns.map((c) => c.name)));
      }
    }
  }

  // Add user filters
  for (const filter of filters) {
    whereParts.push(filter);
  }

  // Assemble SQL
  let sql = `SELECT ${selectParts.join(", ")}\nFROM ${fromClause}`;

  if (whereParts.length > 0) {
    sql += `\nWHERE ${whereParts.join("\n  AND ")}`;
  }

  if (groupByParts.length > 0) {
    sql += `\nGROUP BY ${groupByParts.join(", ")}`;
  }

  if (orderBy) {
    sql += `\nORDER BY ${orderBy}`;
  }

  if (limit) {
    sql += `\nLIMIT ${limit}`;
  }

  // Build explanation
  const explanationParts = [`Query entity "${primaryEntity.name}" (${primaryEntity.table})`];
  if (metrics.length > 0) {
    explanationParts.push(`Metrics: ${metrics.join(", ")}`);
  }
  if (dimensions.length > 0) {
    explanationParts.push(`Grouped by: ${dimensions.join(", ")}`);
  }
  if (allJoins.length > 0) {
    explanationParts.push(`Joins: ${allJoins.map((j) => `${j.fromEntity} -> ${j.toEntity}`).join(", ")}`);
  }

  return {
    sql,
    params: {},
    joins: allJoins,
    explanation: explanationParts.join(". "),
  };
}

/**
 * Prefix bare column names with a table alias.
 * Handles simple cases like SUM(total_amount) -> SUM(e1.total_amount).
 */
function prefixColumnRefs(expr: string, alias: string, knownColumns: string[]): string {
  let result = expr;
  // Sort by length descending to avoid partial replacements
  const sorted = [...knownColumns].sort((a, b) => b.length - a.length);
  for (const col of sorted) {
    // Match bare column name not already prefixed (negative lookbehind for dot)
    const pattern = new RegExp(`(?<!\\.)\\b${col}\\b`, "g");
    result = result.replace(pattern, `${alias}.${col}`);
  }
  return result;
}
