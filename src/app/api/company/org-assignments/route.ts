import { NextResponse } from 'next/server';
import { getDb, parseJson, toJson, now } from '@/lib/d1/client';

/**
 * GET /api/company/org-assignments
 * Returns { [employeeId]: workspace } mapping
 *
 * PUT /api/company/org-assignments
 * Body: { employeeId: string, workspace: string | null }
 * Updates a single employee's org assignment
 */

const STATE_KEY = 'org_assignments';

export async function GET() {
  try {
    const db = getDb();
    const row = await db
      .prepare('SELECT value FROM pipeline_state WHERE key = ?')
      .bind(STATE_KEY)
      .first<{ value: string }>();

    return NextResponse.json(row ? parseJson(row.value) || {} : {});
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function PUT(req: Request) {
  try {
    const { employeeId, workspace } = await req.json();
    if (!employeeId) {
      return NextResponse.json({ error: 'employeeId required' }, { status: 400 });
    }

    const db = getDb();

    // Get current assignments
    const row = await db
      .prepare('SELECT value FROM pipeline_state WHERE key = ?')
      .bind(STATE_KEY)
      .first<{ value: string }>();

    const assignments = (row ? parseJson<Record<string, string | null>>(row.value) : null) || {};

    if (workspace) {
      assignments[employeeId] = workspace;
    } else {
      delete assignments[employeeId];
    }

    // Upsert the assignments
    await db
      .prepare(
        `INSERT INTO pipeline_state (key, value, updated_at)
         VALUES (?, ?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
      )
      .bind(STATE_KEY, toJson(assignments), now())
      .run();

    return NextResponse.json({ success: true, assignments });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
