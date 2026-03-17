# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Is

OpenClaw ontology plugin (`@openclaw/ontology`). Bridges data warehouses and OpenClaw AI agents via a YAML-defined business ontology layer. Agents query data through structured tools rather than raw SQL.

## Commands

```bash
npm install              # install dependencies
npm test                 # run all tests (vitest)
npx vitest run tests/query-planner.test.ts  # run a single test file
npx vitest -t "generates SQL"               # run tests matching a name pattern
npm run build            # compile TypeScript (tsc -> dist/)
npm run typecheck        # type-check without emitting (tsc --noEmit)
```

No linter is configured. Uses `vitest` for testing and TypeScript strict mode.

## Architecture

This is an OpenClaw plugin. The entry point (`index.ts`) calls `definePluginEntry` from the OpenClaw plugin SDK and wires together all subsystems: tools, CLI commands, lifecycle hooks, and a background service.

### Core pipeline

1. **Ontology loading** (`src/ontology/loader.ts`) — Parses YAML files from `ontologyDir` into `OntologyDefinition` structs
2. **Graph building** (`src/ontology/resolver.ts`) — Converts definitions into `OntologyGraph` with entity/metric/dimension lookup maps and a bidirectional adjacency graph for BFS join path-finding
3. **Query planning** (`src/query/planner.ts`) — Takes structured `QueryOptions` (entity, metrics, dimensions, filters) and generates SQL. Automatically resolves cross-entity joins, aliases tables (`e1`, `e2`, ...), applies metric filters, and builds GROUP BY clauses
4. **Safety validation** (`src/query/safety.ts`) — Enforces read-only queries (rejects DML/DDL), applies row limits, sanitizes user-provided filters against injection patterns
5. **Execution** (`src/query/executor.ts`) — Runs SQL through the database connector, formats results as markdown

### Connector system

`DatabaseConnector` interface (`src/connectors/types.ts`) with a factory registry (`src/connectors/registry.ts`). Databricks is the only implementation (`src/connectors/databricks.ts`). New connectors self-register via `registerConnector()` on import — the entry point imports `./src/connectors/databricks.js` as a side effect to trigger registration.

### Context injection

Before each agent turn, the `before_agent_start` hook runs keyword-based relevance scoring (`src/context/selector.ts`) against loaded ontologies and injects matching entity summaries into the system prompt (`src/context/injector.ts`).

### Agent tools (6 total, in `src/tools/`)

`ontology_query`, `ontology_explore`, `ontology_list`, `ontology_describe`, `ontology_sql`, `ontology_validate`. Each tool registration function takes the plugin API, a `() => OntologyGraph[]` accessor (graphs are loaded asynchronously at service start), and relevant config.

### Key types

- `OntologyDefinition` / `OntologyGraph` — in `src/ontology/types.ts`
- `DatabaseConnector` / `QueryResult` — in `src/connectors/types.ts`
- `QueryPlan` / `QueryOptions` — in `src/query/planner.ts`
- Plugin config — `OntologyPluginConfig` in `config.ts` (hand-rolled parser with env var resolution via `${VAR}` syntax)

### Config

Config is validated in `config.ts` with a hand-written parser (not Zod/TypeBox at runtime). The `openclaw.plugin.json` duplicates the schema as JSON Schema for the OpenClaw UI. Both must be kept in sync when adding config fields.

## Conventions

- ESM (`"type": "module"`) — all internal imports use `.js` extensions
- TypeScript strict mode, target ES2022
- Tests live in `tests/` (flat, not mirroring `src/` structure), named `*.test.ts`
- Example ontology YAML files in `examples/`
