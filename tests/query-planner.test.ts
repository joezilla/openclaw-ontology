import { describe, it, expect } from "vitest";
import { buildOntologyGraph } from "../src/ontology/resolver.js";
import { planQuery } from "../src/query/planner.js";
import type { OntologyDefinition } from "../src/ontology/types.js";

const testOntology: OntologyDefinition = {
  id: "ecommerce",
  name: "E-Commerce",
  version: "1.0",
  source: { connector: "databricks", catalog: "main", schema: "analytics" },
  entities: [
    {
      id: "order",
      name: "Order",
      table: "fact_orders",
      primaryKey: "order_id",
      columns: [
        { name: "order_id", type: "string" },
        { name: "customer_id", type: "string" },
        { name: "total_amount", type: "decimal" },
        { name: "order_date", type: "date" },
        { name: "status", type: "string" },
      ],
    },
    {
      id: "customer",
      name: "Customer",
      table: "dim_customers",
      primaryKey: "customer_id",
      columns: [
        { name: "customer_id", type: "string" },
        { name: "segment", type: "string" },
        { name: "name", type: "string" },
      ],
    },
  ],
  relationships: [
    {
      id: "order_customer",
      from: "order.customer_id",
      to: "customer.customer_id",
      type: "many_to_one",
    },
  ],
  metrics: [
    {
      id: "total_revenue",
      name: "Total Revenue",
      entity: "order",
      expression: "SUM(total_amount)",
      filters: ["status != 'cancelled'"],
    },
    {
      id: "avg_order_value",
      name: "Average Order Value",
      entity: "order",
      expression: "AVG(total_amount)",
    },
  ],
  dimensions: [
    {
      id: "time",
      name: "Time",
      entity: "order",
      column: "order_date",
      granularities: ["day", "week", "month", "quarter", "year"],
    },
    {
      id: "customer_segment",
      name: "Customer Segment",
      entity: "customer",
      column: "segment",
    },
  ],
};

describe("planQuery", () => {
  const graph = buildOntologyGraph(testOntology);

  it("generates SQL for a simple metric query", () => {
    const plan = planQuery(graph, {
      entityId: "order",
      metrics: ["total_revenue"],
    });

    expect(plan.sql).toContain("SUM(e1.total_amount)");
    expect(plan.sql).toContain("fact_orders");
    expect(plan.sql).toContain("status != 'cancelled'");
  });

  it("generates SQL with dimensions and GROUP BY", () => {
    const plan = planQuery(graph, {
      entityId: "order",
      metrics: ["total_revenue"],
      dimensions: ["time"],
    });

    expect(plan.sql).toContain("GROUP BY");
    expect(plan.sql).toContain("order_date");
  });

  it("generates SQL with cross-entity dimension join", () => {
    const plan = planQuery(graph, {
      entityId: "order",
      metrics: ["total_revenue"],
      dimensions: ["customer_segment"],
    });

    expect(plan.sql).toContain("JOIN");
    expect(plan.sql).toContain("dim_customers");
    expect(plan.sql).toContain("segment");
    expect(plan.joins.length).toBeGreaterThan(0);
  });

  it("applies user filters", () => {
    const plan = planQuery(graph, {
      entityId: "order",
      metrics: ["total_revenue"],
      filters: ["order_date >= '2025-01-01'"],
    });

    expect(plan.sql).toContain("order_date >= '2025-01-01'");
  });

  it("applies LIMIT when specified", () => {
    const plan = planQuery(graph, {
      entityId: "order",
      metrics: ["total_revenue"],
      limit: 50,
    });

    expect(plan.sql).toContain("LIMIT 50");
  });

  it("generates SQL with time granularity", () => {
    const plan = planQuery(graph, {
      entityId: "order",
      metrics: ["total_revenue"],
      dimensions: ["time:month"],
    });

    expect(plan.sql).toContain("DATE_TRUNC('month', e1.order_date)");
    expect(plan.sql).toContain("AS order_date_month");
    expect(plan.sql).toContain("GROUP BY DATE_TRUNC('month', e1.order_date)");
  });

  it("rejects invalid granularity", () => {
    expect(() =>
      planQuery(graph, {
        entityId: "order",
        metrics: ["total_revenue"],
        dimensions: ["time:yearly"],
      }),
    ).toThrow('Invalid granularity "yearly" for dimension "time"');
  });

  it("rejects granularity on non-temporal dimension", () => {
    expect(() =>
      planQuery(graph, {
        entityId: "order",
        metrics: ["total_revenue"],
        dimensions: ["customer_segment:month"],
      }),
    ).toThrow('Dimension "customer_segment" does not support granularities');
  });

  it("works with granularity and cross-entity join", () => {
    const plan = planQuery(graph, {
      entityId: "order",
      metrics: ["total_revenue"],
      dimensions: ["time:quarter", "customer_segment"],
    });

    expect(plan.sql).toContain("DATE_TRUNC('quarter', e1.order_date)");
    expect(plan.sql).toContain("AS order_date_quarter");
    expect(plan.sql).toContain("JOIN");
    expect(plan.sql).toContain("dim_customers");
    expect(plan.sql).toContain("segment");
    expect(plan.joins.length).toBeGreaterThan(0);
  });

  it("includes explanation in the plan", () => {
    const plan = planQuery(graph, {
      entityId: "order",
      metrics: ["total_revenue"],
      dimensions: ["customer_segment"],
    });

    expect(plan.explanation).toBeTruthy();
    expect(plan.explanation.length).toBeGreaterThan(0);
  });
});
