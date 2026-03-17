import { describe, it, expect } from "vitest";
import { getAvailableConnectors, createConnector } from "../src/connectors/registry.js";

// Import to trigger registration
import "../src/connectors/databricks.js";

describe("connector registry", () => {
  it("has databricks registered", () => {
    const available = getAvailableConnectors();
    expect(available).toContain("databricks");
  });

  it("creates a databricks connector", () => {
    const connector = createConnector("databricks");
    expect(connector.id).toBe("databricks");
    expect(connector.name).toBe("Databricks SQL");
    expect(connector.isConnected()).toBe(false);
  });

  it("throws for unknown connector type", () => {
    expect(() => createConnector("unknown")).toThrow("Unknown connector type");
  });
});

describe("databricks connector (unit)", () => {
  it("starts disconnected", () => {
    const connector = createConnector("databricks");
    expect(connector.isConnected()).toBe(false);
  });

  it("ping returns false when disconnected", async () => {
    const connector = createConnector("databricks");
    const result = await connector.ping();
    expect(result).toBe(false);
  });

  it("query rejects when disconnected", async () => {
    const connector = createConnector("databricks");
    await expect(connector.query("SELECT 1")).rejects.toThrow("Not connected");
  });

  it("getSchema rejects when disconnected", async () => {
    const connector = createConnector("databricks");
    await expect(connector.getSchema()).rejects.toThrow("Not connected");
  });
});
