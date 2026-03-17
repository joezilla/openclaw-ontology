import { homedir } from "node:os";
import { join } from "node:path";

export type ConnectorType = "databricks";

export type OntologyPluginConfig = {
  ontologyDir: string;
  connector: {
    type: ConnectorType;
    host: string;
    path: string;
    token: string;
    catalog?: string;
    schema?: string;
  };
  query: {
    maxRows: number;
    timeoutMs: number;
    allowRawSql: boolean;
  };
  context: {
    autoInject: boolean;
    maxEntities: number;
    includeMetrics: boolean;
    includeSampleValues: boolean;
  };
};

const DEFAULT_ONTOLOGY_DIR = join(homedir(), ".openclaw", "ontologies");
const CONNECTOR_TYPES = ["databricks"] as const;

function assertAllowedKeys(value: Record<string, unknown>, allowed: string[], label: string) {
  const unknown = Object.keys(value).filter((key) => !allowed.includes(key));
  if (unknown.length > 0) {
    throw new Error(`${label} has unknown keys: ${unknown.join(", ")}`);
  }
}

function resolveEnvVars(value: string): string {
  return value.replace(/\$\{([^}]+)\}/g, (_, envVar) => {
    const envValue = process.env[envVar];
    if (!envValue) {
      throw new Error(`Environment variable ${envVar} is not set`);
    }
    return envValue;
  });
}

export const ontologyConfigSchema = {
  parse(value: unknown): OntologyPluginConfig {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new Error("ontology config required");
    }
    const cfg = value as Record<string, unknown>;
    assertAllowedKeys(cfg, ["ontologyDir", "connector", "query", "context"], "ontology config");

    // Connector (required)
    const connector = cfg.connector as Record<string, unknown> | undefined;
    if (!connector || typeof connector !== "object") {
      throw new Error("connector config is required");
    }
    assertAllowedKeys(
      connector,
      ["type", "host", "path", "token", "catalog", "schema"],
      "connector config",
    );

    const connectorType = (connector.type as string) ?? "databricks";
    if (!CONNECTOR_TYPES.includes(connectorType as ConnectorType)) {
      throw new Error(`Unsupported connector type: ${connectorType}`);
    }
    if (typeof connector.host !== "string" || !connector.host) {
      throw new Error("connector.host is required");
    }
    if (typeof connector.path !== "string" || !connector.path) {
      throw new Error("connector.path is required");
    }
    if (typeof connector.token !== "string" || !connector.token) {
      throw new Error("connector.token is required");
    }

    // Query options
    const query = (cfg.query as Record<string, unknown>) ?? {};
    if (typeof query === "object" && query !== null) {
      assertAllowedKeys(query, ["maxRows", "timeoutMs", "allowRawSql"], "query config");
    }
    const maxRows = typeof query.maxRows === "number" ? query.maxRows : 100;
    const timeoutMs = typeof query.timeoutMs === "number" ? query.timeoutMs : 30_000;
    const allowRawSql = query.allowRawSql === true;

    if (maxRows < 1 || maxRows > 10_000) {
      throw new Error("query.maxRows must be between 1 and 10000");
    }
    if (timeoutMs < 1000 || timeoutMs > 300_000) {
      throw new Error("query.timeoutMs must be between 1000 and 300000");
    }

    // Context options
    const context = (cfg.context as Record<string, unknown>) ?? {};
    if (typeof context === "object" && context !== null) {
      assertAllowedKeys(
        context,
        ["autoInject", "maxEntities", "includeMetrics", "includeSampleValues"],
        "context config",
      );
    }

    return {
      ontologyDir:
        typeof cfg.ontologyDir === "string" ? cfg.ontologyDir : DEFAULT_ONTOLOGY_DIR,
      connector: {
        type: connectorType as ConnectorType,
        host: connector.host as string,
        path: connector.path as string,
        token: resolveEnvVars(connector.token as string),
        catalog: typeof connector.catalog === "string" ? connector.catalog : undefined,
        schema: typeof connector.schema === "string" ? connector.schema : undefined,
      },
      query: {
        maxRows,
        timeoutMs,
        allowRawSql,
      },
      context: {
        autoInject: context.autoInject !== false,
        maxEntities: typeof context.maxEntities === "number" ? context.maxEntities : 5,
        includeMetrics: context.includeMetrics !== false,
        includeSampleValues: context.includeSampleValues === true,
      },
    };
  },

  uiHints: {
    "connector.token": {
      label: "Database Token",
      sensitive: true,
      placeholder: "dapi...",
      help: "Authentication token (or use ${DATABRICKS_TOKEN})",
    },
    "connector.host": {
      label: "Host",
      placeholder: "adb-1234567890.1.azuredatabricks.net",
      help: "Databricks workspace hostname",
    },
    "connector.path": {
      label: "HTTP Path",
      placeholder: "/sql/1.0/warehouses/abc123",
      help: "SQL warehouse HTTP path",
    },
    "connector.catalog": {
      label: "Catalog",
      placeholder: "main",
      help: "Default Unity Catalog name",
      advanced: true,
    },
    "connector.schema": {
      label: "Schema",
      placeholder: "analytics",
      help: "Default schema name",
      advanced: true,
    },
    ontologyDir: {
      label: "Ontology Directory",
      placeholder: "~/.openclaw/ontologies",
      help: "Directory containing ontology YAML files",
      advanced: true,
    },
    "query.maxRows": {
      label: "Max Rows",
      placeholder: "100",
      help: "Maximum rows returned per query",
      advanced: true,
    },
    "query.timeoutMs": {
      label: "Query Timeout",
      placeholder: "30000",
      help: "Query timeout in milliseconds",
      advanced: true,
    },
    "context.autoInject": {
      label: "Auto-Inject Context",
      help: "Automatically inject ontology context into agent prompts",
    },
    "context.maxEntities": {
      label: "Max Context Entities",
      placeholder: "5",
      help: "Maximum entities to include in auto-injected context",
      advanced: true,
    },
  },
};
