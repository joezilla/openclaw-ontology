# Connectors

Connectors provide the bridge between the ontology plugin and your data warehouse. Each connector implements the `DatabaseConnector` interface and handles connection management, query execution, and schema introspection.

## Databricks

The built-in Databricks connector uses the `@databricks/sql` Node.js driver to connect to Databricks SQL warehouses via the HTTP protocol.

### Prerequisites

- A running Databricks SQL warehouse (Serverless or Classic)
- A personal access token (PAT) with SQL execution permissions
- Network access from your machine to the Databricks workspace

### Configuration

```bash
openclaw config set plugins.ontology.connector.type "databricks"
openclaw config set plugins.ontology.connector.host "adb-1234567890.1.azuredatabricks.net"
openclaw config set plugins.ontology.connector.path "/sql/1.0/warehouses/abc123def456"
openclaw config set plugins.ontology.connector.token '${DATABRICKS_TOKEN}'
openclaw config set plugins.ontology.connector.catalog "main"
openclaw config set plugins.ontology.connector.schema "analytics"
```

### Configuration Reference

| Property | Required | Default | Description |
|----------|----------|---------|-------------|
| `type` | No | `databricks` | Connector type identifier |
| `host` | Yes | -- | Databricks workspace hostname (e.g., `adb-123456.1.azuredatabricks.net`) |
| `path` | Yes | -- | SQL warehouse HTTP path (e.g., `/sql/1.0/warehouses/abc123`) |
| `token` | Yes | -- | Personal access token or `${ENV_VAR}` reference |
| `catalog` | No | -- | Default Unity Catalog name (e.g., `main`) |
| `schema` | No | -- | Default database schema (e.g., `analytics`) |

### Finding Your Connection Details

1. Log in to your Databricks workspace
2. Click **SQL Warehouses** in the left sidebar
3. Select your warehouse and ensure it is running
4. Open the **Connection Details** tab
5. **Server Hostname** is your `connector.host`
6. **HTTP Path** is your `connector.path`

### Token via Environment Variable

Tokens support `${ENV_VAR}` syntax for environment variable resolution. This avoids storing secrets in your OpenClaw config file:

```bash
# In your shell profile (~/.zshrc, ~/.bashrc)
export DATABRICKS_TOKEN="dapi0123456789abcdef..."

# In OpenClaw config (the literal string ${DATABRICKS_TOKEN} is stored)
openclaw config set plugins.ontology.connector.token '${DATABRICKS_TOKEN}'
```

The variable is resolved at plugin load time. If the variable is not set, the plugin throws an error on startup with the variable name.

### Connection Lifecycle

- **Connect**: The connector establishes a connection on service start. If the connection fails, the service still starts -- tools will return "not connected" errors gracefully.
- **Queries**: Each query opens a new session, executes the statement, fetches results, and closes the session. There is no persistent session pool.
- **Schema introspection**: `getSchema()` queries `INFORMATION_SCHEMA.COLUMNS` for the configured catalog/schema.
- **Disconnect**: The connection is closed on service stop.
- **Ping**: Executes `SELECT 1` to verify connectivity.

### Databricks-Specific Notes

- The connector uses the `@databricks/sql` package, which communicates over HTTPS using the Thrift protocol
- Unity Catalog: if your workspace uses Unity Catalog, set `connector.catalog` to your catalog name
- Serverless warehouses: fully supported; the connector does not distinguish between serverless and classic
- Query results are materialized in memory -- the `query.maxRows` config limit prevents excessive memory use

## Environment Variable Resolution

All string config values that match the `${ENV_VAR}` pattern are resolved from `process.env` at plugin load time:

```json
{
  "connector": {
    "host": "${DATABRICKS_HOST}",
    "token": "${DATABRICKS_TOKEN}"
  }
}
```

Resolution rules:
- `${FOO}` is replaced with `process.env.FOO`
- If `FOO` is not set, plugin initialization throws an error: `Environment variable FOO is not set`
- Nested references (`${${FOO}}`) are not supported
- Partial interpolation (`prefix-${FOO}-suffix`) is supported

## Adding New Connectors

To add support for a new database (Snowflake, BigQuery, Postgres, DuckDB, etc.), implement the `DatabaseConnector` interface and register it with the connector factory.

### Step 1: Implement the Interface

Create `src/connectors/snowflake.ts` (or your DB):

```typescript
import type { ConnectorConfig, DatabaseConnector, QueryResult, SchemaInfo } from "./types.js";
import { registerConnector } from "./registry.js";

class SnowflakeConnector implements DatabaseConnector {
  readonly name = "Snowflake";
  private connected = false;

  constructor(readonly id: string) {}

  async connect(config: ConnectorConfig): Promise<void> {
    // Establish connection using your DB's driver
    // Store connection handle as instance state
    this.connected = true;
  }

  async disconnect(): Promise<void> {
    // Close connection
    this.connected = false;
  }

  isConnected(): boolean {
    return this.connected;
  }

  async query(sql: string, params?: Record<string, unknown>): Promise<QueryResult> {
    if (!this.connected) throw new Error("Not connected");
    const start = Date.now();
    // Execute SQL, map results to QueryResult format
    return {
      columns: [/* ... */],
      rows: [/* ... */],
      rowCount: 0,
      truncated: false,
      executionTimeMs: Date.now() - start,
    };
  }

  async getSchema(catalog?: string, schema?: string): Promise<SchemaInfo> {
    if (!this.connected) throw new Error("Not connected");
    // Query INFORMATION_SCHEMA or equivalent
    return { tables: [] };
  }

  async ping(): Promise<boolean> {
    if (!this.connected) return false;
    try {
      await this.query("SELECT 1");
      return true;
    } catch {
      return false;
    }
  }
}

// Self-register on import
registerConnector("snowflake", (id) => new SnowflakeConnector(id));
```

### Step 2: Register the Import

In `index.ts`, add a side-effect import so the connector self-registers:

```typescript
import "./src/connectors/snowflake.js";
```

### Step 3: Add the Dependency

Add your DB driver to `package.json`:

```json
{
  "dependencies": {
    "snowflake-sdk": "^1.12.0"
  }
}
```

### Step 4: Update the Config Schema

Add your connector type to the `type` enum in `openclaw.plugin.json` and update `config.ts` to accept the new type.

### DatabaseConnector Interface

```typescript
export interface DatabaseConnector {
  readonly id: string;        // Instance identifier
  readonly name: string;      // Human-readable name (e.g., "Snowflake")

  connect(config: ConnectorConfig): Promise<void>;
  disconnect(): Promise<void>;
  isConnected(): boolean;

  query(sql: string, params?: Record<string, unknown>): Promise<QueryResult>;
  getSchema(catalog?: string, schema?: string): Promise<SchemaInfo>;
  ping(): Promise<boolean>;
}
```

### ConnectorConfig

```typescript
export type ConnectorConfig = {
  host: string;       // Database hostname
  path: string;       // Connection path (meaning varies by DB)
  token: string;      // Authentication token/password
  catalog?: string;   // Optional catalog/database name
  schema?: string;    // Optional schema name
};
```

### QueryResult

```typescript
export type QueryResult = {
  columns: Array<{ name: string; type: string }>;  // Column metadata
  rows: Record<string, unknown>[];                   // Result rows as key-value objects
  rowCount: number;                                  // Number of rows returned
  truncated: boolean;                                // True if results were cut short
  executionTimeMs: number;                           // Wall-clock execution time
};
```

### SchemaInfo

```typescript
export type SchemaInfo = {
  tables: Array<{
    name: string;
    columns: Array<{
      name: string;
      type: string;       // DB-reported type string
      nullable: boolean;
    }>;
  }>;
};
```

The `getSchema()` method is called during `ontology_validate` to verify that tables and columns referenced in ontology YAML files actually exist in the database.

### Lazy Loading

Follow the Databricks connector pattern for lazy-loading heavy dependencies:

```typescript
let driverPromise: Promise<typeof import("snowflake-sdk")> | null = null;

const loadDriver = async () => {
  if (!driverPromise) {
    driverPromise = import("snowflake-sdk");
  }
  return driverPromise;
};
```

This avoids loading the DB driver at plugin registration time, which would slow down OpenClaw startup even when the ontology plugin is not actively used.
