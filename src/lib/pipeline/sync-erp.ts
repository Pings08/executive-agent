import { createAdminClient } from '@/lib/supabase/admin';
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
  const supabase = createAdminClient();
  const raven = new RavenClient();
  const errors: string[] = [];

  // Sync employees
  let empCount = 0;
  try {
    const rawEmployees = await raven.fetchEmployees();
    const empRows = rawEmployees.map(emp => ({
      erp_id: String(emp.name),
      name: String(emp.employee_name || 'Unknown'),
      email: emp.email_id ? String(emp.email_id) : null,
      role: String(emp.designation || 'Employee'),
      raven_user: emp.user_id ? String(emp.user_id) : null,
      status: String(emp.status || 'active').toLowerCase() === 'left' ? 'inactive' : 'active',
      date_of_joining: emp.date_of_joining ? String(emp.date_of_joining) : null,
    }));

    const { error } = await supabase
      .from('employees')
      .upsert(empRows, { onConflict: 'erp_id' });

    if (error) errors.push(`Employees: ${error.message}`);
    empCount = empRows.length;
  } catch (err) {
    errors.push(`Employees fetch: ${err}`);
  }

  // Sync projects -> objectives
  let objCount = 0;
  try {
    const rawProjects = await raven.fetchProjects();
    const objRows = rawProjects.map(proj => ({
      erp_id: String(proj.name),
      title: String(proj.project_name || 'Untitled'),
      description: String(proj.description || ''),
      status: mapERPStatus(String(proj.status || '')),
      priority: mapERPPriority(String(proj.priority || '')),
      start_date: proj.expected_start_date ? String(proj.expected_start_date) : null,
      end_date: proj.exp_end_date ? String(proj.exp_end_date) : null,
    }));

    const { error } = await supabase
      .from('objectives')
      .upsert(objRows, { onConflict: 'erp_id' });

    if (error) errors.push(`Objectives: ${error.message}`);
    objCount = objRows.length;
  } catch (err) {
    errors.push(`Projects fetch: ${err}`);
  }

  // Sync tasks
  let taskCount = 0;
  try {
    // Get ID mappings
    const { data: objectives } = await supabase
      .from('objectives')
      .select('id, erp_id');
    const objMap = new Map(objectives?.map(o => [o.erp_id, o.id]) || []);

    const { data: dbEmployees } = await supabase
      .from('employees')
      .select('id, erp_id');
    const empMap = new Map(dbEmployees?.map(e => [e.erp_id, e.id]) || []);

    const rawTasks = await raven.fetchTasks();
    const taskRows = rawTasks
      .filter(t => t.project && objMap.has(String(t.project)))
      .map(task => ({
        erp_id: String(task.name),
        objective_id: objMap.get(String(task.project))!,
        title: String(task.subject || 'Untitled Task'),
        description: String(task.description || ''),
        status: mapERPStatus(String(task.status || '')),
        start_date: task.exp_start_date ? String(task.exp_start_date) : null,
        end_date: task.exp_end_date ? String(task.exp_end_date) : null,
        assignee_id: task._assign ? empMap.get(String(task._assign)) || null : null,
      }));

    const { error } = await supabase
      .from('tasks')
      .upsert(taskRows, { onConflict: 'erp_id' });

    if (error) errors.push(`Tasks: ${error.message}`);
    taskCount = taskRows.length;
  } catch (err) {
    errors.push(`Tasks fetch: ${err}`);
  }

  return { employees: empCount, objectives: objCount, tasks: taskCount, errors };
}
