import fs from "node:fs";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import type { OntologyGraph } from "../ontology/types.js";
import type { DatabaseConnector } from "../connectors/types.js";
import type { OntologyPluginConfig } from "../../config.js";
import { validateOntologyStructure } from "../ontology/loader.js";
import { validateAgainstSchema } from "../ontology/validator.js";
import { buildEntityDetail } from "../context/injector.js";
import { discoverOntology } from "./discover.js";

async function ensureConnected(
  connector: DatabaseConnector,
  config: OntologyPluginConfig,
): Promise<boolean> {
  if (connector.isConnected()) return true;
  try {
    await connector.connect({
      host: config.connector.host,
      path: config.connector.path,
      token: config.connector.token,
      catalog: config.connector.catalog,
      schema: config.connector.schema,
    });
    return true;
  } catch (err) {
    console.error(`Failed to connect to database: ${String(err)}`);
    return false;
  }
}

export function registerCliCommands(
  api: OpenClawPluginApi,
  getGraphs: () => OntologyGraph[],
  connector: DatabaseConnector,
  config: OntologyPluginConfig,
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

          await ensureConnected(connector, config);

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
          if (!(await ensureConnected(connector, config))) return;
          console.log(`Syncing metadata${id ? ` for ${id}` : ""}...`);
          // Trigger a schema refresh via ping
          const ok = await connector.ping();
          console.log(ok ? "Sync complete." : "Sync failed -- database not reachable.");
        });

      ontology
        .command("discover")
        .description("Use LLM to discover database schema and generate an ontology YAML")
        .option("--catalog <catalog>", "Override catalog name")
        .option("--schema <schema>", "Override schema name")
        .option("--include <pattern>", "Glob pattern to include tables (e.g. 'fact_*')")
        .option("--exclude <pattern>", "Glob pattern to exclude tables (e.g. '*_staging')")
        .option("-o, --output <file>", "Write YAML to file instead of stdout")
        .option("--sample-rows <n>", "Sample rows per table for better inference", "3")
        .option("--id <id>", "Ontology ID", "my_ontology")
        .option("--name <name>", "Ontology display name", "My Ontology")
        .action(async (cmdOpts) => {
          if (!(await ensureConnected(connector, config))) return;
          try {
            await discoverOntology(api, connector, config, {
              catalog: cmdOpts.catalog,
              schema: cmdOpts.schema,
              include: cmdOpts.include,
              exclude: cmdOpts.exclude,
              output: cmdOpts.output,
              sampleRows: parseInt(cmdOpts.sampleRows, 10) || 3,
              id: cmdOpts.id,
              name: cmdOpts.name,
            });
          } catch (err) {
            console.error(`Discover failed: ${String(err)}`);
          }
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
