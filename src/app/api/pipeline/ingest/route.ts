import { NextResponse } from 'next/server';
import { ingestRavenMessages } from '@/lib/pipeline/ingest';
import { processUnanalyzedMessages } from '@/lib/pipeline/process';
import { generateAlerts } from '@/lib/alerts/generator';

export async function POST() {
  try {
    // Step 1: Ingest new messages from Raven
    const ingestResult = await ingestRavenMessages();

    // Step 2: Always drain the unanalyzed queue (not just when new messages arrived)
    const processResult = await processUnanalyzedMessages(20);

    // Step 3: Generate alerts from analyses
    let alertResult = { alertsCreated: 0 };
    if (processResult.processedCount > 0) {
      alertResult = await generateAlerts();
    }

    return NextResponse.json({
      success: true,
      ingestedCount: ingestResult.ingestedCount,
      processedCount: processResult.processedCount,
      remainingPending: processResult.remaining,
      alertsCreated: alertResult.alertsCreated,
      errors: [...ingestResult.errors, ...processResult.errors],
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
