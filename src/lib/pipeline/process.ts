import { getDb, newId, now, toJson, parseJson } from '@/lib/d1/client';
import { analyzeMessage, EmployeeContext } from '@/lib/ai/claude-client';

export async function processUnanalyzedMessages(batchSize = 50): Promise<{
  processedCount: number;
  errors: string[];
  remaining: number;
}> {
  const db = getDb();
  const errors: string[] = [];

  // 1. Fetch unprocessed messages (batch)
  const { results: messages } = await db
    .prepare(
      `SELECT rm.*, e.name AS employee_name
       FROM raven_messages rm
       LEFT JOIN employees e ON rm.employee_id = e.id
       WHERE rm.processed = 0
       ORDER BY rm.created_at ASC
       LIMIT ?`
    )
    .bind(batchSize)
    .all<{
      id: string; content: string; sender: string; channel_id: string | null;
      channel_name: string | null; employee_id: string | null; employee_name: string | null;
      created_at: string; processed: number;
    }>();

  if (!messages || messages.length === 0) {
    return { processedCount: 0, errors: [], remaining: 0 };
  }

  // Snapshot total pending BEFORE processing (used for progress reporting)
  const countRow = await db
    .prepare('SELECT COUNT(*) as count FROM raven_messages WHERE processed = 0')
    .first<{ count: number }>();
  const totalPendingBefore = countRow?.count ?? 0;

  // 2. Fetch objectives + tasks for context
  const { results: objectivesRows } = await db
    .prepare('SELECT id, title, description FROM objectives')
    .all<{ id: string; title: string; description: string | null }>();

  const { results: tasksRows } = await db
    .prepare('SELECT objective_id, title FROM tasks')
    .all<{ objective_id: string; title: string }>();

  // Group tasks by objective
  const tasksByObjective = new Map<string, string[]>();
  for (const t of tasksRows || []) {
    if (!tasksByObjective.has(t.objective_id)) {
      tasksByObjective.set(t.objective_id, []);
    }
    tasksByObjective.get(t.objective_id)!.push(t.title);
  }

  const objectivesContext = (objectivesRows || []).map(o => ({
    title: o.title,
    description: o.description || '',
    tasks: tasksByObjective.get(o.id) || [],
  }));

  // 3. Build per-employee history context from the last 7 days of analyses
  const uniqueEmployeeIds = [
    ...new Set(messages.filter(m => m.employee_id).map(m => m.employee_id as string)),
  ];
  const employeeHistoryMap = new Map<string, EmployeeContext>();
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

  for (const empId of uniqueEmployeeIds) {
    const { results: recentAnalyses } = await db
      .prepare(
        `SELECT summary, productivity_score, category, blocker_detected, blocker_description, key_topics, created_at
         FROM message_analyses
         WHERE employee_id = ? AND created_at >= ?
         ORDER BY created_at DESC
         LIMIT 40`
      )
      .bind(empId, sevenDaysAgo)
      .all<{
        summary: string | null; productivity_score: number | null; category: string;
        blocker_detected: number; blocker_description: string | null;
        key_topics: string | null; created_at: string;
      }>();

    if (!recentAnalyses || recentAnalyses.length === 0) {
      employeeHistoryMap.set(empId, { recentSummaries: [], knownBlockers: [], avgProductivityScore: 3, topTopics: [] });
      continue;
    }

    // Aggregate recurring blockers
    const blockerMap = new Map<string, { count: number; firstSeen: string; lastSeen: string }>();
    for (const a of recentAnalyses) {
      if (a.blocker_detected && a.blocker_description) {
        const key = a.blocker_description.substring(0, 100);
        const existing = blockerMap.get(key);
        if (existing) {
          existing.count++;
          if (a.created_at < existing.firstSeen) existing.firstSeen = a.created_at;
          if (a.created_at > existing.lastSeen) existing.lastSeen = a.created_at;
        } else {
          blockerMap.set(key, { count: 1, firstSeen: a.created_at, lastSeen: a.created_at });
        }
      }
    }

    // Rolling average productivity
    const avgScore = recentAnalyses.reduce((s, a) => s + (a.productivity_score || 3), 0) / recentAnalyses.length;

    // Top recurring topics
    const topicCount = new Map<string, number>();
    for (const a of recentAnalyses) {
      const topics = parseJson<string[]>(a.key_topics) || [];
      for (const topic of topics) {
        topicCount.set(topic, (topicCount.get(topic) || 0) + 1);
      }
    }
    const topTopics = [...topicCount.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([t]) => t);

    employeeHistoryMap.set(empId, {
      recentSummaries: recentAnalyses.slice(0, 10).map(a => ({
        date: a.created_at,
        summary: a.summary || '',
        productivityScore: a.productivity_score || 3,
        category: a.category,
      })),
      knownBlockers: [...blockerMap.entries()].map(([description, stats]) => ({ description, ...stats })),
      avgProductivityScore: Math.round(avgScore * 10) / 10,
      topTopics,
    });
  }

  // 4. Process messages in parallel (concurrency=5)
  let processedCount = 0;
  const CONCURRENCY = 5;

  type MessageRow = (typeof messages)[number];
  async function processOne(msg: MessageRow): Promise<void> {
    try {
      if (!msg.content || msg.content.trim().length < 3) {
        await db.prepare('UPDATE raven_messages SET processed = 1 WHERE id = ?').bind(msg.id).run();
        return;
      }

      const employeeContext = msg.employee_id ? employeeHistoryMap.get(msg.employee_id) : undefined;
      const analysis = await analyzeMessage(
        msg.content,
        msg.employee_name || msg.sender,
        msg.channel_name,
        objectivesContext,
        [],  // skip per-message context fetch — too slow at scale
        employeeContext
      );

      let relatedObjectiveId: string | null = null;
      let relatedTaskId: string | null = null;

      if (analysis.relatedObjectiveTitle) {
        const obj = await db
          .prepare('SELECT id FROM objectives WHERE title LIKE ? LIMIT 1')
          .bind(`%${analysis.relatedObjectiveTitle}%`)
          .first<{ id: string }>();
        relatedObjectiveId = obj?.id || null;
      }

      if (analysis.relatedTaskTitle && relatedObjectiveId) {
        const task = await db
          .prepare('SELECT id FROM tasks WHERE objective_id = ? AND title LIKE ? LIMIT 1')
          .bind(relatedObjectiveId, `%${analysis.relatedTaskTitle}%`)
          .first<{ id: string }>();
        relatedTaskId = task?.id || null;
      }

      await db
        .prepare(
          `INSERT INTO message_analyses (id, raven_message_id, employee_id, related_objective_id, related_task_id,
             category, sentiment, productivity_score, summary, key_topics,
             blocker_detected, blocker_description, raw_ai_response, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .bind(
          newId(),
          msg.id,
          msg.employee_id,
          relatedObjectiveId,
          relatedTaskId,
          analysis.category,
          analysis.sentiment,
          analysis.productivityScore,
          analysis.summary,
          toJson(analysis.keyTopics),
          analysis.blockerDetected ? 1 : 0,
          analysis.blockerDescription || null,
          toJson(analysis),
          now(),
        )
        .run();

      await db.prepare('UPDATE raven_messages SET processed = 1 WHERE id = ?').bind(msg.id).run();
      processedCount++;
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      errors.push(`Message ${msg.id}: ${message}`);

      const isRateLimit = message.includes('429') || message.includes('rate_limit') || message.includes('Too Many Requests');
      if (!isRateLimit) {
        await db.prepare('UPDATE raven_messages SET processed = 1 WHERE id = ?').bind(msg.id).run();
      }
    }
  }

  // Run in chunks of CONCURRENCY
  for (let i = 0; i < messages.length; i += CONCURRENCY) {
    await Promise.all(messages.slice(i, i + CONCURRENCY).map(processOne));
  }

  // Re-count after processing — gives accurate "still pending" number
  const afterCountRow = await db
    .prepare('SELECT COUNT(*) as count FROM raven_messages WHERE processed = 0')
    .first<{ count: number }>();
  const totalPendingAfter = afterCountRow?.count ?? 0;

  const remaining = totalPendingAfter ?? Math.max(0, totalPendingBefore - processedCount);
  return { processedCount, errors, remaining };
}
