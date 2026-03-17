# Agent Usage

This guide explains how OpenClaw agents interact with the ontology plugin -- the automatic context injection, the six available tools, example conversation flows, and tips for getting the best results from your ontology definitions.

## How the Plugin Integrates with Agents

The ontology plugin integrates at two levels:

1. **System prompt injection** (`before_agent_start` hook) -- Before the agent processes a user message, the plugin injects a summary of relevant ontologies into the system prompt. This gives the agent awareness of available data without consuming a tool call.

2. **Agent tools** (6 registered tools) -- The agent can call tools to query data, explore the ontology graph, preview SQL, and validate definitions.

## Automatic Context Injection

When `context.autoInject` is enabled (default: `true`), the plugin runs before every agent turn:

1. **Keyword matching** -- The user's prompt is tokenized and scored against entity names, descriptions, metric names, and dimension names across all loaded ontologies
2. **Relevance ranking** -- Ontologies are ranked by match score; the top `context.maxEntities` are selected
3. **Context generation** -- A compact summary is built and prepended to the system prompt

### Example Injected Context

For an e-commerce ontology, the agent sees:

```
<ontology-context>
Available data domains:
- E-Commerce Analytics (ecommerce)
  Entities: order, customer, product
  Metrics: total_revenue, avg_order_value, order_count, customer_count, units_sold
  Dimensions: time (day/week/month/quarter/year), customer_segment, product_category, country
Use ontology_query to query data. Use ontology_explore/ontology_describe for discovery.
</ontology-context>
```

This context is cacheable (`prependContext`) -- it does not change between turns in the same session, so it benefits from prompt caching and does not increase per-turn token costs.

### When Context Is Not Injected

Context injection is skipped when:
- `context.autoInject` is `false`
- No ontologies are loaded (empty `ontologyDir`)
- The user's prompt is too short (< 5 characters)
- No ontologies score above zero for relevance

In these cases, the agent can still use `ontology_list` and `ontology_explore` to discover available data manually.

## Available Tools

### ontology_query

The primary data retrieval tool. Translates structured parameters into safe SQL, executes against the data warehouse, and returns formatted results.

**When agents use it:** When the user asks a quantitative question that maps to known entities, metrics, or dimensions.

**Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `entityId` | string | Yes | Base entity to query (e.g., `"order"`) |
| `metrics` | string[] | No | Metric IDs to compute (e.g., `["total_revenue", "order_count"]`) |
| `dimensions` | string[] | No | Dimension IDs to group by (e.g., `["time", "customer_segment"]`) |
| `filters` | string[] | No | SQL filter expressions (e.g., `["order_date >= '2025-01-01'"]`) |
| `limit` | number | No | Maximum rows to return (default: `query.maxRows` config) |

**Returns:** Markdown table with results, prefixed by the query explanation. The `details` object includes the generated SQL, row count, and execution time.

**Example call:**
```json
{
  "entityId": "order",
  "metrics": ["total_revenue"],
  "dimensions": ["customer_segment"],
  "filters": ["order_date >= '2025-10-01'", "order_date < '2026-01-01'"]
}
```

**Example result:**
```
Query entity "Order" (fact_orders). Metrics: total_revenue. Grouped by: customer_segment. Joins: order -> customer.

| segment | total_revenue |
| --- | --- |
| enterprise | 1234567.00 |
| mid-market | 456789.00 |
| smb | 123456.00 |
| consumer | 45678.00 |

_4 rows in 342ms_
```

### ontology_explore

Browse the ontology graph structure without executing any database queries.

**When agents use it:**
- When the user asks "what data do we have?" or "show me the data model"
- When the agent needs to understand entity relationships before constructing a query
- For discovery when the user's question is ambiguous

**Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `entityId` | string | No | Specific entity to explore (omit for full overview) |

**Without entityId:** Returns an overview of all ontologies with their entities, relationships, metrics, and dimensions.

**With entityId:** Returns detailed information about the specific entity -- columns, related metrics, dimensions, and relationships.

### ontology_list

List all loaded ontologies with their entity, metric, and dimension counts.

**When agents use it:** As a first discovery step to see what data domains are available.

**Parameters:** None.

**Example result:**
```
Loaded ontologies (2):

- **E-Commerce Analytics** (ecommerce) v1.0
  Entities: 3, Metrics: 5, Dimensions: 4
  Business ontology for the e-commerce data warehouse

- **SaaS Business Metrics** (saas) v1.0
  Entities: 3, Metrics: 6, Dimensions: 5
  Business ontology for SaaS subscription and usage analytics
```

### ontology_describe

Get detailed information about a specific entity, metric, dimension, or relationship.

**When agents use it:**
- When the agent needs to understand a metric's exact definition before querying
- When the user asks "what does revenue mean?" or "how is churn calculated?"
- To inspect column types and allowed values before constructing filters

**Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `ontologyId` | string | Yes | Ontology ID |
| `itemType` | string | Yes | One of: `entity`, `metric`, `dimension`, `relationship` |
| `itemId` | string | Yes | The item's ID |

### ontology_sql

Generate the SQL query that would be executed, without running it. Identical parameters to `ontology_query`.

**When agents use it:**
- When the user explicitly asks to see the SQL ("show me the query")
- When the agent wants to preview complex queries before execution
- For debugging or transparency

**Returns:** The generated SQL in a code block, plus explanation and join information.

### ontology_validate

Validate an ontology against the live database schema.

**When agents use it:**
- When the user asks to verify their ontology is up to date
- After the user mentions changing their database schema
- Proactively when queries fail due to missing tables/columns

**Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `ontologyId` | string | No | Ontology ID (omit to validate all) |

## Example Conversations

### Simple metric query

**User:** What was our total revenue last month?

**Agent reasoning:** The context shows a `total_revenue` metric on the `order` entity with a `time` dimension. I need to filter for last month.

**Agent calls `ontology_query`:**
```json
{
  "entityId": "order",
  "metrics": ["total_revenue"],
  "filters": ["order_date >= '2026-02-01'", "order_date < '2026-03-01'"]
}
```

### Cross-entity dimension query

**User:** Show me revenue by product category for Q4.

**Agent reasoning:** `total_revenue` is on `order`, but `product_category` is a dimension on `product`. The planner will resolve the order->product join automatically.

**Agent calls `ontology_query`:**
```json
{
  "entityId": "order",
  "metrics": ["total_revenue"],
  "dimensions": ["product_category"],
  "filters": ["order_date >= '2025-10-01'", "order_date < '2026-01-01'"]
}
```

### Discovery workflow

**User:** What data do we have access to?

**Agent calls `ontology_list`** first, then based on what the user is interested in, calls `ontology_explore` or `ontology_describe` for details.

### SQL preview

**User:** Can you show me the SQL for average order value by customer segment?

**Agent calls `ontology_sql`:**
```json
{
  "entityId": "order",
  "metrics": ["avg_order_value"],
  "dimensions": ["customer_segment"]
}
```

**Agent responds:** Here's the SQL that would be executed:

```sql
SELECT e2.segment AS segment, AVG(e1.total_amount) AS avg_order_value
FROM main.analytics.fact_orders e1
  JOIN main.analytics.dim_customers e2 ON e1.customer_id = e2.customer_id
WHERE e1.status != 'cancelled'
GROUP BY e2.segment
LIMIT 100
```

### Multi-metric comparison

**User:** Compare total revenue and order count by region for the last 3 months.

**Agent calls `ontology_query`:**
```json
{
  "entityId": "order",
  "metrics": ["total_revenue", "order_count"],
  "dimensions": ["region"],
  "filters": ["order_date >= '2025-12-17'"]
}
```

## Tips for Better Agent Results

### Write Descriptions That Map to Natural Language

The agent maps user language to ontology concepts through descriptions. Be explicit:

```yaml
# The agent can map "revenue", "sales", "income" to this metric
- id: total_revenue
  name: Total Revenue
  description: "Total sales revenue -- sum of all non-cancelled order amounts in USD"
```

### Use allowedValues for Enum Columns

Without `allowedValues`, the agent may guess filter values incorrectly:

```yaml
# Without: agent might try status = 'canceled' (wrong spelling)
# With: agent knows the exact valid values
- name: status
  type: string
  allowedValues: [pending, confirmed, shipped, delivered, cancelled]
```

### Pre-define Metrics for Common Questions

Every question your team asks regularly should have a corresponding metric. This prevents the agent from improvising SQL and ensures consistency:

```yaml
# Instead of letting the agent guess SUM(amount) vs SUM(net_amount) vs SUM(gross_amount)
- id: net_revenue
  name: Net Revenue
  description: "Revenue after refunds and discounts"
  entity: order
  expression: "SUM(amount - refund_amount - discount_amount)"
  filters: ["status = 'completed'"]
```

### Keep Ontologies Focused

One ontology per data domain works better than one large ontology because:
- The context selector can pick the most relevant domain
- Context tokens stay small
- Validation errors are scoped

### Include Metric Filters for Business Logic

Encode business rules in metric `filters` so they are always applied:

```yaml
# This metric always excludes test data -- no way for the agent to forget
- id: active_users
  name: Active Users
  entity: user_event
  expression: "COUNT(DISTINCT user_id)"
  filters:
    - "user_type != 'test'"
    - "user_type != 'internal'"
```

### Use Meaningful Entity and Column Descriptions

The more context you provide, the better the agent reasons:

```yaml
# Minimal -- agent might confuse this with invoice amount
- name: total_amount
  type: decimal

# Comprehensive -- agent understands exactly what this is
- name: total_amount
  type: decimal
  description: "Gross order total in USD before tax, including shipping. Does not include refunds."
```
