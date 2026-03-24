import { NextResponse } from 'next/server';
import { synthesizeDay, synthesizeWeek, extractAndUpdateObjectives, synthesizeDayAllOrgs, extractObjectivesAllOrgs } from '@/lib/pipeline/company-synthesis';
import type { Org } from '@/lib/pipeline/company-synthesis';

/**
 * POST /api/pipeline/synthesize
 * Body:
 *   { period: 'day', date, org?: Org, allOrgs?: boolean, extractObjectives?: boolean }
 *   { period: 'week', weekStart, org?: Org }
 *   { period: 'objectives', org?: Org, allOrgs?: boolean, lookbackDays?: number }
 */
export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const { period, date, weekStart, org = 'biotech', allOrgs = false, lookbackDays = 365, extractObjectives = false } = body;

    if (period === 'objectives') {
      if (allOrgs) {
        const result = await extractObjectivesAllOrgs(lookbackDays);
        return NextResponse.json({ success: true, allOrgs: true, results: result });
      }
      const result = await extractAndUpdateObjectives(org as Org, lookbackDays);
      return NextResponse.json({ success: true, org, ...result });
    }

    if (period === 'day') {
      if (!date) return NextResponse.json({ success: false, error: 'date required' }, { status: 400 });

      if (allOrgs) {
        const result = await synthesizeDayAllOrgs(date);
        return NextResponse.json({ success: true, allOrgs: true, date, results: result });
      }

      const result = await synthesizeDay(date, org as Org);
      let objectivesResult = null;
      if (extractObjectives && !result.skipped && !result.error) {
        objectivesResult = await extractAndUpdateObjectives(org as Org, lookbackDays);
      }
      return NextResponse.json({ success: true, org, ...result, objectives: objectivesResult });
    }

    if (period === 'week') {
      const ws = weekStart || date;
      if (!ws) return NextResponse.json({ success: false, error: 'weekStart required' }, { status: 400 });
      const result = await synthesizeWeek(ws, org as Org);
      return NextResponse.json({ success: true, org, ...result });
    }

    return NextResponse.json({ success: false, error: 'period must be "day", "week", or "objectives"' }, { status: 400 });
  } catch (error: unknown) {
    return NextResponse.json({ success: false, error: error instanceof Error ? error.message : 'Unknown error' }, { status: 500 });
  }
}
