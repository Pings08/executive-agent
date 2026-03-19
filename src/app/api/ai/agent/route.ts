import { NextRequest, NextResponse } from 'next/server';
import { ingestRavenMessages } from '@/lib/pipeline/ingest';
import { processUnanalyzedMessages } from '@/lib/pipeline/process';
import { generateAlerts } from '@/lib/alerts/generator';
import { generateDailyDigests } from '@/lib/pipeline/digest';

// POST /api/ai/agent
// Runs the full AI agent cycle:
// 1. Ingest new messages from Raven
// 2. Analyze all unprocessed messages with Claude (per-message)
// 3. Generate daily notes + EOD digests per employee
// 4. Update objective/task progress percentages and statuses
// 5. Create alerts for blockers
//
// Optional body: { date?: string (YYYY-MM-DD), skipIngest?: boolean }
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const { date, skipIngest } = body as { date?: string; skipIngest?: boolean };

    const allErrors: string[] = [];

    // Step 1: Ingest new messages from Raven (unless explicitly skipped)
    let ingestedCount = 0;
    if (!skipIngest) {
      const ingestResult = await ingestRavenMessages();
      ingestedCount = ingestResult.ingestedCount;
      allErrors.push(...ingestResult.errors);
    }

    // Step 2: Analyze all unprocessed messages through Claude
    const processResult = await processUnanalyzedMessages();
    allErrors.push(...processResult.errors);

    // Step 3: Generate alerts from new analyses
    const alertResult = await generateAlerts();

    // Step 4: Generate EOD digests + daily notes + update objective/task progress
    const digestResult = await generateDailyDigests(date);
    allErrors.push(...digestResult.errors);

    return NextResponse.json({
      success: true,
      date: date || new Date().toISOString().split('T')[0],
      ingestedCount,
      analyzedCount: processResult.processedCount,
      alertsCreated: alertResult.alertsCreated,
      digestsCreated: digestResult.digestsCreated,
      objectivesUpdated: digestResult.objectivesUpdated,
      tasksUpdated: digestResult.tasksUpdated,
      errors: allErrors,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
