export type ConnectorConfig = {
  host: string;
  path: string;
  token: string;
  catalog?: string;
  schema?: string;
};

export type QueryResult = {
  columns: Array<{ name: string; type: string }>;
  rows: Record<string, unknown>[];
  rowCount: number;
  truncated: boolean;
  executionTimeMs: number;
};

export type SchemaInfo = {
  tables: Array<{
    name: string;
    columns: Array<{ name: string; type: string; nullable: boolean }>;
  }>;
};

export interface DatabaseConnector {
  readonly id: string;
  readonly name: string;
  connect(config: ConnectorConfig): Promise<void>;
  disconnect(): Promise<void>;
  isConnected(): boolean;
  query(sql: string, params?: Record<string, unknown>): Promise<QueryResult>;
  getSchema(catalog?: string, schema?: string): Promise<SchemaInfo>;
  ping(): Promise<boolean>;
}
