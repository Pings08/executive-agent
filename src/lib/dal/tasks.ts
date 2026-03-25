import { Status } from '@/types';
import { newId, now } from '@/lib/d1/client';

export async function createTask(
  db: D1Database,
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
  const id = newId();
  const timestamp = now();

  await db
    .prepare(
      `INSERT INTO tasks (id, objective_id, parent_task_id, title, description, status, assignee_id, start_date, end_date, progress_percentage, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`
    )
    .bind(
      id,
      data.objectiveId,
      data.parentTaskId || null,
      data.title,
      data.description,
      data.status,
      data.assigneeId || null,
      data.startDate || null,
      data.endDate || null,
      timestamp,
      timestamp
    )
    .run();

  // Fetch the created row since D1 has no RETURNING
  const task = await db.prepare('SELECT * FROM tasks WHERE id = ?').bind(id).first();
  return task;
}

export async function updateTask(
  db: D1Database,
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
  const setClauses: string[] = [];
  const values: unknown[] = [];

  if (updates.title !== undefined) { setClauses.push('title = ?'); values.push(updates.title); }
  if (updates.description !== undefined) { setClauses.push('description = ?'); values.push(updates.description); }
  if (updates.status !== undefined) { setClauses.push('status = ?'); values.push(updates.status); }
  if (updates.assigneeId !== undefined) { setClauses.push('assignee_id = ?'); values.push(updates.assigneeId || null); }
  if (updates.startDate !== undefined) { setClauses.push('start_date = ?'); values.push(updates.startDate || null); }
  if (updates.endDate !== undefined) { setClauses.push('end_date = ?'); values.push(updates.endDate || null); }
  if (updates.progressPercentage !== undefined) { setClauses.push('progress_percentage = ?'); values.push(updates.progressPercentage); }

  if (setClauses.length === 0) return;

  setClauses.push('updated_at = ?');
  values.push(now());
  values.push(id);

  await db
    .prepare(`UPDATE tasks SET ${setClauses.join(', ')} WHERE id = ?`)
    .bind(...values)
    .run();
}

export async function deleteTask(db: D1Database, id: string) {
  await db.prepare('DELETE FROM tasks WHERE id = ?').bind(id).run();
}
