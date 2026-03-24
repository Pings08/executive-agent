import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/d1/client';
import { fetchAlerts, markAlertRead, resolveAlert } from '@/lib/dal/alerts';

export async function GET(request: NextRequest) {
  try {
    const db = getDb();
    const url = new URL(request.url);
    const unread = url.searchParams.get('unread') === 'true';
    const severity = url.searchParams.get('severity');

    const alerts = await fetchAlerts(db, {
      unreadOnly: unread,
      severity: severity || undefined,
      limit: 50,
    });
    return NextResponse.json({ alerts });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const db = getDb();
    const { id, action } = await request.json();

    if (action === 'read') {
      await markAlertRead(db, id);
    } else if (action === 'resolve') {
      await resolveAlert(db, id);
    } else {
      return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
    }

    return NextResponse.json({ success: true });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
