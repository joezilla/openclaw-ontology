# Architecture

Internal design of the `@openclaw/ontology` plugin -- module responsibilities, data flow, and extension points.

## High-Level Architecture

```
                           ┌─────────────────────────┐
                           │     OpenClaw Agent       │
                           │                          │
                           │  System prompt includes  │
                           │  <ontology-context>      │
                           │  block from hook         │
                           └─────────┬────────────────┘
                                     │
                     ┌───────────────┼───────────────┐
                     │               │               │
               ontology_query  ontology_sql   ontology_explore
               ontology_list   ontology_describe   ontology_validate
                     │               │               │
                     └───────┬───────┘               │
                             │                       │
                    ┌────────▼────────┐    ┌─────────▼──────────┐
                    │  Query Engine   │    │  Ontology Loader    │
                    │                 │    │                     │
                    │  planner.ts     │    │  loader.ts          │
                    │  executor.ts    │    │  resolver.ts        │
                    │  safety.ts      │    │  validator.ts       │
                    └────────┬────────┘    └────────────────────┘
                             │
                    ┌────────▼────────┐
                    │  Connector      │
                    │                 │
                    │  registry.ts    │
                    │  databricks.ts  │
                    └─────────────────┘
                             │
                    ┌────────▼────────┐
                    │  Data Warehouse │
                    │  (Databricks)   │
                    └─────────────────┘
```

## Module Responsibilities

### Plugin Entry (`index.ts`)

The entry point uses `definePluginEntry()` to register the plugin with OpenClaw. It:

1. Parses and validates config via `ontologyConfigSchema.parse()`
2. Creates a database connector from the registry
3. Registers all 6 tools (passing lazy `() => graphs` accessors)
4. Registers CLI commands
5. Registers the `before_agent_start` hook for context injection
6. Registers the background service that connects to the DB and loads ontologies

Key design decision: tools receive `() => OntologyGraph[]` getter functions, not direct references. This allows the service to populate graphs asynchronously after tools are registered.

### Config (`config.ts`)

Handles configuration parsing with:
- Key validation (rejects unknown keys at each level)
- Type checking and range validation
- Environment variable resolution (`${ENV_VAR}` syntax)
- Default value population

The config schema is also declared in `openclaw.plugin.json` (JSON Schema format) for the OpenClaw UI to render configuration forms.

### Ontology Core (`src/ontology/`)

#### types.ts

Pure TypeScript type definitions for the YAML DSL. No runtime code. Key types:

- `OntologyDefinition` -- The top-level parsed YAML structure
- `OntologyEntity`, `OntologyColumn`, `OntologyRelationship`, `OntologyMetric`, `OntologyDimension` -- DSL building blocks
- `OntologyGraph` -- The resolved runtime structure with lookup maps and adjacency graph
- `ResolvedJoin` -- A join between two entities with column references

#### loader.ts

Responsible for:
- Reading YAML files from disk (`loadOntologyFile`, `loadOntologyDir`)
- Parsing YAML via `js-yaml`
- Structural validation (`validateOntologyStructure`) -- checks IDs, references, and constraints without requiring a database connection

The loader returns `OntologyDefinition` objects (raw parsed data). The resolver transforms these into `OntologyGraph` objects.

#### resolver.ts

Transforms `OntologyDefinition` into `OntologyGraph`:
- Builds `Map` lookups for entities, metrics, and dimensions
- Resolves relationships into `ResolvedJoin` objects
- Constructs a bidirectional adjacency graph for entity connectivity
- Provides `findJoinPath()` using BFS for shortest-path join resolution

The BFS join path-finder is central to the query planner. When a query references a metric on entity A and a dimension on entity B, `findJoinPath(graph, A, B)` returns the sequence of joins needed.

#### validator.ts

Validates ontology definitions against the live database schema:
- Fetches table/column metadata via `connector.getSchema()`
- Checks that declared tables exist
- Checks that declared columns exist in their tables
- Compares declared types against DB-reported types (loose matching with a compatibility map)

Returns `ValidationResult` with separate `errors` (blocking) and `warnings` (informational).

### Connectors (`src/connectors/`)

#### types.ts

Interface definitions:
- `DatabaseConnector` -- The contract all connectors implement
- `ConnectorConfig` -- Configuration passed to `connect()`
- `QueryResult` -- Standardized query result format
- `SchemaInfo` -- Standardized schema introspection format

#### registry.ts

A simple factory registry:
- `registerConnector(type, factory)` -- Registers a connector factory
- `createConnector(type)` -- Creates an instance from the registry
- `getAvailableConnectors()` -- Lists registered types

Connectors self-register via side-effect imports (e.g., importing `databricks.ts` triggers `registerConnector("databricks", ...)`).

#### databricks.ts

Databricks SQL connector implementation:
- Lazy-loads `@databricks/sql` (prevents slow startup when the plugin is installed but not configured)
- Opens a new session per query (stateless query execution)
- Queries `INFORMATION_SCHEMA.COLUMNS` for schema introspection
- Handles connection/disconnection lifecycle

### Query Engine (`src/query/`)

#### planner.ts

The core of SQL generation. `planQuery()`:

1. Resolves the primary entity from the graph
2. Determines which tables need to be joined (based on metrics and dimensions referencing different entities)
3. Uses `findJoinPath()` to compute join chains
4. Assigns table aliases (`e1`, `e2`, ...)
5. Builds SELECT columns (dimensions as raw columns, metrics as aggregated expressions)
6. Prefixes bare column names with table aliases in expressions
7. Builds WHERE clause from metric filters + user filters
8. Builds GROUP BY clause from dimension columns
9. Applies ORDER BY and LIMIT

Returns a `QueryPlan` with `sql`, `params`, `joins`, and `explanation`.

#### executor.ts

Thin wrapper for execution and formatting:
- `executeQuery()` -- Passes SQL to the connector
- `formatResultAsMarkdown()` -- Renders results as a pipe-delimited markdown table with a footer showing row count and timing
- `formatResultAsJson()` -- Renders results as formatted JSON

#### safety.ts

Query safety guardrails:
- `validateQuerySafety()` -- Rejects DML/DDL statements (INSERT, UPDATE, DELETE, DROP, ALTER, TRUNCATE, CREATE, GRANT, REVOKE, MERGE, EXEC)
- `applyLimits()` -- Adds a LIMIT clause if one is not already present
- `sanitizeFilter()` -- Rejects user-provided filter strings containing semicolons, comments, subqueries, UNION, or INTO patterns

### Context (`src/context/`)

#### injector.ts

Builds the `<ontology-context>` XML block that gets prepended to agent system prompts. For each ontology graph, it generates a compact summary listing entities, metrics, and dimensions with granularity info.

Also provides `buildEntityDetail()` for detailed entity descriptions (used by the explore and describe tools).

#### selector.ts

Keyword-based relevance scoring. `selectRelevantEntities()`:
1. Tokenizes the user's prompt into words (filtering short words)
2. Scores each ontology graph by counting keyword matches against entity names/descriptions, metric names, and dimension names
3. Metrics get a 1.5x weight multiplier (high-signal for data questions)
4. Returns the top N graphs sorted by score

This is intentionally simple -- it runs on every agent turn and must be fast.

### Tools (`src/tools/`)

Each tool file exports a `register*Tool()` function that calls `api.registerTool()`. Tools follow a consistent pattern:
- Accept an `OpenClawPluginApi` reference and lazy graph/connector accessors
- Define parameters using `@sinclair/typebox` (`Type.Object`, `Type.String`, `Type.Optional`, etc.)
- Return `{ content: [{ type: "text", text }], details: { ... } }`
- Handle errors gracefully (return error text, not throw)

### CLI (`src/cli/commands.ts`)

Registers commands under the `ontology` group using `api.registerCli()`. Uses the Commander pattern matching the memory-lancedb plugin.

### Service (`src/service/sync.ts`)

Creates the background service with `start()` and `stop()` methods:
- `start()`: Connects the database connector using config credentials
- `stop()`: Disconnects the connector

The service is extended in `index.ts` to also load ontology YAML files on start and clear graphs on stop.

## Data Flow

### Plugin Startup

```
1. OpenClaw loads plugin via definePluginEntry()
2. register() runs:
   a. Parse config
   b. Create connector (not yet connected)
   c. Register tools (with lazy graph accessors)
   d. Register CLI commands
   e. Register before_agent_start hook
   f. Register service
3. Service starts:
   a. connector.connect() -- establishes DB connection
   b. loadOntologyDir() -- reads YAML files
   c. buildOntologyGraph() -- creates resolved graphs
   d. graphs[] is populated (tools can now access data)
```

### Query Execution

```
1. Agent calls ontology_query with structured params
2. Tool finds matching graph for entityId
3. sanitizeFilter() validates user filters
4. planQuery() generates SQL:
   a. Resolve joins via BFS
   b. Build SELECT/FROM/JOIN/WHERE/GROUP BY
5. validateQuerySafety() checks for DML/DDL
6. applyLimits() ensures LIMIT clause
7. executeQuery() runs SQL via connector
8. formatResultAsMarkdown() formats output
9. Return content + details to agent
```

### Context Injection

```
1. before_agent_start fires with user prompt
2. selectRelevantEntities() scores graphs
3. buildOntologyContext() generates XML block
4. Return { prependContext: context }
5. Agent sees ontology summary in system prompt
```

## Extension Points

| Extension | How |
|-----------|-----|
| New database | Implement `DatabaseConnector`, register in `registry.ts`, import in `index.ts` |
| New tool | Create `src/tools/my-tool.ts`, export `registerMyTool()`, call it from `index.ts` |
| Custom context | Replace or wrap `buildOntologyContext()` in the hook |
| Custom relevance | Replace `selectRelevantEntities()` with embedding-based or LLM-based scoring |
| New CLI command | Add to `registerCliCommands()` in `src/cli/commands.ts` |
