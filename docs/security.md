# Security

The ontology plugin mediates between AI agents and your data warehouse. This document describes the safety model, query guardrails, credential handling, and known boundaries.

## Threat Model

The ontology plugin operates in a trust environment where:

- **The ontology author is trusted.** YAML files are loaded from a local directory controlled by the system administrator. Malicious ontology files could define expressions that expose data -- this is equivalent to giving someone SQL access.
- **The AI agent is semi-trusted.** Agents can call tools with arbitrary parameters, but all queries go through the safety layer before reaching the database. The agent cannot bypass the planner to execute raw SQL (unless `allowRawSql` is explicitly enabled).
- **User input is untrusted.** Users interact with agents in natural language. The agent translates this into tool calls. User-provided filter expressions are sanitized before inclusion in SQL.

## Query Safety Guardrails

### Read-Only Enforcement

All generated SQL is checked by `validateQuerySafety()` before execution. The following statement types are rejected:

| Blocked Statement | Why |
|-------------------|-----|
| `INSERT` | Prevents data creation |
| `UPDATE` | Prevents data modification |
| `DELETE` | Prevents data deletion |
| `DROP` | Prevents schema destruction |
| `ALTER` | Prevents schema modification |
| `TRUNCATE` | Prevents bulk data deletion |
| `CREATE` | Prevents schema creation |
| `GRANT` | Prevents privilege escalation |
| `REVOKE` | Prevents privilege changes |
| `MERGE` | Prevents upsert operations |
| `EXEC` / `EXECUTE` | Prevents stored procedure execution |

Detection is case-insensitive and uses word-boundary matching. This check runs on the final SQL string after all planner transformations.

### Row Limits

Every query has a maximum row limit enforced by `applyLimits()`:

- If the generated SQL does not contain a `LIMIT` clause, one is appended using `query.maxRows` (default: 100)
- If a `LIMIT` clause already exists (from the planner), it is left as-is
- The default maximum is 100 rows; configurable up to 10,000 via `query.maxRows`

This prevents runaway queries that could return millions of rows, consuming memory and network bandwidth.

### Query Timeout

The `query.timeoutMs` config (default: 30 seconds, max: 5 minutes) limits query execution time. Long-running queries are cancelled.

### Filter Sanitization

User-provided filter expressions (passed to `ontology_query` via the `filters` parameter) are sanitized by `sanitizeFilter()` before inclusion in WHERE clauses. The following patterns are rejected:

| Pattern | Rationale |
|---------|-----------|
| Semicolons (`;`) | Prevents statement chaining |
| Single-line comments (`--`) | Prevents comment-based injection |
| Block comments (`/* */`) | Prevents comment-based injection |
| `SELECT` keyword | Prevents subquery injection |
| `UNION` keyword | Prevents UNION-based injection |
| `INTO` keyword | Prevents `SELECT INTO` |

Filters that fail sanitization cause the query to fail with an error message -- they are never passed to the database.

### Structured Query Interface

The primary defense is architectural: agents do not write SQL directly. Instead, they provide structured parameters (`entityId`, `metrics`, `dimensions`, `filters`) and the query planner generates SQL from the ontology definition.

This means:
- Column and table names come from the trusted ontology YAML, not from user input
- Aggregation expressions come from metric definitions, not from the agent
- Join conditions are computed from the relationship graph, not specified by the agent
- Only filter values come from the agent (and are sanitized)

## Credential Handling

### Token Storage

Database tokens are stored in the OpenClaw config file. The config file is not encrypted -- it has the same security as any other dotfile (e.g., `~/.gitconfig`).

**Recommendation:** Use `${ENV_VAR}` syntax to reference environment variables instead of storing tokens directly:

```bash
openclaw config set plugins.ontology.connector.token '${DATABRICKS_TOKEN}'
```

This way the config file contains the literal string `${DATABRICKS_TOKEN}`, and the actual token is resolved from the environment at plugin load time.

### Token Exposure

Tokens are:
- Resolved from environment variables at plugin load time
- Stored in memory for the lifetime of the plugin process
- Passed to the database connector for authentication
- **Never** included in query results, tool outputs, or agent context
- **Never** logged by the plugin (connection messages use the hostname, not the token)

### Environment Variable Resolution

Environment variables are resolved once at startup. If a variable is not set, the plugin fails to load with a clear error message. This prevents silent fallback to empty tokens.

## Ontology File Security

### File Trust

Ontology YAML files are loaded from a local directory. Anyone with write access to `ontologyDir` can define arbitrary SQL expressions in metrics. Treat ontology files with the same security as database credentials or SQL scripts.

### No Remote Loading

Ontology files are loaded from the local filesystem only. There is no URL-based loading, no remote sync, and no untrusted input path to ontology definitions.

### Expression Injection

Metric `expression` fields contain SQL fragments that are embedded directly into generated queries. A malicious expression could:

```yaml
# This expression would be placed in a SELECT clause as-is
expression: "1); DROP TABLE users; --"
```

The safety check (`validateQuerySafety`) runs on the complete generated SQL and would catch this. However, a sufficiently crafted expression might evade detection. This is why ontology files must come from trusted sources.

## Agent Boundaries

### What Agents Can Do

- Query data through structured parameters (entities, metrics, dimensions, filters)
- Browse ontology structure (entities, relationships, columns)
- Preview generated SQL (dry-run)
- Validate ontology against database schema

### What Agents Cannot Do

- Execute arbitrary SQL (unless `allowRawSql` is enabled -- disabled by default)
- Modify data (DML statements are rejected)
- Modify schema (DDL statements are rejected)
- Access tables not defined in ontology files
- Bypass row limits
- Read database credentials
- Modify ontology YAML files
- Change plugin configuration

### allowRawSql

The `query.allowRawSql` config is `false` by default. When enabled, additional code paths may allow raw SQL execution. This flag exists for advanced use cases but significantly increases the attack surface. If you enable it, ensure your database user has read-only permissions at the database level.

## Recommendations

1. **Use read-only database credentials.** Create a dedicated database user with `SELECT`-only permissions for the ontology plugin. This provides defense-in-depth even if the safety layer is bypassed.

2. **Use environment variables for tokens.** Never store tokens directly in config files.

3. **Restrict ontology directory permissions.** Only trusted users should be able to write to `ontologyDir`.

4. **Keep `allowRawSql` disabled.** The structured query interface is sufficient for most use cases.

5. **Set reasonable row limits.** The default of 100 rows is appropriate for most interactive queries. Increase only if needed.

6. **Review metric expressions.** When adding or modifying ontology files, review SQL expressions for correctness and safety.

7. **Use catalog/schema scoping.** Set `connector.catalog` and `connector.schema` to restrict which tables are accessible.
