import { Type } from "@sinclair/typebox";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk/ontology";
import type { OntologyGraph } from "../ontology/types.js";
import { buildEntityDetail } from "../context/injector.js";

export function registerExploreTool(
  api: OpenClawPluginApi,
  getGraphs: () => OntologyGraph[],
): void {
  api.registerTool(
    {
      name: "ontology_explore",
      label: "Explore Ontology",
      description:
        "Browse the ontology graph. Without an entityId, returns an overview of all entities and their relationships. With an entityId, returns that entity's columns, metrics, dimensions, and connections.",
      parameters: Type.Object({
        entityId: Type.Optional(
          Type.String({ description: "Entity ID to explore (omit for full overview)" }),
        ),
      }),
      async execute(_toolCallId, params) {
        const { entityId } = params as { entityId?: string };
        const graphs = getGraphs();

        if (graphs.length === 0) {
          return {
            content: [{ type: "text", text: "No ontologies loaded." }],
            details: { error: "no_ontologies" },
          };
        }

        if (entityId) {
          // Find graph containing entity
          const graph = graphs.find((g) => g.entityMap.has(entityId));
          if (!graph) {
            return {
              content: [{ type: "text", text: `Entity "${entityId}" not found.` }],
              details: { error: "entity_not_found" },
            };
          }

          const detail = buildEntityDetail(graph, entityId);
          return {
            content: [{ type: "text", text: detail }],
            details: { entityId, ontologyId: graph.definition.id },
          };
        }

        // Overview of all ontologies
        const lines: string[] = [];
        for (const graph of graphs) {
          const def = graph.definition;
          lines.push(`## ${def.name} (${def.id})`);
          if (def.description) {
            lines.push(def.description);
          }
          lines.push("");

          lines.push("**Entities:**");
          for (const entity of def.entities) {
            const desc = entity.description ? ` -- ${entity.description}` : "";
            lines.push(`- ${entity.name} (${entity.id})${desc}`);
          }
          lines.push("");

          if (def.relationships.length > 0) {
            lines.push("**Relationships:**");
            for (const rel of def.relationships) {
              lines.push(`- ${rel.from} -> ${rel.to} (${rel.type})`);
            }
            lines.push("");
          }

          if (def.metrics.length > 0) {
            lines.push("**Metrics:**");
            for (const m of def.metrics) {
              lines.push(`- ${m.name} (${m.id}): ${m.expression}`);
            }
            lines.push("");
          }

          if (def.dimensions.length > 0) {
            lines.push("**Dimensions:**");
            for (const d of def.dimensions) {
              const gran = d.granularities ? ` [${d.granularities.join(", ")}]` : "";
              lines.push(`- ${d.name} (${d.column})${gran}`);
            }
            lines.push("");
          }
        }

        return {
          content: [{ type: "text", text: lines.join("\n") }],
          details: { ontologyCount: graphs.length },
        };
      },
    },
    { name: "ontology_explore" },
  );
}
