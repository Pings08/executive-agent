/**
 * D1 Database client for Cloudflare D1.
 *
 * In Cloudflare Pages, the D1 binding is available via getRequestContext().
 * In local development with wrangler, it's injected automatically.
 *
 * For Next.js API routes running outside Cloudflare (e.g., local dev without wrangler),
 * we fall back to the D1 REST API via CLOUDFLARE_D1_* env vars.
 */

let _db: D1Database | null = null;

export function getDb(): D1Database {
  if (_db) return _db;

  // Try @opennextjs/cloudflare context (recommended for Next.js on Cloudflare)
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { getCloudflareContext } = require('@opennextjs/cloudflare');
    const ctx = getCloudflareContext();
    if (ctx?.env?.DB) {
      return ctx.env.DB as D1Database;
    }
  } catch {
    // Not in OpenNext context
  }

  // Fallback: try globalThis bindings (wrangler dev injects these)
  const g = globalThis as Record<string, unknown>;
  if (g.DB) {
    _db = g.DB as D1Database;
    return _db!;
  }

  throw new Error(
    'D1 database not available. Run with `wrangler pages dev` or deploy to Cloudflare Pages.'
  );
}

/**
 * Helper: generate a UUID for primary keys (replaces Supabase uuid_generate_v4())
 */
export function newId(): string {
  return crypto.randomUUID();
}

/**
 * Helper: get current ISO timestamp (replaces Supabase NOW())
 */
export function now(): string {
  return new Date().toISOString();
}

/**
 * Helper: parse a JSON TEXT column value, returning null on failure
 */
export function parseJson<T>(value: string | null | undefined): T | null {
  if (!value) return null;
  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
}

/**
 * Helper: safely stringify a value for a JSON TEXT column
 */
export function toJson(value: unknown): string {
  return JSON.stringify(value ?? null);
}

/**
 * Helper: build a placeholders string for IN clauses: (?, ?, ?)
 */
export function placeholders(count: number): string {
  return `(${new Array(count).fill('?').join(', ')})`;
}

/**
 * D1Database type declaration for environments where @cloudflare/workers-types
 * is not installed.
 */
declare global {
  interface D1Database {
    prepare(query: string): D1PreparedStatement;
    batch<T = unknown>(statements: D1PreparedStatement[]): Promise<D1Result<T>[]>;
    exec(query: string): Promise<D1ExecResult>;
  }

  interface D1PreparedStatement {
    bind(...values: unknown[]): D1PreparedStatement;
    first<T = Record<string, unknown>>(colName?: string): Promise<T | null>;
    run<T = Record<string, unknown>>(): Promise<D1Result<T>>;
    all<T = Record<string, unknown>>(): Promise<D1Result<T>>;
    raw<T = unknown[]>(options?: { columnNames?: boolean }): Promise<T[]>;
  }

  interface D1Result<T = unknown> {
    results: T[];
    success: boolean;
    meta: {
      duration: number;
      changes: number;
      last_row_id: number;
      served_by: string;
    };
  }

  interface D1ExecResult {
    count: number;
    duration: number;
  }
}
