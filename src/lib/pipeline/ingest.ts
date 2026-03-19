import { createAdminClient } from '@/lib/supabase/admin';
import { RavenClient } from '@/lib/raven/client';

export async function ingestRavenMessages(): Promise<{
  ingestedCount: number;
  errors: string[];
}> {
  const supabase = createAdminClient();
  const errors: string[] = [];

  // 1. Get cursor (shared across all users — tracks highest creation seen)
  const { data: stateRow } = await supabase
    .from('pipeline_state')
    .select('value')
    .eq('key', 'raven_last_sync')
    .single();

  const lastCreation = stateRow?.value?.last_message_creation || null;

  // 2. Fetch employees that have API keys stored (per-user fetch)
  //    Plus always run the default key (Satyam) as a baseline.
  const { data: employees } = await supabase
    .from('employees')
    .select('id, raven_user, email, raven_api_key, raven_api_secret')
    .eq('status', 'active');

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
      const msgs = await raven.fetchMessages(lastCreation, 500);
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

  const { data: existingEmps } = await supabase
    .from('employees')
    .select('id, raven_user, email');

  const knownUsers = new Set([
    ...(existingEmps?.map(e => e.raven_user).filter(Boolean) || []),
    ...(existingEmps?.map(e => e.email).filter(Boolean) || []),
  ]);

  const newSenders = uniqueSenders.filter(s => !knownUsers.has(s));
  if (newSenders.length > 0) {
    const newEmpRows = newSenders.map(sender => ({
      erp_id: sender,
      name: sender.split('@')[0]
        .replace(/[._-]/g, ' ')
        .replace(/\b\w/g, (c: string) => c.toUpperCase()),
      email: sender,
      raven_user: sender,
      role: 'Team Member',
      status: 'active',
    }));
    await supabase.from('employees').upsert(newEmpRows, { onConflict: 'erp_id', ignoreDuplicates: true });
  }

  // Re-fetch updated employee list
  const { data: updatedEmployees } = await supabase
    .from('employees')
    .select('id, raven_user, email');

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
    raw_json: msg,
    created_at: String(msg.creation),
    employee_id: employeeLookup.get(String(msg.owner)) || null,
  }));

  // 6. Bulk insert (ignore duplicates — deduplication already done above)
  const { error } = await supabase
    .from('raven_messages')
    .upsert(rows, { onConflict: 'raven_message_id', ignoreDuplicates: true });

  if (error) {
    errors.push(`Insert error: ${error.message}`);
  }

  // 6b. Back-fill employee_id for any orphaned messages
  for (const [senderKey, empId] of employeeLookup.entries()) {
    await supabase
      .from('raven_messages')
      .update({ employee_id: empId })
      .eq('sender', senderKey)
      .is('employee_id', null);
  }

  // 7. Update cursor to the latest message creation timestamp seen
  const latestMsg = allRawMessages.reduce((latest, msg) => {
    const t = String(msg.creation || '');
    return t > String(latest.creation || '') ? msg : latest;
  }, allRawMessages[0]);

  await supabase
    .from('pipeline_state')
    .update({
      value: {
        last_message_creation: String(latestMsg.creation),
        last_sync_at: new Date().toISOString(),
      },
    })
    .eq('key', 'raven_last_sync');

  return { ingestedCount: rows.length, errors };
}
