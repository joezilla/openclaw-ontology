export type ColumnType = "string" | "number" | "decimal" | "integer" | "boolean" | "date" | "timestamp";
export type RelationshipType = "one_to_one" | "one_to_many" | "many_to_one" | "many_to_many";
export type TimeGranularity = "day" | "week" | "month" | "quarter" | "year";

export type OntologyColumn = {
  name: string;
  type: ColumnType;
  description?: string;
  foreignKey?: string; // entity.column reference
  allowedValues?: string[];
};

export type OntologyEntity = {
  id: string;
  name: string;
  description?: string;
  table: string;
  primaryKey: string;
  columns: OntologyColumn[];
};

export type OntologyRelationship = {
  id: string;
  from: string; // entity.column
  to: string; // entity.column
  type: RelationshipType;
  description?: string;
};

export type OntologyMetric = {
  id: string;
  name: string;
  description?: string;
  entity: string;
  expression: string;
  filters?: string[];
};

export type OntologyDimension = {
  id: string;
  name: string;
  entity: string;
  column: string;
  granularities?: TimeGranularity[];
};

export type OntologySource = {
  connector: string;
  catalog?: string;
  schema?: string;
};

export type OntologyDefinition = {
  id: string;
  name: string;
  version: string;
  description?: string;
  source: OntologySource;
  entities: OntologyEntity[];
  relationships: OntologyRelationship[];
  metrics: OntologyMetric[];
  dimensions: OntologyDimension[];
};

export type OntologyFile = {
  ontology: OntologyDefinition;
};

// Resolved graph structures

export type ResolvedJoin = {
  fromEntity: string;
  fromColumn: string;
  toEntity: string;
  toColumn: string;
  relationship: OntologyRelationship;
};

export type OntologyGraph = {
  definition: OntologyDefinition;
  entityMap: Map<string, OntologyEntity>;
  metricMap: Map<string, OntologyMetric>;
  dimensionMap: Map<string, OntologyDimension>;
  joins: ResolvedJoin[];
  adjacency: Map<string, Set<string>>; // entity -> connected entities
};
