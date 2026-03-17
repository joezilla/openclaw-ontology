# @openclaw/ontology

Connect data warehouses, define business ontologies in YAML, and let OpenClaw agents reason over your data with structured, safe SQL queries.

## Overview

The ontology plugin bridges the gap between your data warehouse and OpenClaw's AI agents. Instead of giving agents raw database access, you define a business ontology -- a curated layer of entities, relationships, metrics, and dimensions -- that agents use to answer data questions safely and accurately.

```
User question                  Ontology plugin                  Data warehouse
"What was our revenue   --->   Resolves entities/metrics  --->  SELECT SUM(total_amount)
 by segment last quarter?"     Builds safe SQL                  FROM fact_orders e1
                               Joins tables automatically       JOIN dim_customers e2 ...
                               Enforces read-only               WHERE ...
                          <--- Formats markdown table      <--- [result rows]
```

## Features

- **YAML Ontology DSL** -- Define entities, relationships, metrics, and dimensions in human-readable YAML files
- **Databricks Connector** -- First-class support for Databricks SQL warehouses; extensible connector interface for Snowflake, BigQuery, Postgres, and others
- **6 Agent Tools** -- `ontology_query`, `ontology_explore`, `ontology_list`, `ontology_describe`, `ontology_sql`, `ontology_validate`
- **Automatic Context Injection** -- Ontology summaries are injected into agent system prompts so agents know what data is available before the user even asks
- **Ontology-Aware SQL Generation** -- The query planner resolves cross-entity joins, aliases tables, applies metric filters, and generates correct GROUP BY clauses automatically
- **Read-Only Safety Guardrails** -- DML/DDL rejection, row limits, query timeouts, and filter sanitization prevent destructive operations
- **CLI Management** -- List, describe, validate, sync, and scaffold ontologies from the command line
- **Keyword-Based Relevance** -- Only ontologies relevant to the user's question are injected into context, keeping token costs low

## Installation

### From npm (recommended)

```bash
openclaw plugin install @openclaw/ontology
```

This installs the plugin into OpenClaw's plugin directory and makes it available to all agents.

### From source (development)

```bash
git clone https://github.com/openclaw/openclaw-ontology.git
cd openclaw-ontology
npm install
```

Then register the local plugin with OpenClaw:

```bash
openclaw plugin link /path/to/openclaw-ontology
```

### Verify installation

```bash
openclaw plugin list
```

You should see `@openclaw/ontology` in the output.

## Quick Start

### 1. Set up your database connection

```bash
# Set your Databricks token as an environment variable
export DATABRICKS_TOKEN="dapi..."

# Configure the connector
openclaw config set plugins.ontology.connector.host "adb-1234567890.1.azuredatabricks.net"
openclaw config set plugins.ontology.connector.path "/sql/1.0/warehouses/abc123"
openclaw config set plugins.ontology.connector.token '${DATABRICKS_TOKEN}'
openclaw config set plugins.ontology.connector.catalog "main"
openclaw config set plugins.ontology.connector.schema "analytics"
```

### 2. Create an ontology

Generate a starter template and save it:

```bash
mkdir -p ~/.openclaw/ontologies
openclaw ontology init > ~/.openclaw/ontologies/my-data.yaml
```

Edit the YAML to match your actual tables, or use one of the [examples](examples/).

### 3. Validate

```bash
openclaw ontology validate
```

### 4. Query through an agent

Ask your OpenClaw agent a business question:

> "What was our total revenue by customer segment last quarter?"

The agent automatically uses `ontology_query` to plan the SQL, execute it safely, and return a formatted table.

## How It Works

### Plugin Architecture

```
openclaw.plugin.json         Plugin manifest (config schema, UI hints)
index.ts                     Plugin entry -- registers tools, hooks, CLI, service
config.ts                    Config validation with env var resolution

src/ontology/                Ontology DSL core
  types.ts                   TypeScript types for YAML DSL
  loader.ts                  YAML parser + structural validator
  resolver.ts                Relationship graph builder + join path-finding (BFS)
  validator.ts               Live DB schema validation

src/connectors/              Database abstraction layer
  types.ts                   DatabaseConnector interface
  registry.ts                Connector factory registry
  databricks.ts              Databricks SQL implementation

src/query/                   Query engine
  planner.ts                 Ontology-aware SQL generation
  executor.ts                Query execution + result formatting
  safety.ts                  Read-only enforcement + filter sanitization

src/context/                 Agent integration
  injector.ts                Build <ontology-context> for system prompts
  selector.ts                Keyword-based relevance scoring

src/tools/                   Agent tools (6)
src/cli/                     CLI commands
src/service/                 Background connector lifecycle
```

### Agent Integration Flow

1. **Service start** -- Plugin connects to the database and loads all ontology YAML files from `ontologyDir`
2. **Before agent start** -- The `before_agent_start` hook runs keyword matching against the user's prompt, selects relevant ontologies, and injects a summary into the system prompt
3. **Agent reasoning** -- The agent sees the ontology context and chooses appropriate tools
4. **Query execution** -- `ontology_query` plans SQL from structured parameters, validates safety, applies limits, executes, and returns markdown
5. **Service stop** -- Connector is disconnected cleanly

## Documentation

| Document | Description |
|----------|-------------|
| [Getting Started](docs/getting-started.md) | Step-by-step tutorial from install to first query |
| [Ontology DSL Reference](docs/ontology-dsl.md) | Full YAML format specification with examples |
| [Connectors](docs/connectors.md) | Database setup, env vars, adding new connectors |
| [Agent Usage](docs/agent-usage.md) | How agents use tools, example conversations, tips |
| [Configuration](docs/configuration.md) | All config keys with types, defaults, and descriptions |
| [Architecture](docs/architecture.md) | Internal design, data flow, extension points |
| [Security](docs/security.md) | Safety model, query guardrails, threat mitigations |
| [Troubleshooting](docs/troubleshooting.md) | Common issues, diagnostics, FAQ |

## Examples

- [`examples/ecommerce.yaml`](examples/ecommerce.yaml) -- E-commerce: orders, customers, products with revenue/AOV/units metrics
- [`examples/saas-metrics.yaml`](examples/saas-metrics.yaml) -- SaaS: subscriptions, customers, usage events with MRR/churn/DAU metrics

## Requirements

- OpenClaw (latest)
- Node.js 22+
- A supported data warehouse (Databricks SQL currently; more connectors planned)

## License

MIT
