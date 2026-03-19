import { createAdminClient } from '@/lib/supabase/admin';
import { SupabaseClient } from '@supabase/supabase-js';

export async function generateAlerts(): Promise<{ alertsCreated: number }> {
  const supabase = createAdminClient();
  let alertsCreated = 0;

  alertsCreated += await detectBlockers(supabase);
  alertsCreated += await detectSentimentDrops(supabase);
  alertsCreated += await detectInactivity(supabase);
  alertsCreated += await detectMissedDeadlines(supabase);
  alertsCreated += await detectObjectivesAtRisk(supabase);

  return { alertsCreated };
}

async function detectBlockers(supabase: SupabaseClient): Promise<number> {
  const thirtyMinAgo = new Date(Date.now() - 30 * 60 * 1000).toISOString();

  const { data: blockerAnalyses } = await supabase
    .from('message_analyses')
    .select('*, employees(name), raven_messages(content)')
    .eq('blocker_detected', true)
    .gte('created_at', thirtyMinAgo);

  let created = 0;
  for (const analysis of blockerAnalyses || []) {
    // Check for existing unresolved blocker alert for this employee
    const { data: existing } = await supabase
      .from('alerts')
      .select('id')
      .eq('type', 'blocker_detected')
      .eq('employee_id', analysis.employee_id)
      .eq('is_resolved', false)
      .limit(1);

    if (existing && existing.length > 0) continue;

    await supabase.from('alerts').insert({
      type: 'blocker_detected',
      severity: 'high',
      title: `Blocker detected for ${analysis.employees?.name || 'Unknown'}`,
      description: analysis.blocker_description || analysis.summary || 'A blocker was detected in a team message.',
      employee_id: analysis.employee_id,
      objective_id: analysis.related_objective_id,
      task_id: analysis.related_task_id,
      message_analysis_id: analysis.id,
    });
    created++;
  }
  return created;
}

async function detectSentimentDrops(supabase: SupabaseClient): Promise<number> {
  const today = new Date().toISOString().split('T')[0];
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

  // Get today's digest for each employee
  const { data: todayDigests } = await supabase
    .from('daily_digests')
    .select('*, employees(name)')
    .eq('digest_date', today);

  // Get 7-day averages
  const { data: weekDigests } = await supabase
    .from('daily_digests')
    .select('employee_id, avg_sentiment_score')
    .gte('digest_date', sevenDaysAgo)
    .lt('digest_date', today);

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
    if (digest.avg_sentiment_score == null) continue;
    const weekTotal = weekAvgMap.get(digest.employee_id);
    const weekCount = weekCountMap.get(digest.employee_id);
    if (weekTotal == null || !weekCount) continue;

    const weekAvg = weekTotal / weekCount;
    if (digest.avg_sentiment_score < weekAvg - 0.5) {
      // Check for existing alert
      const { data: existing } = await supabase
        .from('alerts')
        .select('id')
        .eq('type', 'sentiment_drop')
        .eq('employee_id', digest.employee_id)
        .eq('is_resolved', false)
        .limit(1);

      if (existing && existing.length > 0) continue;

      await supabase.from('alerts').insert({
        type: 'sentiment_drop',
        severity: 'medium',
        title: `Sentiment drop for ${digest.employees?.name || 'Unknown'}`,
        description: `Today's sentiment score (${digest.avg_sentiment_score.toFixed(2)}) is significantly below their 7-day average (${weekAvg.toFixed(2)}).`,
        employee_id: digest.employee_id,
      });
      created++;
    }
  }
  return created;
}

async function detectInactivity(supabase: SupabaseClient): Promise<number> {
  const twoDaysAgo = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString();

  // Get all active employees
  const { data: employees } = await supabase
    .from('employees')
    .select('id, name')
    .eq('status', 'active');

  if (!employees) return 0;

  let created = 0;
  for (const emp of employees) {
    // Check for any messages in last 2 days
    const { data: recentMsgs } = await supabase
      .from('raven_messages')
      .select('id')
      .eq('employee_id', emp.id)
      .gte('created_at', twoDaysAgo)
      .limit(1);

    if (recentMsgs && recentMsgs.length > 0) continue;

    // Check for existing alert
    const { data: existing } = await supabase
      .from('alerts')
      .select('id')
      .eq('type', 'no_activity')
      .eq('employee_id', emp.id)
      .eq('is_resolved', false)
      .limit(1);

    if (existing && existing.length > 0) continue;

    await supabase.from('alerts').insert({
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

async function detectMissedDeadlines(supabase: SupabaseClient): Promise<number> {
  const today = new Date().toISOString().split('T')[0];

  // Tasks past end_date and not completed
  const { data: overdueTasks } = await supabase
    .from('tasks')
    .select('id, title, objective_id, assignee_id, end_date, objectives(title), employees:assignee_id(name)')
    .lt('end_date', today)
    .neq('status', 'completed');

  if (!overdueTasks) return 0;

  let created = 0;
  for (const task of overdueTasks) {
    const { data: existing } = await supabase
      .from('alerts')
      .select('id')
      .eq('type', 'missed_deadline')
      .eq('task_id', task.id)
      .eq('is_resolved', false)
      .limit(1);

    if (existing && existing.length > 0) continue;

    const empName = (task.employees as unknown as { name: string })?.name || 'Unassigned';
    await supabase.from('alerts').insert({
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

async function detectObjectivesAtRisk(supabase: SupabaseClient): Promise<number> {
  const { data: objectives } = await supabase
    .from('objectives')
    .select('id, title, tasks(status)')
    .neq('status', 'completed');

  if (!objectives) return 0;

  let created = 0;
  for (const obj of objectives) {
    const tasks = obj.tasks || [];
    if (tasks.length === 0) continue;

    const blockedOrOverdue = tasks.filter(
      (t: { status: string }) => t.status === 'blocked'
    ).length;
    const ratio = blockedOrOverdue / tasks.length;

    if (ratio <= 0.5) continue;

    const { data: existing } = await supabase
      .from('alerts')
      .select('id')
      .eq('type', 'objective_at_risk')
      .eq('objective_id', obj.id)
      .eq('is_resolved', false)
      .limit(1);

    if (existing && existing.length > 0) continue;

    await supabase.from('alerts').insert({
      type: 'objective_at_risk',
      severity: 'critical',
      title: `Objective at risk: ${obj.title}`,
      description: `${blockedOrOverdue} of ${tasks.length} tasks are blocked (${Math.round(ratio * 100)}%).`,
      objective_id: obj.id,
    });
    created++;
  }
  return created;
}
