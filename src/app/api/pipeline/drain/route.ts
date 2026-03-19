import { NextResponse } from 'next/server';
import { processUnanalyzedMessages } from '@/lib/pipeline/process';
import { generateAlerts } from '@/lib/alerts/generator';

/**
 * POST /api/pipeline/drain
 * Processes ALL pending (unanalyzed) messages in one shot.
 * Loops in batches of 20 until the queue is empty or maxBatches is hit.
 * Use from Settings when you have a large backlog.
 */
export async function POST(req: Request) {
  const { maxBatches = 10 } = await req.json().catch(() => ({}));

  let totalProcessed = 0;
  const allErrors: string[] = [];
  let batchesRun = 0;
  let remaining = Infinity;

  // Keep draining until empty or safety cap reached
  while (remaining > 0 && batchesRun < maxBatches) {
    const result = await processUnanalyzedMessages(20);
    totalProcessed += result.processedCount;
    allErrors.push(...result.errors);
    remaining = result.remaining;
    batchesRun++;

    // If nothing was processed this batch, queue is empty
    if (result.processedCount === 0) break;
  }

  // Generate alerts from the freshly analyzed messages
  let alertsCreated = 0;
  if (totalProcessed > 0) {
    const alertResult = await generateAlerts();
    alertsCreated = alertResult.alertsCreated;
  }

  return NextResponse.json({
    success: true,
    totalProcessed,
    batchesRun,
    remainingPending: remaining === Infinity ? 0 : remaining,
    alertsCreated,
    errors: allErrors,
  });
}
