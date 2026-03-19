import { createAdminClient } from '@/lib/supabase/admin';
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
  const supabase = createAdminClient();
  const targetDate = date || new Date().toISOString().split('T')[0];
  const errors: string[] = [];
  let digestsCreated = 0;
  let objectivesUpdated = 0;
  let tasksUpdated = 0;

  // Fetch all active employees
  const { data: employees, error: empError } = await supabase
    .from('employees')
    .select('id, name')
    .eq('status', 'active');

  if (empError) {
    return {
      digestsCreated: 0,
      objectivesUpdated: 0,
      tasksUpdated: 0,
      errors: [`Failed to fetch employees: ${empError.message}`],
    };
  }

  // Fetch all non-completed objectives with their tasks + progress percentages
  const { data: objectivesData } = await supabase
    .from('objectives')
    .select('id, title, description, status, progress_percentage, tasks(id, title, status, progress_percentage)')
    .neq('status', 'completed');

  type ObjRow = {
    id: string;
    title: string;
    description: string | null;
    status: string;
    progress_percentage: number | null;
    tasks: { id: string; title: string; status: string; progress_percentage: number | null }[];
  };

  const objectivesContext = ((objectivesData || []) as ObjRow[]).map(o => ({
    id: o.id,
    title: o.title,
    description: o.description || '',
    status: o.status,
    progress_percentage: o.progress_percentage ?? 0,
    tasks: (o.tasks || []).map(t => ({
      id: t.id,
      title: t.title,
      status: t.status,
      progress_percentage: t.progress_percentage ?? 0,
    })),
  }));

  for (const employee of employees || []) {
    try {
      // Fetch today's analyses joined with message + related objective/task
      const { data: analyses, error: anlError } = await supabase
        .from('message_analyses')
        .select(`
          id,
          category,
          sentiment,
          productivity_score,
          summary,
          blocker_detected,
          blocker_description,
          related_objective_id,
          raven_messages (
            content,
            created_at,
            channel_name
          ),
          objectives (
            title
          ),
          tasks (
            title
          )
        `)
        .eq('employee_id', employee.id)
        .gte('created_at', `${targetDate}T00:00:00Z`)
        .lte('created_at', `${targetDate}T23:59:59Z`)
        .order('created_at', { ascending: true });

      if (anlError) {
        errors.push(`${employee.name}: DB error — ${anlError.message}`);
        continue;
      }

      if (!analyses || analyses.length === 0) continue; // silent today — no digest

      type AnalysisRow = {
        category: string;
        sentiment: string;
        productivity_score: number | null;
        summary: string | null;
        blocker_detected: boolean;
        blocker_description: string | null;
        raven_messages: { content: string; created_at: string; channel_name: string | null } | null;
        objectives: { title: string } | null;
        tasks: { title: string } | null;
      };

      const rows = analyses as unknown as AnalysisRow[];

      const messages = rows.map(a => ({
        content: a.raven_messages?.content || '',
        timestamp: a.raven_messages?.created_at || targetDate,
        channel: a.raven_messages?.channel_name || null,
      }));

      const analysisContext = rows.map(a => ({
        summary: a.summary || '',
        category: a.category,
        sentiment: a.sentiment,
        productivityScore: a.productivity_score || 3,
        blockerDetected: a.blocker_detected || false,
        blockerDescription: a.blocker_description || null,
        relatedObjectiveTitle: a.objectives?.title || null,
        relatedTaskTitle: a.tasks?.title || null,
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
      // to stay under rate limits (12s delay built into process.ts batching)
      const [eodResult, dailyNoteResult] = await Promise.all([
        generateEODDigest(employee.name, messages, analysisContext, objectivesForPrompt),
        generateEmployeeDailyNote(employee.name, messages, analysisContext, objectivesForNotePrompt),
      ]);

      // Upsert EOD digest with all new fields
      const { error: upsertError } = await supabase.from('daily_digests').upsert(
        {
          employee_id: employee.id,
          digest_date: targetDate,
          message_count: analyses.length,
          avg_sentiment_score: eodResult.sentimentScore,
          avg_productivity_score: eodResult.productivityScore,
          overall_rating: eodResult.overallRating,
          topics: eodResult.keyTopics,
          summary: eodResult.summary,
          blockers_count: eodResult.blockersCount,
          daily_note: dailyNoteResult.narrativeNote,
          objective_progress: dailyNoteResult.objectiveProgress,
        },
        { onConflict: 'employee_id,digest_date' }
      );

      if (upsertError) {
        errors.push(`${employee.name}: Save failed — ${upsertError.message}`);
      } else {
        digestsCreated++;
      }

      // --- Update objective and task progress from daily note analysis ---
      const now = new Date().toISOString();

      for (const progress of dailyNoteResult.objectiveProgress) {
        if (!progress.objectiveTitle) continue;

        // Match objective by title (case-insensitive substring match)
        const matchedObj = objectivesContext.find(o => {
          const oTitle = o.title.toLowerCase();
          const pTitle = progress.objectiveTitle!.toLowerCase();
          return oTitle === pTitle || oTitle.includes(pTitle) || pTitle.includes(oTitle);
        });

        if (!matchedObj) continue;

        // Build objective update payload
        const objUpdate: Record<string, unknown> = {
          last_activity_at: now,
          updated_at: now,
        };

        // Update progress_percentage (additive, capped at 99 — humans confirm completion)
        const newPct = Math.min(99, matchedObj.progress_percentage + progress.estimatedProgressPct);
        if (newPct > matchedObj.progress_percentage) {
          objUpdate.progress_percentage = newPct;
        }

        // Update ai_summary with latest evidence
        if (progress.evidenceSummary) {
          objUpdate.ai_summary = progress.evidenceSummary;
        }

        // Update status only if it's a valid advance
        if (progress.suggestedStatus && canAdvanceStatus(matchedObj.status, progress.suggestedStatus)) {
          objUpdate.status = progress.suggestedStatus;
          matchedObj.status = progress.suggestedStatus;
        }

        const { error: objUpdateError } = await supabase
          .from('objectives')
          .update(objUpdate)
          .eq('id', matchedObj.id);

        if (!objUpdateError) {
          matchedObj.progress_percentage = newPct;
          objectivesUpdated++;
        }

        // Update the specific task if identified
        if (progress.taskTitle) {
          const matchedTask = matchedObj.tasks.find(t => {
            const tTitle = t.title.toLowerCase();
            const pTitle = progress.taskTitle!.toLowerCase();
            return tTitle === pTitle || tTitle.includes(pTitle) || pTitle.includes(pTitle);
          });

          if (matchedTask) {
            const taskUpdate: Record<string, unknown> = { updated_at: now };

            // Advance task status: not_started → in_progress if work was done
            if (progress.suggestedStatus === 'blocked') {
              taskUpdate.status = 'blocked';
            } else if (matchedTask.status === 'not_started' && progress.estimatedProgressPct > 0) {
              taskUpdate.status = 'in_progress';
            }

            // Update task progress percentage (additive, capped at 99)
            const newTaskPct = Math.min(99, matchedTask.progress_percentage + progress.estimatedProgressPct);
            if (newTaskPct > matchedTask.progress_percentage) {
              taskUpdate.progress_percentage = newTaskPct;
            }

            if (Object.keys(taskUpdate).length > 1) { // more than just updated_at
              const { error: taskUpdateError } = await supabase
                .from('tasks')
                .update(taskUpdate)
                .eq('id', matchedTask.id);

              if (!taskUpdateError) {
                matchedTask.progress_percentage = newTaskPct;
                tasksUpdated++;
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

        const { error: updateError } = await supabase
          .from('objectives')
          .update({ status: progress.suggestedStatus, updated_at: now })
          .eq('id', matchedObj.id);

        if (!updateError) {
          matchedObj.status = progress.suggestedStatus;
          // only count if not already counted by daily note
        }
      }

      // Create alert for any high-severity blocker found in today's EOD
      for (const blocker of eodResult.blockers) {
        if (blocker.severity !== 'high') continue;

        // Avoid duplicate alerts (one per employee per day)
        const { data: existing } = await supabase
          .from('alerts')
          .select('id')
          .eq('employee_id', employee.id)
          .eq('type', 'blocker_detected')
          .eq('is_resolved', false)
          .gte('created_at', `${targetDate}T00:00:00Z`)
          .limit(1);

        if (!existing || existing.length === 0) {
          await supabase.from('alerts').insert({
            type: 'blocker_detected',
            severity: 'high',
            title: `EOD Blocker — ${employee.name}`,
            description: `${blocker.description}\n\nEvidence: "${blocker.messageExcerpt}"`,
            employee_id: employee.id,
          });
        }
      }
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      errors.push(`${employee.name}: ${msg}`);
    }
  }

  return { digestsCreated, objectivesUpdated, tasksUpdated, errors };
}
