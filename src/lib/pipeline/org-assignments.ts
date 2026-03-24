import { getDb, now, toJson } from '@/lib/d1/client';

/**
 * Auto-assign employees to orgs based on WHERE THEY ACTUALLY POST MESSAGES
 * in Raven — not workspace membership (which is too broad).
 *
 * Logic:
 *   1. Fetch channel → workspace mapping from Raven
 *   2. Count each employee's messages per workspace (from raven_messages in D1)
 *   3. Assign to the workspace where they post MOST messages
 *
 * Workspace → Org mapping:
 *   ExRNA / VV Biotech → biotech
 *   Technoculture      → tcr
 *   Sentient           → sentient_x
 */

export type Org = 'biotech' | 'tcr' | 'sentient_x';

const BASE = process.env.ERPNEXT_BASE_URL!;
const AUTH = `token ${process.env.ERPNEXT_API_KEY}:${process.env.ERPNEXT_API_SECRET}`;
const HEADERS = { Authorization: AUTH, 'Content-Type': 'application/json' };

const WORKSPACE_TO_ORG: Record<string, Org> = {
  'ExRNA': 'biotech',
  'VV Biotech': 'biotech',
  'Technoculture': 'tcr',
  'Sentient': 'sentient_x',
};

async function fetchRaven<T>(
  doctype: string, fields: string[], filters?: unknown[][], limit = 500,
): Promise<T[]> {
  const url = new URL(`${BASE}/api/resource/${encodeURIComponent(doctype)}`);
  url.searchParams.set('fields', JSON.stringify(fields));
  url.searchParams.set('limit_page_length', String(limit));
  if (filters) url.searchParams.set('filters', JSON.stringify(filters));
  const res = await fetch(url.toString(), { headers: HEADERS });
  if (!res.ok) throw new Error(`${doctype} fetch failed: ${res.status}`);
  const data = await res.json();
  return data.data || [];
}

export async function fetchAndAssignOrgs(): Promise<{
  total: number;
  assigned: Record<Org, number>;
  unassigned: string[];
}> {
  const db = getDb();

  // 1. Fetch channel → workspace mapping from Raven
  const channels = await fetchRaven<{ name: string; workspace: string | null }>(
    'Raven Channel', ['name', 'workspace'], undefined, 500,
  );

  // Build channel_id → org lookup
  const channelOrg = new Map<string, Org>();
  for (const ch of channels) {
    if (ch.workspace) {
      const org = WORKSPACE_TO_ORG[ch.workspace];
      if (org) channelOrg.set(ch.name, org);
    }
  }

  // 2. Fetch all active employees
  const { results: empList } = await db
    .prepare('SELECT id, name, email, raven_user FROM employees WHERE status = ?')
    .bind('active')
    .all<{ id: string; name: string; email: string | null; raven_user: string | null }>();

  if (!empList || empList.length === 0) {
    return { total: 0, assigned: { biotech: 0, tcr: 0, sentient_x: 0 }, unassigned: [] };
  }

  // 3. For each employee, count messages per org by looking at channel_id
  const assignments: Record<string, Org> = {};
  const counters: Record<Org, number> = { biotech: 0, tcr: 0, sentient_x: 0 };
  const unassigned: string[] = [];

  for (const emp of empList) {
    // Fetch this employee's messages with channel_id
    const { results: msgs } = await db
      .prepare(
        `SELECT channel_id FROM raven_messages
         WHERE employee_id = ? AND channel_id IS NOT NULL
         LIMIT 500`
      )
      .bind(emp.id)
      .all<{ channel_id: string }>();

    if (!msgs || msgs.length === 0) {
      unassigned.push(emp.name);
      continue;
    }

    // Count messages per org
    const orgCount: Record<Org, number> = { biotech: 0, tcr: 0, sentient_x: 0 };
    for (const m of msgs) {
      const org = channelOrg.get(m.channel_id);
      if (org) orgCount[org]++;
    }

    // Assign to the org with the most messages
    const topOrg = (Object.entries(orgCount) as [Org, number][])
      .filter(([, count]) => count > 0)
      .sort((a, b) => b[1] - a[1])[0];

    if (topOrg) {
      assignments[emp.id] = topOrg[0];
      counters[topOrg[0]]++;
    } else {
      // Messages are in channels that don't belong to any workspace (DMs etc.)
      unassigned.push(emp.name);
    }
  }

  // 4. Store in pipeline_state
  await db
    .prepare(
      `INSERT INTO pipeline_state (key, value, updated_at)
       VALUES (?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
    )
    .bind('org_assignments', toJson({ assignments, updated_at: now() }), now())
    .run();

  // 5. Update employee workspace column
  const updateStmts = Object.entries(assignments).map(([empId, org]) =>
    db.prepare('UPDATE employees SET workspace = ? WHERE id = ?').bind(org, empId)
  );
  if (updateStmts.length > 0) {
    await db.batch(updateStmts);
  }

  return { total: empList.length, assigned: counters, unassigned };
}
