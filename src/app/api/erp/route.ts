import { NextResponse } from 'next/server';
import { syncERPData } from '@/lib/pipeline/sync-erp';
import { ingestRavenMessages } from '@/lib/pipeline/ingest';

export async function POST() {
  try {
    const syncResult = await syncERPData();
    const ingestResult = await ingestRavenMessages();

    return NextResponse.json({
      success: true,
      data: {
        employees: syncResult.employees,
        objectives: syncResult.objectives,
        tasks: syncResult.tasks,
        messagesIngested: ingestResult.ingestedCount,
      },
      message: `Synced ${syncResult.employees} employees, ${syncResult.objectives} objectives, ${syncResult.tasks} tasks. Ingested ${ingestResult.ingestedCount} messages.`,
      errors: [...syncResult.errors, ...ingestResult.errors],
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
