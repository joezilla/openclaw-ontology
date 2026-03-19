import { describe, it, expect, vi } from "vitest";
import { buildOntologyGraph } from "../src/ontology/resolver.js";
import { planQuery } from "../src/query/planner.js";
import { formatResultAsMarkdown, formatResultAsJson } from "../src/query/executor.js";
import type { OntologyDefinition } from "../src/ontology/types.js";
import type { QueryResult } from "../src/connectors/types.js";

const testOntology: OntologyDefinition = {
  id: "test",
  name: "Test",
  version: "1.0",
  source: { connector: "databricks" },
  entities: [
    {
      id: "order",
      name: "Order",
      table: "orders",
      primaryKey: "id",
      columns: [
        { name: "id", type: "string" },
        { name: "amount", type: "decimal" },
        { name: "date", type: "date" },
      ],
    },
  ],
  relationships: [],
  metrics: [
    {
      id: "total",
      name: "Total",
      entity: "order",
      expression: "SUM(amount)",
    },
  ],
  dimensions: [
    {
      id: "by_date",
      name: "By Date",
      entity: "order",
      column: "date",
    },
  ],
};

describe("formatResultAsMarkdown", () => {
  it("formats query result as markdown table", () => {
    const result: QueryResult = {
      columns: [
        { name: "date", type: "date" },
        { name: "total", type: "decimal" },
      ],
      rows: [
        { date: "2025-01-01", total: 1500.5 },
        { date: "2025-01-02", total: 2300.0 },
      ],
      rowCount: 2,
      truncated: false,
      executionTimeMs: 150,
    };

    const md = formatResultAsMarkdown(result);
    expect(md).toContain("| date |");
    expect(md).toContain("| total |");
    expect(md).toContain("2025-01-01");
    expect(md).toContain("1500.5");
    expect(md).toContain("2 rows");
  });

  it("indicates truncation", () => {
    const result: QueryResult = {
      columns: [{ name: "id", type: "string" }],
      rows: [{ id: "1" }],
      rowCount: 1,
      truncated: true,
      executionTimeMs: 50,
    };

    const md = formatResultAsMarkdown(result);
    expect(md).toContain("truncated");
  });
});

describe("formatResultAsJson", () => {
  it("formats result as JSON string", () => {
    const result: QueryResult = {
      columns: [{ name: "id", type: "string" }],
      rows: [{ id: "1" }, { id: "2" }],
      rowCount: 2,
      truncated: false,
      executionTimeMs: 50,
    };

    const json = formatResultAsJson(result);
    const parsed = JSON.parse(json);
    expect(parsed.rows).toHaveLength(2);
    expect(parsed.rowCount).toBe(2);
  });
});

describe("end-to-end plan + format", () => {
  it("plans a query and formats mock results", () => {
    const graph = buildOntologyGraph(testOntology);
    const plan = planQuery(graph, {
      entityId: "order",
      metrics: ["total"],
      dimensions: ["by_date"],
    });

    expect(plan.sql).toContain("SUM(e1.amount)");
    expect(plan.sql).toContain("orders");

    // Mock result that such a query would return
    const mockResult: QueryResult = {
      columns: [
        { name: "date", type: "date" },
        { name: "total", type: "decimal" },
      ],
      rows: [{ date: "2025-01-01", total: 5000 }],
      rowCount: 1,
      truncated: false,
      executionTimeMs: 200,
    };

    const md = formatResultAsMarkdown(mockResult);
    expect(md).toContain("5000");
  });
});
