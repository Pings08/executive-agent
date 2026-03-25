import { getDb, newId, now } from '@/lib/d1/client';
import { RavenClient } from '@/lib/raven/client';

function mapERPStatus(status: string): string {
  const s = status.toLowerCase();
  if (s === 'open' || s === 'working' || s === 'in progress') return 'in_progress';
  if (s === 'completed' || s === 'closed' || s === 'done') return 'completed';
  if (s === 'cancelled' || s === 'blocked' || s === 'hold') return 'blocked';
  return 'not_started';
}

function mapERPPriority(priority: string): string {
  const p = priority.toLowerCase();
  if (p === 'urgent' || p === 'critical') return 'critical';
  if (p === 'high') return 'high';
  if (p === 'low') return 'low';
  return 'medium';
}

export async function syncERPData(): Promise<{
  employees: number;
  objectives: number;
  tasks: number;
  errors: string[];
}> {
  const db = getDb();
  const raven = new RavenClient();
  const errors: string[] = [];

  // Sync employees — merge by email to avoid duplicates when erp_id differs
  let empCount = 0;
  try {
    const rawEmployees = await raven.fetchEmployees();

    // Fetch existing employees indexed by email and erp_id
    const { results: existingEmps } = await db
      .prepare('SELECT id, erp_id, email, raven_user FROM employees')
      .all<{ id: string; erp_id: string; email: string | null; raven_user: string | null }>();

    const byErpId = new Map((existingEmps || []).map(e => [e.erp_id, e]));
    const byEmail = new Map((existingEmps || []).filter(e => e.email).map(e => [e.email!.toLowerCase(), e]));

    const toInsert: { erp_id: string; name: string; email: string | null; role: string; raven_user: string | null; status: string }[] = [];
    const toUpdate: { id: string; fields: { name: string; email: string | null; role: string; raven_user: string | null; status: string } }[] = [];

    for (const emp of rawEmployees) {
      const erp_id = String(emp.name);
      const email = emp.email_id ? String(emp.email_id).toLowerCase() : null;
      const raven_user = emp.user_id ? String(emp.user_id) : (email || null);
      const fields = {
        name: String(emp.employee_name || 'Unknown'),
        email,
        role: String(emp.designation || 'Employee'),
        raven_user,
        status: String(emp.status || 'active').toLowerCase() === 'left' ? 'inactive' : 'active',
      };

      const existing = byErpId.get(erp_id) || (email ? byEmail.get(email) : null);
      if (existing) {
        // Update only — fill in missing raven_user or update name
        toUpdate.push({ id: existing.id, fields: { ...fields, raven_user: raven_user || existing.raven_user } });
      } else {
        toInsert.push({ erp_id, ...fields });
      }
    }

    // Batch updates
    for (const { id, fields } of toUpdate) {
      try {
        await db
          .prepare(
            `UPDATE employees SET name = ?, email = ?, role = ?, raven_user = ?, status = ?, updated_at = ?
             WHERE id = ?`
          )
          .bind(fields.name, fields.email, fields.role, fields.raven_user, fields.status, now(), id)
          .run();
      } catch (err) {
        errors.push(`Employee update ${id}: ${err}`);
      }
    }

    // Batch inserts
    if (toInsert.length > 0) {
      const stmts = toInsert.map(emp =>
        db
          .prepare(
            `INSERT INTO employees (id, erp_id, name, email, raven_user, role, status, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
             ON CONFLICT(erp_id) DO UPDATE SET
               name = excluded.name, email = excluded.email, role = excluded.role,
               raven_user = excluded.raven_user, status = excluded.status, updated_at = excluded.updated_at`
          )
          .bind(newId(), emp.erp_id, emp.name, emp.email, emp.raven_user, emp.role, emp.status, now(), now())
      );
      try {
        await db.batch(stmts);
      } catch (err) {
        errors.push(`Employees insert: ${err}`);
      }
    }

    empCount = rawEmployees.length;
  } catch (err) {
    errors.push(`Employees fetch: ${err}`);
  }

  // Sync projects -> objectives
  let objCount = 0;
  try {
    const rawProjects = await raven.fetchProjects();

    const stmts = rawProjects.map(proj => {
      const erp_id = String(proj.name);
      const title = String(proj.project_name || 'Untitled');
      const description = String(proj.description || '');
      const status = mapERPStatus(String(proj.status || ''));
      const priority = mapERPPriority(String(proj.priority || ''));
      const start_date = proj.expected_start_date ? String(proj.expected_start_date) : null;
      const end_date = proj.exp_end_date ? String(proj.exp_end_date) : null;

      return db
        .prepare(
          `INSERT INTO objectives (id, erp_id, title, description, status, priority, start_date, end_date, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(erp_id) DO UPDATE SET
             title = excluded.title, description = excluded.description, status = excluded.status,
             priority = excluded.priority, start_date = excluded.start_date, end_date = excluded.end_date,
             updated_at = excluded.updated_at`
        )
        .bind(newId(), erp_id, title, description, status, priority, start_date, end_date, now(), now());
    });

    if (stmts.length > 0) {
      try {
        await db.batch(stmts);
      } catch (err) {
        errors.push(`Objectives: ${err}`);
      }
    }
    objCount = rawProjects.length;
  } catch (err) {
    errors.push(`Projects fetch: ${err}`);
  }

  // Sync tasks
  let taskCount = 0;
  try {
    // Get ID mappings
    const { results: objectives } = await db
      .prepare('SELECT id, erp_id FROM objectives')
      .all<{ id: string; erp_id: string }>();
    const objMap = new Map((objectives || []).map(o => [o.erp_id, o.id]));

    const { results: dbEmployees } = await db
      .prepare('SELECT id, erp_id FROM employees')
      .all<{ id: string; erp_id: string }>();
    const empMap = new Map((dbEmployees || []).map(e => [e.erp_id, e.id]));

    const rawTasks = await raven.fetchTasks();
    const filteredTasks = rawTasks.filter(t => t.project && objMap.has(String(t.project)));

    const stmts = filteredTasks.map(task => {
      const erp_id = String(task.name);
      const objective_id = objMap.get(String(task.project))!;
      const title = String(task.subject || 'Untitled Task');
      const description = String(task.description || '');
      const status = mapERPStatus(String(task.status || ''));
      const start_date = task.exp_start_date ? String(task.exp_start_date) : null;
      const end_date = task.exp_end_date ? String(task.exp_end_date) : null;
      const assignee_id = task._assign ? empMap.get(String(task._assign)) || null : null;

      return db
        .prepare(
          `INSERT INTO tasks (id, erp_id, objective_id, title, description, status, start_date, end_date, assignee_id, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(erp_id) DO UPDATE SET
             objective_id = excluded.objective_id, title = excluded.title, description = excluded.description,
             status = excluded.status, start_date = excluded.start_date, end_date = excluded.end_date,
             assignee_id = excluded.assignee_id, updated_at = excluded.updated_at`
        )
        .bind(newId(), erp_id, objective_id, title, description, status, start_date, end_date, assignee_id, now(), now());
    });

    if (stmts.length > 0) {
      try {
        await db.batch(stmts);
      } catch (err) {
        errors.push(`Tasks: ${err}`);
      }
    }
    taskCount = filteredTasks.length;
  } catch (err) {
    errors.push(`Tasks fetch: ${err}`);
  }

  return { employees: empCount, objectives: objCount, tasks: taskCount, errors };
}
