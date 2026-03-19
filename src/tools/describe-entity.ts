import { Type } from "@sinclair/typebox";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import type { OntologyGraph } from "../ontology/types.js";
import { buildEntityDetail } from "../context/injector.js";

type ItemType = "entity" | "metric" | "dimension" | "relationship";

export function registerDescribeTool(
  api: OpenClawPluginApi,
  getGraphs: () => OntologyGraph[],
): void {
  api.registerTool(
    {
      name: "ontology_describe",
      label: "Describe Ontology Item",
      description:
        "Get detailed information about a specific entity, metric, dimension, or relationship in the ontology.",
      parameters: Type.Object({
        ontologyId: Type.String({ description: "Ontology ID" }),
        itemType: Type.Unsafe<ItemType>({
          type: "string",
          enum: ["entity", "metric", "dimension", "relationship"],
          description: "Type of item to describe",
        }),
        itemId: Type.String({ description: "Item ID" }),
      }),
      async execute(_toolCallId, params) {
        const { ontologyId, itemType, itemId } = params as {
          ontologyId: string;
          itemType: ItemType;
          itemId: string;
        };

        const graphs = getGraphs();
        const graph = graphs.find((g) => g.definition.id === ontologyId);

        if (!graph) {
          return {
            content: [{ type: "text", text: `Ontology "${ontologyId}" not found.` }],
            details: { error: "ontology_not_found" },
          };
        }

        switch (itemType) {
          case "entity": {
            const detail = buildEntityDetail(graph, itemId);
            if (!detail) {
              return {
                content: [{ type: "text", text: `Entity "${itemId}" not found in "${ontologyId}".` }],
                details: { error: "not_found" },
              };
            }
            return {
              content: [{ type: "text", text: detail }],
              details: { ontologyId, itemType, itemId },
            };
          }

          case "metric": {
            const metric = graph.metricMap.get(itemId);
            if (!metric) {
              return {
                content: [{ type: "text", text: `Metric "${itemId}" not found.` }],
                details: { error: "not_found" },
              };
            }
            const lines = [
              `Metric: ${metric.name} (${metric.id})`,
              `Entity: ${metric.entity}`,
              `Expression: ${metric.expression}`,
            ];
            if (metric.description) {
              lines.push(`Description: ${metric.description}`);
            }
            if (metric.filters?.length) {
              lines.push(`Filters: ${metric.filters.join(", ")}`);
            }
            return {
              content: [{ type: "text", text: lines.join("\n") }],
              details: { ontologyId, itemType, itemId },
            };
          }

          case "dimension": {
            const dim = graph.dimensionMap.get(itemId);
            if (!dim) {
              return {
                content: [{ type: "text", text: `Dimension "${itemId}" not found.` }],
                details: { error: "not_found" },
              };
            }
            const lines = [
              `Dimension: ${dim.name} (${dim.id})`,
              `Entity: ${dim.entity}`,
              `Column: ${dim.column}`,
            ];
            if (dim.granularities?.length) {
              lines.push(`Granularities: ${dim.granularities.join(", ")}`);
              lines.push(`Usage: ${dim.id} (raw), ${dim.granularities.map((g) => `${dim.id}:${g}`).join(", ")}`);
            }
            return {
              content: [{ type: "text", text: lines.join("\n") }],
              details: { ontologyId, itemType, itemId },
            };
          }

          case "relationship": {
            const rel = graph.definition.relationships.find((r) => r.id === itemId);
            if (!rel) {
              return {
                content: [{ type: "text", text: `Relationship "${itemId}" not found.` }],
                details: { error: "not_found" },
              };
            }
            const lines = [
              `Relationship: ${rel.id}`,
              `From: ${rel.from}`,
              `To: ${rel.to}`,
              `Type: ${rel.type}`,
            ];
            if (rel.description) {
              lines.push(`Description: ${rel.description}`);
            }
            return {
              content: [{ type: "text", text: lines.join("\n") }],
              details: { ontologyId, itemType, itemId },
            };
          }

          default:
            return {
              content: [{ type: "text", text: `Unknown item type: "${itemType}"` }],
              details: { error: "unknown_type" },
            };
        }
      },
    },
    { name: "ontology_describe" },
  );
}
