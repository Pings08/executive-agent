import { SupabaseClient } from '@supabase/supabase-js';
import { DailyDigest, ObjectiveProgressEntry } from '@/types';

export async function fetchDigests(
  supabase: SupabaseClient,
  filters?: {
    employeeId?: string;
    startDate?: string;
    endDate?: string;
    limit?: number;
  }
): Promise<DailyDigest[]> {
  let query = supabase
    .from('daily_digests')
    .select('*, employees(name)')
    .order('digest_date', { ascending: false })
    .limit(filters?.limit ?? 30);

  if (filters?.employeeId) query = query.eq('employee_id', filters.employeeId);
  if (filters?.startDate) query = query.gte('digest_date', filters.startDate);
  if (filters?.endDate) query = query.lte('digest_date', filters.endDate);

  const { data, error } = await query;
  if (error) throw error;

  return (data || []).map(d => ({
    id: d.id,
    employeeId: d.employee_id,
    employeeName: d.employees?.name ?? undefined,
    digestDate: d.digest_date,
    messageCount: d.message_count,
    avgSentimentScore: d.avg_sentiment_score ?? undefined,
    avgProductivityScore: d.avg_productivity_score ?? undefined,
    overallRating: d.overall_rating ?? undefined,
    topics: d.topics ?? undefined,
    summary: d.summary ?? undefined,
    dailyNote: d.daily_note ?? undefined,
    objectiveProgress: (d.objective_progress as ObjectiveProgressEntry[] | null) ?? undefined,
    blockersCount: d.blockers_count,
  }));
}

export async function upsertDigest(
  supabase: SupabaseClient,
  digest: {
    employee_id: string;
    digest_date: string;
    message_count: number;
    avg_sentiment_score: number | null;
    avg_productivity_score: number | null;
    overall_rating?: number | null;
    topics: string[] | null;
    summary: string | null;
    daily_note?: string | null;
    objective_progress?: ObjectiveProgressEntry[] | null;
    blockers_count: number;
  }
) {
  const { data, error } = await supabase
    .from('daily_digests')
    .upsert(digest, { onConflict: 'employee_id,digest_date' })
    .select()
    .single();

  if (error) throw error;
  return data;
}
