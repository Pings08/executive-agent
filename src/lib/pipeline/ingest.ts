import { getDb, newId, now, toJson, parseJson } from '@/lib/d1/client';
import { RavenClient } from '@/lib/raven/client';

export async function ingestRavenMessages(): Promise<{
  ingestedCount: number;
  errors: string[];
}> {
  const db = getDb();
  const errors: string[] = [];

  // 1. Get cursor (shared across all users — tracks highest creation seen)
  const stateRow = await db
    .prepare('SELECT value FROM pipeline_state WHERE key = ?')
    .bind('raven_last_sync')
    .first<{ value: string }>();

  const stateValue = parseJson<{ last_message_creation?: string }>(stateRow?.value);
  const lastCreation = stateValue?.last_message_creation || null;

  // 2. Fetch employees that have API keys stored (per-user fetch)
  //    Plus always run the default key (Satyam) as a baseline.
  const { results: employees } = await db
    .prepare('SELECT id, raven_user, email, raven_api_key, raven_api_secret FROM employees WHERE status = ?')
    .bind('active')
    .all<{ id: string; raven_user: string | null; email: string | null; raven_api_key: string | null; raven_api_secret: string | null }>();

  // Build a list of API key configs to try.
  // Each entry fetches messages visible to that user's Raven account.
  type KeyConfig = { label: string; key?: string; secret?: string };
  const keyConfigs: KeyConfig[] = [
    { label: 'default' }, // env vars — always run first
  ];
  for (const emp of employees || []) {
    if (emp.raven_api_key && emp.raven_api_secret) {
      const label = emp.raven_user || emp.email || emp.id;
      // Skip if this is the same as the default key (Satyam)
      if (emp.raven_api_key !== process.env.ERPNEXT_API_KEY) {
        keyConfigs.push({ label, key: emp.raven_api_key, secret: emp.raven_api_secret });
      }
    }
  }

  // 3. Collect all raw messages from all users, deduplicated by name (raven_message_id)
  const seenIds = new Set<string>();
  const allRawMessages: Record<string, unknown>[] = [];

  for (const config of keyConfigs) {
    try {
      const raven = new RavenClient(config.key, config.secret);
      const msgs = await raven.fetchMessages(lastCreation ?? undefined, 500);
      for (const msg of msgs) {
        const id = String(msg.name || '');
        if (id && !seenIds.has(id)) {
          seenIds.add(id);
          allRawMessages.push(msg);
        }
      }
    } catch (err) {
      errors.push(`Fetch failed (${config.label}): ${err}`);
    }
  }

  if (allRawMessages.length === 0) {
    return { ingestedCount: 0, errors };
  }

  // 4. Auto-create employees from unique senders not yet in the DB
  const uniqueSenders = [...new Set(allRawMessages.map(m => String(m.owner || '')).filter(Boolean))];

  const { results: existingEmps } = await db
    .prepare('SELECT id, raven_user, email FROM employees')
    .all<{ id: string; raven_user: string | null; email: string | null }>();

  const knownUsers = new Set([
    ...(existingEmps?.map(e => e.raven_user).filter(Boolean) || []),
    ...(existingEmps?.map(e => e.email).filter(Boolean) || []),
  ]);

  // Only create employees for senders not already known by email OR raven_user.
  const newSenders = uniqueSenders.filter(s => !knownUsers.has(s));
  if (newSenders.length > 0) {
    const stmts = newSenders.map(sender => {
      const name = sender.split('@')[0]
        .replace(/[._-]/g, ' ')
        .replace(/\b\w/g, (c: string) => c.toUpperCase());
      return db
        .prepare(
          `INSERT OR IGNORE INTO employees (id, erp_id, name, email, raven_user, role, status)
           VALUES (?, ?, ?, ?, ?, ?, ?)`
        )
        .bind(newId(), sender, name, sender, sender, 'Team Member', 'active');
    });
    await db.batch(stmts);
  }

  // Back-fill raven_user on existing ERP-synced employees that are missing it,
  // so they can be matched when messages arrive (avoids future orphaned messages).
  for (const sender of uniqueSenders) {
    if (knownUsers.has(sender)) {
      // If matched by email but raven_user is null, fill it in
      await db
        .prepare('UPDATE employees SET raven_user = ? WHERE email = ? AND raven_user IS NULL')
        .bind(sender, sender)
        .run();
    }
  }

  // Re-fetch updated employee list
  const { results: updatedEmployees } = await db
    .prepare('SELECT id, raven_user, email FROM employees')
    .all<{ id: string; raven_user: string | null; email: string | null }>();

  const employeeLookup = new Map<string, string>();
  updatedEmployees?.forEach(emp => {
    if (emp.raven_user) employeeLookup.set(emp.raven_user, emp.id);
    if (emp.email) employeeLookup.set(emp.email, emp.id);
  });

  // 5. Map to DB rows
  const rows = allRawMessages.map(msg => ({
    raven_message_id: String(msg.name),
    channel_id: msg.channel_id ? String(msg.channel_id) : null,
    sender: String(msg.owner || ''),
    content: String(msg.content || msg.text || ''),
    message_type: String(msg.message_type || 'text'),
    raw_json: toJson(msg),
    created_at: String(msg.creation),
    employee_id: employeeLookup.get(String(msg.owner)) || null,
  }));

  // 6. Bulk insert (ignore duplicates — deduplication already done above)
  const insertStmts = rows.map(row =>
    db
      .prepare(
        `INSERT OR IGNORE INTO raven_messages (id, raven_message_id, channel_id, sender, content, message_type, raw_json, created_at, employee_id, processed)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0)`
      )
      .bind(
        newId(),
        row.raven_message_id,
        row.channel_id,
        row.sender,
        row.content,
        row.message_type,
        row.raw_json,
        row.created_at,
        row.employee_id,
      )
  );

  try {
    await db.batch(insertStmts);
  } catch (err) {
    errors.push(`Insert error: ${err}`);
  }

  // 6b. Back-fill employee_id for any orphaned messages
  for (const [senderKey, empId] of employeeLookup.entries()) {
    await db
      .prepare('UPDATE raven_messages SET employee_id = ? WHERE sender = ? AND employee_id IS NULL')
      .bind(empId, senderKey)
      .run();
  }

  // 7. Update cursor to the latest message creation timestamp seen
  const latestMsg = allRawMessages.reduce((latest, msg) => {
    const t = String(msg.creation || '');
    return t > String(latest.creation || '') ? msg : latest;
  }, allRawMessages[0]);

  const cursorValue = toJson({
    last_message_creation: String(latestMsg.creation),
    last_sync_at: now(),
  });

  await db
    .prepare(
      `INSERT INTO pipeline_state (key, value, updated_at)
       VALUES (?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
    )
    .bind('raven_last_sync', cursorValue, now())
    .run();

  return { ingestedCount: rows.length, errors };
}
