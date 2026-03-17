# Troubleshooting

Common issues, error messages, diagnostics, and solutions for the `@openclaw/ontology` plugin.

## Quick Diagnostics

Run these commands to check plugin health:

```bash
# Is the plugin installed?
openclaw plugin list

# Are ontologies loaded?
openclaw ontology list

# Are there validation errors?
openclaw ontology validate

# Can the plugin reach the database?
openclaw ontology sync
```

## Installation Issues

### Plugin not found after install

**Symptom:** `openclaw plugin list` does not show `@openclaw/ontology`.

**Causes and fixes:**
- The install command did not complete successfully. Re-run `openclaw plugin install @openclaw/ontology`.
- Using a local link? Make sure `openclaw plugin link /path/to/openclaw-ontology` points to the correct directory (the one containing `openclaw.plugin.json`).

### Missing dependency: @databricks/sql

**Symptom:** Error on first query: `failed to load @databricks/sql`.

**Causes and fixes:**
- The `@databricks/sql` package may not support your platform (common on some Linux ARM builds). Check [the package's compatibility matrix](https://www.npmjs.com/package/@databricks/sql).
- Run `npm install` in the plugin directory to ensure dependencies are present.
- If using a local link, run `npm install` in the cloned repo.

## Connection Issues

### "Database connector is not connected"

**Symptom:** Tool calls return "Database connector is not connected" or queries fail with "Not connected to Databricks".

**Causes:**
1. **Missing config:** Connector host, path, or token is not set
2. **Invalid token:** Token expired or does not have SQL permissions
3. **Network issues:** Cannot reach the Databricks workspace
4. **Warehouse not running:** The SQL warehouse is stopped or starting

**Diagnostics:**
```bash
# Check if config is set
openclaw config get plugins.ontology.connector.host
openclaw config get plugins.ontology.connector.path
openclaw config get plugins.ontology.connector.token

# Test connectivity
openclaw ontology sync
```

**Fixes:**
- Verify your token is valid and not expired. Generate a new PAT from Databricks Settings > Developer > Access Tokens.
- Verify the SQL warehouse is running in the Databricks UI.
- Check that your machine can reach the host: `curl -s -o /dev/null -w "%{http_code}" https://<host>/api/2.0/sql/warehouses/`
- If using `${ENV_VAR}` syntax, verify the variable is set: `echo $DATABRICKS_TOKEN`

### "Environment variable X is not set"

**Symptom:** Plugin fails to load with `Environment variable DATABRICKS_TOKEN is not set`.

**Causes:**
- The environment variable is not exported in your shell
- Running OpenClaw from a context where the variable is not inherited (e.g., a cron job, a different shell session, or an IDE terminal)

**Fixes:**
- Add `export DATABRICKS_TOKEN="..."` to your shell profile (`~/.zshrc` or `~/.bashrc`)
- Source your profile: `source ~/.zshrc`
- If running from the OpenClaw gateway, ensure the variable is set in the gateway's environment

### Connection timeout

**Symptom:** Plugin hangs on startup or first query times out.

**Causes:**
- Firewall blocking HTTPS traffic to the Databricks workspace
- VPN required but not connected
- SQL warehouse is in a starting state

**Fixes:**
- Check your VPN connection
- Verify port 443 access: `nc -zv <host> 443`
- Wait for the warehouse to reach "Running" state in the Databricks UI

## Ontology Issues

### "No ontologies loaded"

**Symptom:** `openclaw ontology list` shows nothing. Tools say "No ontologies loaded."

**Causes:**
1. No YAML files in the ontology directory
2. Wrong directory configured
3. YAML files have parse errors

**Diagnostics:**
```bash
# Check which directory is configured
openclaw config get plugins.ontology.ontologyDir

# List files in that directory
ls -la ~/.openclaw/ontologies/

# Try loading a file manually to check for parse errors
cat ~/.openclaw/ontologies/my-ontology.yaml
```

**Fixes:**
- Create the ontology directory if it does not exist: `mkdir -p ~/.openclaw/ontologies`
- Generate a starter file: `openclaw ontology init > ~/.openclaw/ontologies/starter.yaml`
- Check for YAML syntax errors (indentation is the most common issue)

### "Invalid ontology file: missing top-level 'ontology' key"

**Symptom:** Ontology fails to load.

**Cause:** The YAML file does not have `ontology:` as the top-level key.

**Fix:** Ensure your file structure is:
```yaml
ontology:
  id: ...
  name: ...
  version: ...
  # ...
```

### Validation errors

**Symptom:** `openclaw ontology validate` reports errors.

Common errors and fixes:

| Error | Cause | Fix |
|-------|-------|-----|
| `Duplicate entity ID: "X"` | Two entities have the same `id` | Rename one to be unique |
| `Duplicate column "X" in entity "Y"` | Same column name appears twice | Remove the duplicate |
| `primaryKey "X" not found in columns` | PK is declared but not in the columns list | Add the PK to columns |
| `foreignKey references unknown entity "X"` | FK target entity does not exist | Check entity ID spelling |
| `Relationship "X": "from" references unknown entity "Y"` | Relationship references a missing entity | Check entity ID in `from`/`to` |
| `Metric "X": references unknown entity "Y"` | Metric's `entity` field does not exist | Fix the entity reference |
| `Dimension "X": references unknown column "Y"` | Dimension column not in the entity's columns | Add the column or fix the name |
| `table "X" not found in database` | Live validation: table does not exist | Check table name, catalog, and schema |
| `column "X" not found in table "Y"` | Live validation: column does not exist | Check column name |

### Schema warnings (type mismatch)

**Symptom:** Validation passes but shows warnings like `column "X" declared as "date" but DB reports "timestamp"`.

**Cause:** The ontology declares a type that does not exactly match the database type. The validator uses loose matching -- `date` matches `date` but not `timestamp`.

**Impact:** Warnings are informational. The query planner does not use ontology types for query generation, so mismatches do not affect queries.

**Fix:** Update the ontology column type to match the database, or ignore the warning if the mismatch is acceptable (e.g., `timestamp` when you declared `date`).

## Query Issues

### "Entity 'X' not found in any loaded ontology"

**Symptom:** `ontology_query` returns entity not found.

**Causes:**
- Typo in the entity ID
- The ontology containing this entity failed to load
- The entity is defined in a different ontology than expected

**Fix:** Run `openclaw ontology list` to see loaded ontologies, then `openclaw ontology describe <ontology_id>` to see entity IDs.

### "No join path from 'X' to 'Y'"

**Symptom:** Query fails when using a dimension from a different entity.

**Cause:** There is no chain of relationships connecting entity X to entity Y in the ontology.

**Fix:** Add a relationship connecting the two entities (directly or through intermediaries):
```yaml
relationships:
  - id: x_to_y
    from: x.y_id
    to: y.id
    type: many_to_one
```

### "Query contains forbidden statement: INSERT"

**Symptom:** Query rejected by safety check.

**Cause:** The generated SQL contains a DML/DDL keyword. This should not happen with the structured query interface. Possible causes:
- A metric expression contains a forbidden keyword (e.g., `expression: "DELETE ..."`)
- `allowRawSql` is enabled and the agent attempted raw SQL

**Fix:** Review metric expressions in your ontology YAML. Ensure they contain only SELECT-compatible aggregate expressions.

### "Filter rejected: contains potentially unsafe pattern"

**Symptom:** Query fails because a user filter was rejected.

**Cause:** The filter string contains a pattern that looks like SQL injection (semicolons, comments, subqueries, UNION).

**Examples of rejected filters:**
- `id = 1; DROP TABLE orders` (semicolon)
- `id = 1 -- comment` (SQL comment)
- `id IN (SELECT id FROM admin)` (subquery)

**Fix:** Use simple comparison filters only:
- `column = 'value'`
- `column >= '2025-01-01'`
- `column IN ('a', 'b', 'c')`
- `column != 'cancelled'`
- `column BETWEEN 10 AND 100`
- `column LIKE 'prefix%'`
- `column IS NOT NULL`

### Query returns no results

**Possible causes:**
- Filters are too restrictive
- Date range does not match any data
- The metric's built-in filters exclude all rows
- The table is empty in the configured catalog/schema

**Diagnostics:**
1. Ask the agent to use `ontology_sql` to preview the generated SQL
2. Check the WHERE clause for unexpected conditions
3. Try removing filters to see if data exists
4. Check metric `filters` in the ontology YAML

### Results are truncated

**Symptom:** Result shows "(truncated)" in the footer.

**Cause:** The query returned more rows than `query.maxRows` (default: 100).

**Fix:**
- Add more specific filters to reduce the result set
- Increase `query.maxRows` in config: `openclaw config set plugins.ontology.query.maxRows 500`
- Use dimensions to aggregate data into fewer rows

## Performance Issues

### Slow queries

**Possible causes:**
- Querying large tables without filters
- SQL warehouse is cold (first query after idle period)
- Complex joins across many entities
- High `maxRows` setting

**Fixes:**
- Add date range filters to limit scanned data
- Pre-warm the warehouse by running a simple query first
- Reduce `maxRows` to return fewer results
- Use dimensions to aggregate data server-side

### Slow startup

**Possible causes:**
- Many ontology YAML files to load
- Database connection is slow to establish
- `@databricks/sql` driver is being loaded for the first time

**Note:** The Databricks driver is lazy-loaded (imported only when first needed), so it does not affect startup unless a database operation runs immediately.

## FAQ

### Can I use multiple connectors simultaneously?

Not currently. Each ontology plugin instance connects to one database. If you need multiple databases, install the plugin twice under different names, or consolidate data into one warehouse.

### Can I use the plugin without a database?

Partially. You can define ontologies and validate their structure (`openclaw ontology validate`), but you cannot run queries without a connected database. The agent can still use `ontology_list`, `ontology_explore`, and `ontology_describe` to browse ontology definitions.

### How do I update ontologies without restarting?

Currently, ontologies are loaded on service start. To pick up changes, restart the OpenClaw gateway. A future `sync` command may support hot-reloading.

### Can I have multiple ontology files for the same domain?

Each YAML file defines one ontology with a unique `id`. If two files use the same `id`, both will be loaded and the tools will see two entries. Use unique IDs for each file.

### What SQL dialects does the query planner support?

The planner generates ANSI-compatible SQL. Databricks is the primary target. For other databases, you may need to adjust metric expressions (e.g., date functions vary by dialect).

### How do I debug generated SQL?

Ask the agent to use `ontology_sql` instead of `ontology_query`. This returns the generated SQL without executing it. You can then run the SQL manually in your database tool.
