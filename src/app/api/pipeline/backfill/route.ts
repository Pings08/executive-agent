import { NextResponse } from 'next/server';
import { backfillAllDays, backfillAllOrgs, synthesizeWeek, extractAndUpdateObjectives, extractObjectivesAllOrgs, backfillMonths, backfillMonthsAllOrgs } from '@/lib/pipeline/company-synthesis';
import type { Org } from '@/lib/pipeline/company-synthesis';
import { fetchAndAssignOrgs } from '@/lib/pipeline/org-assignments';

/**
 * POST /api/pipeline/backfill
 * Body:
 *   { org?: Org, allOrgs?: boolean, batchLimit?: number }
 *   { mode: 'weeks', org?: Org, weeksBack?: number }
 *   { mode: 'objectives', org?: Org, allOrgs?: boolean, lookbackDays?: number }
 */
export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const { batchLimit = 20, mode = 'days', org = 'biotech', allOrgs = false, weeksBack = 4, lookbackDays = 365 } = body;

    // Assign orgs from Raven workspace membership
    if (mode === 'assign-orgs') {
      const result = await fetchAndAssignOrgs();
      return NextResponse.json({ success: true, mode: 'assign-orgs', ...result });
    }

    // Monthly-first backfill: 1 Gemini call per org per month
    if (mode === 'monthly') {
      const monthsBack = body.monthsBack || 12;
      if (allOrgs) {
        const result = await backfillMonthsAllOrgs(monthsBack);
        return NextResponse.json({ success: true, mode: 'monthly', allOrgs: true, results: result });
      }
      const result = await backfillMonths(org as Org, monthsBack);
      return NextResponse.json({ success: true, mode: 'monthly', org, ...result });
    }

    if (mode === 'objectives') {
      if (allOrgs) {
        const result = await extractObjectivesAllOrgs(lookbackDays);
        return NextResponse.json({ success: true, mode: 'objectives', allOrgs: true, results: result });
      }
      const result = await extractAndUpdateObjectives(org as Org, lookbackDays);
      return NextResponse.json({ success: true, mode: 'objectives', org, ...result });
    }

    if (mode === 'weeks') {
      const results: { weekStart: string; snapshotId: string | null; daysFound: number; skipped: boolean; error: string | null }[] = [];
      const today = new Date();
      for (let w = weeksBack - 1; w >= 0; w--) {
        const d = new Date(today);
        d.setDate(d.getDate() - d.getDay() + 1 - w * 7);
        const ws = d.toISOString().slice(0, 10);
        const result = await synthesizeWeek(ws, org as Org);
        results.push({ weekStart: ws, ...result });
      }
      const processed = results.filter(r => !r.skipped && !r.error).length;
      const skipped = results.filter(r => r.skipped).length;
      const errors = results.filter(r => r.error).map(r => `${r.weekStart}: ${r.error}`);
      return NextResponse.json({ success: true, mode: 'weeks', org, processed, skipped, errors });
    }

    // Default: backfill day snapshots
    if (allOrgs) {
      const result = await backfillAllOrgs(batchLimit);
      return NextResponse.json({ success: true, mode: 'days', allOrgs: true, results: result });
    }
    const result = await backfillAllDays(org as Org, batchLimit);
    return NextResponse.json({ success: true, mode: 'days', org, ...result });
  } catch (error: unknown) {
    return NextResponse.json({ success: false, error: error instanceof Error ? error.message : 'Unknown error' }, { status: 500 });
  }
}
