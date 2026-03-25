import { NextResponse } from 'next/server';
import { getDb } from '@/lib/d1/client';

// One-time deduplication: collapses employees with the same email into one record.
// Keeps the row whose erp_id looks like a proper ERP code (not an email address).
// Updates raven_messages.employee_id to point to the kept record, then deletes the rest.
export async function POST() {
  try {
    const db = getDb();

    // 1. Fetch all employees
    const { results: all } = await db
      .prepare('SELECT id, name, email, erp_id, raven_user, status FROM employees ORDER BY created_at ASC')
      .all<{ id: string; name: string; email: string | null; erp_id: string | null; raven_user: string | null; status: string }>();

    if (!all || all.length === 0) {
      return NextResponse.json({ success: true, deduped: 0, updated: 0, errors: [] });
    }

    // 2. Group by email (skip nulls)
    const byEmail = new Map<string, typeof all>();
    for (const emp of all) {
      if (!emp.email) continue;
      const key = emp.email.toLowerCase();
      if (!byEmail.has(key)) byEmail.set(key, []);
      byEmail.get(key)!.push(emp);
    }

    let deduped = 0;
    let updated = 0;
    const errors: string[] = [];

    for (const [, group] of byEmail) {
      if (group.length <= 1) continue;

      // Prefer the record whose erp_id does NOT look like an email (i.e. proper ERP code like VVB005)
      const isEmailErpId = (e: (typeof group)[0]) => e.erp_id?.includes('@');
      const canonical = group.find(e => !isEmailErpId(e)) || group[0];
      const dupes = group.filter(e => e.id !== canonical.id);

      // Ensure canonical has raven_user set (take from a dupe if missing)
      const ravenUser = canonical.raven_user
        || dupes.find(d => d.raven_user)?.raven_user
        || canonical.email;

      if (!canonical.raven_user && ravenUser) {
        await db
          .prepare('UPDATE employees SET raven_user = ? WHERE id = ?')
          .bind(ravenUser, canonical.id)
          .run();
      }

      // 3. Re-point raven_messages from dupe IDs to canonical ID
      for (const dupe of dupes) {
        try {
          await db
            .prepare('UPDATE raven_messages SET employee_id = ? WHERE employee_id = ?')
            .bind(canonical.id, dupe.id)
            .run();
          updated++;
        } catch (e) {
          errors.push(`msg update ${dupe.id}: ${e instanceof Error ? e.message : String(e)}`);
        }

        // 4. Delete the dupe
        try {
          await db
            .prepare('DELETE FROM employees WHERE id = ?')
            .bind(dupe.id)
            .run();
          deduped++;
        } catch (e) {
          errors.push(`delete ${dupe.id}: ${e instanceof Error ? e.message : String(e)}`);
        }
      }
    }

    return NextResponse.json({ success: true, deduped, updated, errors });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
