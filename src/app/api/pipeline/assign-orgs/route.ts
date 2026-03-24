import { NextResponse } from 'next/server';
import { fetchAndAssignOrgs } from '@/lib/pipeline/org-assignments';

export async function POST() {
  try {
    const result = await fetchAndAssignOrgs();
    return NextResponse.json({ success: true, ...result });
  } catch (err) {
    return NextResponse.json({ success: false, error: String(err) }, { status: 500 });
  }
}
