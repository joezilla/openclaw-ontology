# Configuration

Complete reference for the `@openclaw/ontology` plugin configuration, including all keys, defaults, validation rules, and examples.

## Setting Config Values

Use the OpenClaw CLI to set config values:

```bash
openclaw config set plugins.ontology.<key> <value>
```

For nested keys:

```bash
openclaw config set plugins.ontology.connector.host "adb-123.1.azuredatabricks.net"
openclaw config set plugins.ontology.query.maxRows 500
openclaw config set plugins.ontology.context.autoInject true
```

## Full Config Structure

```json
{
  "ontologyDir": "~/.openclaw/ontologies",
  "connector": {
    "type": "databricks",
    "host": "adb-1234567890.1.azuredatabricks.net",
    "path": "/sql/1.0/warehouses/abc123",
    "token": "${DATABRICKS_TOKEN}",
    "catalog": "main",
    "schema": "analytics"
  },
  "query": {
    "maxRows": 100,
    "timeoutMs": 30000,
    "allowRawSql": false
  },
  "context": {
    "autoInject": true,
    "maxEntities": 5,
    "includeMetrics": true,
    "includeSampleValues": false
  }
}
```

## Config Reference

### ontologyDir

| | |
|---|---|
| **Type** | `string` |
| **Default** | `~/.openclaw/ontologies` |
| **Required** | No |

Directory containing ontology YAML files. All files with `.yaml` or `.yml` extensions in this directory are loaded when the ontology service starts.

The path supports `~` for the home directory and is resolved via `api.resolvePath()`.

```bash
# Use default
# (no config needed -- ~/.openclaw/ontologies)

# Use custom directory
openclaw config set plugins.ontology.ontologyDir "/data/ontologies"

# Use project-local directory
openclaw config set plugins.ontology.ontologyDir "./ontologies"
```

### connector (required)

Database connection settings. At least `host`, `path`, and `token` are required.

#### connector.type

| | |
|---|---|
| **Type** | `string` |
| **Default** | `"databricks"` |
| **Required** | No |

The database connector type. Currently only `"databricks"` is built in. Additional connectors can be added by implementing the `DatabaseConnector` interface (see [Connectors](connectors.md)).

#### connector.host

| | |
|---|---|
| **Type** | `string` |
| **Default** | -- |
| **Required** | Yes |

Database hostname. For Databricks, this is the workspace URL without the protocol (e.g., `adb-1234567890.1.azuredatabricks.net`).

#### connector.path

| | |
|---|---|
| **Type** | `string` |
| **Default** | -- |
| **Required** | Yes |

Connection path. For Databricks, this is the SQL warehouse HTTP path (e.g., `/sql/1.0/warehouses/abc123def456`).

#### connector.token

| | |
|---|---|
| **Type** | `string` |
| **Default** | -- |
| **Required** | Yes |

Authentication token. Supports `${ENV_VAR}` syntax for environment variable resolution (see [Environment Variables](#environment-variables)).

**Recommended:** Always use `${ENV_VAR}` syntax instead of storing tokens directly in config. The OpenClaw config file is not encrypted.

#### connector.catalog

| | |
|---|---|
| **Type** | `string` |
| **Default** | -- |
| **Required** | No |

Default catalog name. When set, the query planner qualifies table references as `catalog.schema.table`. For Databricks Unity Catalog, this is typically `"main"`.

#### connector.schema

| | |
|---|---|
| **Type** | `string` |
| **Default** | -- |
| **Required** | No |

Default schema/database name. When set with `catalog`, table references are fully qualified. Can be overridden per-ontology in the YAML `source` block.

### query

Query execution settings. All optional with sensible defaults.

#### query.maxRows

| | |
|---|---|
| **Type** | `number` |
| **Default** | `100` |
| **Range** | 1 -- 10,000 |

Maximum number of rows returned per query. If a query would return more rows, a `LIMIT` clause is automatically appended and the result is marked as `truncated: true`.

```bash
# Allow larger result sets
openclaw config set plugins.ontology.query.maxRows 1000

# Restrictive (for cost control)
openclaw config set plugins.ontology.query.maxRows 25
```

#### query.timeoutMs

| | |
|---|---|
| **Type** | `number` |
| **Default** | `30000` (30 seconds) |
| **Range** | 1,000 -- 300,000 (5 minutes) |

Query timeout in milliseconds. Queries exceeding this duration are cancelled.

```bash
# Allow longer queries (2 minutes)
openclaw config set plugins.ontology.query.timeoutMs 120000
```

#### query.allowRawSql

| | |
|---|---|
| **Type** | `boolean` |
| **Default** | `false` |

**Not recommended.** When `false` (default), all queries go through the ontology query planner, which generates safe SQL from structured parameters. When `true`, additional raw SQL execution paths may be enabled.

Leave this `false` unless you have a specific need for raw SQL and understand the security implications.

### context

Agent context injection settings. Controls how ontology summaries are injected into agent system prompts.

#### context.autoInject

| | |
|---|---|
| **Type** | `boolean` |
| **Default** | `true` |

When enabled, the plugin automatically injects ontology context into the agent's system prompt before each turn. The context summarizes available entities, metrics, and dimensions so the agent knows what data is available.

Disable this if:
- You want agents to discover data exclusively through tool calls
- You are managing context injection through a custom hook
- Token costs are a concern and you want explicit opt-in

```bash
# Disable auto-injection
openclaw config set plugins.ontology.context.autoInject false
```

#### context.maxEntities

| | |
|---|---|
| **Type** | `number` |
| **Default** | `5` |
| **Range** | 1 -- 50 |

Maximum number of ontology graphs to include in the injected context. The keyword-based relevance selector scores all loaded ontologies against the user's prompt and includes only the top N.

Lower values reduce token costs. Higher values ensure more data domains are visible to the agent.

#### context.includeMetrics

| | |
|---|---|
| **Type** | `boolean` |
| **Default** | `true` |

When enabled, metric names are included in the injected context summary. This helps the agent know what measurements are available.

#### context.includeSampleValues

| | |
|---|---|
| **Type** | `boolean` |
| **Default** | `false` |

**Experimental.** When enabled, the plugin queries the database for sample column values and includes them in the context. This helps the agent generate correct filter values but increases startup time and context size.

## Environment Variables

String config values support `${ENV_VAR}` syntax for environment variable resolution:

```bash
# Set in your shell profile
export DATABRICKS_TOKEN="dapi0123456789abcdef..."
export DATABRICKS_HOST="adb-1234567890.1.azuredatabricks.net"

# Reference in config
openclaw config set plugins.ontology.connector.token '${DATABRICKS_TOKEN}'
openclaw config set plugins.ontology.connector.host '${DATABRICKS_HOST}'
```

### Resolution Rules

- `${FOO}` is replaced with the value of `process.env.FOO`
- If `FOO` is not set, the plugin throws: `Environment variable FOO is not set`
- Partial interpolation works: `prefix-${FOO}-suffix` resolves to `prefix-value-suffix`
- Multiple variables in one string: `${HOST}:${PORT}` resolves both
- Nested references are not supported: `${${VAR_NAME}}` does not work
- Resolution happens once at plugin load time (not per-query)

## Validation Rules

Config validation runs at plugin load time. Invalid config prevents the plugin from starting.

| Rule | Error Message |
|------|---------------|
| Missing `connector` | `connector config is required` |
| Missing `connector.host` | `connector.host is required` |
| Missing `connector.path` | `connector.path is required` |
| Missing `connector.token` | `connector.token is required` |
| Unknown connector type | `Unsupported connector type: X` |
| `maxRows` out of range | `query.maxRows must be between 1 and 10000` |
| `timeoutMs` out of range | `query.timeoutMs must be between 1000 and 300000` |
| Unknown config keys | `ontology config has unknown keys: X, Y` |
| Unset env var | `Environment variable X is not set` |

## CLI Commands

The ontology plugin registers CLI commands under the `ontology` group:

```bash
# List all loaded ontologies with counts
openclaw ontology list

# Show details for an ontology or entity
openclaw ontology describe <id>

# Validate ontology YAML against live database schema
openclaw ontology validate [id]

# Trigger metadata sync from database
openclaw ontology sync [id]

# Print a starter ontology YAML template
openclaw ontology init
```

### openclaw ontology list

Lists all loaded ontologies with entity, metric, and dimension counts:

```
ecommerce -- E-Commerce Analytics v1.0 (3 entities, 5 metrics, 4 dimensions)
saas -- SaaS Business Metrics v1.0 (3 entities, 6 metrics, 5 dimensions)
```

### openclaw ontology describe \<id\>

Pass an ontology ID to see its full summary, or an entity ID to see columns, metrics, dimensions, and relationships:

```bash
# Ontology overview
openclaw ontology describe ecommerce

# Entity detail
openclaw ontology describe order
```

### openclaw ontology validate [id]

Runs structural validation and (if connected) live schema validation:

```bash
# Validate all
openclaw ontology validate

# Validate one
openclaw ontology validate ecommerce
```

### openclaw ontology sync [id]

Verifies database connectivity. Useful for troubleshooting connection issues:

```bash
openclaw ontology sync
```

### openclaw ontology init

Prints a starter YAML template to stdout. Redirect to create a new file:

```bash
openclaw ontology init > ~/.openclaw/ontologies/new-domain.yaml
```

## Example Configs

### Minimal (Databricks only)

```bash
export DATABRICKS_TOKEN="dapi..."
openclaw config set plugins.ontology.connector.host "adb-123.1.azuredatabricks.net"
openclaw config set plugins.ontology.connector.path "/sql/1.0/warehouses/abc"
openclaw config set plugins.ontology.connector.token '${DATABRICKS_TOKEN}'
```

### Full configuration

```bash
# Connection
openclaw config set plugins.ontology.connector.type "databricks"
openclaw config set plugins.ontology.connector.host "adb-123.1.azuredatabricks.net"
openclaw config set plugins.ontology.connector.path "/sql/1.0/warehouses/abc"
openclaw config set plugins.ontology.connector.token '${DATABRICKS_TOKEN}'
openclaw config set plugins.ontology.connector.catalog "main"
openclaw config set plugins.ontology.connector.schema "analytics"

# Ontology directory
openclaw config set plugins.ontology.ontologyDir "~/.openclaw/ontologies"

# Query limits
openclaw config set plugins.ontology.query.maxRows 500
openclaw config set plugins.ontology.query.timeoutMs 60000
openclaw config set plugins.ontology.query.allowRawSql false

# Context injection
openclaw config set plugins.ontology.context.autoInject true
openclaw config set plugins.ontology.context.maxEntities 10
openclaw config set plugins.ontology.context.includeMetrics true
openclaw config set plugins.ontology.context.includeSampleValues false
```
