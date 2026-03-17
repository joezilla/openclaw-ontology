import type { OpenClawPluginApi } from "openclaw/plugin-sdk/ontology";
import type { DatabaseConnector } from "../connectors/types.js";
import type { OntologyPluginConfig } from "../../config.js";

export type OntologyService = {
  start(): Promise<void>;
  stop(): Promise<void>;
};

/**
 * Create the ontology background service.
 * Manages connector lifecycle (connect on start, disconnect on stop).
 */
export function createOntologyService(
  api: OpenClawPluginApi,
  connector: DatabaseConnector,
  config: OntologyPluginConfig,
): OntologyService {
  return {
    async start() {
      try {
        await connector.connect({
          host: config.connector.host,
          path: config.connector.path,
          token: config.connector.token,
          catalog: config.connector.catalog,
          schema: config.connector.schema,
        });
        api.logger.info(
          `ontology-service: connected to ${config.connector.type} (${config.connector.host})`,
        );
      } catch (err) {
        api.logger.warn(`ontology-service: connection failed: ${String(err)}`);
        // Service still starts -- tools will report "not connected" gracefully
      }
    },

    async stop() {
      try {
        await connector.disconnect();
        api.logger.info("ontology-service: disconnected");
      } catch (err) {
        api.logger.warn(`ontology-service: disconnect error: ${String(err)}`);
      }
    },
  };
}
