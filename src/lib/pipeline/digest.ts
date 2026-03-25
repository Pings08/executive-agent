import { getDb, newId, now, toJson, parseJson } from '@/lib/d1/client';
import { generateEODDigest, generateEmployeeDailyNote } from '@/lib/ai/claude-client';

// Status progression guard: only allow advancing forward, never downgrade.
// "completed" is never auto-set — requires human confirmation.
// "blocked" can always be set.
const STATUS_RANK: Record<string, number> = {
  not_started: 0,
  in_progress: 1,
  completed: 2,
};

function canAdvanceStatus(current: string, suggested: string): boolean {
  if (suggested === 'blocked') return true;
  const currentRank = STATUS_RANK[current] ?? 0;
  const suggestedRank = STATUS_RANK[suggested] ?? 0;
  // Allow not_started → in_progress. Also allow in_progress → in_progress (no-op status, but progress_percentage will update).
  return suggestedRank >= 1 && currentRank <= 1 && suggestedRank !== STATUS_RANK['completed'];
}

export async function generateDailyDigests(date?: string): Promise<{
  digestsCreated: number;
  objectivesUpdated: number;
  tasksUpdated: number;
  errors: string[];
}> {
  const db = getDb();
  const targetDate = date || new Date().toISOString().split('T')[0];
  const errors: string[] = [];
  let digestsCreated = 0;
  let objectivesUpdated = 0;
  let tasksUpdated = 0;

  // Fetch all active employees
  const { results: employees } = await db
    .prepare('SELECT id, name FROM employees WHERE status = ?')
    .bind('active')
    .all<{ id: string; name: string }>();

  if (!employees || employees.length === 0) {
    return {
      digestsCreated: 0,
      objectivesUpdated: 0,
      tasksUpdated: 0,
      errors: ['Failed to fetch employees or no active employees found'],
    };
  }

  // Fetch all non-completed objectives with their tasks + progress percentages
  const { results: objectivesRows } = await db
    .prepare('SELECT id, title, description, status, progress_percentage FROM objectives WHERE status != ?')
    .bind('completed')
    .all<{ id: string; title: string; description: string | null; status: string; progress_percentage: number | null }>();

  const { results: tasksRows } = await db
    .prepare(
      `SELECT t.id, t.title, t.status, t.progress_percentage, t.objective_id
       FROM tasks t
       JOIN objectives o ON t.objective_id = o.id
       WHERE o.status != ?`
    )
    .bind('completed')
    .all<{ id: string; title: string; status: string; progress_percentage: number | null; objective_id: string }>();

  // Group tasks by objective
  const tasksByObjective = new Map<string, { id: string; title: string; status: string; progress_percentage: number }[]>();
  for (const t of tasksRows || []) {
    if (!tasksByObjective.has(t.objective_id)) {
      tasksByObjective.set(t.objective_id, []);
    }
    tasksByObjective.get(t.objective_id)!.push({
      id: t.id,
      title: t.title,
      status: t.status,
      progress_percentage: t.progress_percentage ?? 0,
    });
  }

  type ObjContext = {
    id: string;
    title: string;
    description: string;
    status: string;
    progress_percentage: number;
    tasks: { id: string; title: string; status: string; progress_percentage: number }[];
  };

  const objectivesContext: ObjContext[] = (objectivesRows || []).map(o => ({
    id: o.id,
    title: o.title,
    description: o.description || '',
    status: o.status,
    progress_percentage: o.progress_percentage ?? 0,
    tasks: tasksByObjective.get(o.id) || [],
  }));

  for (const employee of employees) {
    try {
      // Fetch today's analyses joined with message + related objective/task
      const { results: analyses } = await db
        .prepare(
          `SELECT ma.id, ma.category, ma.sentiment, ma.productivity_score, ma.summary,
                  ma.blocker_detected, ma.blocker_description, ma.related_objective_id,
                  rm.content AS message_content, rm.created_at AS message_created_at, rm.channel_name,
                  o.title AS objective_title,
                  t.title AS task_title
           FROM message_analyses ma
           LEFT JOIN raven_messages rm ON ma.raven_message_id = rm.id
           LEFT JOIN objectives o ON ma.related_objective_id = o.id
           LEFT JOIN tasks t ON ma.related_task_id = t.id
           WHERE ma.employee_id = ?
             AND ma.created_at >= ?
             AND ma.created_at <= ?
           ORDER BY ma.created_at ASC`
        )
        .bind(employee.id, `${targetDate}T00:00:00Z`, `${targetDate}T23:59:59Z`)
        .all<{
          id: string; category: string; sentiment: string; productivity_score: number | null;
          summary: string | null; blocker_detected: number; blocker_description: string | null;
          related_objective_id: string | null;
          message_content: string | null; message_created_at: string | null; channel_name: string | null;
          objective_title: string | null; task_title: string | null;
        }>();

      if (!analyses || analyses.length === 0) continue; // silent today — no digest

      const messages = analyses.map(a => ({
        content: a.message_content || '',
        timestamp: a.message_created_at || targetDate,
        channel: a.channel_name || null,
      }));

      const analysisContext = analyses.map(a => ({
        summary: a.summary || '',
        category: a.category,
        sentiment: a.sentiment,
        productivityScore: a.productivity_score || 3,
        blockerDetected: a.blocker_detected === 1,
        blockerDescription: a.blocker_description || null,
        relatedObjectiveTitle: a.objective_title || null,
        relatedTaskTitle: a.task_title || null,
      }));

      const objectivesForPrompt = objectivesContext.map(o => ({
        title: o.title,
        description: o.description,
        status: o.status,
        tasks: o.tasks.map(t => ({ title: t.title, status: t.status })),
      }));

      const objectivesForNotePrompt = objectivesContext.map(o => ({
        title: o.title,
        description: o.description,
        status: o.status,
        tasks: o.tasks.map(t => ({
          title: t.title,
          status: t.status,
          progress_percentage: t.progress_percentage,
        })),
      }));

      // Call Claude for EOD verdict (CEO-facing) and daily note (employee-facing) in sequence
      // to stay under rate limits
      const [eodResult, dailyNoteResult] = await Promise.all([
        generateEODDigest(employee.name, messages, analysisContext, objectivesForPrompt),
        generateEmployeeDailyNote(employee.name, messages, analysisContext, objectivesForNotePrompt),
      ]);

      // Upsert EOD digest with all new fields
      try {
        await db
          .prepare(
            `INSERT INTO daily_digests (id, employee_id, digest_date, message_count,
               avg_sentiment_score, avg_productivity_score, overall_rating, topics,
               summary, blockers_count, daily_note, objective_progress, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
             ON CONFLICT(employee_id, digest_date) DO UPDATE SET
               message_count = excluded.message_count,
               avg_sentiment_score = excluded.avg_sentiment_score,
               avg_productivity_score = excluded.avg_productivity_score,
               overall_rating = excluded.overall_rating,
               topics = excluded.topics,
               summary = excluded.summary,
               blockers_count = excluded.blockers_count,
               daily_note = excluded.daily_note,
               objective_progress = excluded.objective_progress,
               updated_at = excluded.updated_at`
          )
          .bind(
            newId(),
            employee.id,
            targetDate,
            analyses.length,
            eodResult.sentimentScore,
            eodResult.productivityScore,
            eodResult.overallRating,
            toJson(eodResult.keyTopics),
            eodResult.summary,
            eodResult.blockersCount,
            dailyNoteResult.narrativeNote,
            toJson(dailyNoteResult.objectiveProgress),
            now(),
            now(),
          )
          .run();
        digestsCreated++;
      } catch (err) {
        errors.push(`${employee.name}: Save failed — ${err}`);
      }

      // --- Update objective and task progress from daily note analysis ---
      const timestamp = now();

      for (const progress of dailyNoteResult.objectiveProgress) {
        if (!progress.objectiveTitle) continue;

        // Match objective by title (case-insensitive substring match)
        const matchedObj = objectivesContext.find(o => {
          const oTitle = o.title.toLowerCase();
          const pTitle = progress.objectiveTitle!.toLowerCase();
          return oTitle === pTitle || oTitle.includes(pTitle) || pTitle.includes(oTitle);
        });

        if (!matchedObj) continue;

        // Build objective update
        const updates: string[] = ['last_activity_at = ?', 'updated_at = ?'];
        const binds: unknown[] = [timestamp, timestamp];

        // Update progress_percentage (additive, capped at 99 — humans confirm completion)
        const newPct = Math.min(99, matchedObj.progress_percentage + progress.estimatedProgressPct);
        if (newPct > matchedObj.progress_percentage) {
          updates.push('progress_percentage = ?');
          binds.push(newPct);
        }

        // Update ai_summary with latest evidence
        if (progress.evidenceSummary) {
          updates.push('ai_summary = ?');
          binds.push(progress.evidenceSummary);
        }

        // Update status only if it's a valid advance
        if (progress.suggestedStatus && canAdvanceStatus(matchedObj.status, progress.suggestedStatus)) {
          updates.push('status = ?');
          binds.push(progress.suggestedStatus);
          matchedObj.status = progress.suggestedStatus;
        }

        binds.push(matchedObj.id);

        try {
          await db
            .prepare(`UPDATE objectives SET ${updates.join(', ')} WHERE id = ?`)
            .bind(...binds)
            .run();
          matchedObj.progress_percentage = newPct;
          objectivesUpdated++;
        } catch {
          // silently skip failed objective update
        }

        // Update the specific task if identified
        if (progress.taskTitle) {
          const matchedTask = matchedObj.tasks.find(t => {
            const tTitle = t.title.toLowerCase();
            const pTitle = progress.taskTitle!.toLowerCase();
            return tTitle === pTitle || tTitle.includes(pTitle) || pTitle.includes(pTitle);
          });

          if (matchedTask) {
            const taskUpdates: string[] = ['updated_at = ?'];
            const taskBinds: unknown[] = [timestamp];

            // Advance task status: not_started → in_progress if work was done
            if (progress.suggestedStatus === 'blocked') {
              taskUpdates.push('status = ?');
              taskBinds.push('blocked');
            } else if (matchedTask.status === 'not_started' && progress.estimatedProgressPct > 0) {
              taskUpdates.push('status = ?');
              taskBinds.push('in_progress');
            }

            // Update task progress percentage (additive, capped at 99)
            const newTaskPct = Math.min(99, matchedTask.progress_percentage + progress.estimatedProgressPct);
            if (newTaskPct > matchedTask.progress_percentage) {
              taskUpdates.push('progress_percentage = ?');
              taskBinds.push(newTaskPct);
            }

            if (taskUpdates.length > 1) { // more than just updated_at
              taskBinds.push(matchedTask.id);
              try {
                await db
                  .prepare(`UPDATE tasks SET ${taskUpdates.join(', ')} WHERE id = ?`)
                  .bind(...taskBinds)
                  .run();
                matchedTask.progress_percentage = newTaskPct;
                tasksUpdated++;
              } catch {
                // silently skip failed task update
              }
            }
          }
        }
      }

      // Also apply EOD objective status updates (status-only, from the CEO analysis)
      for (const progress of eodResult.objectiveProgress) {
        if (!progress.progressMade || !progress.suggestedStatus) continue;
        if (!['in_progress', 'blocked'].includes(progress.suggestedStatus)) continue;

        const matchedObj = objectivesContext.find(o => {
          const oTitle = o.title.toLowerCase();
          const pTitle = progress.objectiveTitle.toLowerCase();
          return oTitle === pTitle || oTitle.includes(pTitle) || pTitle.includes(oTitle);
        });

        if (!matchedObj) continue;
        if (!canAdvanceStatus(matchedObj.status, progress.suggestedStatus)) continue;

        try {
          await db
            .prepare('UPDATE objectives SET status = ?, updated_at = ? WHERE id = ?')
            .bind(progress.suggestedStatus, timestamp, matchedObj.id)
            .run();
          matchedObj.status = progress.suggestedStatus;
          // only count if not already counted by daily note
        } catch {
          // silently skip
        }
      }

      // Create alert for any high-severity blocker found in today's EOD
      for (const blocker of eodResult.blockers) {
        if (blocker.severity !== 'high') continue;

        // Avoid duplicate alerts (one per employee per day)
        const existingAlert = await db
          .prepare(
            `SELECT id FROM alerts
             WHERE employee_id = ? AND type = ? AND is_resolved = 0 AND created_at >= ?
             LIMIT 1`
          )
          .bind(employee.id, 'blocker_detected', `${targetDate}T00:00:00Z`)
          .first<{ id: string }>();

        if (!existingAlert) {
          await db
            .prepare(
              `INSERT INTO alerts (id, type, severity, title, description, employee_id, is_read, is_resolved, created_at)
               VALUES (?, ?, ?, ?, ?, ?, 0, 0, ?)`
            )
            .bind(
              newId(),
              'blocker_detected',
              'high',
              `EOD Blocker — ${employee.name}`,
              `${blocker.description}\n\nEvidence: "${blocker.messageExcerpt}"`,
              employee.id,
              now(),
            )
            .run();
        }
      }
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      errors.push(`${employee.name}: ${msg}`);
    }
  }

  return { digestsCreated, objectivesUpdated, tasksUpdated, errors };
}
