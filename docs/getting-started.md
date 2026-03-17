# Getting Started

This guide walks you through installing the ontology plugin, connecting to a Databricks warehouse, defining your first ontology, validating it, and running your first agent-powered data query.

## Prerequisites

Before you begin, make sure you have:

- **OpenClaw** installed and configured (run `openclaw --version` to verify)
- **Node.js 22+** (run `node --version` to verify)
- **A Databricks workspace** with at least one SQL warehouse running
- **A Databricks personal access token** (PAT) with access to your target catalog/schema

If you do not have a Databricks PAT yet, see [Databricks: Generate a personal access token](https://docs.databricks.com/en/dev-tools/auth/pat.html).

## Step 1: Install the Plugin

### Option A: From npm (recommended)

```bash
openclaw plugin install @openclaw/ontology
```

### Option B: From source

```bash
git clone https://github.com/openclaw/openclaw-ontology.git
cd openclaw-ontology
npm install
openclaw plugin link .
```

### Verify

```bash
openclaw plugin list
```

You should see `@openclaw/ontology` (or `ontology`) in the plugin list.

## Step 2: Configure the Database Connection

Store your Databricks token in an environment variable. Add this to your shell profile (`~/.zshrc`, `~/.bashrc`, etc.) so it persists across sessions:

```bash
export DATABRICKS_TOKEN="dapi0123456789abcdef..."
```

Then configure the connector:

```bash
openclaw config set plugins.ontology.connector.host "adb-1234567890.1.azuredatabricks.net"
openclaw config set plugins.ontology.connector.path "/sql/1.0/warehouses/abc123def456"
openclaw config set plugins.ontology.connector.token '${DATABRICKS_TOKEN}'
```

Optionally set a default catalog and schema so your ontology files do not need to repeat them:

```bash
openclaw config set plugins.ontology.connector.catalog "main"
openclaw config set plugins.ontology.connector.schema "analytics"
```

### Where to find your connection details

1. Log in to your Databricks workspace
2. Click **SQL Warehouses** in the left sidebar
3. Select your warehouse
4. Open the **Connection Details** tab
5. Copy the **Server Hostname** (this is `connector.host`)
6. Copy the **HTTP Path** (this is `connector.path`)

## Step 3: Create the Ontology Directory

The plugin loads all `.yaml` and `.yml` files from a single directory. The default is `~/.openclaw/ontologies/`:

```bash
mkdir -p ~/.openclaw/ontologies
```

To use a different directory:

```bash
openclaw config set plugins.ontology.ontologyDir "/path/to/your/ontologies"
```

## Step 4: Generate a Starter Ontology

The `init` command prints a starter YAML template to stdout:

```bash
openclaw ontology init > ~/.openclaw/ontologies/my-first.yaml
```

Open the file in your editor and replace the placeholder values with your actual tables and columns.

### Minimal example: two entities with a join

Here is a small but complete ontology with sales and reps, showing all the key features (entities, columns, foreign keys, relationships, metrics, dimensions):

```yaml
ontology:
  id: sales
  name: Sales Analytics
  version: "1.0"
  description: "Sales pipeline data from the analytics warehouse"

  source:
    connector: databricks
    catalog: main
    schema: analytics

  entities:
    - id: deal
      name: Deal
      description: "A closed or open sales deal"
      table: fact_deals
      primaryKey: deal_id
      columns:
        - name: deal_id
          type: string
          description: "Unique deal identifier"
        - name: rep_id
          type: string
          description: "Sales representative who owns the deal"
          foreignKey: rep.rep_id
        - name: amount
          type: decimal
          description: "Deal value in USD"
        - name: close_date
          type: date
          description: "Date the deal was closed (null if open)"
        - name: stage
          type: string
          description: "Current deal stage"
          allowedValues: [prospecting, qualification, proposal, negotiation, closed_won, closed_lost]

    - id: rep
      name: Sales Rep
      description: "A member of the sales team"
      table: dim_reps
      primaryKey: rep_id
      columns:
        - name: rep_id
          type: string
          description: "Unique rep identifier"
        - name: name
          type: string
          description: "Full name"
        - name: region
          type: string
          description: "Sales region"
          allowedValues: [north_america, emea, apac, latam]
        - name: hire_date
          type: date
          description: "Date the rep joined"

  relationships:
    - id: deal_rep
      from: deal.rep_id
      to: rep.rep_id
      type: many_to_one
      description: "Each deal is owned by one rep"

  metrics:
    - id: total_pipeline
      name: Total Pipeline
      description: "Sum of all deal amounts"
      entity: deal
      expression: "SUM(amount)"

    - id: closed_won_revenue
      name: Closed Won Revenue
      description: "Revenue from won deals"
      entity: deal
      expression: "SUM(amount)"
      filters: ["stage = 'closed_won'"]

    - id: win_rate
      name: Win Rate
      description: "Percentage of deals that closed won"
      entity: deal
      expression: "ROUND(COUNT(CASE WHEN stage = 'closed_won' THEN 1 END) * 100.0 / NULLIF(COUNT(*), 0), 1)"

    - id: deal_count
      name: Deal Count
      description: "Number of deals"
      entity: deal
      expression: "COUNT(*)"

  dimensions:
    - id: close_date
      name: Close Date
      entity: deal
      column: close_date
      granularities: [day, week, month, quarter, year]

    - id: region
      name: Region
      entity: rep
      column: region

    - id: stage
      name: Deal Stage
      entity: deal
      column: stage
```

Save this as `~/.openclaw/ontologies/sales.yaml`.

## Step 5: Validate the Ontology

Run structural validation (no database connection needed):

```bash
openclaw ontology validate
```

Expected output:

```
Validating: Sales Analytics (sales)
  Valid
```

If the database is connected, validation also checks that your tables and columns actually exist:

```
Validating: Sales Analytics (sales)
  Schema warnings:
    - Entity "deal": column "close_date" declared as "date" but DB reports "timestamp"
  Valid
```

Warnings are informational -- they flag potential type mismatches but do not block usage.

### Common validation errors

| Error | Cause | Fix |
|-------|-------|-----|
| `Duplicate entity ID: "X"` | Two entities share the same `id` | Rename one |
| `primaryKey "X" not found in columns` | PK column missing from the columns list | Add the PK column |
| `foreignKey references unknown entity "X"` | FK target does not match any entity ID | Check entity IDs |
| `Metric "X": references unknown entity "Y"` | Metric's `entity` field does not exist | Fix the entity reference |
| `table "X" not found in database` | Table does not exist in the configured catalog/schema | Check table name and source config |

## Step 6: List Loaded Ontologies

```bash
openclaw ontology list
```

Output:

```
sales -- Sales Analytics v1.0 (2 entities, 4 metrics, 3 dimensions)
```

## Step 7: Explore an Ontology

Get a detailed view of a specific ontology or entity:

```bash
# Full ontology overview
openclaw ontology describe sales

# Single entity detail
openclaw ontology describe deal
```

## Step 8: Ask Your Agent a Question

Start an OpenClaw session and ask a business question:

> "What was our closed won revenue by region last quarter?"

Behind the scenes:

1. The plugin injects ontology context into the agent's system prompt
2. The agent recognizes `closed_won_revenue` metric and `region` dimension
3. The agent calls `ontology_query` with structured parameters
4. The query planner resolves the deal -> rep join, generates SQL with safety checks
5. SQL executes against Databricks, results come back as a markdown table

### Preview the generated SQL

If you want to see what SQL the agent would execute without running it:

> "Show me the SQL for closed won revenue by region"

The agent calls `ontology_sql` instead, returning the generated query for inspection.

## Step 9: Iterate on Your Ontology

As your data model evolves:

1. Edit your YAML files to add entities, metrics, or dimensions
2. Run `openclaw ontology validate` to catch errors
3. Restart the OpenClaw gateway to pick up changes (ontologies are loaded on service start)

## Next Steps

- Read the full [Ontology DSL Reference](ontology-dsl.md) for all YAML options
- See [Agent Usage](agent-usage.md) for tips on writing descriptions that help agents reason
- Check [Configuration](configuration.md) for tuning query limits, context injection, and more
- Review [Troubleshooting](troubleshooting.md) if you run into issues
