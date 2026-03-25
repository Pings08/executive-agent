import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/d1/client';
import { fetchEmployees } from '@/lib/dal/employees';
import { fetchObjectives } from '@/lib/dal/objectives';
import { fetchAlerts, fetchUnreadAlertCount } from '@/lib/dal/alerts';

/**
 * GET /api/data — Returns all essential data for the AppContext.
 *
 * Query params:
 *   ?alerts_only=true — Only return alerts + analyses (for 30s polling)
 */
export async function GET(request: NextRequest) {
  try {
    const db = getDb();
    const url = new URL(request.url);
    const alertsOnly = url.searchParams.get('alerts_only') === 'true';

    if (alertsOnly) {
      // Lightweight poll — only alerts + recent analyses
      const [alertsList, alertCount, analyses] = await Promise.all([
        fetchAlerts(db, { unresolvedOnly: true, limit: 10 }),
        fetchUnreadAlertCount(db),
        fetchRecentAnalyses(db, 10),
      ]);

      return NextResponse.json({
        alerts: alertsList,
        unreadAlertCount: alertCount,
        analyses,
      });
    }

    // Full data load — employees and objectives first (critical)
    const [emps, objs] = await Promise.all([
      fetchEmployees(db),
      fetchObjectives(db),
    ]);

    // Non-critical data
    const [alertsList, alertCount, analyses] = await Promise.all([
      fetchAlerts(db, { unresolvedOnly: true, limit: 10 }),
      fetchUnreadAlertCount(db),
      fetchRecentAnalyses(db, 10),
    ]);

    return NextResponse.json({
      employees: emps,
      objectives: objs,
      alerts: alertsList,
      unreadAlertCount: alertCount,
      analyses,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/**
 * Fetch recent message analyses with JOINs for employee name, objective title, message content.
 * This replaces the old Supabase-based fetchAnalyses for the /api/data endpoint.
 */
async function fetchRecentAnalyses(db: D1Database, limit: number) {
  const { results } = await db
    .prepare(
      `SELECT
        ma.*,
        e.name as employee_name,
        o.title as objective_title,
        rm.content as message_content
       FROM message_analyses ma
       LEFT JOIN employees e ON ma.employee_id = e.id
       LEFT JOIN objectives o ON ma.related_objective_id = o.id
       LEFT JOIN raven_messages rm ON ma.raven_message_id = rm.id
       ORDER BY ma.created_at DESC
       LIMIT ?`
    )
    .bind(limit)
    .all();

  return (results || []).map((a: Record<string, unknown>) => ({
    id: a.id,
    ravenMessageId: a.raven_message_id,
    employeeId: a.employee_id ?? undefined,
    employeeName: a.employee_name ?? undefined,
    relatedObjectiveId: a.related_objective_id ?? undefined,
    relatedObjectiveTitle: a.objective_title ?? undefined,
    relatedTaskId: a.related_task_id ?? undefined,
    category: a.category,
    sentiment: a.sentiment,
    productivityScore: a.productivity_score ?? undefined,
    summary: a.summary ?? undefined,
    keyTopics: a.key_topics ? JSON.parse(a.key_topics as string) : undefined,
    blockerDetected: a.blocker_detected === 1,
    blockerDescription: a.blocker_description ?? undefined,
    messageContent: a.message_content ?? undefined,
    createdAt: a.created_at,
  }));
}
