import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/d1/client';
import { createTask, updateTask, deleteTask } from '@/lib/dal/tasks';

/**
 * POST /api/tasks — Create a new task
 * PATCH /api/tasks — Update an existing task
 * DELETE /api/tasks — Delete a task
 */

export async function POST(request: NextRequest) {
  try {
    const db = getDb();
    const data = await request.json();
    const task = await createTask(db, {
      objectiveId: data.objectiveId,
      parentTaskId: data.parentTaskId,
      title: data.title,
      description: data.description,
      status: data.status,
      assigneeId: data.assigneeId || undefined,
      startDate: data.startDate || undefined,
      endDate: data.endDate || undefined,
    });
    return NextResponse.json({ task });
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
    await updateTask(db, id, {
      title: updates.title,
      description: updates.description,
      status: updates.status,
      assigneeId: updates.assigneeId,
      startDate: updates.startDate,
      endDate: updates.endDate,
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
    await deleteTask(db, id);
    return NextResponse.json({ success: true });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
