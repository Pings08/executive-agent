import { SupabaseClient } from '@supabase/supabase-js';
import { Status } from '@/types';

export async function createTask(
  supabase: SupabaseClient,
  data: {
    objectiveId: string;
    parentTaskId?: string;
    title: string;
    description: string;
    status: Status;
    assigneeId?: string;
    startDate?: string;
    endDate?: string;
  }
) {
  const { data: task, error } = await supabase
    .from('tasks')
    .insert({
      objective_id: data.objectiveId,
      parent_task_id: data.parentTaskId || null,
      title: data.title,
      description: data.description,
      status: data.status,
      assignee_id: data.assigneeId || null,
      start_date: data.startDate || null,
      end_date: data.endDate || null,
    })
    .select()
    .single();

  if (error) throw error;
  return task;
}

export async function updateTask(
  supabase: SupabaseClient,
  id: string,
  updates: Partial<{
    title: string;
    description: string;
    status: Status;
    assigneeId: string;
    startDate: string;
    endDate: string;
    progressPercentage: number;
  }>
) {
  const dbUpdates: Record<string, unknown> = {};
  if (updates.title !== undefined) dbUpdates.title = updates.title;
  if (updates.description !== undefined) dbUpdates.description = updates.description;
  if (updates.status !== undefined) dbUpdates.status = updates.status;
  if (updates.assigneeId !== undefined) dbUpdates.assignee_id = updates.assigneeId || null;
  if (updates.startDate !== undefined) dbUpdates.start_date = updates.startDate || null;
  if (updates.endDate !== undefined) dbUpdates.end_date = updates.endDate || null;
  if (updates.progressPercentage !== undefined) dbUpdates.progress_percentage = updates.progressPercentage;

  const { error } = await supabase.from('tasks').update(dbUpdates).eq('id', id);
  if (error) throw error;
}

export async function deleteTask(supabase: SupabaseClient, id: string) {
  const { error } = await supabase.from('tasks').delete().eq('id', id);
  if (error) throw error;
}
