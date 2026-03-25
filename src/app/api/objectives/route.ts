import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/d1/client';
import {
  createObjective,
  updateObjective,
  deleteObjective,
} from '@/lib/dal/objectives';

/**
 * POST /api/objectives — Create a new objective
 * PATCH /api/objectives — Update an existing objective
 * DELETE /api/objectives — Delete an objective
 */

export async function POST(request: NextRequest) {
  try {
    const db = getDb();
    const data = await request.json();
    const newObj = await createObjective(db, {
      title: data.title,
      description: data.description,
      status: data.status,
      priority: data.priority,
      startDate: data.startDate,
      endDate: data.endDate,
      assigneeIds: data.assigneeIds || [],
    });
    return NextResponse.json({ objective: newObj });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const db = getDb();
    const { id, ...updates } = await request.json();
    if (!id) {
      return NextResponse.json({ error: 'id required' }, { status: 400 });
    }
    await updateObjective(db, id, {
      title: updates.title,
      description: updates.description,
      status: updates.status,
      priority: updates.priority,
      startDate: updates.startDate,
      endDate: updates.endDate,
      assigneeIds: updates.assigneeIds,
    });
    return NextResponse.json({ success: true });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const db = getDb();
    const { id } = await request.json();
    if (!id) {
      return NextResponse.json({ error: 'id required' }, { status: 400 });
    }
    await deleteObjective(db, id);
    return NextResponse.json({ success: true });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
