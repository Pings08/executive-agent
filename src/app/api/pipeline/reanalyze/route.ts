import { NextResponse } from 'next/server';
import { getDb, placeholders } from '@/lib/d1/client';

// Resets the most recent N messages so they get re-analyzed with the current prompt.
// Deletes their existing message_analyses rows and marks them processed=false.
export async function POST(req: Request) {
  try {
    const db = getDb();
    const { limit = 50 } = await req.json().catch(() => ({}));

    // 1. Get the most recent N processed message IDs
    const { results: messages } = await db
      .prepare(
        'SELECT id FROM raven_messages WHERE processed = 1 ORDER BY created_at DESC LIMIT ?'
      )
      .bind(limit)
      .all<{ id: string }>();

    if (!messages || messages.length === 0) {
      return NextResponse.json({ reset: 0 });
    }

    const ids = messages.map(m => m.id);

    // 2. Delete existing analyses for these messages
    await db
      .prepare(
        `DELETE FROM message_analyses WHERE raven_message_id IN ${placeholders(ids.length)}`
      )
      .bind(...ids)
      .run();

    // 3. Reset processed flag so pipeline picks them up again
    await db
      .prepare(
        `UPDATE raven_messages SET processed = 0 WHERE id IN ${placeholders(ids.length)}`
      )
      .bind(...ids)
      .run();

    return NextResponse.json({ reset: ids.length });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
