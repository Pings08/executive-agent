import { RavenMessage, MessageAnalysis } from '@/types';
import { newId, now, parseJson, toJson } from '@/lib/d1/client';

interface DbMessageJoinRow {
  id: string;
  raven_message_id: string;
  channel_id: string | null;
  channel_name: string | null;
  sender: string;
  content: string;
  message_type: string;
  raw_json: string | null; // TEXT in D1
  created_at: string;
  ingested_at: string;
  processed: number; // INTEGER 0/1 in D1
  employee_id: string | null;
  employee_name: string | null;
}

interface DbAnalysisJoinRow {
  id: string;
  raven_message_id: string;
  employee_id: string | null;
  employee_name: string | null;
  related_objective_id: string | null;
  objective_title: string | null;
  related_task_id: string | null;
  category: string;
  sentiment: string;
  productivity_score: number | null;
  summary: string | null;
  key_topics: string | null; // TEXT (JSON array) in D1
  blocker_detected: number; // INTEGER 0/1 in D1
  blocker_description: string | null;
  raw_ai_response: string | null; // TEXT (JSON) in D1
  message_content: string | null;
  created_at: string;
}

export async function fetchRecentMessages(
  db: D1Database,
  limit = 50
): Promise<RavenMessage[]> {
  const { results } = await db
    .prepare(
      `SELECT m.*, e.name as employee_name
       FROM raven_messages m
       LEFT JOIN employees e ON m.employee_id = e.id
       ORDER BY m.created_at DESC
       LIMIT ?`
    )
    .bind(limit)
    .all<DbMessageJoinRow>();

  return (results || []).map(msg => ({
    id: msg.id,
    ravenMessageId: msg.raven_message_id,
    channelId: msg.channel_id ?? undefined,
    channelName: msg.channel_name ?? undefined,
    sender: msg.sender,
    content: msg.content,
    messageType: msg.message_type,
    employeeId: msg.employee_id ?? undefined,
    employeeName: msg.employee_name ?? undefined,
    createdAt: msg.created_at,
    processed: msg.processed === 1,
  }));
}

export async function fetchUnprocessedMessages(db: D1Database, limit = 20) {
  const { results } = await db
    .prepare(
      `SELECT m.*, e.name as employee_name
       FROM raven_messages m
       LEFT JOIN employees e ON m.employee_id = e.id
       WHERE m.processed = 0
       ORDER BY m.created_at ASC
       LIMIT ?`
    )
    .bind(limit)
    .all<DbMessageJoinRow>();

  return (results || []).map(msg => ({
    ...msg,
    processed: msg.processed === 1,
    raw_json: parseJson<Record<string, unknown>>(msg.raw_json),
  }));
}

export async function insertMessages(
  db: D1Database,
  messages: {
    raven_message_id: string;
    channel_id: string | null;
    channel_name?: string | null;
    sender: string;
    content: string;
    message_type: string;
    raw_json: Record<string, unknown>;
    created_at: string;
    employee_id: string | null;
  }[]
) {
  if (messages.length === 0) return { count: 0 };

  const stmts = messages.map(msg =>
    db
      .prepare(
        `INSERT OR IGNORE INTO raven_messages (id, raven_message_id, channel_id, channel_name, sender, content, message_type, raw_json, created_at, ingested_at, processed, employee_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)`
      )
      .bind(
        newId(),
        msg.raven_message_id,
        msg.channel_id,
        msg.channel_name ?? null,
        msg.sender,
        msg.content,
        msg.message_type,
        toJson(msg.raw_json),
        msg.created_at,
        now(),
        msg.employee_id
      )
  );

  await db.batch(stmts);
  return { count: messages.length };
}

export async function markMessageProcessed(db: D1Database, id: string) {
  await db
    .prepare('UPDATE raven_messages SET processed = 1 WHERE id = ?')
    .bind(id)
    .run();
}

export async function insertAnalysis(
  db: D1Database,
  analysis: {
    raven_message_id: string;
    employee_id: string | null;
    related_objective_id: string | null;
    related_task_id: string | null;
    category: string;
    sentiment: string;
    productivity_score: number | null;
    summary: string | null;
    key_topics: string[] | null;
    blocker_detected: boolean;
    blocker_description: string | null;
    raw_ai_response: Record<string, unknown> | null;
  }
) {
  const id = newId();
  const timestamp = now();

  await db
    .prepare(
      `INSERT INTO message_analyses (id, raven_message_id, employee_id, related_objective_id, related_task_id, category, sentiment, productivity_score, summary, key_topics, blocker_detected, blocker_description, raw_ai_response, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(
      id,
      analysis.raven_message_id,
      analysis.employee_id,
      analysis.related_objective_id,
      analysis.related_task_id,
      analysis.category,
      analysis.sentiment,
      analysis.productivity_score,
      analysis.summary,
      analysis.key_topics ? toJson(analysis.key_topics) : null,
      analysis.blocker_detected ? 1 : 0,
      analysis.blocker_description,
      analysis.raw_ai_response ? toJson(analysis.raw_ai_response) : null,
      timestamp
    )
    .run();

  // Fetch the created row since D1 has no RETURNING
  const row = await db.prepare('SELECT * FROM message_analyses WHERE id = ?').bind(id).first();
  return row;
}

export async function fetchAnalyses(
  db: D1Database,
  filters?: {
    employeeId?: string;
    objectiveId?: string;
    blockerOnly?: boolean;
    limit?: number;
  }
): Promise<MessageAnalysis[]> {
  const whereClauses: string[] = [];
  const values: unknown[] = [];

  if (filters?.employeeId) {
    whereClauses.push('a.employee_id = ?');
    values.push(filters.employeeId);
  }
  if (filters?.objectiveId) {
    whereClauses.push('a.related_objective_id = ?');
    values.push(filters.objectiveId);
  }
  if (filters?.blockerOnly) {
    whereClauses.push('a.blocker_detected = 1');
  }

  const whereSQL = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';
  const limitVal = filters?.limit ?? 50;
  values.push(limitVal);

  const { results } = await db
    .prepare(
      `SELECT a.*, e.name as employee_name, o.title as objective_title, m.content as message_content
       FROM message_analyses a
       LEFT JOIN employees e ON a.employee_id = e.id
       LEFT JOIN objectives o ON a.related_objective_id = o.id
       LEFT JOIN raven_messages m ON a.raven_message_id = m.raven_message_id
       ${whereSQL}
       ORDER BY a.created_at DESC
       LIMIT ?`
    )
    .bind(...values)
    .all<DbAnalysisJoinRow>();

  return (results || []).map(a => ({
    id: a.id,
    ravenMessageId: a.raven_message_id,
    employeeId: a.employee_id ?? undefined,
    employeeName: a.employee_name ?? undefined,
    relatedObjectiveId: a.related_objective_id ?? undefined,
    relatedObjectiveTitle: a.objective_title ?? undefined,
    relatedTaskId: a.related_task_id ?? undefined,
    category: a.category,
    sentiment: a.sentiment,
    productivityScore: a.productivity_score ?? undefined,
    summary: a.summary ?? undefined,
    keyTopics: parseJson<string[]>(a.key_topics) ?? undefined,
    blockerDetected: a.blocker_detected === 1,
    blockerDescription: a.blocker_description ?? undefined,
    messageContent: a.message_content ?? undefined,
    createdAt: a.created_at,
  }));
}
