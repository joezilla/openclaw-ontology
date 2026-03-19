import type { ConnectorConfig, DatabaseConnector, QueryResult, SchemaInfo } from "./types.js";
import { registerConnector } from "./registry.js";

let databricksSqlPromise: Promise<typeof import("@databricks/sql")> | null = null;

const loadDatabricksSql = async () => {
  if (!databricksSqlPromise) {
    databricksSqlPromise = import("@databricks/sql");
  }
  try {
    return await databricksSqlPromise;
  } catch (err) {
    throw new Error(`ontology: failed to load @databricks/sql. ${String(err)}`, { cause: err });
  }
};

class DatabricksConnector implements DatabaseConnector {
  readonly name = "Databricks SQL";
  private client: unknown = null;
  private connected = false;
  private config: ConnectorConfig | null = null;

  constructor(readonly id: string) {}

  async connect(config: ConnectorConfig): Promise<void> {
    const { DBSQLClient } = await loadDatabricksSql();
    const client = new DBSQLClient();

    await client.connect({
      host: config.host,
      path: config.path,
      token: config.token,
    });

    this.client = client;
    this.config = config;
    this.connected = true;
  }

  async disconnect(): Promise<void> {
    if (this.client && this.connected) {
      try {
        await (this.client as { close(): Promise<void> }).close();
      } catch {
        // Best effort
      }
    }
    this.client = null;
    this.connected = false;
  }

  isConnected(): boolean {
    return this.connected;
  }

  async query(sql: string, _params?: Record<string, unknown>): Promise<QueryResult> {
    if (!this.connected || !this.client) {
      throw new Error("Not connected to Databricks");
    }

    const start = Date.now();
    const session = await (
      this.client as { openSession(): Promise<unknown> }
    ).openSession();

    try {
      const operation = await (
        session as { executeStatement(sql: string): Promise<unknown> }
      ).executeStatement(sql);

      const resultSet = await (operation as { fetchAll(): Promise<unknown[]> }).fetchAll();
      const schema = await (
        operation as { getSchema(): Promise<{ columns: Array<{ columnName: string; typeDesc: { types: Array<{ primitiveEntry: { type: string } }> } }> }> }
      ).getSchema();

      await (operation as { close(): Promise<void> }).close();

      const rawRows = resultSet as Record<string, unknown>[];

      // Derive column info from schema, falling back to row keys
      let columns: Array<{ name: string; type: string }>;
      if (schema?.columns?.length) {
        columns = schema.columns.map((col) => ({
          name: col.columnName,
          type: col.typeDesc?.types?.[0]?.primitiveEntry?.type ?? "unknown",
        }));
      } else if (rawRows.length > 0) {
        columns = Object.keys(rawRows[0]!).map((k) => ({ name: k, type: "unknown" }));
      } else {
        columns = [];
      }

      // Use raw rows directly -- the Databricks SDK returns them as key-value objects
      const rows = rawRows;

      return {
        columns,
        rows,
        rowCount: rows.length,
        truncated: false,
        executionTimeMs: Date.now() - start,
      };
    } finally {
      await (session as { close(): Promise<void> }).close();
    }
  }

  async getSchema(catalog?: string, schema?: string): Promise<SchemaInfo> {
    if (!this.connected) {
      throw new Error("Not connected to Databricks");
    }

    const cat = catalog ?? this.config?.catalog ?? "main";
    const sch = schema ?? this.config?.schema ?? "default";

    const result = await this.query(`
      SELECT table_name, column_name, data_type, is_nullable
      FROM ${cat}.information_schema.columns
      WHERE table_schema = '${sch}'
      ORDER BY table_name, ordinal_position
    `);

    const tableMap = new Map<string, Array<{ name: string; type: string; nullable: boolean }>>();

    for (const row of result.rows) {
      // Normalize keys to lowercase -- Databricks may return uppercase column names
      const r: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(row)) {
        r[k.toLowerCase()] = v;
      }
      const tableName = r.table_name as string;
      const cols = tableMap.get(tableName) ?? [];
      cols.push({
        name: r.column_name as string,
        type: r.data_type as string,
        nullable: (r.is_nullable as string) === "YES",
      });
      tableMap.set(tableName, cols);
    }

    return {
      tables: [...tableMap.entries()].map(([name, columns]) => ({ name, columns })),
    };
  }

  async ping(): Promise<boolean> {
    if (!this.connected) {
      return false;
    }
    try {
      await this.query("SELECT 1");
      return true;
    } catch {
      return false;
    }
  }
}

// Self-register
registerConnector("databricks", (id) => new DatabricksConnector(id));
