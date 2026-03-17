import { Type } from "@sinclair/typebox";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk/ontology";
import type { OntologyGraph } from "../ontology/types.js";
import type { DatabaseConnector } from "../connectors/types.js";
import { planQuery } from "../query/planner.js";
import { executeQuery, formatResultAsMarkdown } from "../query/executor.js";
import { validateQuerySafety, applyLimits, sanitizeFilter } from "../query/safety.js";

type QueryConfig = {
  maxRows: number;
  timeoutMs: number;
  allowRawSql: boolean;
};

export function registerQueryTool(
  api: OpenClawPluginApi,
  getGraphs: () => OntologyGraph[],
  connector: DatabaseConnector,
  queryConfig: QueryConfig,
): void {
  api.registerTool(
    {
      name: "ontology_query",
      label: "Ontology Query",
      description:
        "Execute a structured query through the business ontology. Returns data from the connected data warehouse, formatted as a table. Use this when the user asks data questions about business metrics, entities, or dimensions defined in the ontology.",
      parameters: Type.Object({
        entityId: Type.String({ description: "The entity to query (e.g. 'order', 'customer')" }),
        metrics: Type.Optional(
          Type.Array(Type.String(), { description: "Metric IDs to compute (e.g. ['total_revenue'])" }),
        ),
        dimensions: Type.Optional(
          Type.Array(Type.String(), { description: "Dimension IDs to group by (e.g. ['time', 'customer_segment'])" }),
        ),
        filters: Type.Optional(
          Type.Array(Type.String(), { description: "SQL filter expressions (e.g. [\"order_date >= '2025-01-01'\"])" }),
        ),
        limit: Type.Optional(
          Type.Number({ description: "Maximum rows to return (default: config maxRows)" }),
        ),
      }),
      async execute(_toolCallId, params) {
        const {
          entityId,
          metrics = [],
          dimensions = [],
          filters = [],
          limit,
        } = params as {
          entityId: string;
          metrics?: string[];
          dimensions?: string[];
          filters?: string[];
          limit?: number;
        };

        const graphs = getGraphs();
        if (graphs.length === 0) {
          return {
            content: [{ type: "text", text: "No ontologies loaded. Check ontology configuration." }],
            details: { error: "no_ontologies" },
          };
        }

        // Find the graph containing this entity
        const graph = graphs.find((g) => g.entityMap.has(entityId));
        if (!graph) {
          return {
            content: [{ type: "text", text: `Entity "${entityId}" not found in any loaded ontology.` }],
            details: { error: "entity_not_found" },
          };
        }

        try {
          // Sanitize user filters
          const sanitizedFilters = filters.map((f) => sanitizeFilter(f));

          // Plan the query
          const plan = planQuery(graph, {
            entityId,
            metrics,
            dimensions,
            filters: sanitizedFilters,
            limit: limit ?? queryConfig.maxRows,
          });

          // Safety check
          const safety = validateQuerySafety(plan.sql);
          if (!safety.safe) {
            return {
              content: [{ type: "text", text: `Query rejected: ${safety.reason}` }],
              details: { error: "unsafe_query", reason: safety.reason },
            };
          }

          // Apply limits
          const safeSql = applyLimits(plan.sql, queryConfig.maxRows, queryConfig.timeoutMs);
          plan.sql = safeSql;

          // Execute
          const result = await executeQuery(connector, plan);
          const markdown = formatResultAsMarkdown(result);

          return {
            content: [{ type: "text", text: `${plan.explanation}\n\n${markdown}` }],
            details: {
              sql: plan.sql,
              rowCount: result.rowCount,
              executionTimeMs: result.executionTimeMs,
              truncated: result.truncated,
            },
          };
        } catch (err) {
          return {
            content: [{ type: "text", text: `Query failed: ${String(err)}` }],
            details: { error: "query_failed", message: String(err) },
          };
        }
      },
    },
    { name: "ontology_query" },
  );
}
