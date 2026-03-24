import { getDb, newId, now } from '@/lib/d1/client';

export async function generateAlerts(): Promise<{ alertsCreated: number }> {
  const db = getDb();
  let alertsCreated = 0;

  alertsCreated += await detectBlockers(db);
  alertsCreated += await detectSentimentDrops(db);
  alertsCreated += await detectInactivity(db);
  alertsCreated += await detectMissedDeadlines(db);
  alertsCreated += await detectObjectivesAtRisk(db);

  return { alertsCreated };
}

async function insertAlert(
  db: D1Database,
  alert: {
    type: string;
    severity: string;
    title: string;
    description: string;
    employee_id?: string | null;
    objective_id?: string | null;
    task_id?: string | null;
    message_analysis_id?: string | null;
  }
) {
  await db
    .prepare(
      `INSERT INTO alerts (id, type, severity, title, description, employee_id, objective_id, task_id, message_analysis_id, is_read, is_resolved, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, ?)`
    )
    .bind(
      newId(),
      alert.type,
      alert.severity,
      alert.title,
      alert.description,
      alert.employee_id ?? null,
      alert.objective_id ?? null,
      alert.task_id ?? null,
      alert.message_analysis_id ?? null,
      now()
    )
    .run();
}

async function detectBlockers(db: D1Database): Promise<number> {
  const thirtyMinAgo = new Date(Date.now() - 30 * 60 * 1000).toISOString();

  // Fetch recent blocker analyses with employee name and message content
  const { results: blockerAnalyses } = await db
    .prepare(
      `SELECT ma.*, e.name as employee_name, rm.content as message_content
       FROM message_analyses ma
       LEFT JOIN employees e ON ma.employee_id = e.id
       LEFT JOIN raven_messages rm ON ma.raven_message_id = rm.id
       WHERE ma.blocker_detected = 1 AND ma.created_at >= ?`
    )
    .bind(thirtyMinAgo)
    .all<Record<string, unknown>>();

  let created = 0;
  for (const analysis of blockerAnalyses || []) {
    // Check for existing unresolved blocker alert for this employee
    const existing = await db
      .prepare(
        `SELECT id FROM alerts
         WHERE type = 'blocker_detected' AND employee_id = ? AND is_resolved = 0
         LIMIT 1`
      )
      .bind(analysis.employee_id)
      .first();

    if (existing) continue;

    await insertAlert(db, {
      type: 'blocker_detected',
      severity: 'high',
      title: `Blocker detected for ${(analysis.employee_name as string) || 'Unknown'}`,
      description: (analysis.blocker_description as string) || (analysis.summary as string) || 'A blocker was detected in a team message.',
      employee_id: analysis.employee_id as string | null,
      objective_id: analysis.related_objective_id as string | null,
      task_id: analysis.related_task_id as string | null,
      message_analysis_id: analysis.id as string,
    });
    created++;
  }
  return created;
}

async function detectSentimentDrops(db: D1Database): Promise<number> {
  const today = new Date().toISOString().split('T')[0];
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

  // Get today's digests with employee names
  const { results: todayDigests } = await db
    .prepare(
      `SELECT dd.*, e.name as employee_name
       FROM daily_digests dd
       LEFT JOIN employees e ON dd.employee_id = e.id
       WHERE dd.digest_date = ?`
    )
    .bind(today)
    .all<Record<string, unknown>>();

  // Get 7-day digests for averaging
  const { results: weekDigests } = await db
    .prepare(
      `SELECT employee_id, avg_sentiment_score
       FROM daily_digests
       WHERE digest_date >= ? AND digest_date < ?`
    )
    .bind(sevenDaysAgo, today)
    .all<{ employee_id: string; avg_sentiment_score: number | null }>();

  if (!todayDigests || !weekDigests) return 0;

  // Calculate 7-day avg per employee
  const weekAvgMap = new Map<string, number>();
  const weekCountMap = new Map<string, number>();
  for (const d of weekDigests) {
    if (d.avg_sentiment_score == null) continue;
    const current = weekAvgMap.get(d.employee_id) || 0;
    const count = weekCountMap.get(d.employee_id) || 0;
    weekAvgMap.set(d.employee_id, current + d.avg_sentiment_score);
    weekCountMap.set(d.employee_id, count + 1);
  }

  let created = 0;
  for (const digest of todayDigests) {
    const sentimentScore = digest.avg_sentiment_score as number | null;
    const employeeId = digest.employee_id as string;
    if (sentimentScore == null) continue;
    const weekTotal = weekAvgMap.get(employeeId);
    const weekCount = weekCountMap.get(employeeId);
    if (weekTotal == null || !weekCount) continue;

    const weekAvg = weekTotal / weekCount;
    if (sentimentScore < weekAvg - 0.5) {
      // Check for existing alert
      const existing = await db
        .prepare(
          `SELECT id FROM alerts
           WHERE type = 'sentiment_drop' AND employee_id = ? AND is_resolved = 0
           LIMIT 1`
        )
        .bind(employeeId)
        .first();

      if (existing) continue;

      await insertAlert(db, {
        type: 'sentiment_drop',
        severity: 'medium',
        title: `Sentiment drop for ${(digest.employee_name as string) || 'Unknown'}`,
        description: `Today's sentiment score (${sentimentScore.toFixed(2)}) is significantly below their 7-day average (${weekAvg.toFixed(2)}).`,
        employee_id: employeeId,
      });
      created++;
    }
  }
  return created;
}

async function detectInactivity(db: D1Database): Promise<number> {
  const twoDaysAgo = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString();

  // Get all active employees
  const { results: employees } = await db
    .prepare("SELECT id, name FROM employees WHERE status = 'active'")
    .all<{ id: string; name: string }>();

  if (!employees) return 0;

  let created = 0;
  for (const emp of employees) {
    // Check for any messages in last 2 days
    const recentMsg = await db
      .prepare(
        'SELECT id FROM raven_messages WHERE employee_id = ? AND created_at >= ? LIMIT 1'
      )
      .bind(emp.id, twoDaysAgo)
      .first();

    if (recentMsg) continue;

    // Check for existing alert
    const existing = await db
      .prepare(
        `SELECT id FROM alerts
         WHERE type = 'no_activity' AND employee_id = ? AND is_resolved = 0
         LIMIT 1`
      )
      .bind(emp.id)
      .first();

    if (existing) continue;

    await insertAlert(db, {
      type: 'no_activity',
      severity: 'medium',
      title: `No activity from ${emp.name}`,
      description: `${emp.name} has not sent any messages in over 2 days.`,
      employee_id: emp.id,
    });
    created++;
  }
  return created;
}

async function detectMissedDeadlines(db: D1Database): Promise<number> {
  const today = new Date().toISOString().split('T')[0];

  // Tasks past end_date and not completed, with objective title and employee name
  const { results: overdueTasks } = await db
    .prepare(
      `SELECT t.id, t.title, t.objective_id, t.assignee_id, t.end_date,
              o.title as objective_title, e.name as employee_name
       FROM tasks t
       LEFT JOIN objectives o ON t.objective_id = o.id
       LEFT JOIN employees e ON t.assignee_id = e.id
       WHERE t.end_date < ? AND t.status != 'completed'`
    )
    .bind(today)
    .all<{
      id: string; title: string; objective_id: string | null; assignee_id: string | null;
      end_date: string; objective_title: string | null; employee_name: string | null;
    }>();

  if (!overdueTasks) return 0;

  let created = 0;
  for (const task of overdueTasks) {
    const existing = await db
      .prepare(
        `SELECT id FROM alerts
         WHERE type = 'missed_deadline' AND task_id = ? AND is_resolved = 0
         LIMIT 1`
      )
      .bind(task.id)
      .first();

    if (existing) continue;

    const empName = task.employee_name || 'Unassigned';
    await insertAlert(db, {
      type: 'missed_deadline',
      severity: 'high',
      title: `Missed deadline: ${task.title}`,
      description: `Task "${task.title}" was due ${task.end_date} and is not completed. Assigned to ${empName}.`,
      employee_id: task.assignee_id,
      objective_id: task.objective_id,
      task_id: task.id,
    });
    created++;
  }
  return created;
}

async function detectObjectivesAtRisk(db: D1Database): Promise<number> {
  // Get non-completed objectives
  const { results: objectives } = await db
    .prepare("SELECT id, title FROM objectives WHERE status != 'completed'")
    .all<{ id: string; title: string }>();

  if (!objectives) return 0;

  // Get all task statuses grouped by objective
  const { results: tasks } = await db
    .prepare('SELECT objective_id, status FROM tasks')
    .all<{ objective_id: string; status: string }>();

  // Group tasks by objective_id
  const tasksByObjective = new Map<string, string[]>();
  for (const t of tasks || []) {
    const list = tasksByObjective.get(t.objective_id);
    if (list) list.push(t.status);
    else tasksByObjective.set(t.objective_id, [t.status]);
  }

  let created = 0;
  for (const obj of objectives) {
    const taskStatuses = tasksByObjective.get(obj.id) || [];
    if (taskStatuses.length === 0) continue;

    const blockedOrOverdue = taskStatuses.filter(s => s === 'blocked').length;
    const ratio = blockedOrOverdue / taskStatuses.length;

    if (ratio <= 0.5) continue;

    const existing = await db
      .prepare(
        `SELECT id FROM alerts
         WHERE type = 'objective_at_risk' AND objective_id = ? AND is_resolved = 0
         LIMIT 1`
      )
      .bind(obj.id)
      .first();

    if (existing) continue;

    await insertAlert(db, {
      type: 'objective_at_risk',
      severity: 'critical',
      title: `Objective at risk: ${obj.title}`,
      description: `${blockedOrOverdue} of ${taskStatuses.length} tasks are blocked (${Math.round(ratio * 100)}%).`,
      objective_id: obj.id,
    });
    created++;
  }
  return created;
}
