import { NextRequest, NextResponse } from 'next/server';
import { getDb, toJson, parseJson, now } from '@/lib/d1/client';

const GEMINI_MODEL = 'gemini-2.0-flash';
const GEMINI_API_URL = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;

/**
 * POST /api/messages/evaluate?date=YYYY-MM-DD&org=biotech
 *
 * Evaluates each employee's daily messages with AI.
 * Stores results in pipeline_state as `daily_eval:{org}:{date}`.
 */
export async function POST(req: NextRequest) {
  const date = req.nextUrl.searchParams.get('date');
  const org = req.nextUrl.searchParams.get('org') || 'biotech';
  if (!date) return NextResponse.json({ error: 'date required' }, { status: 400 });

  try {
    const db = getDb();
    const stateKey = `daily_eval:${org}:${date}`;

    // Check cache
    const cached = await db
      .prepare('SELECT value FROM pipeline_state WHERE key = ?')
      .bind(stateKey)
      .first<{ value: string }>();
    if (cached) {
      const parsed = parseJson<{ evaluations: EmployeeEval[] }>(cached.value);
      if (parsed?.evaluations) {
        return NextResponse.json({ date, org, evaluations: parsed.evaluations, cached: true });
      }
    }

    // Get channel prefixes for this org
    const ORG_PREFIXES: Record<string, string[]> = {
      biotech: ['ExRNA-', 'VV Biotech-'],
      tcr: ['Technoculture-'],
      sentient_x: ['Sentient-'],
    };
    const prefixes = ORG_PREFIXES[org] || [];
    if (prefixes.length === 0) {
      return NextResponse.json({ error: 'Unknown org' }, { status: 400 });
    }

    const dayStart = `${date} 00:00:00`;
    const dayEnd = `${date} 23:59:59`;

    // Fetch messages for this org's channels
    const channelClauses = prefixes.map(() => 'rm.channel_id LIKE ?').join(' OR ');
    const likeParams = prefixes.map(p => `${p}%`);

    const { results: messages } = await db
      .prepare(
        `SELECT rm.content, rm.channel_id, rm.created_at, rm.message_type,
                e.name AS employee_name, e.id AS employee_id
         FROM raven_messages rm
         LEFT JOIN employees e ON rm.employee_id = e.id
         WHERE rm.created_at >= ? AND rm.created_at <= ?
           AND rm.content IS NOT NULL
           AND (${channelClauses})
         ORDER BY rm.created_at ASC`
      )
      .bind(dayStart, dayEnd, ...likeParams)
      .all<{ content: string; channel_id: string; created_at: string; message_type: string; employee_name: string | null; employee_id: string | null }>();

    if (!messages || messages.length === 0) {
      return NextResponse.json({ date, org, evaluations: [], cached: false });
    }

    // Group text messages by employee
    const byEmployee = new Map<string, { name: string; messages: string[] }>();
    for (const m of messages) {
      if (m.message_type !== 'Text' && m.message_type !== 'text') continue;
      if (!m.content || m.content.trim().length < 3) continue;
      const name = m.employee_name || 'Unknown';
      if (!byEmployee.has(name)) byEmployee.set(name, { name, messages: [] });
      const time = m.created_at.split(' ')[1]?.slice(0, 5) || '';
      byEmployee.get(name)!.messages.push(`[${time}] #${m.channel_id}: ${m.content}`);
    }

    // Build prompt for AI evaluation
    const employeeBlocks = [...byEmployee.entries()]
      .filter(([, e]) => e.messages.length >= 1)
      .map(([name, e]) => `### ${name} (${e.messages.length} messages)\n${e.messages.join('\n')}`)
      .join('\n\n');

    if (!employeeBlocks) {
      return NextResponse.json({ date, org, evaluations: [], cached: false });
    }

    const prompt = `You are the Operational Intelligence Lead for Raven. Evaluate each employee's daily messages for ${date}.

For each employee, assess:
1. What topics/tasks did they work on today?
2. How effective were their communications? (1-10 score)
3. What was their contribution toward team objectives?
4. Any blockers or issues they raised?

Be encouraging but honest. Highlight specific contributions.

## Employee Messages — ${date}
${employeeBlocks}

Respond ONLY with valid JSON (no markdown):
{
  "evaluations": [
    {
      "employee_name": "<name>",
      "topics": ["<topic1>", "<topic2>"],
      "effectiveness_score": <1-10>,
      "summary": "<2-3 sentence assessment: what they worked on, how effective, contribution to objectives>",
      "key_contributions": ["<specific contribution>"],
      "blockers": ["<any blockers mentioned>"],
      "message_count": <number>
    }
  ]
}`;

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) return NextResponse.json({ error: 'GEMINI_API_KEY not set' }, { status: 500 });

    const res = await fetch(`${GEMINI_API_URL}?key=${apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.7, maxOutputTokens: 4096 },
      }),
    });

    if (!res.ok) {
      const err = await res.text();
      return NextResponse.json({ error: `Gemini API error: ${err}` }, { status: 500 });
    }

    const data = await res.json() as {
      candidates?: { content?: { parts?: { text?: string }[] } }[];
    };
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';

    // Parse AI response
    const jsonMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/) || [null, text];
    const cleaned = (jsonMatch[1] || text).trim();
    let evaluations: EmployeeEval[] = [];
    try {
      const parsed = JSON.parse(cleaned);
      evaluations = parsed.evaluations || [];
    } catch {
      return NextResponse.json({ error: 'Failed to parse AI response', raw: text }, { status: 500 });
    }

    // Cache the result
    await db
      .prepare(
        `INSERT INTO pipeline_state (key, value, updated_at)
         VALUES (?, ?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
      )
      .bind(stateKey, toJson({ evaluations, generated_at: now() }), now())
      .run();

    return NextResponse.json({ date, org, evaluations, cached: false });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

export async function GET(req: NextRequest) {
  const date = req.nextUrl.searchParams.get('date');
  const org = req.nextUrl.searchParams.get('org') || 'biotech';
  if (!date) return NextResponse.json({ error: 'date required' }, { status: 400 });

  try {
    const db = getDb();
    const stateKey = `daily_eval:${org}:${date}`;
    const cached = await db
      .prepare('SELECT value FROM pipeline_state WHERE key = ?')
      .bind(stateKey)
      .first<{ value: string }>();

    if (cached) {
      const parsed = parseJson<{ evaluations: EmployeeEval[] }>(cached.value);
      return NextResponse.json({ date, org, evaluations: parsed?.evaluations || [], cached: true });
    }

    return NextResponse.json({ date, org, evaluations: [], cached: false });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

interface EmployeeEval {
  employee_name: string;
  topics: string[];
  effectiveness_score: number;
  summary: string;
  key_contributions: string[];
  blockers: string[];
  message_count: number;
}
