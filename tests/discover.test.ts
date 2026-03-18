import { describe, it, expect, vi } from "vitest";
import { discoverOntology, type DiscoverOptions } from "../src/cli/discover.js";
import type { DatabaseConnector, SchemaInfo } from "../src/connectors/types.js";
import type { OntologyPluginConfig } from "../config.js";

function makeConnector(schema: SchemaInfo, sampleRows?: Record<string, Record<string, unknown>[]>): DatabaseConnector {
  return {
    id: "test",
    name: "Test",
    connect: vi.fn(),
    disconnect: vi.fn(),
    isConnected: () => true,
    ping: vi.fn().mockResolvedValue(true),
    getSchema: vi.fn().mockResolvedValue(schema),
    query: vi.fn().mockImplementation(async (sql: string) => {
      // Extract table name from "SELECT * FROM ... LIMIT ..."
      const match = sql.match(/FROM\s+(?:\S+\.)*(\S+)\s+LIMIT/i);
      const tableName = match?.[1] ?? "";
      const rows = sampleRows?.[tableName] ?? [];
      return { columns: [], rows, rowCount: rows.length, truncated: false, executionTimeMs: 1 };
    }),
  };
}

function makeApi(assistantYaml: string) {
  const messages = [
    { role: "user", content: "..." },
    { role: "assistant", content: assistantYaml },
  ];
  return {
    id: "ontology",
    name: "Ontology",
    source: "test",
    config: {},
    pluginConfig: {},
    runtime: {
      subagent: {
        run: vi.fn().mockResolvedValue({ runId: "run-1" }),
        waitForRun: vi.fn().mockResolvedValue({ status: "ok" }),
        getSessionMessages: vi.fn().mockResolvedValue({ messages }),
        deleteSession: vi.fn().mockResolvedValue(undefined),
      },
    },
    logger: {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    },
    resolvePath: (p: string) => p,
    registerTool: vi.fn(),
    registerHook: vi.fn(),
    registerHttpRoute: vi.fn(),
    registerChannel: vi.fn(),
    registerGatewayMethod: vi.fn(),
    registerCli: vi.fn(),
    registerService: vi.fn(),
    registerProvider: vi.fn(),
    registerCommand: vi.fn(),
    registerContextEngine: vi.fn(),
    on: vi.fn(),
  } as any;
}

const testConfig: OntologyPluginConfig = {
  ontologyDir: "/tmp/ontologies",
  connector: {
    type: "databricks",
    host: "test.databricks.net",
    path: "/sql/1.0/warehouses/abc",
    token: "dapi123",
    catalog: "main",
    schema: "analytics",
  },
  query: { maxRows: 100, timeoutMs: 30_000, allowRawSql: false },
  context: { autoInject: true, maxEntities: 5, includeMetrics: true, includeSampleValues: false },
};

const testSchema: SchemaInfo = {
  tables: [
    {
      name: "fact_orders",
      columns: [
        { name: "order_id", type: "STRING", nullable: false },
        { name: "customer_id", type: "STRING", nullable: false },
        { name: "total_amount", type: "DECIMAL", nullable: true },
        { name: "order_date", type: "DATE", nullable: true },
      ],
    },
    {
      name: "dim_customers",
      columns: [
        { name: "customer_id", type: "STRING", nullable: false },
        { name: "name", type: "STRING", nullable: true },
        { name: "segment", type: "STRING", nullable: true },
      ],
    },
    {
      name: "staging_temp",
      columns: [
        { name: "id", type: "STRING", nullable: false },
      ],
    },
  ],
};

const sampleYaml = `ontology:
  id: test_ontology
  name: Test Ontology
  version: "1.0"
  description: "Test"

  source:
    connector: databricks
    catalog: main
    schema: analytics

  entities:
    - id: order
      name: Order
      table: fact_orders
      primaryKey: order_id
      columns:
        - name: order_id
          type: string

  relationships: []
  metrics: []
  dimensions: []
`;

describe("discoverOntology", () => {
  it("fetches schema and calls subagent", async () => {
    const connector = makeConnector(testSchema);
    const api = makeApi(sampleYaml);

    const result = await discoverOntology(api, connector, testConfig, {
      id: "test_ontology",
      name: "Test Ontology",
      sampleRows: 0,
    });

    expect(connector.getSchema).toHaveBeenCalledWith("main", "analytics");
    expect(api.runtime.subagent.run).toHaveBeenCalledOnce();
    expect(api.runtime.subagent.waitForRun).toHaveBeenCalledWith({ runId: "run-1", timeoutMs: 120_000 });
    expect(result).toContain("ontology:");
    expect(result).toContain("test_ontology");
  });

  it("filters tables with --include", async () => {
    const connector = makeConnector(testSchema);
    const api = makeApi(sampleYaml);

    await discoverOntology(api, connector, testConfig, {
      include: "fact_*",
      id: "test",
      name: "Test",
      sampleRows: 0,
    });

    const runCall = api.runtime.subagent.run.mock.calls[0][0];
    expect(runCall.message).toContain("fact_orders");
    expect(runCall.message).not.toContain("dim_customers");
    expect(runCall.message).not.toContain("staging_temp");
  });

  it("filters tables with --exclude", async () => {
    const connector = makeConnector(testSchema);
    const api = makeApi(sampleYaml);

    await discoverOntology(api, connector, testConfig, {
      exclude: "staging_*",
      id: "test",
      name: "Test",
      sampleRows: 0,
    });

    const runCall = api.runtime.subagent.run.mock.calls[0][0];
    expect(runCall.message).toContain("fact_orders");
    expect(runCall.message).toContain("dim_customers");
    expect(runCall.message).not.toContain("staging_temp");
  });

  it("combines include and exclude", async () => {
    const connector = makeConnector(testSchema);
    const api = makeApi(sampleYaml);

    await discoverOntology(api, connector, testConfig, {
      include: "*_*",
      exclude: "staging_*",
      id: "test",
      name: "Test",
      sampleRows: 0,
    });

    const runCall = api.runtime.subagent.run.mock.calls[0][0];
    expect(runCall.message).toContain("fact_orders");
    expect(runCall.message).toContain("dim_customers");
    expect(runCall.message).not.toContain("staging_temp");
  });

  it("throws when no tables match filters", async () => {
    const connector = makeConnector(testSchema);
    const api = makeApi(sampleYaml);

    await expect(
      discoverOntology(api, connector, testConfig, {
        include: "nonexistent_*",
        id: "test",
        name: "Test",
        sampleRows: 0,
      }),
    ).rejects.toThrow("No tables matched");
  });

  it("throws on empty schema", async () => {
    const connector = makeConnector({ tables: [] });
    const api = makeApi(sampleYaml);

    await expect(
      discoverOntology(api, connector, testConfig, {
        id: "test",
        name: "Test",
        sampleRows: 0,
      }),
    ).rejects.toThrow("No tables found");
  });

  it("samples rows when sampleRows > 0", async () => {
    const sampleData = {
      fact_orders: [{ order_id: "o1", total_amount: 99.99 }],
      dim_customers: [{ customer_id: "c1", name: "Alice" }],
    };
    const connector = makeConnector(testSchema, sampleData);
    const api = makeApi(sampleYaml);

    await discoverOntology(api, connector, testConfig, {
      id: "test",
      name: "Test",
      sampleRows: 1,
    });

    // Should query each table for samples (3 tables match by default)
    expect(connector.query).toHaveBeenCalled();
    const runCall = api.runtime.subagent.run.mock.calls[0][0];
    expect(runCall.message).toContain("SAMPLE ROWS");
  });

  it("throws on LLM timeout", async () => {
    const connector = makeConnector(testSchema);
    const api = makeApi(sampleYaml);
    api.runtime.subagent.waitForRun.mockResolvedValue({ status: "timeout" });

    await expect(
      discoverOntology(api, connector, testConfig, {
        id: "test",
        name: "Test",
        sampleRows: 0,
      }),
    ).rejects.toThrow("timed out");
  });

  it("extracts YAML from code-fenced response", async () => {
    const fenced = "Here is the ontology:\n\n```yaml\n" + sampleYaml + "```\n\nHope this helps!";
    const connector = makeConnector(testSchema);
    const api = makeApi(fenced);

    const result = await discoverOntology(api, connector, testConfig, {
      id: "test",
      name: "Test",
      sampleRows: 0,
    });

    expect(result).toContain("ontology:");
    expect(result).not.toContain("```");
    expect(result).not.toContain("Hope this helps");
  });

  it("writes to file when --output specified", async () => {
    const connector = makeConnector(testSchema);
    const api = makeApi(sampleYaml);
    const tmpFile = `/tmp/ontology-test-${Date.now()}.yaml`;

    await discoverOntology(api, connector, testConfig, {
      id: "test",
      name: "Test",
      sampleRows: 0,
      output: tmpFile,
    });

    const { readFile, unlink } = await import("node:fs/promises");
    const content = await readFile(tmpFile, "utf-8");
    expect(content).toContain("ontology:");
    await unlink(tmpFile);
  });

  it("overrides catalog and schema", async () => {
    const connector = makeConnector(testSchema);
    const api = makeApi(sampleYaml);

    await discoverOntology(api, connector, testConfig, {
      catalog: "other_catalog",
      schema: "other_schema",
      id: "test",
      name: "Test",
      sampleRows: 0,
    });

    expect(connector.getSchema).toHaveBeenCalledWith("other_catalog", "other_schema");
  });
});
