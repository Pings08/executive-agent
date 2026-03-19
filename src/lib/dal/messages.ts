import { SupabaseClient } from '@supabase/supabase-js';
import { RavenMessage, MessageAnalysis } from '@/types';

export async function fetchRecentMessages(
  supabase: SupabaseClient,
  limit = 50
): Promise<RavenMessage[]> {
  const { data, error } = await supabase
    .from('raven_messages')
    .select('*, employees(name)')
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error) throw error;

  return (data || []).map(msg => ({
    id: msg.id,
    ravenMessageId: msg.raven_message_id,
    channelId: msg.channel_id ?? undefined,
    channelName: msg.channel_name ?? undefined,
    sender: msg.sender,
    content: msg.content,
    messageType: msg.message_type,
    employeeId: msg.employee_id ?? undefined,
    employeeName: msg.employees?.name ?? undefined,
    createdAt: msg.created_at,
    processed: msg.processed,
  }));
}

export async function fetchUnprocessedMessages(supabase: SupabaseClient, limit = 20) {
  const { data, error } = await supabase
    .from('raven_messages')
    .select('*, employees(name)')
    .eq('processed', false)
    .order('created_at', { ascending: true })
    .limit(limit);

  if (error) throw error;
  return data || [];
}

export async function insertMessages(
  supabase: SupabaseClient,
  messages: {
    raven_message_id: string;
    channel_id: string | null;
    channel_name?: string | null;
    sender: string;
    content: string;
    message_type: string;
    raw_json: Record<string, unknown>;
    created_at: string;
    employee_id: string | null;
  }[]
) {
  if (messages.length === 0) return { count: 0 };

  const { error } = await supabase
    .from('raven_messages')
    .upsert(messages, { onConflict: 'raven_message_id', ignoreDuplicates: true });

  if (error) throw error;
  return { count: messages.length };
}

export async function markMessageProcessed(supabase: SupabaseClient, id: string) {
  const { error } = await supabase
    .from('raven_messages')
    .update({ processed: true })
    .eq('id', id);
  if (error) throw error;
}

export async function insertAnalysis(
  supabase: SupabaseClient,
  analysis: {
    raven_message_id: string;
    employee_id: string | null;
    related_objective_id: string | null;
    related_task_id: string | null;
    category: string;
    sentiment: string;
    productivity_score: number | null;
    summary: string | null;
    key_topics: string[] | null;
    blocker_detected: boolean;
    blocker_description: string | null;
    raw_ai_response: Record<string, unknown> | null;
  }
) {
  const { data, error } = await supabase
    .from('message_analyses')
    .insert(analysis)
    .select()
    .single();

  if (error) throw error;
  return data;
}

export async function fetchAnalyses(
  supabase: SupabaseClient,
  filters?: {
    employeeId?: string;
    objectiveId?: string;
    blockerOnly?: boolean;
    limit?: number;
  }
): Promise<MessageAnalysis[]> {
  let query = supabase
    .from('message_analyses')
    .select('*, employees(name), objectives(title), raven_messages(content)')
    .order('created_at', { ascending: false })
    .limit(filters?.limit ?? 50);

  if (filters?.employeeId) query = query.eq('employee_id', filters.employeeId);
  if (filters?.objectiveId) query = query.eq('related_objective_id', filters.objectiveId);
  if (filters?.blockerOnly) query = query.eq('blocker_detected', true);

  const { data, error } = await query;
  if (error) throw error;

  return (data || []).map(a => ({
    id: a.id,
    ravenMessageId: a.raven_message_id,
    employeeId: a.employee_id ?? undefined,
    employeeName: a.employees?.name ?? undefined,
    relatedObjectiveId: a.related_objective_id ?? undefined,
    relatedObjectiveTitle: a.objectives?.title ?? undefined,
    relatedTaskId: a.related_task_id ?? undefined,
    category: a.category,
    sentiment: a.sentiment,
    productivityScore: a.productivity_score ?? undefined,
    summary: a.summary ?? undefined,
    keyTopics: a.key_topics ?? undefined,
    blockerDetected: a.blocker_detected,
    blockerDescription: a.blocker_description ?? undefined,
    messageContent: a.raven_messages?.content ?? undefined,
    createdAt: a.created_at,
  }));
}
