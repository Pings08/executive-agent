import { Alert } from '@/types';
import { newId, now } from '@/lib/d1/client';

interface DbAlertJoinRow {
  id: string;
  type: string;
  severity: string;
  title: string;
  description: string;
  employee_id: string | null;
  employee_name: string | null;
  objective_id: string | null;
  objective_title: string | null;
  task_id: string | null;
  message_analysis_id: string | null;
  is_read: number; // INTEGER 0/1 in D1
  is_resolved: number; // INTEGER 0/1 in D1
  resolved_at: string | null;
  created_at: string;
}

export async function fetchAlerts(
  db: D1Database,
  filters?: {
    unreadOnly?: boolean;
    unresolvedOnly?: boolean;
    severity?: string;
    limit?: number;
  }
): Promise<Alert[]> {
  const whereClauses: string[] = [];
  const values: unknown[] = [];

  if (filters?.unreadOnly) {
    whereClauses.push('a.is_read = 0');
  }
  if (filters?.unresolvedOnly) {
    whereClauses.push('a.is_resolved = 0');
  }
  if (filters?.severity) {
    whereClauses.push('a.severity = ?');
    values.push(filters.severity);
  }

  const whereSQL = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';
  const limitVal = filters?.limit ?? 50;
  values.push(limitVal);

  const { results } = await db
    .prepare(
      `SELECT a.*, e.name as employee_name, o.title as objective_title
       FROM alerts a
       LEFT JOIN employees e ON a.employee_id = e.id
       LEFT JOIN objectives o ON a.objective_id = o.id
       ${whereSQL}
       ORDER BY a.created_at DESC
       LIMIT ?`
    )
    .bind(...values)
    .all<DbAlertJoinRow>();

  return (results || []).map(a => ({
    id: a.id,
    type: a.type,
    severity: a.severity,
    title: a.title,
    description: a.description,
    employeeId: a.employee_id ?? undefined,
    employeeName: a.employee_name ?? undefined,
    objectiveId: a.objective_id ?? undefined,
    objectiveTitle: a.objective_title ?? undefined,
    isRead: a.is_read === 1,
    isResolved: a.is_resolved === 1,
    createdAt: a.created_at,
  }));
}

export async function createAlert(
  db: D1Database,
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
  const id = newId();
  const timestamp = now();

  await db
    .prepare(
      `INSERT INTO alerts (id, type, severity, title, description, employee_id, objective_id, task_id, message_analysis_id, is_read, is_resolved, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, ?)`
    )
    .bind(
      id,
      alert.type,
      alert.severity,
      alert.title,
      alert.description,
      alert.employee_id ?? null,
      alert.objective_id ?? null,
      alert.task_id ?? null,
      alert.message_analysis_id ?? null,
      timestamp
    )
    .run();

  // Fetch the created row since D1 has no RETURNING
  const row = await db.prepare('SELECT * FROM alerts WHERE id = ?').bind(id).first();
  return row;
}

export async function markAlertRead(db: D1Database, id: string) {
  await db
    .prepare('UPDATE alerts SET is_read = 1 WHERE id = ?')
    .bind(id)
    .run();
}

export async function resolveAlert(db: D1Database, id: string) {
  await db
    .prepare('UPDATE alerts SET is_resolved = 1, resolved_at = ? WHERE id = ?')
    .bind(now(), id)
    .run();
}

export async function fetchUnreadAlertCount(db: D1Database): Promise<number> {
  const row = await db
    .prepare('SELECT COUNT(*) as count FROM alerts WHERE is_read = 0')
    .first<{ count: number }>();

  return row?.count ?? 0;
}
