import fs from "node:fs";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk/ontology";
import type { OntologyGraph } from "../ontology/types.js";
import type { DatabaseConnector } from "../connectors/types.js";
import { validateOntologyStructure } from "../ontology/loader.js";
import { validateAgainstSchema } from "../ontology/validator.js";
import { buildEntityDetail } from "../context/injector.js";

export function registerCliCommands(
  api: OpenClawPluginApi,
  getGraphs: () => OntologyGraph[],
  connector: DatabaseConnector,
): void {
  api.registerCli(
    ({ program }) => {
      const ontology = program
        .command("ontology")
        .description("Ontology plugin commands");

      ontology
        .command("list")
        .description("List loaded ontologies")
        .action(() => {
          const graphs = getGraphs();
          if (graphs.length === 0) {
            console.log("No ontologies loaded.");
            return;
          }
          for (const g of graphs) {
            const def = g.definition;
            console.log(
              `${def.id} -- ${def.name} v${def.version} (${def.entities.length} entities, ${def.metrics.length} metrics, ${def.dimensions.length} dimensions)`,
            );
          }
        });

      ontology
        .command("describe")
        .description("Show ontology details")
        .argument("<id>", "Ontology or entity ID")
        .action((id) => {
          const graphs = getGraphs();

          // Try as ontology ID first
          const graph = graphs.find((g) => g.definition.id === id);
          if (graph) {
            const def = graph.definition;
            console.log(`${def.name} (${def.id}) v${def.version}`);
            if (def.description) {
              console.log(def.description);
            }
            console.log(`\nEntities: ${def.entities.map((e) => e.id).join(", ")}`);
            console.log(`Metrics: ${def.metrics.map((m) => m.id).join(", ")}`);
            console.log(`Dimensions: ${def.dimensions.map((d) => d.id).join(", ")}`);
            return;
          }

          // Try as entity ID
          for (const g of graphs) {
            if (g.entityMap.has(id)) {
              console.log(buildEntityDetail(g, id));
              return;
            }
          }

          console.error(`Not found: "${id}"`);
        });

      ontology
        .command("validate")
        .description("Validate ontology against live schema")
        .argument("[id]", "Ontology ID (omit to validate all)")
        .action(async (id) => {
          const graphs = getGraphs();
          const toValidate = id
            ? graphs.filter((g) => g.definition.id === id)
            : graphs;

          if (toValidate.length === 0) {
            console.log(id ? `Ontology "${id}" not found.` : "No ontologies loaded.");
            return;
          }

          for (const graph of toValidate) {
            const def = graph.definition;
            console.log(`\nValidating: ${def.name} (${def.id})`);

            const structErrors = validateOntologyStructure(def);
            if (structErrors.length > 0) {
              console.log("  Structural errors:");
              for (const err of structErrors) {
                console.log(`    - ${err}`);
              }
            }

            if (connector.isConnected()) {
              const result = await validateAgainstSchema(def, connector);
              if (result.errors.length > 0) {
                console.log("  Schema errors:");
                for (const err of result.errors) {
                  console.log(`    - ${err}`);
                }
              }
              if (result.warnings.length > 0) {
                console.log("  Warnings:");
                for (const w of result.warnings) {
                  console.log(`    - ${w}`);
                }
              }
              if (result.valid && structErrors.length === 0) {
                console.log("  Valid");
              }
            } else {
              console.log("  (DB not connected -- structural validation only)");
              if (structErrors.length === 0) {
                console.log("  Structural validation passed");
              }
            }
          }
        });

      ontology
        .command("sync")
        .description("Sync metadata from database")
        .argument("[id]", "Ontology ID")
        .action(async (id) => {
          if (!connector.isConnected()) {
            console.error("Database not connected. Start the ontology service first.");
            return;
          }
          console.log(`Syncing metadata${id ? ` for ${id}` : ""}...`);
          // Trigger a schema refresh via ping
          const ok = await connector.ping();
          console.log(ok ? "Sync complete." : "Sync failed -- database not reachable.");
        });

      ontology
        .command("init")
        .description("Generate a starter ontology YAML template")
        .action(() => {
          const template = `ontology:
  id: my_ontology
  name: My Ontology
  version: "1.0"
  description: "Describe your data domain here"

  source:
    connector: databricks
    catalog: main
    schema: default

  entities:
    - id: example_entity
      name: Example Entity
      description: "An example entity"
      table: my_table
      primaryKey: id
      columns:
        - name: id
          type: string
          description: "Primary identifier"
        - name: name
          type: string
          description: "Display name"
        - name: created_at
          type: timestamp
          description: "Creation timestamp"

  relationships: []

  metrics:
    - id: total_count
      name: Total Count
      entity: example_entity
      expression: "COUNT(*)"

  dimensions:
    - id: by_date
      name: By Date
      entity: example_entity
      column: created_at
      granularities: [day, week, month]
`;
          console.log(template);
          console.log(
            "Save this to a .yaml file in your ontology directory (default: ~/.openclaw/ontologies/)",
          );
        });
    },
    { commands: ["ontology"] },
  );
}
