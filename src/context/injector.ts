import type { OntologyGraph } from "../ontology/types.js";

/**
 * Build the ontology context block for agent system prompt injection.
 */
export function buildOntologyContext(graphs: OntologyGraph[]): string {
  const sections: string[] = [];

  for (const graph of graphs) {
    const def = graph.definition;
    const entityNames = def.entities.map((e) => e.id).join(", ");
    const metricNames = def.metrics.map((m) => m.id).join(", ");

    const dimParts = def.dimensions.map((d) => {
      const granStr = d.granularities ? ` (${d.granularities.join("/")})` : "";
      return `${d.id}${granStr}`;
    });
    const dimNames = dimParts.join(", ");

    const lines = [
      `- ${def.name} (${def.id})`,
    ];
    if (entityNames) {
      lines.push(`  Entities: ${entityNames}`);
    }
    if (metricNames) {
      lines.push(`  Metrics: ${metricNames}`);
    }
    if (dimNames) {
      lines.push(`  Dimensions: ${dimNames}`);
    }

    sections.push(lines.join("\n"));
  }

  return [
    "<ontology-context>",
    "Available data domains:",
    ...sections,
    "Use ontology_query to query data. Use ontology_explore/ontology_describe for discovery.",
    "</ontology-context>",
  ].join("\n");
}

/**
 * Build detailed description of a specific entity.
 */
export function buildEntityDetail(graph: OntologyGraph, entityId: string): string {
  const entity = graph.entityMap.get(entityId);
  if (!entity) {
    return "";
  }

  const lines = [
    `Entity: ${entity.name} (${entity.id})`,
    `Table: ${entity.table}`,
    `Primary Key: ${entity.primaryKey}`,
  ];

  if (entity.description) {
    lines.push(`Description: ${entity.description}`);
  }

  lines.push("", "Columns:");
  for (const col of entity.columns) {
    let colLine = `  - ${col.name} (${col.type})`;
    if (col.description) {
      colLine += ` -- ${col.description}`;
    }
    if (col.foreignKey) {
      colLine += ` [FK -> ${col.foreignKey}]`;
    }
    if (col.allowedValues) {
      colLine += ` [values: ${col.allowedValues.join(", ")}]`;
    }
    lines.push(colLine);
  }

  // Related metrics
  const relatedMetrics = [...graph.metricMap.values()].filter(
    (m) => m.entity === entityId,
  );
  if (relatedMetrics.length > 0) {
    lines.push("", "Metrics:");
    for (const m of relatedMetrics) {
      lines.push(`  - ${m.name} (${m.id}): ${m.expression}`);
    }
  }

  // Related dimensions
  const relatedDims = [...graph.dimensionMap.values()].filter(
    (d) => d.entity === entityId,
  );
  if (relatedDims.length > 0) {
    lines.push("", "Dimensions:");
    for (const d of relatedDims) {
      const gran = d.granularities ? ` [${d.granularities.join(", ")}]` : "";
      lines.push(`  - ${d.name} (${d.column})${gran}`);
    }
  }

  // Relationships
  const relatedJoins = graph.joins.filter(
    (j) => j.fromEntity === entityId || j.toEntity === entityId,
  );
  if (relatedJoins.length > 0) {
    lines.push("", "Relationships:");
    for (const j of relatedJoins) {
      const desc = j.relationship.description ?? `${j.fromEntity} -> ${j.toEntity}`;
      lines.push(`  - ${j.relationship.id}: ${desc}`);
    }
  }

  return lines.join("\n");
}
