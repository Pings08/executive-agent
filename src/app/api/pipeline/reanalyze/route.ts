import { createAdminClient } from '@/lib/supabase/admin';
import { NextResponse } from 'next/server';

// Resets the most recent N messages so they get re-analyzed with the current prompt.
// Deletes their existing message_analyses rows and marks them processed=false.
export async function POST(req: Request) {
  const supabase = createAdminClient();
  const { limit = 50 } = await req.json().catch(() => ({}));

  // 1. Get the most recent N message IDs
  const { data: messages, error: fetchErr } = await supabase
    .from('raven_messages')
    .select('id')
    .eq('processed', true)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (fetchErr) {
    return NextResponse.json({ error: fetchErr.message }, { status: 500 });
  }

  if (!messages || messages.length === 0) {
    return NextResponse.json({ reset: 0 });
  }

  const ids = messages.map(m => m.id);

  // 2. Delete existing analyses for these messages
  const { error: delErr } = await supabase
    .from('message_analyses')
    .delete()
    .in('raven_message_id', ids);

  if (delErr) {
    return NextResponse.json({ error: delErr.message }, { status: 500 });
  }

  // 3. Reset processed flag so pipeline picks them up again
  const { error: updateErr } = await supabase
    .from('raven_messages')
    .update({ processed: false })
    .in('id', ids);

  if (updateErr) {
    return NextResponse.json({ error: updateErr.message }, { status: 500 });
  }

  return NextResponse.json({ reset: ids.length });
}
