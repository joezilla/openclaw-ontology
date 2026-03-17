# Ontology DSL Reference

The ontology DSL is a YAML format for defining business data models over your data warehouse tables. Each YAML file describes one ontology -- a cohesive data domain with entities, relationships, metrics, and dimensions.

## File Format

Ontology files use the `.yaml` or `.yml` extension and must have a single top-level `ontology` key:

```yaml
ontology:
  id: ...
  name: ...
  # ... rest of definition
```

Files are loaded from the directory specified by `ontologyDir` (default: `~/.openclaw/ontologies/`). All valid YAML files in that directory are loaded on service start.

## Top-Level Fields

```yaml
ontology:
  id: ecommerce                     # Required. Unique identifier (lowercase, no spaces)
  name: E-Commerce Analytics         # Required. Human-readable display name
  version: "1.0"                     # Required. Version string (for your tracking)
  description: "Business ontology"   # Optional. Shown in CLI and agent context
  source: ...                        # Required. Database connection reference
  entities: [...]                    # Required. At least one entity
  relationships: [...]               # Optional. Defaults to []
  metrics: [...]                     # Optional. Defaults to []
  dimensions: [...]                  # Optional. Defaults to []
```

### ID Naming Rules

- Use lowercase alphanumeric characters and underscores only
- Must be unique across all loaded ontology files
- Used in CLI commands (`openclaw ontology describe ecommerce`) and tool parameters

## Source

The `source` block specifies which database connector to use and optional default catalog/schema:

```yaml
source:
  connector: databricks    # Required. Must match a registered connector type
  catalog: main            # Optional. Default catalog for table references
  schema: analytics        # Optional. Default schema for table references
```

When `catalog` and `schema` are set, the query planner automatically qualifies table references (e.g., `main.analytics.fact_orders`). If omitted, tables are referenced without qualification.

## Entities

Entities are the core building blocks. Each entity maps to one database table and defines its columns, primary key, and metadata.

```yaml
entities:
  - id: order
    name: Order
    description: "A customer purchase transaction"
    table: fact_orders
    primaryKey: order_id
    columns:
      - name: order_id
        type: string
        description: "Unique order identifier"
      - name: customer_id
        type: string
        description: "Customer who placed the order"
        foreignKey: customer.customer_id
      - name: total_amount
        type: decimal
        description: "Total order value in USD"
      - name: status
        type: string
        description: "Current order status"
        allowedValues: [pending, confirmed, shipped, delivered, cancelled]
```

### Entity Fields

| Field | Required | Description |
|-------|----------|-------------|
| `id` | Yes | Unique entity identifier (lowercase, used in metrics/dimensions/tool calls) |
| `name` | Yes | Human-readable display name |
| `description` | No | Description shown in agent context. **Write these carefully** -- the agent uses them to map user questions to the right entity |
| `table` | Yes | Database table name (must exist in the configured catalog/schema) |
| `primaryKey` | Yes | Name of the primary key column (must be listed in `columns`) |
| `columns` | Yes | Array of column definitions (at least one) |

### Column Fields

| Field | Required | Description |
|-------|----------|-------------|
| `name` | Yes | Column name as it appears in the database |
| `type` | Yes | One of the supported column types (see below) |
| `description` | No | Description used by the agent for reasoning. Include units, business meaning, and any non-obvious semantics |
| `foreignKey` | No | Reference to another entity's column in `entity_id.column_name` format |
| `allowedValues` | No | List of valid values for this column. Helps the agent generate correct filters |

### Column Types

| Type | Description | DB Type Examples |
|------|-------------|-----------------|
| `string` | Text/character data | `VARCHAR`, `CHAR`, `TEXT`, `NVARCHAR`, `STRING` |
| `number` | Any numeric (float or integer) | `FLOAT`, `DOUBLE`, `NUMERIC`, `NUMBER` |
| `decimal` | Fixed-point decimal | `DECIMAL`, `NUMERIC`, `NUMBER(p,s)` |
| `integer` | Whole numbers only | `INT`, `INTEGER`, `BIGINT`, `SMALLINT` |
| `boolean` | True/false | `BOOLEAN`, `BOOL`, `BIT` |
| `date` | Date without time | `DATE` |
| `timestamp` | Date with time | `TIMESTAMP`, `DATETIME`, `TIMESTAMPTZ` |

Type compatibility is checked loosely during validation -- the validator maps ontology types to known DB type families and issues warnings (not errors) for mismatches.

### Foreign Keys

Foreign keys create implicit relationships. The format is `target_entity_id.target_column_name`:

```yaml
columns:
  - name: customer_id
    type: string
    foreignKey: customer.customer_id
```

Foreign keys are validated: the target entity and column must exist in the same ontology file. They are informational metadata -- the query planner uses `relationships` (not foreign keys) to resolve joins.

## Relationships

Relationships define how entities join together. The query planner uses these to automatically resolve cross-entity queries.

```yaml
relationships:
  - id: order_customer
    from: order.customer_id
    to: customer.customer_id
    type: many_to_one
    description: "Each order belongs to one customer"
```

### Relationship Fields

| Field | Required | Description |
|-------|----------|-------------|
| `id` | Yes | Unique relationship identifier |
| `from` | Yes | Source in `entity_id.column_name` format |
| `to` | Yes | Target in `entity_id.column_name` format |
| `type` | Yes | Cardinality type (see below) |
| `description` | No | Human-readable description of the relationship |

### Relationship Types

| Type | Description | Example |
|------|-------------|---------|
| `one_to_one` | Each row in A maps to exactly one row in B | user -> user_profile |
| `one_to_many` | One row in A maps to many rows in B | customer -> orders |
| `many_to_one` | Many rows in A map to one row in B | orders -> customer |
| `many_to_many` | Many-to-many (requires intermediate table) | students <-> courses |

### How Joins Are Resolved

When a query references metrics or dimensions from different entities, the planner uses BFS (breadth-first search) over the relationship graph to find the shortest join path. For example:

- Query: entity=`order`, dimension=`customer_segment` (on entity `customer`)
- Planner finds: `order.customer_id = customer.customer_id` via the `order_customer` relationship
- Generated SQL includes: `JOIN dim_customers e2 ON e1.customer_id = e2.customer_id`

If no path exists between two entities, the query fails with a clear error message.

## Metrics

Metrics are pre-defined aggregate expressions. They save the agent from guessing SQL aggregation syntax and ensure consistent business logic.

```yaml
metrics:
  - id: total_revenue
    name: Total Revenue
    description: "Sum of all order amounts, excluding cancelled orders"
    entity: order
    expression: "SUM(total_amount)"
    filters:
      - "status != 'cancelled'"

  - id: avg_order_value
    name: Average Order Value
    description: "Average order amount, excluding cancelled orders"
    entity: order
    expression: "AVG(total_amount)"
    filters:
      - "status != 'cancelled'"

  - id: customer_count
    name: Customer Count
    description: "Number of unique customers with orders"
    entity: order
    expression: "COUNT(DISTINCT customer_id)"
```

### Metric Fields

| Field | Required | Description |
|-------|----------|-------------|
| `id` | Yes | Unique metric identifier (used in tool calls) |
| `name` | Yes | Human-readable display name |
| `description` | No | Business definition. Be specific -- include what is included/excluded |
| `entity` | Yes | Base entity this metric operates on |
| `expression` | Yes | SQL aggregate expression (placed in SELECT clause) |
| `filters` | No | Array of SQL WHERE conditions always applied when this metric is queried |

### Expression Guidelines

- Use standard SQL aggregate functions: `SUM()`, `AVG()`, `COUNT()`, `MIN()`, `MAX()`, `COUNT(DISTINCT ...)`
- Reference column names directly (the planner adds table aliases automatically)
- For complex expressions, use `CASE WHEN` inside aggregates:
  ```yaml
  expression: "ROUND(COUNT(CASE WHEN status = 'churned' THEN 1 END) * 100.0 / NULLIF(COUNT(*), 0), 2)"
  ```
- Avoid subqueries in expressions -- they are not supported by the safety validator

### Metric Filters

Filters are SQL conditions that are **always** applied when the metric is used. They ensure consistent business logic:

```yaml
# This metric always excludes test accounts
filters:
  - "customer_type != 'test'"
  - "amount > 0"
```

Multiple filters are combined with `AND`.

## Dimensions

Dimensions are columns used for grouping and slicing data. They become GROUP BY clauses in generated SQL.

```yaml
dimensions:
  - id: time
    name: Time
    entity: order
    column: order_date
    granularities:
      - day
      - week
      - month
      - quarter
      - year

  - id: customer_segment
    name: Customer Segment
    entity: customer
    column: segment
```

### Dimension Fields

| Field | Required | Description |
|-------|----------|-------------|
| `id` | Yes | Unique dimension identifier (used in tool calls) |
| `name` | Yes | Human-readable display name |
| `entity` | Yes | Entity containing this column |
| `column` | Yes | Column name in the entity |
| `granularities` | No | Time granularity levels (only for date/timestamp columns) |

### Time Granularities

For date or timestamp columns, specify `granularities` to let the query planner apply appropriate date truncation:

| Granularity | SQL Effect | Example |
|-------------|-----------|---------|
| `day` | No truncation (raw date) | `2025-03-15` |
| `week` | Truncate to week start | `2025-03-10` |
| `month` | Truncate to month start | `2025-03-01` |
| `quarter` | Truncate to quarter start | `2025-01-01` |
| `year` | Truncate to year start | `2025-01-01` |

## Validation Rules

The loader performs structural validation before any database checks:

1. **Unique IDs** -- Entity, metric, dimension, and relationship IDs must be unique within an ontology
2. **Column uniqueness** -- Column names must be unique within each entity
3. **Primary key exists** -- The `primaryKey` must be listed in the entity's `columns`
4. **Foreign key targets exist** -- `foreignKey` references must point to valid entity.column pairs
5. **Relationship references** -- `from` and `to` must reference valid entity.column pairs
6. **Metric entity exists** -- The `entity` field must match an existing entity ID
7. **Dimension entity/column** -- Both the entity and column must exist

Live schema validation (requires DB connection) additionally checks:

8. **Table exists** -- The table must exist in the configured catalog/schema
9. **Columns exist** -- All declared columns must exist in the database table
10. **Type compatibility** -- Column types are loosely checked against DB-reported types (warnings only)

## Best Practices

### Write Descriptive Descriptions

The agent uses `description` fields to map natural language to ontology concepts. Compare:

```yaml
# Bad -- agent cannot map "revenue" to this
- id: metric_1
  name: M1
  entity: order
  expression: "SUM(total_amount)"

# Good -- agent understands this is revenue
- id: total_revenue
  name: Total Revenue
  description: "Sum of all non-cancelled order amounts in USD"
  entity: order
  expression: "SUM(total_amount)"
  filters: ["status != 'cancelled'"]
```

### Use allowedValues Liberally

Enumerating allowed values helps the agent generate correct filters:

```yaml
- name: status
  type: string
  allowedValues: [active, churned, paused, trial]
```

Without this, the agent might guess values like "cancelled" or "inactive" that do not exist.

### One Ontology per Domain

Keep ontologies focused on one business domain (e-commerce, HR, marketing). The context selector scores relevance per-ontology, and focused ontologies produce more relevant context.

### Version Your Ontologies

Use the `version` field to track changes. When you change table structures or metric definitions, bump the version.

## Complete Examples

- [`examples/ecommerce.yaml`](../examples/ecommerce.yaml) -- E-commerce with orders, customers, products
- [`examples/saas-metrics.yaml`](../examples/saas-metrics.yaml) -- SaaS with subscriptions, usage, MRR/churn
