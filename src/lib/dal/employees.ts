import { DbEmployee } from '@/types/database';
import { Employee } from '@/types';
import { newId, now } from '@/lib/d1/client';

export function mapDbEmployeeToEmployee(dbEmp: DbEmployee): Employee {
  return {
    id: dbEmp.id,
    name: dbEmp.name,
    email: dbEmp.email ?? '',
    role: dbEmp.role,
    avatar: dbEmp.avatar_url ?? undefined,
    status: dbEmp.status,
    ravenUser: dbEmp.raven_user ?? undefined,
    workspace: dbEmp.workspace ?? undefined,
    dateOfJoining: dbEmp.date_of_joining ?? undefined,
    createdAt: dbEmp.created_at,
  };
}

export async function fetchEmployees(db: D1Database): Promise<Employee[]> {
  const { results } = await db
    .prepare('SELECT * FROM employees ORDER BY name')
    .all<DbEmployee>();

  return (results || []).map(mapDbEmployeeToEmployee);
}

export async function fetchEmployeeById(db: D1Database, id: string): Promise<Employee | null> {
  const row = await db
    .prepare('SELECT * FROM employees WHERE id = ?')
    .bind(id)
    .first<DbEmployee>();

  if (!row) return null;
  return mapDbEmployeeToEmployee(row);
}

export async function upsertEmployee(
  db: D1Database,
  employee: Partial<DbEmployee> & { erp_id: string; name: string }
): Promise<DbEmployee | null> {
  const id = employee.id ?? newId();
  const timestamp = now();

  await db
    .prepare(
      `INSERT INTO employees (id, erp_id, name, email, role, avatar_url, status, date_of_joining, raven_user, workspace, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(erp_id) DO UPDATE SET
         name = excluded.name,
         email = excluded.email,
         role = excluded.role,
         avatar_url = excluded.avatar_url,
         status = excluded.status,
         date_of_joining = excluded.date_of_joining,
         raven_user = excluded.raven_user,
         workspace = excluded.workspace,
         updated_at = excluded.updated_at`
    )
    .bind(
      id,
      employee.erp_id,
      employee.name,
      employee.email ?? null,
      employee.role ?? 'employee',
      employee.avatar_url ?? null,
      employee.status ?? 'active',
      employee.date_of_joining ?? null,
      employee.raven_user ?? null,
      employee.workspace ?? null,
      employee.created_at ?? timestamp,
      timestamp
    )
    .run();

  // D1 has no RETURNING — fetch the row after upsert
  const row = await db
    .prepare('SELECT * FROM employees WHERE erp_id = ?')
    .bind(employee.erp_id)
    .first<DbEmployee>();

  return row ?? null;
}
