import { NextResponse } from 'next/server';
import { getDb } from '@/lib/d1/client';

const BASE = process.env.ERPNEXT_BASE_URL!;
const AUTH = `token ${process.env.ERPNEXT_API_KEY}:${process.env.ERPNEXT_API_SECRET}`;
const HEADERS = { Authorization: AUTH, 'Content-Type': 'application/json' };

async function fetchRaven<T>(doctype: string, fields: string[], filters?: unknown[][], limit = 500): Promise<T[]> {
  const url = new URL(`${BASE}/api/resource/${encodeURIComponent(doctype)}`);
  url.searchParams.set('fields', JSON.stringify(fields));
  url.searchParams.set('limit_page_length', String(limit));
  if (filters) url.searchParams.set('filters', JSON.stringify(filters));
  const res = await fetch(url.toString(), { headers: HEADERS });
  if (!res.ok) throw new Error(`${doctype} fetch failed: ${res.status}`);
  const data = await res.json();
  return data.data || [];
}

export async function GET() {
  try {
    const db = getDb();

    // Fetch workspaces, members, enabled users from ERPNext and employees from D1 in parallel
    const [workspaces, members, enabledUsers, empResults] = await Promise.all([
      fetchRaven<{ name: string; workspace_name: string; description: string }>('Raven Workspace', ['name', 'workspace_name', 'description']),
      fetchRaven<{ user: string; workspace: string }>('Raven Workspace Member', ['user', 'workspace'], undefined, 1000),
      fetchRaven<{ name: string }>('User', ['name'], [['enabled', '=', 1]], 1000),
      db
        .prepare("SELECT id, name, email, role, raven_user FROM employees WHERE status = 'active'")
        .all<{ id: string; name: string; email: string | null; role: string; raven_user: string | null }>(),
    ]);

    // Build set of enabled user emails for fast lookup
    const enabledSet = new Set(enabledUsers.map(u => u.name.toLowerCase()));

    const empList = empResults.results || [];

    // Build user -> employee lookup (by email or raven_user)
    const empByEmail = new Map(empList.map(e => [e.email?.toLowerCase(), e]));
    const empByRaven = new Map(empList.map(e => [e.raven_user?.toLowerCase(), e]));

    const resolveEmployee = (userId: string) => {
      const u = userId.toLowerCase();
      return empByEmail.get(u) || empByRaven.get(u) || null;
    };

    // Group members by workspace, resolve to employees
    const workspaceMap = new Map<string, Set<string>>();
    for (const m of members) {
      if (!workspaceMap.has(m.workspace)) workspaceMap.set(m.workspace, new Set());
      workspaceMap.get(m.workspace)!.add(m.user);
    }

    const result = workspaces.map(ws => {
      const userIds = [...(workspaceMap.get(ws.name) || [])];
      const resolvedMembers = userIds
        .map(userId => {
          const emp = resolveEmployee(userId);
          return emp
            ? { id: emp.id, name: emp.name, role: emp.role, email: userId }
            : { id: null, name: userId.split('@')[0].replace(/[._]/g, ' ').replace(/\b\w/g, c => c.toUpperCase()), role: 'External', email: userId };
        })
        .filter(m => m.email !== 'Administrator' && enabledSet.has(m.email.toLowerCase()))
        .sort((a, b) => a.name.localeCompare(b.name));

      return {
        name: ws.name,
        label: ws.workspace_name,
        description: ws.description || '',
        members: resolvedMembers,
      };
    });

    return NextResponse.json({ workspaces: result });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
