import { NextResponse } from 'next/server';
import { getDb, parseJson, placeholders } from '@/lib/d1/client';

/**
 * GET /api/company?org=biotech|tcr|sentient_x
 *   Returns day snapshots, week snapshot, and inferred objectives for the org.
 *
 * GET /api/company?org=biotech&period=month&month=2025-12
 *   Returns the monthly synthesis for that org+month.
 *
 * GET /api/company?org=biotech&trajectories=true&month=2025-12
 *   Returns employee trajectories for that org+month.
 */
export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const org = searchParams.get('org') || 'biotech';
    const period = searchParams.get('period');
    const month = searchParams.get('month');
    const trajectories = searchParams.get('trajectories');

    const db = getDb();

    // Monthly synthesis
    if (period === 'month' && month) {
      const row = await db
        .prepare('SELECT value FROM pipeline_state WHERE key = ?')
        .bind(`snapshot:month:${org}:${month}`)
        .first<{ value: string }>();
      return NextResponse.json({ org, month, snapshot: row ? parseJson(row.value) : null });
    }

    // Employee trajectories
    if (trajectories === 'true' && month) {
      const row = await db
        .prepare('SELECT value FROM pipeline_state WHERE key = ?')
        .bind(`trajectories:${org}:${month}`)
        .first<{ value: string }>();
      const parsed = row ? parseJson<{ employees: Record<string, unknown> }>(row.value) : null;
      return NextResponse.json({ org, month, trajectories: parsed?.employees || {} });
    }

    // Default: day/week snapshots + objectives
    // Use exact key lookups instead of expensive LIKE queries
    const today = new Date();
    const dayKeys: string[] = [];
    for (let i = 0; i < 7; i++) {
      const d = new Date(today);
      d.setDate(d.getDate() - i);
      dayKeys.push(`snapshot:day:${org}:${d.toISOString().slice(0, 10)}`);
    }

    // Find the most recent Monday for the week snapshot
    const monday = new Date(today);
    monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7));
    const weekKey = `snapshot:week:${org}:${monday.toISOString().slice(0, 10)}`;
    const objKey = `inferred_objectives:${org}`;

    // Fetch day snapshots, week snapshot, and objectives in parallel
    const [dayResults, weekRow, objRow] = await Promise.all([
      db
        .prepare(`SELECT key, value FROM pipeline_state WHERE key IN ${placeholders(dayKeys.length)}`)
        .bind(...dayKeys)
        .all<{ key: string; value: string }>(),
      db
        .prepare('SELECT value FROM pipeline_state WHERE key = ?')
        .bind(weekKey)
        .first<{ value: string }>(),
      db
        .prepare('SELECT value FROM pipeline_state WHERE key = ?')
        .bind(objKey)
        .first<{ value: string }>(),
    ]);

    const daySnapshots = (dayResults.results || [])
      .map(r => parseJson<Record<string, unknown>>(r.value))
      .filter((v): v is Record<string, unknown> => v !== null && typeof v === 'object' && 'narrative' in v)
      .sort((a, b) => {
        const aStart = (a.period_start as string) || '';
        const bStart = (b.period_start as string) || '';
        return bStart.localeCompare(aStart);
      });

    const weekParsed = weekRow ? parseJson<Record<string, unknown>>(weekRow.value) : null;
    const objParsed = objRow ? parseJson<{ objectives: unknown[] }>(objRow.value) : null;

    return NextResponse.json({
      org,
      daySnapshots,
      weekSnapshot: weekParsed && 'narrative' in weekParsed ? weekParsed : null,
      objectives: objParsed?.objectives || [],
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
