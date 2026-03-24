import { createAdminClient } from '@/lib/supabase/admin';
import {
  synthesizeCompanyDay, synthesizeCompanyWeek, extractObjectiveHierarchy,
  synthesizeCompanyMonth, computeMonthlyTrajectories,
} from '@/lib/ai/claude-client';
import type { CompanySynthesisResult, MonthlySynthesisResult, EmployeeTrajectory, HypothesisDetected, ProposedObjective, PerformanceScore } from '@/lib/ai/claude-client';

/**
 * Company-level synthesis pipeline — per-org, channel-based filtering.
 *
 * Orgs are determined by Raven workspace → channel_id prefix:
 *   biotech  = channels starting with "ExRNA-" or "VV Biotech-"
 *   tcr      = channels starting with "Technoculture-"
 *   sentient_x = channels starting with "Sentient-"
 *
 * Storage keys in pipeline_state:
 *   snapshot:day:{org}:{YYYY-MM-DD}
 *   snapshot:week:{org}:{YYYY-MM-DD}
 *   inferred_objectives:{org}
 *   synthesis_backfill_cursor:{org}
 */

export type Org = 'biotech' | 'tcr' | 'sentient_x';
const ALL_ORGS: Org[] = ['biotech', 'tcr', 'sentient_x'];

/** Channel prefix patterns for each org */
const ORG_CHANNEL_PREFIXES: Record<Org, string[]> = {
  biotech: ['ExRNA-', 'VV Biotech-'],
  tcr: ['Technoculture-'],
  sentient_x: ['Sentient-'],
};

export interface CompanySnapshot {
  period_type: string;
  period_start: string;
  period_end: string;
  org: string;
  narrative: string;
  employee_narrative?: string;
  key_themes: string[];
  objectives_snapshot: CompanySynthesisResult['objectives_snapshot'];
  hypotheses_detected?: HypothesisDetected[];
  proposed_objectives?: ProposedObjective[];
  performance_scores?: PerformanceScore[];
  blockers: CompanySynthesisResult['blockers'];
  highlights: CompanySynthesisResult['highlights'];
  message_count: number;
  active_employee_count: number;
  created_at: string;
}

export interface InferredObjective {
  id: string;
  title: string;
  description: string;
  level: 'strategic' | 'operational' | 'tactical';
  parent_id: string | null;
  status: string;
  first_seen_at: string;
  last_seen_at: string;
  evidence_summary: string;
  confidence_score: number;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

async function getState(supabase: ReturnType<typeof createAdminClient>, key: string) {
  const { data } = await supabase
    .from('pipeline_state')
    .select('value')
    .eq('key', key)
    .maybeSingle();
  return data?.value ?? null;
}

async function setState(supabase: ReturnType<typeof createAdminClient>, key: string, value: unknown) {
  await supabase
    .from('pipeline_state')
    .upsert({ key, value }, { onConflict: 'key' });
}

/** Build an OR filter for channel_id prefixes matching an org */
function buildChannelFilter(supabase: ReturnType<typeof createAdminClient>, org: Org) {
  const prefixes = ORG_CHANNEL_PREFIXES[org];
  // PostgREST or filter: channel_id.like.PREFIX1%,channel_id.like.PREFIX2%
  return prefixes.map(p => `channel_id.like.${p}%`).join(',');
}

const ORG_LABELS: Record<Org, string> = {
  biotech: 'ExRNA / VV Biotech',
  tcr: 'Technoculture Research (TCR)',
  sentient_x: 'Sentient',
};

// ── Day Synthesis (per org, channel-based) ───────────────────────────────────

export async function synthesizeDay(date: string, org: Org): Promise<{
  snapshotId: string | null;
  messageCount: number;
  employeeCount: number;
  skipped: boolean;
  error: string | null;
}> {
  const supabase = createAdminClient();
  const stateKey = `snapshot:day:${org}:${date}`;

  // Check if already synthesized
  const existing = await getState(supabase, stateKey);
  if (existing?.narrative) {
    return { snapshotId: stateKey, messageCount: existing.message_count || 0, employeeCount: existing.active_employee_count || 0, skipped: true, error: null };
  }

  const dayStart = `${date}T00:00:00.000Z`;
  const dayEnd = `${date}T23:59:59.999Z`;

  // Fetch messages for this org by channel_id prefix — active employees only
  const prefixes = ORG_CHANNEL_PREFIXES[org];
  let allMessages: { content: string; channel_id: string; sender: string; created_at: string; employees: unknown }[] = [];

  for (const prefix of prefixes) {
    const { data } = await supabase
      .from('raven_messages')
      .select('content, channel_id, sender, created_at, employees(name, status)')
      .gte('created_at', dayStart)
      .lte('created_at', dayEnd)
      .not('content', 'is', null)
      .like('channel_id', `${prefix}%`)
      .order('created_at', { ascending: true });
    if (data) allMessages = allMessages.concat(data);
  }

  // Filter to active employees only (Raven Intelligence rule)
  allMessages = allMessages.filter(m => {
    const emp = m.employees as { name: string; status: string } | null;
    return !emp || emp.status === 'active'; // include if no employee record or if active
  });

  // Sort by time
  allMessages.sort((a, b) => a.created_at.localeCompare(b.created_at));

  if (allMessages.length === 0) {
    return { snapshotId: null, messageCount: 0, employeeCount: 0, skipped: true, error: null };
  }

  // Format messages
  const messages = allMessages
    .filter(m => m.content && m.content.trim().length >= 3)
    .map(m => ({
      employeeName: (m.employees as unknown as { name: string } | null)?.name || m.sender,
      channel: m.channel_id || null,
      content: m.content,
      time: new Date(m.created_at).toTimeString().slice(0, 5),
    }));

  if (messages.length === 0) {
    return { snapshotId: null, messageCount: 0, employeeCount: 0, skipped: true, error: null };
  }

  const uniqueEmployees = new Set(messages.map(m => m.employeeName));
  const allEmployeeNames = [...uniqueEmployees];

  try {
    const result = await synthesizeCompanyDay(date, messages, allEmployeeNames);

    const snapshot: CompanySnapshot = {
      period_type: 'day',
      period_start: date,
      period_end: date,
      org,
      narrative: result.narrative,
      employee_narrative: result.employee_narrative,
      key_themes: result.key_themes,
      objectives_snapshot: result.objectives_snapshot,
      hypotheses_detected: result.hypotheses_detected,
      proposed_objectives: result.proposed_objectives,
      performance_scores: result.performance_scores,
      blockers: result.blockers,
      highlights: result.highlights,
      message_count: messages.length,
      active_employee_count: uniqueEmployees.size,
      created_at: new Date().toISOString(),
    };

    await setState(supabase, stateKey, snapshot);

    return { snapshotId: stateKey, messageCount: messages.length, employeeCount: uniqueEmployees.size, skipped: false, error: null };
  } catch (err) {
    return { snapshotId: null, messageCount: messages.length, employeeCount: uniqueEmployees.size, skipped: false, error: String(err) };
  }
}

// ── Week Rollup (per org) ────────────────────────────────────────────────────

export async function synthesizeWeek(weekStart: string, org: Org): Promise<{
  snapshotId: string | null;
  daysFound: number;
  skipped: boolean;
  error: string | null;
}> {
  const supabase = createAdminClient();
  const stateKey = `snapshot:week:${org}:${weekStart}`;

  const existing = await getState(supabase, stateKey);
  if (existing?.narrative) {
    return { snapshotId: stateKey, daysFound: 0, skipped: true, error: null };
  }

  const start = new Date(weekStart);
  const end = new Date(start);
  end.setDate(end.getDate() + 6);
  const weekEnd = end.toISOString().slice(0, 10);

  const daySnapshots: { date: string; narrative: string; key_themes: string[]; message_count: number }[] = [];
  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    const dateStr = d.toISOString().slice(0, 10);
    const daySnap = await getState(supabase, `snapshot:day:${org}:${dateStr}`);
    if (daySnap?.narrative) {
      daySnapshots.push({
        date: dateStr,
        narrative: daySnap.narrative,
        key_themes: daySnap.key_themes || [],
        message_count: daySnap.message_count || 0,
      });
    }
  }

  if (daySnapshots.length === 0) {
    return { snapshotId: null, daysFound: 0, skipped: true, error: null };
  }

  try {
    const result = await synthesizeCompanyWeek(weekStart, weekEnd, daySnapshots);
    const totalMessages = daySnapshots.reduce((s, d) => s + d.message_count, 0);

    const snapshot: CompanySnapshot = {
      period_type: 'week',
      period_start: weekStart,
      period_end: weekEnd,
      org,
      narrative: result.narrative,
      employee_narrative: result.employee_narrative,
      key_themes: result.key_themes,
      objectives_snapshot: result.objectives_snapshot,
      hypotheses_detected: result.hypotheses_detected,
      proposed_objectives: result.proposed_objectives,
      performance_scores: result.performance_scores,
      blockers: result.blockers,
      highlights: result.highlights,
      message_count: totalMessages,
      active_employee_count: 0,
      created_at: new Date().toISOString(),
    };

    await setState(supabase, stateKey, snapshot);
    return { snapshotId: stateKey, daysFound: daySnapshots.length, skipped: false, error: null };
  } catch (err) {
    return { snapshotId: null, daysFound: daySnapshots.length, skipped: false, error: String(err) };
  }
}

// ── Objective Extraction (per org) ───────────────────────────────────────────

export async function extractAndUpdateObjectives(org: Org, lookbackDays = 365): Promise<{
  created: number;
  updated: number;
  stalled: number;
  errors: string[];
}> {
  const supabase = createAdminClient();

  const snapshots: { date: string; narrative: string }[] = [];
  const today = new Date();

  for (let i = lookbackDays; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    const dateStr = d.toISOString().slice(0, 10);
    const snap = await getState(supabase, `snapshot:day:${org}:${dateStr}`);
    if (snap?.narrative) {
      snapshots.push({ date: dateStr, narrative: snap.narrative });
    }
  }

  if (snapshots.length === 0) {
    return { created: 0, updated: 0, stalled: 0, errors: [`No day snapshots for ${ORG_LABELS[org]}. Run backfill first.`] };
  }

  const existingState = await getState(supabase, `inferred_objectives:${org}`);
  const existingObjectives: InferredObjective[] = existingState?.objectives || [];

  const existing = existingObjectives.map(o => ({
    title: o.title, level: o.level, status: o.status, last_seen_at: o.last_seen_at,
  }));

  let aiResult;
  try {
    aiResult = await extractObjectiveHierarchy(snapshots, existing);
  } catch (err) {
    return { created: 0, updated: 0, stalled: 0, errors: [`AI extraction failed: ${err}`] };
  }

  const todayStr = today.toISOString().slice(0, 10);
  const normalize = (t: string) => t.toLowerCase().replace(/[^a-z0-9 ]/g, '').trim();
  const existingByTitle = new Map(existingObjectives.map(o => [normalize(o.title), o]));

  let created = 0, updated = 0, stalled = 0;
  const newObjectives: InferredObjective[] = [];

  const allToProcess: {
    title: string; level: string; description: string; status: string;
    confidence: number; evidence_summary: string; parentTitle?: string;
  }[] = [];

  for (const obj of aiResult.objectives) {
    allToProcess.push({ title: obj.title, level: obj.level, description: obj.description, status: obj.status, confidence: obj.confidence, evidence_summary: obj.evidence_summary });
    for (const child of (obj.children || [])) {
      allToProcess.push({ title: child.title, level: child.level, description: child.description, status: child.status, confidence: child.confidence, evidence_summary: child.evidence_summary, parentTitle: obj.title });
    }
  }

  const titleToId = new Map<string, string>();

  for (const obj of allToProcess) {
    const key = normalize(obj.title);
    const ex = existingByTitle.get(key);

    if (ex) {
      newObjectives.push({
        ...ex, status: obj.status, confidence_score: Math.min(1, Math.max(0, obj.confidence)),
        evidence_summary: obj.evidence_summary, description: obj.description, last_seen_at: todayStr,
      });
      titleToId.set(key, ex.id);
      updated++;
    } else {
      const id = crypto.randomUUID();
      newObjectives.push({
        id, title: obj.title, description: obj.description,
        level: obj.level as 'strategic' | 'operational' | 'tactical',
        parent_id: null, status: obj.status, first_seen_at: todayStr, last_seen_at: todayStr,
        evidence_summary: obj.evidence_summary, confidence_score: Math.min(1, Math.max(0, obj.confidence)),
      });
      titleToId.set(key, id);
      created++;
    }
  }

  for (const obj of allToProcess) {
    if (!obj.parentTitle) continue;
    const childId = titleToId.get(normalize(obj.title));
    const parentId = titleToId.get(normalize(obj.parentTitle));
    if (childId && parentId) {
      const child = newObjectives.find(o => o.id === childId);
      if (child) child.parent_id = parentId;
    }
  }

  // Keep existing objectives not mentioned by AI — do NOT auto-mark as stalled or abandoned.
  // Teams revisit objectives on different cadences; absence ≠ abandonment.
  for (const old of existingObjectives) {
    if (!titleToId.has(normalize(old.title))) {
      newObjectives.push(old);
    }
  }

  await setState(supabase, `inferred_objectives:${org}`, {
    objectives: newObjectives, updated_at: new Date().toISOString(),
  });

  return { created, updated, stalled, errors: [] };
}

// ── Backfill (per org, channel-based) ────────────────────────────────────────

export async function backfillAllDays(org: Org, batchLimit = 20): Promise<{
  processed: number;
  skipped: number;
  errors: string[];
  remaining: number;
  complete: boolean;
}> {
  const supabase = createAdminClient();
  let processed = 0, skipped = 0;
  const errors: string[] = [];

  const cursorKey = `synthesis_backfill_cursor:${org}`;
  const stateRow = await getState(supabase, cursorKey);
  const cursor: string | null = stateRow?.last_date_processed || null;

  // Find all dates that have messages for this org (by channel prefix)
  const prefixes = ORG_CHANNEL_PREFIXES[org];
  let allMsgDates: { created_at: string }[] = [];

  for (const prefix of prefixes) {
    const { data } = await supabase
      .from('raven_messages')
      .select('created_at')
      .like('channel_id', `${prefix}%`)
      .order('created_at', { ascending: true });
    if (data) allMsgDates = allMsgDates.concat(data);
  }

  if (allMsgDates.length === 0) {
    return { processed: 0, skipped: 0, errors: [], remaining: 0, complete: true };
  }

  const allDates = [...new Set(allMsgDates.map(m => m.created_at.slice(0, 10)))].sort();

  const startIdx = cursor ? allDates.findIndex(d => d > cursor) : 0;
  if (startIdx === -1) {
    return { processed: 0, skipped: 0, errors: [], remaining: 0, complete: true };
  }

  const datesToProcess = allDates.slice(startIdx);
  const batch = datesToProcess.slice(0, batchLimit);
  const remaining = datesToProcess.length - batch.length;

  const doneSet = new Set<string>();
  for (const date of batch) {
    const snap = await getState(supabase, `snapshot:day:${org}:${date}`);
    if (snap?.narrative) doneSet.add(date);
  }

  for (const date of batch) {
    if (doneSet.has(date)) {
      skipped++;
      await setState(supabase, cursorKey, { last_date_processed: date });
      continue;
    }

    const result = await synthesizeDay(date, org);

    if (result.skipped) {
      skipped++;
    } else if (result.error) {
      errors.push(`${date}: ${result.error}`);
      if (result.error.includes('429') || result.error.includes('quota')) {
        errors.push('Rate limited — stopping batch.');
        break;
      }
    } else {
      processed++;
    }

    await setState(supabase, cursorKey, { last_date_processed: date });
    await new Promise(r => setTimeout(r, 1500));
  }

  return { processed, skipped, errors, remaining, complete: remaining === 0 && errors.length === 0 };
}

// ── Monthly Synthesis (per org — one Gemini call per month) ──────────────────

async function getOrgEmployeeIds(supabase: ReturnType<typeof createAdminClient>, org: Org): Promise<Set<string>> {
  const state = await getState(supabase, 'org_assignments');
  if (!state?.assignments) return new Set();
  const assignments: Record<string, string> = state.assignments;
  return new Set(Object.entries(assignments).filter(([, o]) => o === org).map(([id]) => id));
}

export async function synthesizeMonth(month: string, org: Org): Promise<{
  success: boolean;
  messageCount: number;
  employeeCount: number;
  skipped: boolean;
  error: string | null;
}> {
  const supabase = createAdminClient();
  const stateKey = `snapshot:month:${org}:${month}`;

  // Check if already done
  const existing = await getState(supabase, stateKey);
  if (existing?.monthly_narrative) {
    return { success: true, messageCount: existing.message_count || 0, employeeCount: existing.active_employee_count || 0, skipped: true, error: null };
  }

  // Get org employees
  const orgEmpIds = await getOrgEmployeeIds(supabase, org);
  if (orgEmpIds.size === 0) {
    return { success: false, messageCount: 0, employeeCount: 0, skipped: false, error: `No employees assigned to ${org}. Run "Assign Orgs" first.` };
  }

  // Fetch ALL messages for this org for the entire month
  const monthStart = `${month}-01T00:00:00.000Z`;
  const lastDay = new Date(parseInt(month.slice(0, 4)), parseInt(month.slice(5, 7)), 0).getDate();
  const monthEnd = `${month}-${String(lastDay).padStart(2, '0')}T23:59:59.999Z`;

  const { data: rawMessages } = await supabase
    .from('raven_messages')
    .select('content, channel_id, sender, created_at, employee_id, employees(name, status)')
    .gte('created_at', monthStart)
    .lte('created_at', monthEnd)
    .not('content', 'is', null)
    .in('employee_id', [...orgEmpIds])
    .order('created_at', { ascending: true });

  // Filter to active employees only (Raven Intelligence rule) and non-empty content
  const allMessages = (rawMessages || []).filter(m => {
    if (!m.content || m.content.trim().length < 3) return false;
    const emp = m.employees as unknown as { name: string; status: string } | null;
    return !emp || emp.status === 'active';
  });

  if (allMessages.length === 0) {
    return { success: true, messageCount: 0, employeeCount: 0, skipped: true, error: null };
  }

  const messages = allMessages.map(m => ({
    employeeName: (m.employees as unknown as { name: string } | null)?.name || m.sender,
    channel: m.channel_id || null,
    content: m.content,
    date: m.created_at.slice(0, 10),
    time: new Date(m.created_at).toTimeString().slice(0, 5),
  }));

  const uniqueEmployees = [...new Set(messages.map(m => m.employeeName))];

  try {
    const result = await synthesizeCompanyMonth(month, ORG_LABELS[org], messages, uniqueEmployees);

    // Store the monthly snapshot
    await setState(supabase, stateKey, {
      ...result,
      org,
      month,
      message_count: messages.length,
      active_employee_count: uniqueEmployees.length,
      created_at: new Date().toISOString(),
    });

    // Derive backward-compatible daily snapshot keys from weekly_breakdowns
    for (const week of result.weekly_breakdowns || []) {
      const weekKey = `snapshot:week:${org}:${week.week_start}`;
      await setState(supabase, weekKey, {
        period_type: 'week',
        period_start: week.week_start,
        period_end: week.week_end,
        org,
        narrative: week.narrative,
        key_themes: week.key_themes,
        objectives_snapshot: [],
        blockers: [],
        highlights: week.highlights || [],
        message_count: 0,
        active_employee_count: 0,
        created_at: new Date().toISOString(),
      });
    }

    // Derive daily highlight keys
    for (const day of result.daily_highlights || []) {
      const dayKey = `snapshot:day:${org}:${day.date}`;
      await setState(supabase, dayKey, {
        period_type: 'day',
        period_start: day.date,
        period_end: day.date,
        org,
        narrative: `${day.headline} ${(day.notable_events || []).join('. ')}`,
        key_themes: [],
        objectives_snapshot: [],
        blockers: [],
        highlights: [],
        message_count: 0,
        active_employee_count: 0,
        created_at: new Date().toISOString(),
      });
    }

    return { success: true, messageCount: messages.length, employeeCount: uniqueEmployees.length, skipped: false, error: null };
  } catch (err) {
    return { success: false, messageCount: messages.length, employeeCount: uniqueEmployees.length, skipped: false, error: String(err) };
  }
}

export async function computeTrajectories(month: string, org: Org): Promise<{
  success: boolean;
  employeeCount: number;
  error: string | null;
}> {
  const supabase = createAdminClient();
  const stateKey = `trajectories:${org}:${month}`;

  const existing = await getState(supabase, stateKey);
  if (existing?.employees && Object.keys(existing.employees).length > 0) {
    return { success: true, employeeCount: Object.keys(existing.employees).length, error: null };
  }

  const orgEmpIds = await getOrgEmployeeIds(supabase, org);
  if (orgEmpIds.size === 0) {
    return { success: false, employeeCount: 0, error: `No employees for ${org}` };
  }

  const monthStart = `${month}-01T00:00:00.000Z`;
  const lastDay = new Date(parseInt(month.slice(0, 4)), parseInt(month.slice(5, 7)), 0).getDate();
  const monthEnd = `${month}-${String(lastDay).padStart(2, '0')}T23:59:59.999Z`;

  const { data: rawMessages } = await supabase
    .from('raven_messages')
    .select('content, channel_id, sender, created_at, employee_id, employees(name, email, status)')
    .gte('created_at', monthStart)
    .lte('created_at', monthEnd)
    .not('content', 'is', null)
    .in('employee_id', [...orgEmpIds])
    .order('created_at', { ascending: true });

  // Filter to active employees only (Raven Intelligence rule)
  const activeMessages = (rawMessages || []).filter(m => {
    const emp = m.employees as unknown as { name: string; email: string; status: string } | null;
    return !emp || emp.status === 'active';
  });

  if (!activeMessages || activeMessages.length === 0) {
    return { success: true, employeeCount: 0, error: null };
  }

  // Group messages by employee
  const byEmployee = new Map<string, {
    name: string;
    email: string;
    messages: { date: string; time: string; channel: string | null; content: string }[];
  }>();

  for (const m of activeMessages) {
    const emp = m.employees as unknown as { name: string; email: string; status: string } | null;
    const empId = m.employee_id || m.sender;
    if (!byEmployee.has(empId)) {
      byEmployee.set(empId, {
        name: emp?.name || m.sender,
        email: emp?.email || m.sender,
        messages: [],
      });
    }
    byEmployee.get(empId)!.messages.push({
      date: m.created_at.slice(0, 10),
      time: new Date(m.created_at).toTimeString().slice(0, 5),
      channel: m.channel_id || null,
      content: m.content,
    });
  }

  const employees = [...byEmployee.values()].filter(e => e.messages.length > 0);

  try {
    const trajectories = await computeMonthlyTrajectories(month, ORG_LABELS[org], employees);

    const trajMap: Record<string, EmployeeTrajectory> = {};
    for (const t of trajectories) {
      trajMap[t.email] = t;
    }

    await setState(supabase, stateKey, {
      employees: trajMap,
      updated_at: new Date().toISOString(),
    });

    return { success: true, employeeCount: trajectories.length, error: null };
  } catch (err) {
    return { success: false, employeeCount: employees.length, error: String(err) };
  }
}

export async function backfillMonths(org: Org, monthsBack = 12): Promise<{
  processed: number;
  skipped: number;
  errors: string[];
}> {
  const supabase = createAdminClient();
  let processed = 0, skipped = 0;
  const errors: string[] = [];

  // Find the date range of messages for this org
  const orgEmpIds = await getOrgEmployeeIds(supabase, org);
  if (orgEmpIds.size === 0) {
    return { processed: 0, skipped: 0, errors: [`No employees assigned to ${org}`] };
  }

  const { data: earliest } = await supabase
    .from('raven_messages')
    .select('created_at')
    .in('employee_id', [...orgEmpIds])
    .order('created_at', { ascending: true })
    .limit(1);

  if (!earliest || earliest.length === 0) {
    return { processed: 0, skipped: 0, errors: [] };
  }

  const startDate = new Date(earliest[0].created_at);
  const startMonth = `${startDate.getFullYear()}-${String(startDate.getMonth() + 1).padStart(2, '0')}`;
  const now = new Date();
  const endMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

  // Generate list of months from start to end
  const months: string[] = [];
  const cursor = new Date(startDate.getFullYear(), startDate.getMonth(), 1);
  const limit = new Date(now.getFullYear(), now.getMonth(), 1);
  while (cursor <= limit && months.length < monthsBack) {
    months.push(`${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, '0')}`);
    cursor.setMonth(cursor.getMonth() + 1);
  }

  for (const month of months) {
    // Synthesize month
    const synthResult = await synthesizeMonth(month, org);
    if (synthResult.skipped) {
      skipped++;
    } else if (synthResult.error) {
      errors.push(`${month} synthesis: ${synthResult.error}`);
      if (synthResult.error.includes('429') || synthResult.error.includes('quota')) {
        errors.push('Rate limited — stopping.');
        break;
      }
    } else {
      processed++;
    }

    // Compute trajectories
    const trajResult = await computeTrajectories(month, org);
    if (trajResult.error) {
      errors.push(`${month} trajectories: ${trajResult.error}`);
    }

    // Rate limit between months
    await new Promise(r => setTimeout(r, 4000));
  }

  // Extract objectives from all monthly narratives
  try {
    await extractAndUpdateObjectives(org, 365);
  } catch (err) {
    errors.push(`Objective extraction: ${String(err)}`);
  }

  return { processed, skipped, errors };
}

export async function backfillMonthsAllOrgs(monthsBack = 12) {
  const results = {} as Record<Org, { processed: number; skipped: number; errors: string[] }>;
  for (const org of ALL_ORGS) {
    results[org] = await backfillMonths(org, monthsBack);
  }
  return results;
}

// ── Multi-org convenience functions ──────────────────────────────────────────

export async function synthesizeDayAllOrgs(date: string) {
  const results = {} as Record<Org, { messageCount: number; employeeCount: number; skipped: boolean; error: string | null }>;
  for (const org of ALL_ORGS) {
    const r = await synthesizeDay(date, org);
    results[org] = { messageCount: r.messageCount, employeeCount: r.employeeCount, skipped: r.skipped, error: r.error };
  }
  return results;
}

export async function backfillAllOrgs(batchLimit = 10) {
  const results = {} as Record<Org, { processed: number; skipped: number; errors: string[]; remaining: number }>;
  for (const org of ALL_ORGS) {
    const r = await backfillAllDays(org, batchLimit);
    results[org] = { processed: r.processed, skipped: r.skipped, errors: r.errors, remaining: r.remaining };
  }
  return results;
}

export async function extractObjectivesAllOrgs(lookbackDays = 365) {
  const results = {} as Record<Org, { created: number; updated: number; stalled: number; errors: string[] }>;
  for (const org of ALL_ORGS) {
    const r = await extractAndUpdateObjectives(org, lookbackDays);
    results[org] = r;
  }
  return results;
}
