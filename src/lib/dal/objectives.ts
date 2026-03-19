import { SupabaseClient } from '@supabase/supabase-js';
import { Objective, SubPoint, Status, Priority } from '@/types';

interface DbObjectiveRow {
  id: string;
  erp_id: string | null;
  title: string;
  description: string;
  status: string;
  priority: string;
  start_date: string | null;
  end_date: string | null;
  progress_percentage: number | null;
  last_activity_at: string | null;
  ai_summary: string | null;
  created_at: string;
  updated_at: string;
  objective_assignees: { employee_id: string }[];
  tasks: DbTaskRow[];
}

interface DbTaskRow {
  id: string;
  objective_id: string;
  parent_task_id: string | null;
  title: string;
  description: string;
  status: string;
  assignee_id: string | null;
  start_date: string | null;
  end_date: string | null;
  progress_percentage: number | null;
  created_at: string;
  updated_at: string;
}

function buildTaskTree(tasks: DbTaskRow[], parentId: string | null = null): SubPoint[] {
  return tasks
    .filter(t => t.parent_task_id === parentId)
    .map(t => ({
      id: t.id,
      title: t.title,
      description: t.description,
      status: t.status as Status,
      startDate: t.start_date ?? '',
      endDate: t.end_date ?? '',
      assigneeId: t.assignee_id ?? '',
      progressPercentage: t.progress_percentage ?? 0,
      createdAt: t.created_at,
      updatedAt: t.updated_at,
      subPoints: buildTaskTree(tasks, t.id),
    }));
}

function mapDbObjectiveToObjective(row: DbObjectiveRow): Objective {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    status: row.status as Status,
    priority: row.priority as Priority,
    startDate: row.start_date ?? '',
    endDate: row.end_date ?? '',
    assigneeIds: (row.objective_assignees || []).map(a => a.employee_id),
    subPoints: buildTaskTree(row.tasks || []),
    progressPercentage: row.progress_percentage ?? 0,
    lastActivityAt: row.last_activity_at ?? undefined,
    aiSummary: row.ai_summary ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function fetchObjectives(supabase: SupabaseClient): Promise<Objective[]> {
  const { data, error } = await supabase
    .from('objectives')
    .select('*, objective_assignees(employee_id), tasks(*)')
    .order('created_at', { ascending: false });

  if (error) throw error;
  return (data || []).map((row: DbObjectiveRow) => mapDbObjectiveToObjective(row));
}

export async function createObjective(
  supabase: SupabaseClient,
  data: {
    title: string;
    description: string;
    status: Status;
    priority: Priority;
    startDate: string;
    endDate: string;
    assigneeIds: string[];
  }
): Promise<Objective> {
  const { data: obj, error } = await supabase
    .from('objectives')
    .insert({
      title: data.title,
      description: data.description,
      status: data.status,
      priority: data.priority,
      start_date: data.startDate || null,
      end_date: data.endDate || null,
    })
    .select()
    .single();

  if (error) throw error;

  // Insert assignees
  if (data.assigneeIds.length > 0) {
    await supabase.from('objective_assignees').insert(
      data.assigneeIds.map(empId => ({
        objective_id: obj.id,
        employee_id: empId,
      }))
    );
  }

  return {
    id: obj.id,
    title: obj.title,
    description: obj.description,
    status: obj.status as Status,
    priority: obj.priority as Priority,
    startDate: obj.start_date ?? '',
    endDate: obj.end_date ?? '',
    assigneeIds: data.assigneeIds,
    subPoints: [],
    progressPercentage: 0,
    createdAt: obj.created_at,
    updatedAt: obj.updated_at,
  };
}

export async function updateObjective(
  supabase: SupabaseClient,
  id: string,
  updates: Partial<{
    title: string;
    description: string;
    status: Status;
    priority: Priority;
    startDate: string;
    endDate: string;
    assigneeIds: string[];
    progressPercentage: number;
    aiSummary: string;
  }>
): Promise<void> {
  const dbUpdates: Record<string, unknown> = {};
  if (updates.title !== undefined) dbUpdates.title = updates.title;
  if (updates.description !== undefined) dbUpdates.description = updates.description;
  if (updates.status !== undefined) dbUpdates.status = updates.status;
  if (updates.priority !== undefined) dbUpdates.priority = updates.priority;
  if (updates.startDate !== undefined) dbUpdates.start_date = updates.startDate || null;
  if (updates.endDate !== undefined) dbUpdates.end_date = updates.endDate || null;
  if (updates.progressPercentage !== undefined) dbUpdates.progress_percentage = updates.progressPercentage;
  if (updates.aiSummary !== undefined) dbUpdates.ai_summary = updates.aiSummary;

  if (Object.keys(dbUpdates).length > 0) {
    const { error } = await supabase
      .from('objectives')
      .update(dbUpdates)
      .eq('id', id);
    if (error) throw error;
  }

  if (updates.assigneeIds !== undefined) {
    await supabase.from('objective_assignees').delete().eq('objective_id', id);
    if (updates.assigneeIds.length > 0) {
      await supabase.from('objective_assignees').insert(
        updates.assigneeIds.map(empId => ({
          objective_id: id,
          employee_id: empId,
        }))
      );
    }
  }
}

export async function deleteObjective(supabase: SupabaseClient, id: string): Promise<void> {
  const { error } = await supabase.from('objectives').delete().eq('id', id);
  if (error) throw error;
}
