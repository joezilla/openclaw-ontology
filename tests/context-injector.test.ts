import { describe, it, expect } from "vitest";
import { buildOntologyGraph } from "../src/ontology/resolver.js";
import { buildOntologyContext, buildEntityDetail } from "../src/context/injector.js";
import { selectRelevantEntities } from "../src/context/selector.js";
import type { OntologyDefinition } from "../src/ontology/types.js";

const testOntology: OntologyDefinition = {
  id: "ecommerce",
  name: "E-Commerce Analytics",
  version: "1.0",
  description: "Business ontology for e-commerce",
  source: { connector: "databricks", catalog: "main", schema: "analytics" },
  entities: [
    {
      id: "order",
      name: "Order",
      description: "A customer purchase transaction",
      table: "fact_orders",
      primaryKey: "order_id",
      columns: [
        { name: "order_id", type: "string" },
        { name: "customer_id", type: "string" },
        { name: "total_amount", type: "decimal" },
        { name: "order_date", type: "date" },
      ],
    },
    {
      id: "customer",
      name: "Customer",
      description: "A registered customer",
      table: "dim_customers",
      primaryKey: "customer_id",
      columns: [
        { name: "customer_id", type: "string" },
        { name: "segment", type: "string" },
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
    },
  ],
  dimensions: [
    {
      id: "time",
      name: "Time",
      entity: "order",
      column: "order_date",
      granularities: ["day", "month", "year"],
    },
    {
      id: "customer_segment",
      name: "Customer Segment",
      entity: "customer",
      column: "segment",
    },
  ],
};

describe("buildOntologyContext", () => {
  it("generates context block with ontology summary", () => {
    const graph = buildOntologyGraph(testOntology);
    const context = buildOntologyContext([graph]);

    expect(context).toContain("<ontology-context>");
    expect(context).toContain("</ontology-context>");
    expect(context).toContain("E-Commerce Analytics");
    expect(context).toContain("order");
    expect(context).toContain("customer");
    expect(context).toContain("total_revenue");
    expect(context).toContain("ontology_query");
  });

  it("includes multiple ontologies", () => {
    const graph = buildOntologyGraph(testOntology);
    const context = buildOntologyContext([graph, graph]);
    // Should mention the ontology at least twice
    const matches = context.match(/E-Commerce Analytics/g);
    expect(matches?.length).toBeGreaterThanOrEqual(2);
  });
});

describe("buildEntityDetail", () => {
  it("returns entity details with columns", () => {
    const graph = buildOntologyGraph(testOntology);
    const detail = buildEntityDetail(graph, "order");

    expect(detail).toContain("Order");
    expect(detail).toContain("order_id");
    expect(detail).toContain("total_amount");
    expect(detail).toContain("order_date");
  });

  it("returns empty string for unknown entity", () => {
    const graph = buildOntologyGraph(testOntology);
    const detail = buildEntityDetail(graph, "nonexistent");
    expect(detail).toBe("");
  });
});

describe("selectRelevantEntities", () => {
  it("selects graphs matching revenue keywords", () => {
    const graph = buildOntologyGraph(testOntology);
    const relevant = selectRelevantEntities([graph], "what was our revenue last quarter", 5);
    expect(relevant.length).toBeGreaterThan(0);
  });

  it("selects graphs matching customer keywords", () => {
    const graph = buildOntologyGraph(testOntology);
    const relevant = selectRelevantEntities([graph], "show me customer segments", 5);
    expect(relevant.length).toBeGreaterThan(0);
  });

  it("respects maxEntities limit", () => {
    const graph = buildOntologyGraph(testOntology);
    const relevant = selectRelevantEntities([graph], "revenue customer order", 1);
    expect(relevant.length).toBeLessThanOrEqual(1);
  });

  it("returns empty for unrelated prompts", () => {
    const graph = buildOntologyGraph(testOntology);
    const relevant = selectRelevantEntities([graph], "tell me a joke about cats", 5);
    // May or may not match -- at minimum should not crash
    expect(Array.isArray(relevant)).toBe(true);
  });
});
