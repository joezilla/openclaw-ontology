import { Type } from "@sinclair/typebox";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import type { OntologyGraph } from "../ontology/types.js";
import { planQuery } from "../query/planner.js";
import { sanitizeFilter } from "../query/safety.js";

type QueryConfig = {
  maxRows: number;
  timeoutMs: number;
  allowRawSql: boolean;
};

export function registerSqlTool(
  api: OpenClawPluginApi,
  getGraphs: () => OntologyGraph[],
  queryConfig: QueryConfig,
): void {
  api.registerTool(
    {
      name: "ontology_sql",
      label: "Preview SQL",
      description:
        "Generate the SQL query that would be executed for given parameters, without actually running it. Use this for dry-run previews, debugging, or when the user wants to see the generated SQL.",
      parameters: Type.Object({
        entityId: Type.String({ description: "The entity to query" }),
        metrics: Type.Optional(
          Type.Array(Type.String(), { description: "Metric IDs to compute" }),
        ),
        dimensions: Type.Optional(
          Type.Array(Type.String(), { description: "Dimension IDs to group by" }),
        ),
        filters: Type.Optional(
          Type.Array(Type.String(), { description: "SQL filter expressions" }),
        ),
        limit: Type.Optional(Type.Number({ description: "Max rows" })),
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
        const graph = graphs.find((g) => g.entityMap.has(entityId));

        if (!graph) {
          return {
            content: [{ type: "text", text: `Entity "${entityId}" not found.` }],
            details: { error: "entity_not_found" },
          };
        }

        try {
          const sanitizedFilters = filters.map((f) => sanitizeFilter(f));

          const plan = planQuery(graph, {
            entityId,
            metrics,
            dimensions,
            filters: sanitizedFilters,
            limit: limit ?? queryConfig.maxRows,
          });

          const text = [
            "**Generated SQL (dry-run):**",
            "```sql",
            plan.sql,
            "```",
            "",
            `**Explanation:** ${plan.explanation}`,
          ];

          if (plan.joins.length > 0) {
            text.push(
              "",
              "**Joins:**",
              ...plan.joins.map(
                (j) => `- ${j.fromEntity}.${j.fromColumn} = ${j.toEntity}.${j.toColumn}`,
              ),
            );
          }

          return {
            content: [{ type: "text", text: text.join("\n") }],
            details: { sql: plan.sql, joins: plan.joins.length },
          };
        } catch (err) {
          return {
            content: [{ type: "text", text: `SQL generation failed: ${String(err)}` }],
            details: { error: "plan_failed", message: String(err) },
          };
        }
      },
    },
    { name: "ontology_sql" },
  );
}
