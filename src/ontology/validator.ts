import type { OntologyDefinition } from "./types.js";
import type { DatabaseConnector } from "../connectors/types.js";

export type ValidationResult = {
  valid: boolean;
  errors: string[];
  warnings: string[];
};

/**
 * Validate an ontology definition against a live database schema.
 * Checks that referenced tables and columns actually exist.
 */
export async function validateAgainstSchema(
  def: OntologyDefinition,
  connector: DatabaseConnector,
): Promise<ValidationResult> {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!connector.isConnected()) {
    return { valid: false, errors: ["Database connector is not connected"], warnings };
  }

  const schemaInfo = await connector.getSchema(def.source.catalog, def.source.schema);

  // Build table lookup: table name -> column set
  const tableColumns = new Map<string, Map<string, string>>();
  for (const table of schemaInfo.tables) {
    const colMap = new Map<string, string>();
    for (const col of table.columns) {
      colMap.set(col.name.toLowerCase(), col.type);
    }
    tableColumns.set(table.name.toLowerCase(), colMap);
  }

  // Validate each entity
  for (const entity of def.entities) {
    const tableName = entity.table.toLowerCase();
    const cols = tableColumns.get(tableName);

    if (!cols) {
      errors.push(`Entity "${entity.id}": table "${entity.table}" not found in database`);
      continue;
    }

    // Check each column
    for (const col of entity.columns) {
      const dbCol = cols.get(col.name.toLowerCase());
      if (!dbCol) {
        errors.push(
          `Entity "${entity.id}": column "${col.name}" not found in table "${entity.table}"`,
        );
      } else {
        // Type compatibility check (loose -- DB types vary widely)
        const compatible = isTypeCompatible(col.type, dbCol);
        if (!compatible) {
          warnings.push(
            `Entity "${entity.id}": column "${col.name}" declared as "${col.type}" but DB reports "${dbCol}"`,
          );
        }
      }
    }

    // Check primary key
    if (!cols.has(entity.primaryKey.toLowerCase())) {
      errors.push(
        `Entity "${entity.id}": primaryKey "${entity.primaryKey}" not found in table "${entity.table}"`,
      );
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

const TYPE_COMPAT_MAP: Record<string, string[]> = {
  string: ["string", "varchar", "char", "text", "nvarchar", "nchar"],
  number: ["number", "int", "integer", "bigint", "smallint", "tinyint", "float", "double", "decimal", "numeric", "real"],
  decimal: ["decimal", "numeric", "float", "double", "real", "number"],
  integer: ["int", "integer", "bigint", "smallint", "tinyint", "number"],
  boolean: ["boolean", "bool", "bit", "tinyint"],
  date: ["date"],
  timestamp: ["timestamp", "datetime", "datetime2", "timestamptz"],
};

function isTypeCompatible(ontologyType: string, dbType: string): boolean {
  const compatibleTypes = TYPE_COMPAT_MAP[ontologyType];
  if (!compatibleTypes) {
    return true; // Unknown ontology type, skip check
  }
  const normalizedDb = dbType.toLowerCase().replace(/\(.*\)/, "").trim();
  return compatibleTypes.some((t) => normalizedDb.includes(t));
}
