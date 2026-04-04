import { getDb, now, toJson } from '@/lib/d1/client';

/**
 * Assign employees to orgs using ERPNext workspace membership + email domain.
 *
 * Priority:
 *   1. Email domain: @exrna.com → biotech, @technoculture.io → tcr
 *   2. ERPNext workspace membership (primary workspace)
 *   3. Fallback: message activity patterns
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

const DOMAIN_TO_ORG: Record<string, Org> = {
  'exrna.com': 'biotech',
  'technoculture.io': 'tcr',
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

function getOrgByEmail(email: string | null): Org | null {
  if (!email) return null;
  const domain = email.split('@')[1]?.toLowerCase();
  return domain ? DOMAIN_TO_ORG[domain] || null : null;
}

function getPrimaryOrg(email: string | null, workspaces: string[]): Org | null {
  // 1. Email domain takes priority
  const domainOrg = getOrgByEmail(email);
  if (domainOrg) return domainOrg;

  // 2. Workspace membership
  const wsSet = new Set(workspaces);

  // If only in biotech workspaces
  if (wsSet.size > 0 && [...wsSet].every(w => w === 'ExRNA' || w === 'VV Biotech')) {
    return 'biotech';
  }

  // If only in Technoculture (not in ExRNA/VVB)
  if (wsSet.has('Technoculture') && !wsSet.has('ExRNA') && !wsSet.has('VV Biotech') && !wsSet.has('Sentient')) {
    return 'tcr';
  }

  // If only in Sentient
  if (wsSet.has('Sentient') && !wsSet.has('Technoculture') && !wsSet.has('ExRNA') && !wsSet.has('VV Biotech')) {
    return 'sentient_x';
  }

  // In multiple orgs — determine by non-biotech membership
  // (since ExRNA/VVB are the most common, check for TCR/Sentient specifically)
  if (wsSet.has('Sentient') && !wsSet.has('Technoculture')) return 'sentient_x';
  if (wsSet.has('Technoculture') && !wsSet.has('Sentient')) return 'tcr';

  // In both TCR and Sentient — default to TCR
  if (wsSet.has('Technoculture')) return 'tcr';

  // Fallback
  if (wsSet.has('ExRNA') || wsSet.has('VV Biotech')) return 'biotech';

  return null;
}

export async function fetchAndAssignOrgs(): Promise<{
  total: number;
  assigned: Record<Org, number>;
  unassigned: string[];
}> {
  const db = getDb();

  // 1. Fetch workspace memberships from ERPNext
  const wsMemberships = await fetchRaven<{ user: string; workspace: string }>(
    'Raven Workspace Member', ['user', 'workspace'], undefined, 1000,
  );

  // Build user → workspaces map
  const userWorkspaces = new Map<string, string[]>();
  for (const m of wsMemberships) {
    if (m.user === 'Administrator') continue;
    if (!userWorkspaces.has(m.user)) userWorkspaces.set(m.user, []);
    userWorkspaces.get(m.user)!.push(m.workspace);
  }

  // 2. Fetch all active employees from D1
  const { results: empList } = await db
    .prepare('SELECT id, name, email, raven_user FROM employees WHERE status = ?')
    .bind('active')
    .all<{ id: string; name: string; email: string | null; raven_user: string | null }>();

  if (!empList || empList.length === 0) {
    return { total: 0, assigned: { biotech: 0, tcr: 0, sentient_x: 0 }, unassigned: [] };
  }

  // 3. Assign each employee to an org
  const assignments: Record<string, Org> = {};
  const counters: Record<Org, number> = { biotech: 0, tcr: 0, sentient_x: 0 };
  const unassigned: string[] = [];

  for (const emp of empList) {
    const ravenEmail = emp.raven_user || emp.email;
    const workspaces = userWorkspaces.get(ravenEmail || '') || [];

    const org = getPrimaryOrg(ravenEmail, workspaces);

    if (org) {
      assignments[emp.id] = org;
      counters[org]++;
    } else {
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
    // Batch in chunks of 50 to avoid D1 limits
    for (let i = 0; i < updateStmts.length; i += 50) {
      await db.batch(updateStmts.slice(i, i + 50));
    }
  }

  return { total: empList.length, assigned: counters, unassigned };
}
