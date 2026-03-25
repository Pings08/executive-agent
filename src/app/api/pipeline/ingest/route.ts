import { NextResponse } from 'next/server';
import { ingestRavenMessages } from '@/lib/pipeline/ingest';

/**
 * POST /api/pipeline/ingest
 *
 * Ingests new messages from Raven into Supabase.
 * NO per-message AI analysis — company-level synthesis is done separately
 * via /api/pipeline/synthesize (holistic, not per-message).
 */
export async function POST() {
  try {
    const ingestResult = await ingestRavenMessages();

    return NextResponse.json({
      success: true,
      ingestedCount: ingestResult.ingestedCount,
      errors: ingestResult.errors,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
