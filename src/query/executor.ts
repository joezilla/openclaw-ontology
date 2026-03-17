import type { DatabaseConnector, QueryResult } from "../connectors/types.js";
import type { QueryPlan } from "./planner.js";

/**
 * Execute a planned query against a database connector.
 */
export async function executeQuery(
  connector: DatabaseConnector,
  plan: QueryPlan,
): Promise<QueryResult> {
  if (!connector.isConnected()) {
    throw new Error("Database connector is not connected");
  }
  return connector.query(plan.sql, plan.params);
}

/**
 * Format a query result as a Markdown table.
 */
export function formatResultAsMarkdown(result: QueryResult): string {
  if (result.rows.length === 0) {
    return "_No results returned._";
  }

  const colNames = result.columns.map((c) => c.name);

  // Header
  const header = `| ${colNames.join(" | ")} |`;
  const separator = `| ${colNames.map(() => "---").join(" | ")} |`;

  // Rows
  const rows = result.rows.map((row) => {
    const cells = colNames.map((col) => {
      const val = row[col];
      if (val === null || val === undefined) {
        return "_null_";
      }
      return String(val);
    });
    return `| ${cells.join(" | ")} |`;
  });

  const lines = [header, separator, ...rows];

  // Footer
  const truncNote = result.truncated ? " (truncated)" : "";
  lines.push("");
  lines.push(`_${result.rowCount} rows${truncNote} in ${result.executionTimeMs}ms_`);

  return lines.join("\n");
}

/**
 * Format a query result as a JSON string.
 */
export function formatResultAsJson(result: QueryResult): string {
  return JSON.stringify(
    {
      columns: result.columns,
      rows: result.rows,
      rowCount: result.rowCount,
      truncated: result.truncated,
      executionTimeMs: result.executionTimeMs,
    },
    null,
    2,
  );
}
