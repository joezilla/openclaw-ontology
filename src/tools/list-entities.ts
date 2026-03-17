import { Type } from "@sinclair/typebox";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk/ontology";
import type { OntologyGraph } from "../ontology/types.js";

export function registerListTool(
  api: OpenClawPluginApi,
  getGraphs: () => OntologyGraph[],
): void {
  api.registerTool(
    {
      name: "ontology_list",
      label: "List Ontologies",
      description:
        "List all loaded ontologies with their entity, metric, and dimension counts. Use this to discover what data domains are available.",
      parameters: Type.Object({}),
      async execute() {
        const graphs = getGraphs();

        if (graphs.length === 0) {
          return {
            content: [{ type: "text", text: "No ontologies loaded." }],
            details: { count: 0 },
          };
        }

        const lines = graphs.map((g) => {
          const def = g.definition;
          return [
            `- **${def.name}** (${def.id}) v${def.version}`,
            `  Entities: ${def.entities.length}, Metrics: ${def.metrics.length}, Dimensions: ${def.dimensions.length}`,
            def.description ? `  ${def.description}` : "",
          ]
            .filter(Boolean)
            .join("\n");
        });

        return {
          content: [
            {
              type: "text",
              text: `Loaded ontologies (${graphs.length}):\n\n${lines.join("\n\n")}`,
            },
          ],
          details: { count: graphs.length },
        };
      },
    },
    { name: "ontology_list" },
  );
}
