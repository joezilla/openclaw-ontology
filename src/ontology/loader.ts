import fs from "node:fs";
import path from "node:path";
import yaml from "js-yaml";
import type { OntologyDefinition, OntologyFile } from "./types.js";

/**
 * Load and parse a single ontology YAML file.
 */
export async function loadOntologyFile(filePath: string): Promise<OntologyDefinition> {
  const content = await fs.promises.readFile(filePath, "utf-8");
  const parsed = yaml.load(content) as OntologyFile;

  if (!parsed || !parsed.ontology) {
    throw new Error(`Invalid ontology file: ${filePath} (missing top-level "ontology" key)`);
  }

  const def = parsed.ontology;

  if (!def.id || typeof def.id !== "string") {
    throw new Error(`Ontology in ${filePath} is missing required "id" field`);
  }
  if (!def.name || typeof def.name !== "string") {
    throw new Error(`Ontology in ${filePath} is missing required "name" field`);
  }
  if (!def.version || typeof def.version !== "string") {
    throw new Error(`Ontology in ${filePath} is missing required "version" field`);
  }
  if (!def.source || typeof def.source !== "object") {
    throw new Error(`Ontology in ${filePath} is missing required "source" field`);
  }

  // Normalize arrays
  def.entities = def.entities ?? [];
  def.relationships = def.relationships ?? [];
  def.metrics = def.metrics ?? [];
  def.dimensions = def.dimensions ?? [];

  return def;
}

/**
 * Load all ontology YAML files from a directory.
 */
export async function loadOntologyDir(dirPath: string): Promise<OntologyDefinition[]> {
  if (!fs.existsSync(dirPath)) {
    return [];
  }

  const entries = await fs.promises.readdir(dirPath);
  const yamlFiles = entries.filter(
    (f) => f.endsWith(".yaml") || f.endsWith(".yml"),
  );

  const definitions: OntologyDefinition[] = [];
  for (const file of yamlFiles) {
    const def = await loadOntologyFile(path.join(dirPath, file));
    definitions.push(def);
  }

  return definitions;
}

/**
 * Validate ontology structure (no DB connection needed).
 * Returns array of error strings -- empty means valid.
 */
export function validateOntologyStructure(def: OntologyDefinition): string[] {
  const errors: string[] = [];

  // Build entity lookup
  const entityIds = new Set<string>();
  const entityColumns = new Map<string, Set<string>>();

  for (const entity of def.entities) {
    if (entityIds.has(entity.id)) {
      errors.push(`Duplicate entity ID: "${entity.id}"`);
    }
    entityIds.add(entity.id);

    const colNames = new Set<string>();
    for (const col of entity.columns) {
      if (colNames.has(col.name)) {
        errors.push(`Duplicate column "${col.name}" in entity "${entity.id}"`);
      }
      colNames.add(col.name);
    }
    entityColumns.set(entity.id, colNames);

    // Check primary key exists in columns
    if (!colNames.has(entity.primaryKey)) {
      errors.push(
        `Entity "${entity.id}": primaryKey "${entity.primaryKey}" not found in columns`,
      );
    }

    // Check foreign key targets
    for (const col of entity.columns) {
      if (col.foreignKey) {
        const [targetEntity, targetCol] = col.foreignKey.split(".");
        if (!targetEntity || !targetCol) {
          errors.push(
            `Entity "${entity.id}", column "${col.name}": invalid foreignKey format "${col.foreignKey}" (expected "entity.column")`,
          );
        }
      }
    }
  }

  // Validate foreign key targets exist (second pass after all entities loaded)
  for (const entity of def.entities) {
    for (const col of entity.columns) {
      if (col.foreignKey) {
        const [targetEntity, targetCol] = col.foreignKey.split(".");
        if (!entityIds.has(targetEntity)) {
          errors.push(
            `Entity "${entity.id}", column "${col.name}": foreignKey references unknown entity "${targetEntity}"`,
          );
        } else if (targetCol && !entityColumns.get(targetEntity)?.has(targetCol)) {
          errors.push(
            `Entity "${entity.id}", column "${col.name}": foreignKey references unknown column "${targetEntity}.${targetCol}"`,
          );
        }
      }
    }
  }

  // Validate relationships
  for (const rel of def.relationships) {
    const [fromEntity, fromCol] = rel.from.split(".");
    const [toEntity, toCol] = rel.to.split(".");

    if (!entityIds.has(fromEntity)) {
      errors.push(`Relationship "${rel.id}": "from" references unknown entity "${fromEntity}"`);
    } else if (fromCol && !entityColumns.get(fromEntity)?.has(fromCol)) {
      errors.push(
        `Relationship "${rel.id}": "from" references unknown column "${fromEntity}.${fromCol}"`,
      );
    }

    if (!entityIds.has(toEntity)) {
      errors.push(`Relationship "${rel.id}": "to" references unknown entity "${toEntity}"`);
    } else if (toCol && !entityColumns.get(toEntity)?.has(toCol)) {
      errors.push(
        `Relationship "${rel.id}": "to" references unknown column "${toEntity}.${toCol}"`,
      );
    }
  }

  // Validate metrics
  for (const metric of def.metrics) {
    if (!entityIds.has(metric.entity)) {
      errors.push(`Metric "${metric.id}": references unknown entity "${metric.entity}"`);
    }
  }

  // Validate dimensions
  for (const dim of def.dimensions) {
    if (!entityIds.has(dim.entity)) {
      errors.push(`Dimension "${dim.id}": references unknown entity "${dim.entity}"`);
    } else if (!entityColumns.get(dim.entity)?.has(dim.column)) {
      errors.push(
        `Dimension "${dim.id}": references unknown column "${dim.column}" in entity "${dim.entity}"`,
      );
    }
  }

  return errors;
}
