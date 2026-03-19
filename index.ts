/**
 * OpenClaw Ontology Plugin
 *
 * Connect data warehouses, define business ontologies via YAML DSL,
 * and give OpenClaw agents the ability to reason over ontology + live data.
 */

import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import { ontologyConfigSchema } from "./config.js";
import { loadOntologyDir } from "./src/ontology/loader.js";
import { buildOntologyGraph } from "./src/ontology/resolver.js";
import { createConnector } from "./src/connectors/registry.js";
import { registerQueryTool } from "./src/tools/query-data.js";
import { registerExploreTool } from "./src/tools/explore-ontology.js";
import { registerListTool } from "./src/tools/list-entities.js";
import { registerDescribeTool } from "./src/tools/describe-entity.js";
import { registerSqlTool } from "./src/tools/generate-sql.js";
import { registerValidateTool } from "./src/tools/validate-ontology.js";
import { registerCliCommands } from "./src/cli/commands.js";
import { createOntologyService } from "./src/service/sync.js";
import { buildOntologyContext } from "./src/context/injector.js";
import { selectRelevantEntities } from "./src/context/selector.js";
import type { OntologyGraph } from "./src/ontology/types.js";

// Ensure Databricks connector is registered on import
import "./src/connectors/databricks.js";

export default {
  id: "ontology",
  name: "Ontology",
  description: "Connect data warehouses and define business ontologies for agent reasoning",
  kind: "data" as const,
  configSchema: ontologyConfigSchema,

  register(api: OpenClawPluginApi) {
    const cfg = ontologyConfigSchema.parse(api.pluginConfig);
    const resolvedOntologyDir = api.resolvePath(cfg.ontologyDir);

    // Create database connector
    const connector = createConnector(cfg.connector.type);

    // State: loaded ontology graphs (populated on service start)
    let graphs: OntologyGraph[] = [];

    api.logger.info(`ontology: plugin registered (dir: ${resolvedOntologyDir})`);

    // ========================================================================
    // Tools
    // ========================================================================

    registerQueryTool(api, () => graphs, connector, cfg.query);
    registerExploreTool(api, () => graphs);
    registerListTool(api, () => graphs);
    registerDescribeTool(api, () => graphs);
    registerSqlTool(api, () => graphs, cfg.query);
    registerValidateTool(api, () => graphs, connector);

    // ========================================================================
    // CLI Commands
    // ========================================================================

    registerCliCommands(api, () => graphs, connector, cfg);

    // ========================================================================
    // Lifecycle Hooks
    // ========================================================================

    if (cfg.context.autoInject) {
      api.on("before_agent_start", async (event) => {
        if (!event.prompt || event.prompt.length < 5 || graphs.length === 0) {
          return;
        }

        try {
          const relevant = selectRelevantEntities(graphs, event.prompt, cfg.context.maxEntities);
          if (relevant.length === 0) {
            return;
          }

          const context = buildOntologyContext(relevant);
          api.logger.info?.(`ontology: injecting context (${relevant.length} graphs)`);

          return {
            prependContext: context,
          };
        } catch (err) {
          api.logger.warn(`ontology: context injection failed: ${String(err)}`);
        }
      });
    }

    // ========================================================================
    // Service
    // ========================================================================

    const service = createOntologyService(api, connector, cfg);

    // Extend start to load ontologies
    api.registerService({
      id: "ontology-service",
      async start() {
        // Connect to database
        await service.start();

        // Load ontology files
        try {
          const definitions = await loadOntologyDir(resolvedOntologyDir);
          graphs = definitions.map((def) => buildOntologyGraph(def));
          api.logger.info(
            `ontology: loaded ${graphs.length} ontologies from ${resolvedOntologyDir}`,
          );
        } catch (err) {
          api.logger.warn(`ontology: failed to load ontologies: ${String(err)}`);
          graphs = [];
        }
      },
      async stop() {
        await service.stop();
        graphs = [];
      },
    });
  },
};
