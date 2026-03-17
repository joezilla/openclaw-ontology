import { describe, it, expect } from "vitest";
import { validateQuerySafety, applyLimits, sanitizeFilter } from "../src/query/safety.js";

describe("validateQuerySafety", () => {
  it("allows SELECT queries", () => {
    const result = validateQuerySafety("SELECT * FROM orders WHERE id = 1");
    expect(result.safe).toBe(true);
  });

  it("allows WITH (CTE) queries", () => {
    const result = validateQuerySafety(
      "WITH cte AS (SELECT * FROM orders) SELECT * FROM cte",
    );
    expect(result.safe).toBe(true);
  });

  it("rejects INSERT statements", () => {
    const result = validateQuerySafety("INSERT INTO orders VALUES (1, 'test')");
    expect(result.safe).toBe(false);
    expect(result.reason).toContain("INSERT");
  });

  it("rejects UPDATE statements", () => {
    const result = validateQuerySafety("UPDATE orders SET status = 'cancelled'");
    expect(result.safe).toBe(false);
  });

  it("rejects DELETE statements", () => {
    const result = validateQuerySafety("DELETE FROM orders WHERE id = 1");
    expect(result.safe).toBe(false);
  });

  it("rejects DROP statements", () => {
    const result = validateQuerySafety("DROP TABLE orders");
    expect(result.safe).toBe(false);
  });

  it("rejects ALTER statements", () => {
    const result = validateQuerySafety("ALTER TABLE orders ADD COLUMN new_col INT");
    expect(result.safe).toBe(false);
  });

  it("rejects TRUNCATE statements", () => {
    const result = validateQuerySafety("TRUNCATE TABLE orders");
    expect(result.safe).toBe(false);
  });

  it("rejects CREATE statements", () => {
    const result = validateQuerySafety("CREATE TABLE evil (id INT)");
    expect(result.safe).toBe(false);
  });

  it("rejects GRANT statements", () => {
    const result = validateQuerySafety("GRANT ALL ON orders TO public");
    expect(result.safe).toBe(false);
  });

  it("rejects case-insensitive DML", () => {
    const result = validateQuerySafety("insert INTO orders VALUES (1)");
    expect(result.safe).toBe(false);
  });
});

describe("applyLimits", () => {
  it("adds LIMIT when missing", () => {
    const sql = applyLimits("SELECT * FROM orders", 100, 30000);
    expect(sql).toContain("LIMIT 100");
  });

  it("does not add LIMIT when already present", () => {
    const sql = applyLimits("SELECT * FROM orders LIMIT 50", 100, 30000);
    expect(sql).not.toContain("LIMIT 100");
    expect(sql).toContain("LIMIT 50");
  });

  it("respects lower existing LIMIT", () => {
    const sql = applyLimits("SELECT * FROM orders LIMIT 10", 100, 30000);
    expect(sql).toContain("LIMIT 10");
  });
});

describe("sanitizeFilter", () => {
  it("allows simple comparison filters", () => {
    const result = sanitizeFilter("order_date >= '2025-01-01'");
    expect(result).toBe("order_date >= '2025-01-01'");
  });

  it("allows IN clauses", () => {
    const result = sanitizeFilter("status IN ('active', 'pending')");
    expect(result).toBe("status IN ('active', 'pending')");
  });

  it("rejects semicolons", () => {
    expect(() => sanitizeFilter("1=1; DROP TABLE orders")).toThrow();
  });

  it("rejects SQL comments", () => {
    expect(() => sanitizeFilter("1=1 -- comment")).toThrow();
  });

  it("rejects block comments", () => {
    expect(() => sanitizeFilter("1=1 /* evil */")).toThrow();
  });

  it("rejects subqueries", () => {
    expect(() => sanitizeFilter("id IN (SELECT id FROM admin)")).toThrow();
  });
});
