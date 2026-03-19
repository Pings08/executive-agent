import { NextResponse } from 'next/server';
import { generateDailyDigests } from '@/lib/pipeline/digest';

// POST /api/pipeline/digest
// Generates End-of-Day digests for all active employees:
// - per-employee rating (1-10), productivity, sentiment
// - identified blockers with severity
// - objective progress detection + auto-status updates
// Accepts optional ?date=YYYY-MM-DD query param to regenerate a past day.
export async function POST(request: Request) {
  try {
    const url = new URL(request.url);
    const date = url.searchParams.get('date') || undefined;

    const result = await generateDailyDigests(date);

    return NextResponse.json({
      success: true,
      digestsCreated: result.digestsCreated,
      objectivesUpdated: result.objectivesUpdated,
      errors: result.errors,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
