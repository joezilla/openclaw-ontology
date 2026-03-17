import type { DatabaseConnector } from "./types.js";

export type ConnectorFactory = (id: string) => DatabaseConnector;

const registry = new Map<string, ConnectorFactory>();

/**
 * Register a connector factory for a given type.
 */
export function registerConnector(type: string, factory: ConnectorFactory): void {
  registry.set(type, factory);
}

/**
 * Create a connector instance by type.
 */
export function createConnector(type: string, id?: string): DatabaseConnector {
  const factory = registry.get(type);
  if (!factory) {
    throw new Error(`Unknown connector type: "${type}". Available: ${getAvailableConnectors().join(", ")}`);
  }
  return factory(id ?? type);
}

/**
 * List all registered connector types.
 */
export function getAvailableConnectors(): string[] {
  return [...registry.keys()];
}
