import fs from "node:fs/promises";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk/ontology";
import type { DatabaseConnector, SchemaInfo } from "../connectors/types.js";
import type { OntologyPluginConfig } from "../../config.js";

export type DiscoverOptions = {
  catalog?: string;
  schema?: string;
  include?: string;
  exclude?: string;
  output?: string;
  sampleRows: number;
  id: string;
  name: string;
};

/**
 * Simple glob matching: supports `*` (any chars) and `?` (single char).
 */
function matchGlob(value: string, pattern: string): boolean {
  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*/g, ".*")
    .replace(/\?/g, ".");
  return new RegExp(`^${escaped}$`, "i").test(value);
}

function mapDbTypeToOntology(dbType: string): string {
  const t = dbType.toLowerCase();
  if (t.includes("int") || t.includes("bigint") || t.includes("smallint") || t.includes("tinyint")) return "integer";
  if (t.includes("decimal") || t.includes("numeric") || t.includes("float") || t.includes("double")) return "decimal";
  if (t.includes("boolean") || t === "bool") return "boolean";
  if (t.includes("timestamp")) return "timestamp";
  if (t.includes("date")) return "date";
  return "string";
}

function formatSchemaForPrompt(
  tables: SchemaInfo["tables"],
  sampleData: Map<string, Record<string, unknown>[]>,
): string {
  const parts: string[] = [];

  for (const table of tables) {
    const lines: string[] = [`TABLE: ${table.name}`];
    lines.push("  COLUMNS:");
    for (const col of table.columns) {
      lines.push(`    - ${col.name} (${col.type}${col.nullable ? ", nullable" : ""})`);
    }

    const samples = sampleData.get(table.name);
    if (samples && samples.length > 0) {
      lines.push("  SAMPLE ROWS:");
      for (const row of samples) {
        const vals = Object.entries(row)
          .map(([k, v]) => `${k}=${JSON.stringify(v)}`)
          .join(", ");
        lines.push(`    { ${vals} }`);
      }
    }

    parts.push(lines.join("\n"));
  }

  return parts.join("\n\n");
}

const SYSTEM_PROMPT = `You are a data modeling expert. Your task is to analyze database table schemas and sample data, then generate a well-structured ontology YAML file for the OpenClaw ontology plugin.

The ontology YAML format is:

\`\`\`yaml
ontology:
  id: <snake_case_id>
  name: <Human-Readable Name>
  version: "1.0"
  description: "<Describe the data domain>"

  source:
    connector: databricks
    catalog: <catalog>
    schema: <schema>

  entities:
    - id: <snake_case_entity_id>
      name: <Human Name>
      description: "<What this entity represents>"
      table: <actual_table_name>
      primaryKey: <primary_key_column>
      columns:
        - name: <column_name>
          type: <string|integer|decimal|boolean|date|timestamp>
          description: "<What this column stores>"
        - name: <fk_column>
          type: string
          description: "<Description>"
          foreignKey: <target_entity>.<target_column>   # only for foreign keys
        - name: <enum_column>
          type: string
          description: "<Description>"
          allowedValues: [val1, val2, val3]             # only for low-cardinality enums

  relationships:
    - id: <entity1>_<entity2>
      from: <entity1>.<fk_column>
      to: <entity2>.<pk_column>
      type: <one_to_one|one_to_many|many_to_one|many_to_many>
      description: "<Describe the relationship>"

  metrics:
    - id: <metric_id>
      name: <Metric Name>
      description: "<What this metric measures>"
      entity: <entity_id>
      expression: "<SQL aggregate expression, e.g. SUM(amount)>"
      filters: ["<optional SQL filter condition>"]  # omit if no filter needed

  dimensions:
    - id: <dimension_id>
      name: <Dimension Name>
      entity: <entity_id>
      column: <column_name>
      granularities: [day, week, month, quarter, year]  # only for date/timestamp columns
\`\`\`

## Rules

1. **Entities**: Create one entity per table. Use a short snake_case id (not the full table name). Pick the most likely primary key from the columns.
2. **Column types**: Map database types to ontology types: string, integer, decimal, boolean, date, timestamp.
3. **Foreign keys**: Identify columns that reference other tables (e.g., \`customer_id\` in an orders table likely references a customers table). Add \`foreignKey: <entity>.<column>\` annotations.
4. **allowedValues**: If sample data shows a column has few distinct categorical values, add \`allowedValues\`. Do NOT add this for high-cardinality columns like IDs or names.
5. **Relationships**: Infer relationships from foreign keys. Use many_to_one when an FK points from a fact to a dimension, one_to_many for the reverse.
6. **Metrics**: Suggest 3-7 useful business metrics based on the data. Use SQL aggregate expressions (SUM, COUNT, AVG, COUNT(DISTINCT ...), etc.). Add filters where appropriate (e.g., excluding cancelled orders).
7. **Dimensions**: Identify useful grouping/slicing columns. Add granularities for date/timestamp dimensions.
8. **Descriptions**: Write concise, informative descriptions for entities, columns, metrics, and dimensions.

Return ONLY the YAML content. Do not wrap it in code fences. Do not include any commentary before or after the YAML.`;

export async function discoverOntology(
  api: OpenClawPluginApi,
  connector: DatabaseConnector,
  config: OntologyPluginConfig,
  opts: DiscoverOptions,
): Promise<string> {
  const catalog = opts.catalog ?? config.connector.catalog;
  const schema = opts.schema ?? config.connector.schema;

  // 1. Fetch schema
  console.log(`Fetching schema from ${catalog ?? "default"}.${schema ?? "default"}...`);
  const schemaInfo = await connector.getSchema(catalog, schema);

  if (schemaInfo.tables.length === 0) {
    throw new Error("No tables found in the specified catalog/schema.");
  }

  // 2. Filter tables
  let tables = schemaInfo.tables;
  if (opts.include) {
    tables = tables.filter((t) => matchGlob(t.name, opts.include!));
  }
  if (opts.exclude) {
    tables = tables.filter((t) => !matchGlob(t.name, opts.exclude!));
  }

  if (tables.length === 0) {
    throw new Error("No tables matched the include/exclude filters.");
  }

  console.log(`Found ${tables.length} table(s): ${tables.map((t) => t.name).join(", ")}`);

  // 3. Sample rows for better LLM context
  const sampleData = new Map<string, Record<string, unknown>[]>();
  if (opts.sampleRows > 0) {
    const qualifiedPrefix = [catalog, schema].filter(Boolean).join(".");
    for (const table of tables) {
      try {
        const qualified = qualifiedPrefix ? `${qualifiedPrefix}.${table.name}` : table.name;
        const result = await connector.query(
          `SELECT * FROM ${qualified} LIMIT ${opts.sampleRows}`,
        );
        sampleData.set(table.name, result.rows);
      } catch (err) {
        api.logger.warn(`ontology-discover: failed to sample ${table.name}: ${String(err)}`);
      }
    }
    console.log(`Sampled rows from ${sampleData.size} table(s).`);
  }

  // 4. Build the prompt
  const schemaText = formatSchemaForPrompt(tables, sampleData);
  const userMessage = [
    `Analyze the following database schema and generate an ontology YAML file.`,
    ``,
    `Ontology ID: ${opts.id}`,
    `Ontology Name: ${opts.name}`,
    `Connector: ${config.connector.type}`,
    catalog ? `Catalog: ${catalog}` : null,
    schema ? `Schema: ${schema}` : null,
    ``,
    `--- DATABASE SCHEMA ---`,
    ``,
    schemaText,
  ]
    .filter((line) => line !== null)
    .join("\n");

  // 5. Call LLM via subagent
  console.log("Generating ontology with LLM...");
  const sessionKey = `ontology-discover-${Date.now()}`;

  const { runId } = await api.runtime.subagent.run({
    sessionKey,
    message: userMessage,
    extraSystemPrompt: SYSTEM_PROMPT,
  });

  const waitResult = await api.runtime.subagent.waitForRun({
    runId,
    timeoutMs: 120_000,
  });

  if (waitResult.status !== "ok") {
    throw new Error(
      `LLM generation ${waitResult.status === "timeout" ? "timed out" : "failed"}: ${waitResult.error ?? "unknown error"}`,
    );
  }

  // 6. Extract YAML from subagent response
  const { messages } = await api.runtime.subagent.getSessionMessages({
    sessionKey,
    limit: 10,
  });

  const yaml = extractYaml(messages);
  if (!yaml) {
    throw new Error("LLM did not return valid YAML content.");
  }

  // 7. Cleanup
  try {
    await api.runtime.subagent.deleteSession({ sessionKey, deleteTranscript: true });
  } catch {
    // Best effort
  }

  // 8. Output
  if (opts.output) {
    await fs.writeFile(opts.output, yaml, "utf-8");
    console.log(`\nOntology written to ${opts.output}`);
    console.log("Review and edit the file before using it — this is a starting point, not a finished ontology.");
  } else {
    console.log("\n--- GENERATED ONTOLOGY ---\n");
    console.log(yaml);
    console.log("\n--- END ---");
    console.log("\nUse --output <file> to save directly to a YAML file.");
  }

  return yaml;
}

/**
 * Extract YAML content from subagent messages.
 * Looks for the last assistant message and strips any code fences.
 */
function extractYaml(messages: unknown[]): string | null {
  // Walk backwards to find last assistant text
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i] as Record<string, unknown>;
    if (msg.role !== "assistant") continue;

    let text = "";
    if (typeof msg.content === "string") {
      text = msg.content;
    } else if (Array.isArray(msg.content)) {
      text = (msg.content as Array<{ type?: string; text?: string }>)
        .filter((p) => p.type === "text" && typeof p.text === "string")
        .map((p) => p.text!)
        .join("\n");
    }

    if (!text.trim()) continue;

    // Strip code fences if present
    const fenced = text.match(/```(?:ya?ml)?\s*\n?([\s\S]*?)\n?\s*```/);
    if (fenced) {
      text = fenced[1]!;
    }

    text = text.trim();
    if (text.includes("ontology:")) {
      return text + "\n";
    }
  }

  return null;
}
