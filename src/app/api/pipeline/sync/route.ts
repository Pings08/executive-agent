import { NextResponse } from 'next/server';
import { syncERPData } from '@/lib/pipeline/sync-erp';

export async function POST() {
  try {
    const result = await syncERPData();
    return NextResponse.json({ success: true, ...result });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
