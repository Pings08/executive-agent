import { Objective, SubPoint, Status, Priority } from '@/types';
import { newId, now } from '@/lib/d1/client';

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

interface DbAssigneeRow {
  objective_id: string;
  employee_id: string;
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

function mapDbObjectiveToObjective(
  row: DbObjectiveRow,
  assigneeIds: string[],
  tasks: DbTaskRow[]
): Objective {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    status: row.status as Status,
    priority: row.priority as Priority,
    startDate: row.start_date ?? '',
    endDate: row.end_date ?? '',
    assigneeIds,
    subPoints: buildTaskTree(tasks),
    progressPercentage: row.progress_percentage ?? 0,
    lastActivityAt: row.last_activity_at ?? undefined,
    aiSummary: row.ai_summary ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function fetchObjectives(db: D1Database): Promise<Objective[]> {
  // Run all three queries in parallel via db.batch
  const [objectivesResult, tasksResult, assigneesResult] = await db.batch([
    db.prepare('SELECT * FROM objectives ORDER BY created_at DESC'),
    db.prepare('SELECT * FROM tasks'),
    db.prepare('SELECT objective_id, employee_id FROM objective_assignees'),
  ]);

  const objectives = (objectivesResult.results || []) as unknown as DbObjectiveRow[];
  const allTasks = (tasksResult.results || []) as unknown as DbTaskRow[];
  const allAssignees = (assigneesResult.results || []) as unknown as DbAssigneeRow[];

  // Group tasks and assignees by objective_id
  const tasksByObjective = new Map<string, DbTaskRow[]>();
  for (const t of allTasks) {
    const list = tasksByObjective.get(t.objective_id);
    if (list) list.push(t);
    else tasksByObjective.set(t.objective_id, [t]);
  }

  const assigneesByObjective = new Map<string, string[]>();
  for (const a of allAssignees) {
    const list = assigneesByObjective.get(a.objective_id);
    if (list) list.push(a.employee_id);
    else assigneesByObjective.set(a.objective_id, [a.employee_id]);
  }

  return objectives.map(row =>
    mapDbObjectiveToObjective(
      row,
      assigneesByObjective.get(row.id) || [],
      tasksByObjective.get(row.id) || []
    )
  );
}

export async function createObjective(
  db: D1Database,
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
  const id = newId();
  const timestamp = now();

  await db
    .prepare(
      `INSERT INTO objectives (id, title, description, status, priority, start_date, end_date, progress_percentage, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`
    )
    .bind(
      id,
      data.title,
      data.description,
      data.status,
      data.priority,
      data.startDate || null,
      data.endDate || null,
      timestamp,
      timestamp
    )
    .run();

  // Insert assignees
  if (data.assigneeIds.length > 0) {
    const stmts = data.assigneeIds.map(empId =>
      db
        .prepare('INSERT INTO objective_assignees (objective_id, employee_id) VALUES (?, ?)')
        .bind(id, empId)
    );
    await db.batch(stmts);
  }

  return {
    id,
    title: data.title,
    description: data.description,
    status: data.status,
    priority: data.priority,
    startDate: data.startDate ?? '',
    endDate: data.endDate ?? '',
    assigneeIds: data.assigneeIds,
    subPoints: [],
    progressPercentage: 0,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

export async function updateObjective(
  db: D1Database,
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
  // Build dynamic SET clause
  const setClauses: string[] = [];
  const values: unknown[] = [];

  if (updates.title !== undefined) { setClauses.push('title = ?'); values.push(updates.title); }
  if (updates.description !== undefined) { setClauses.push('description = ?'); values.push(updates.description); }
  if (updates.status !== undefined) { setClauses.push('status = ?'); values.push(updates.status); }
  if (updates.priority !== undefined) { setClauses.push('priority = ?'); values.push(updates.priority); }
  if (updates.startDate !== undefined) { setClauses.push('start_date = ?'); values.push(updates.startDate || null); }
  if (updates.endDate !== undefined) { setClauses.push('end_date = ?'); values.push(updates.endDate || null); }
  if (updates.progressPercentage !== undefined) { setClauses.push('progress_percentage = ?'); values.push(updates.progressPercentage); }
  if (updates.aiSummary !== undefined) { setClauses.push('ai_summary = ?'); values.push(updates.aiSummary); }

  if (setClauses.length > 0) {
    setClauses.push('updated_at = ?');
    values.push(now());
    values.push(id);

    await db
      .prepare(`UPDATE objectives SET ${setClauses.join(', ')} WHERE id = ?`)
      .bind(...values)
      .run();
  }

  if (updates.assigneeIds !== undefined) {
    // Delete existing assignees, then re-insert
    await db.prepare('DELETE FROM objective_assignees WHERE objective_id = ?').bind(id).run();

    if (updates.assigneeIds.length > 0) {
      const stmts = updates.assigneeIds.map(empId =>
        db
          .prepare('INSERT INTO objective_assignees (objective_id, employee_id) VALUES (?, ?)')
          .bind(id, empId)
      );
      await db.batch(stmts);
    }
  }
}

export async function deleteObjective(db: D1Database, id: string): Promise<void> {
  await db.prepare('DELETE FROM objectives WHERE id = ?').bind(id).run();
}
