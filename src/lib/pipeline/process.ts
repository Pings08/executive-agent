import { createAdminClient } from '@/lib/supabase/admin';
import { analyzeMessage } from '@/lib/ai/claude-client';

export async function processUnanalyzedMessages(batchSize = 20): Promise<{
  processedCount: number;
  errors: string[];
  remaining: number;
}> {
  const supabase = createAdminClient();
  const errors: string[] = [];

  // 1. Fetch unprocessed messages (batch of 20 — Claude allows ~50 RPM, we stay safe at ~15/min)
  const { data: messages } = await supabase
    .from('raven_messages')
    .select('*, employees(name)')
    .eq('processed', false)
    .order('created_at', { ascending: true })
    .limit(batchSize);

  if (!messages || messages.length === 0) {
    return { processedCount: 0, errors: [], remaining: 0 };
  }

  // Count total pending so caller knows how big the backlog is
  const { count: totalPending } = await supabase
    .from('raven_messages')
    .select('*', { count: 'exact', head: true })
    .eq('processed', false);

  // 2. Fetch objectives for context
  const { data: objectives } = await supabase
    .from('objectives')
    .select('title, description, tasks(title)');

  const objectivesContext = (objectives || []).map(o => ({
    title: o.title,
    description: o.description,
    tasks: (o.tasks || []).map((t: { title: string }) => t.title),
  }));

  // 3. Process each message
  let processedCount = 0;

  for (const msg of messages) {
    try {
      // Skip very short/empty messages
      if (!msg.content || msg.content.trim().length < 3) {
        await supabase
          .from('raven_messages')
          .update({ processed: true })
          .eq('id', msg.id);
        continue;
      }

      // Fetch recent context (last 10 messages in same channel)
      const { data: contextMsgs } = await supabase
        .from('raven_messages')
        .select('sender, content, created_at, employees(name)')
        .eq('channel_id', msg.channel_id)
        .lt('created_at', msg.created_at)
        .order('created_at', { ascending: false })
        .limit(10);

      const recentContext = (contextMsgs || []).map((m: Record<string, unknown>) => ({
        sender: (m.employees as { name: string } | null)?.name || String(m.sender),
        content: String(m.content),
        timestamp: String(m.created_at),
      }));

      // Call Claude for analysis
      const analysis = await analyzeMessage(
        msg.content,
        (msg.employees as { name: string } | null)?.name || msg.sender,
        msg.channel_name,
        objectivesContext,
        recentContext
      );

      // Resolve objective/task IDs from titles
      let relatedObjectiveId: string | null = null;
      let relatedTaskId: string | null = null;

      if (analysis.relatedObjectiveTitle) {
        const { data: obj } = await supabase
          .from('objectives')
          .select('id')
          .ilike('title', `%${analysis.relatedObjectiveTitle}%`)
          .limit(1)
          .maybeSingle();
        relatedObjectiveId = obj?.id || null;
      }

      if (analysis.relatedTaskTitle && relatedObjectiveId) {
        const { data: task } = await supabase
          .from('tasks')
          .select('id')
          .eq('objective_id', relatedObjectiveId)
          .ilike('title', `%${analysis.relatedTaskTitle}%`)
          .limit(1)
          .maybeSingle();
        relatedTaskId = task?.id || null;
      }

      // Insert analysis
      await supabase.from('message_analyses').insert({
        raven_message_id: msg.id,
        employee_id: msg.employee_id,
        related_objective_id: relatedObjectiveId,
        related_task_id: relatedTaskId,
        category: analysis.category,
        sentiment: analysis.sentiment,
        productivity_score: analysis.productivityScore,
        summary: analysis.summary,
        key_topics: analysis.keyTopics,
        blocker_detected: analysis.blockerDetected,
        blocker_description: analysis.blockerDescription,
        raw_ai_response: analysis as unknown as Record<string, unknown>,
      });

      // Mark message as processed
      await supabase
        .from('raven_messages')
        .update({ processed: true })
        .eq('id', msg.id);

      processedCount++;

      // Throttle: 4s between calls → ~15 req/min, well within Claude's 50 RPM limit
      if (processedCount < messages.length) {
        await new Promise(r => setTimeout(r, 4_000));
      }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      errors.push(`Message ${msg.id}: ${message}`);

      // Do NOT mark rate-limited messages as processed — leave them for retry
      const isRateLimit =
        message.includes('429') ||
        message.includes('rate_limit') ||
        message.includes('Too Many Requests');

      if (!isRateLimit) {
        // Non-retriable error (bad JSON, network, etc.) — mark processed to avoid infinite loops
        await supabase
          .from('raven_messages')
          .update({ processed: true })
          .eq('id', msg.id);
      }
    }
  }

  const remaining = Math.max(0, (totalPending ?? 0) - processedCount);
  return { processedCount, errors, remaining };
}
