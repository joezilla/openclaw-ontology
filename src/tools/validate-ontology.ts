import { Type } from "@sinclair/typebox";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import type { OntologyGraph } from "../ontology/types.js";
import type { DatabaseConnector } from "../connectors/types.js";
import { validateOntologyStructure } from "../ontology/loader.js";
import { validateAgainstSchema } from "../ontology/validator.js";

export function registerValidateTool(
  api: OpenClawPluginApi,
  getGraphs: () => OntologyGraph[],
  connector: DatabaseConnector,
): void {
  api.registerTool(
    {
      name: "ontology_validate",
      label: "Validate Ontology",
      description:
        "Validate an ontology definition against the live database schema. Checks that tables, columns, and types exist and match. Useful for catching drift between ontology definitions and actual database structure.",
      parameters: Type.Object({
        ontologyId: Type.Optional(
          Type.String({ description: "Ontology ID to validate (omit to validate all)" }),
        ),
      }),
      async execute(_toolCallId, params) {
        const { ontologyId } = params as { ontologyId?: string };
        const graphs = getGraphs();

        if (graphs.length === 0) {
          return {
            content: [{ type: "text", text: "No ontologies loaded." }],
            details: { error: "no_ontologies" },
          };
        }

        const toValidate = ontologyId
          ? graphs.filter((g) => g.definition.id === ontologyId)
          : graphs;

        if (toValidate.length === 0) {
          return {
            content: [{ type: "text", text: `Ontology "${ontologyId}" not found.` }],
            details: { error: "ontology_not_found" },
          };
        }

        const results: string[] = [];

        for (const graph of toValidate) {
          const def = graph.definition;
          results.push(`## ${def.name} (${def.id})`);

          // Structural validation (no DB needed)
          const structErrors = validateOntologyStructure(def);
          if (structErrors.length > 0) {
            results.push("**Structural errors:**");
            for (const err of structErrors) {
              results.push(`- ${err}`);
            }
          }

          // Schema validation (requires DB)
          if (connector.isConnected()) {
            try {
              const schemaResult = await validateAgainstSchema(def, connector);
              if (schemaResult.errors.length > 0) {
                results.push("**Schema errors:**");
                for (const err of schemaResult.errors) {
                  results.push(`- ${err}`);
                }
              }
              if (schemaResult.warnings.length > 0) {
                results.push("**Schema warnings:**");
                for (const warn of schemaResult.warnings) {
                  results.push(`- ${warn}`);
                }
              }
              if (schemaResult.valid && structErrors.length === 0) {
                results.push("Valid -- all tables and columns match.");
              }
            } catch (err) {
              results.push(`**Schema validation failed:** ${String(err)}`);
            }
          } else {
            if (structErrors.length === 0) {
              results.push("Structural validation passed. Connect to database for full schema validation.");
            }
          }

          results.push("");
        }

        return {
          content: [{ type: "text", text: results.join("\n") }],
          details: { validated: toValidate.length },
        };
      },
    },
    { name: "ontology_validate" },
  );
}
