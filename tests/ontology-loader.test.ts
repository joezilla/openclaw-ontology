import { describe, it, expect, beforeEach } from "vitest";
import { validateOntologyStructure } from "../src/ontology/loader.js";
import type { OntologyDefinition } from "../src/ontology/types.js";

function makeValidOntology(overrides?: Partial<OntologyDefinition>): OntologyDefinition {
  return {
    id: "test",
    name: "Test Ontology",
    version: "1.0",
    description: "Test ontology for unit tests",
    source: {
      connector: "databricks",
      catalog: "main",
      schema: "analytics",
    },
    entities: [
      {
        id: "order",
        name: "Order",
        table: "fact_orders",
        primaryKey: "order_id",
        columns: [
          { name: "order_id", type: "string", description: "Unique order ID" },
          { name: "customer_id", type: "string", foreignKey: "customer.customer_id" },
          { name: "total_amount", type: "decimal" },
          { name: "order_date", type: "date" },
        ],
      },
      {
        id: "customer",
        name: "Customer",
        table: "dim_customers",
        primaryKey: "customer_id",
        columns: [
          { name: "customer_id", type: "string" },
          { name: "segment", type: "string", allowedValues: ["enterprise", "smb", "consumer"] },
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
    ],
    dimensions: [
      {
        id: "time",
        name: "Time",
        entity: "order",
        column: "order_date",
        granularities: ["day", "week", "month", "quarter", "year"],
      },
    ],
    ...overrides,
  };
}

describe("validateOntologyStructure", () => {
  it("returns no errors for a valid ontology", () => {
    const errors = validateOntologyStructure(makeValidOntology());
    expect(errors).toEqual([]);
  });

  it("detects duplicate entity IDs", () => {
    const ontology = makeValidOntology({
      entities: [
        {
          id: "order",
          name: "Order",
          table: "t1",
          primaryKey: "id",
          columns: [{ name: "id", type: "string" }],
        },
        {
          id: "order",
          name: "Order 2",
          table: "t2",
          primaryKey: "id",
          columns: [{ name: "id", type: "string" }],
        },
      ],
    });
    const errors = validateOntologyStructure(ontology);
    expect(errors.some((e) => e.includes("Duplicate entity ID"))).toBe(true);
  });

  it("detects duplicate column names within an entity", () => {
    const ontology = makeValidOntology({
      entities: [
        {
          id: "order",
          name: "Order",
          table: "t1",
          primaryKey: "id",
          columns: [
            { name: "id", type: "string" },
            { name: "id", type: "number" },
          ],
        },
      ],
    });
    const errors = validateOntologyStructure(ontology);
    expect(errors.some((e) => e.includes("Duplicate column"))).toBe(true);
  });

  it("detects relationships referencing non-existent entities", () => {
    const ontology = makeValidOntology({
      relationships: [
        {
          id: "bad_rel",
          from: "nonexistent.col",
          to: "customer.customer_id",
          type: "many_to_one",
        },
      ],
    });
    const errors = validateOntologyStructure(ontology);
    expect(errors.some((e) => e.includes("nonexistent"))).toBe(true);
  });

  it("detects metrics referencing non-existent entities", () => {
    const ontology = makeValidOntology({
      metrics: [
        {
          id: "bad_metric",
          name: "Bad",
          entity: "nonexistent",
          expression: "COUNT(*)",
        },
      ],
    });
    const errors = validateOntologyStructure(ontology);
    expect(errors.some((e) => e.includes("nonexistent"))).toBe(true);
  });

  it("detects dimensions referencing non-existent columns", () => {
    const ontology = makeValidOntology({
      dimensions: [
        {
          id: "bad_dim",
          name: "Bad",
          entity: "order",
          column: "nonexistent_col",
        },
      ],
    });
    const errors = validateOntologyStructure(ontology);
    expect(errors.some((e) => e.includes("nonexistent_col"))).toBe(true);
  });

  it("detects foreign keys referencing non-existent targets", () => {
    const ontology = makeValidOntology({
      entities: [
        {
          id: "order",
          name: "Order",
          table: "t1",
          primaryKey: "id",
          columns: [
            { name: "id", type: "string" },
            { name: "ref", type: "string", foreignKey: "ghost.ghost_id" },
          ],
        },
      ],
    });
    const errors = validateOntologyStructure(ontology);
    expect(errors.some((e) => e.includes("ghost"))).toBe(true);
  });
});
