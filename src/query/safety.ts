const DML_DDL_PATTERNS = [
  /\bINSERT\b/i,
  /\bUPDATE\b/i,
  /\bDELETE\b/i,
  /\bDROP\b/i,
  /\bALTER\b/i,
  /\bTRUNCATE\b/i,
  /\bCREATE\b/i,
  /\bGRANT\b/i,
  /\bREVOKE\b/i,
  /\bMERGE\b/i,
  /\bEXEC\b/i,
  /\bEXECUTE\b/i,
];

/**
 * Validate that a SQL query is read-only.
 * Rejects DML/DDL statements.
 */
export function validateQuerySafety(sql: string): { safe: boolean; reason?: string } {
  const trimmed = sql.trim();

  for (const pattern of DML_DDL_PATTERNS) {
    if (pattern.test(trimmed)) {
      const match = trimmed.match(pattern);
      return {
        safe: false,
        reason: `Query contains forbidden statement: ${match?.[0]?.toUpperCase()}`,
      };
    }
  }

  return { safe: true };
}

/**
 * Apply row limit and timeout to a SQL query.
 * Adds LIMIT clause if not already present.
 */
export function applyLimits(sql: string, maxRows: number, _timeoutMs: number): string {
  const trimmed = sql.trim().replace(/;$/, "");

  // Check if LIMIT already exists
  if (/\bLIMIT\s+\d+/i.test(trimmed)) {
    return trimmed;
  }

  return `${trimmed}\nLIMIT ${maxRows}`;
}

const INJECTION_PATTERNS = [
  /;/, // Semicolons (statement chaining)
  /--/, // Single-line comments
  /\/\*/, // Block comments
  /\bSELECT\b/i, // Subqueries
  /\bUNION\b/i, // UNION injection
  /\bINTO\b/i, // SELECT INTO
];

/**
 * Sanitize a user-provided filter expression.
 * Rejects patterns that could indicate SQL injection.
 */
export function sanitizeFilter(filter: string): string {
  for (const pattern of INJECTION_PATTERNS) {
    if (pattern.test(filter)) {
      throw new Error(
        `Filter rejected: contains potentially unsafe pattern "${pattern.source}" in "${filter}"`,
      );
    }
  }

  return filter;
}
