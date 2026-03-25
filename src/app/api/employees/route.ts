import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/d1/client';

/**
 * GET /api/employees?active=true&fields=keys
 *   Returns active employees; if fields=keys, includes raven_api_key/secret columns.
 *
 * PATCH /api/employees
 *   Body: { id, raven_api_key?, raven_api_secret? }
 *   Updates employee fields.
 */

export async function GET(request: NextRequest) {
  try {
    const db = getDb();
    const url = new URL(request.url);
    const activeOnly = url.searchParams.get('active') === 'true';
    const fields = url.searchParams.get('fields');

    let sql: string;
    if (fields === 'keys') {
      sql = 'SELECT id, name, raven_user, email, raven_api_key, raven_api_secret FROM employees';
    } else {
      sql = 'SELECT id, name, email, role, raven_user, workspace, status FROM employees';
    }

    if (activeOnly) {
      sql += " WHERE status = 'active'";
    }

    sql += ' ORDER BY name';

    const { results } = await db.prepare(sql).all();
    return NextResponse.json({ employees: results || [] });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const db = getDb();
    const { id, raven_api_key, raven_api_secret } = await request.json();

    if (!id) {
      return NextResponse.json({ error: 'id required' }, { status: 400 });
    }

    const setClauses: string[] = [];
    const values: unknown[] = [];

    if (raven_api_key !== undefined) {
      setClauses.push('raven_api_key = ?');
      values.push(raven_api_key || null);
    }
    if (raven_api_secret !== undefined) {
      setClauses.push('raven_api_secret = ?');
      values.push(raven_api_secret || null);
    }

    if (setClauses.length === 0) {
      return NextResponse.json({ error: 'No fields to update' }, { status: 400 });
    }

    values.push(id);

    await db
      .prepare(`UPDATE employees SET ${setClauses.join(', ')} WHERE id = ?`)
      .bind(...values)
      .run();

    return NextResponse.json({ success: true });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
