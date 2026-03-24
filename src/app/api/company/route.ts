import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';

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
  const { searchParams } = new URL(req.url);
  const org = searchParams.get('org') || 'biotech';
  const period = searchParams.get('period');
  const month = searchParams.get('month');
  const trajectories = searchParams.get('trajectories');

  const supabase = createAdminClient();

  // Monthly synthesis
  if (period === 'month' && month) {
    const { data } = await supabase
      .from('pipeline_state')
      .select('value')
      .eq('key', `snapshot:month:${org}:${month}`)
      .maybeSingle();
    return NextResponse.json({ org, month, snapshot: data?.value || null });
  }

  // Employee trajectories
  if (trajectories === 'true' && month) {
    const { data } = await supabase
      .from('pipeline_state')
      .select('value')
      .eq('key', `trajectories:${org}:${month}`)
      .maybeSingle();
    return NextResponse.json({ org, month, trajectories: data?.value?.employees || {} });
  }

  // Default: day/week snapshots + objectives
  // Use exact key lookups (eq) instead of expensive LIKE queries to reduce DB load
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

  const [dayRows, weekRow, objRow] = await Promise.all([
    supabase
      .from('pipeline_state')
      .select('key, value')
      .in('key', dayKeys),
    supabase
      .from('pipeline_state')
      .select('value')
      .eq('key', weekKey)
      .maybeSingle(),
    supabase
      .from('pipeline_state')
      .select('value')
      .eq('key', `inferred_objectives:${org}`)
      .maybeSingle(),
  ]);

  const daySnapshots = (dayRows.data || [])
    .map(r => r.value)
    .filter((v: unknown) => v && typeof v === 'object' && 'narrative' in (v as Record<string, unknown>))
    .sort((a: unknown, b: unknown) => {
      const aStart = (a as { period_start?: string }).period_start || '';
      const bStart = (b as { period_start?: string }).period_start || '';
      return bStart.localeCompare(aStart);
    });

  return NextResponse.json({
    org,
    daySnapshots,
    weekSnapshot: weekRow.data?.value?.narrative ? weekRow.data.value : null,
    objectives: objRow.data?.value?.objectives || [],
  });
}
