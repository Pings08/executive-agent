import { NextResponse } from 'next/server';
import { processUnanalyzedMessages } from '@/lib/pipeline/process';

export async function POST() {
  try {
    const result = await processUnanalyzedMessages();
    return NextResponse.json({ success: true, ...result });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
