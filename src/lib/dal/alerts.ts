import { SupabaseClient } from '@supabase/supabase-js';
import { Alert } from '@/types';

export async function fetchAlerts(
  supabase: SupabaseClient,
  filters?: {
    unreadOnly?: boolean;
    unresolvedOnly?: boolean;
    severity?: string;
    limit?: number;
  }
): Promise<Alert[]> {
  let query = supabase
    .from('alerts')
    .select('*, employees(name), objectives(title)')
    .order('created_at', { ascending: false })
    .limit(filters?.limit ?? 50);

  if (filters?.unreadOnly) query = query.eq('is_read', false);
  if (filters?.unresolvedOnly) query = query.eq('is_resolved', false);
  if (filters?.severity) query = query.eq('severity', filters.severity);

  const { data, error } = await query;
  if (error) throw error;

  return (data || []).map(a => ({
    id: a.id,
    type: a.type,
    severity: a.severity,
    title: a.title,
    description: a.description,
    employeeId: a.employee_id ?? undefined,
    employeeName: a.employees?.name ?? undefined,
    objectiveId: a.objective_id ?? undefined,
    objectiveTitle: a.objectives?.title ?? undefined,
    isRead: a.is_read,
    isResolved: a.is_resolved,
    createdAt: a.created_at,
  }));
}

export async function createAlert(
  supabase: SupabaseClient,
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
  const { data, error } = await supabase
    .from('alerts')
    .insert(alert)
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function markAlertRead(supabase: SupabaseClient, id: string) {
  const { error } = await supabase
    .from('alerts')
    .update({ is_read: true })
    .eq('id', id);
  if (error) throw error;
}

export async function resolveAlert(supabase: SupabaseClient, id: string) {
  const { error } = await supabase
    .from('alerts')
    .update({ is_resolved: true, resolved_at: new Date().toISOString() })
    .eq('id', id);
  if (error) throw error;
}

export async function fetchUnreadAlertCount(supabase: SupabaseClient): Promise<number> {
  const { count, error } = await supabase
    .from('alerts')
    .select('*', { count: 'exact', head: true })
    .eq('is_read', false);

  if (error) throw error;
  return count ?? 0;
}
