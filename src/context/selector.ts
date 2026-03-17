import type { OntologyGraph } from "../ontology/types.js";

/**
 * Select ontology graphs most relevant to the user's prompt.
 * Uses keyword matching against entity names, descriptions, metrics, dimensions.
 */
export function selectRelevantEntities(
  graphs: OntologyGraph[],
  userPrompt: string,
  maxEntities: number,
): OntologyGraph[] {
  if (graphs.length === 0) {
    return [];
  }

  const promptLower = userPrompt.toLowerCase();
  const promptWords = promptLower.split(/\s+/).filter((w) => w.length > 2);

  const scored: Array<{ graph: OntologyGraph; score: number }> = [];

  for (const graph of graphs) {
    let score = 0;
    const def = graph.definition;

    // Match against ontology name/description
    score += matchScore(def.name, promptWords);
    if (def.description) {
      score += matchScore(def.description, promptWords);
    }

    // Match against entities
    for (const entity of def.entities) {
      score += matchScore(entity.name, promptWords);
      score += matchScore(entity.id, promptWords);
      if (entity.description) {
        score += matchScore(entity.description, promptWords) * 0.5;
      }
    }

    // Match against metrics
    for (const metric of def.metrics) {
      score += matchScore(metric.name, promptWords) * 1.5; // Metrics are high-signal
      score += matchScore(metric.id, promptWords) * 1.5;
    }

    // Match against dimensions
    for (const dim of def.dimensions) {
      score += matchScore(dim.name, promptWords);
      score += matchScore(dim.id, promptWords);
    }

    if (score > 0) {
      scored.push({ graph, score });
    }
  }

  // Sort by score descending, take top N
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, maxEntities).map((s) => s.graph);
}

function matchScore(text: string, promptWords: string[]): number {
  const lower = text.toLowerCase();
  let score = 0;
  for (const word of promptWords) {
    if (lower.includes(word)) {
      score += 1;
    }
  }
  return score;
}
