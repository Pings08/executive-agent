import { DailyDigest, ObjectiveProgressEntry } from '@/types';
import { newId, now, parseJson, toJson } from '@/lib/d1/client';

interface DbDigestJoinRow {
  id: string;
  employee_id: string;
  employee_name: string | null;
  digest_date: string;
  message_count: number;
  avg_sentiment_score: number | null;
  avg_productivity_score: number | null;
  overall_rating: number | null;
  topics: string | null; // TEXT (JSON array) in D1
  summary: string | null;
  daily_note: string | null;
  objective_progress: string | null; // TEXT (JSON) in D1
  blockers_count: number;
  created_at: string;
}

export async function fetchDigests(
  db: D1Database,
  filters?: {
    employeeId?: string;
    startDate?: string;
    endDate?: string;
    limit?: number;
  }
): Promise<DailyDigest[]> {
  const whereClauses: string[] = [];
  const values: unknown[] = [];

  if (filters?.employeeId) {
    whereClauses.push('d.employee_id = ?');
    values.push(filters.employeeId);
  }
  if (filters?.startDate) {
    whereClauses.push('d.digest_date >= ?');
    values.push(filters.startDate);
  }
  if (filters?.endDate) {
    whereClauses.push('d.digest_date <= ?');
    values.push(filters.endDate);
  }

  const whereSQL = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';
  const limitVal = filters?.limit ?? 30;
  values.push(limitVal);

  const { results } = await db
    .prepare(
      `SELECT d.*, e.name as employee_name
       FROM daily_digests d
       LEFT JOIN employees e ON d.employee_id = e.id
       ${whereSQL}
       ORDER BY d.digest_date DESC
       LIMIT ?`
    )
    .bind(...values)
    .all<DbDigestJoinRow>();

  return (results || []).map(d => ({
    id: d.id,
    employeeId: d.employee_id,
    employeeName: d.employee_name ?? undefined,
    digestDate: d.digest_date,
    messageCount: d.message_count,
    avgSentimentScore: d.avg_sentiment_score ?? undefined,
    avgProductivityScore: d.avg_productivity_score ?? undefined,
    overallRating: d.overall_rating ?? undefined,
    topics: parseJson<string[]>(d.topics) ?? undefined,
    summary: d.summary ?? undefined,
    dailyNote: d.daily_note ?? undefined,
    objectiveProgress: parseJson<ObjectiveProgressEntry[]>(d.objective_progress) ?? undefined,
    blockersCount: d.blockers_count,
  }));
}

export async function upsertDigest(
  db: D1Database,
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
  const id = newId();
  const timestamp = now();

  await db
    .prepare(
      `INSERT INTO daily_digests (id, employee_id, digest_date, message_count, avg_sentiment_score, avg_productivity_score, overall_rating, topics, summary, daily_note, objective_progress, blockers_count, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(employee_id, digest_date) DO UPDATE SET
         message_count = excluded.message_count,
         avg_sentiment_score = excluded.avg_sentiment_score,
         avg_productivity_score = excluded.avg_productivity_score,
         overall_rating = excluded.overall_rating,
         topics = excluded.topics,
         summary = excluded.summary,
         daily_note = excluded.daily_note,
         objective_progress = excluded.objective_progress,
         blockers_count = excluded.blockers_count`
    )
    .bind(
      id,
      digest.employee_id,
      digest.digest_date,
      digest.message_count,
      digest.avg_sentiment_score,
      digest.avg_productivity_score,
      digest.overall_rating ?? null,
      digest.topics ? toJson(digest.topics) : null,
      digest.summary,
      digest.daily_note ?? null,
      digest.objective_progress ? toJson(digest.objective_progress) : null,
      digest.blockers_count,
      timestamp
    )
    .run();

  // Fetch the upserted row since D1 has no RETURNING
  const row = await db
    .prepare('SELECT * FROM daily_digests WHERE employee_id = ? AND digest_date = ?')
    .bind(digest.employee_id, digest.digest_date)
    .first();

  return row;
}
