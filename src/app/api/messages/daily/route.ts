import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/d1/client';

const BASE = process.env.ERPNEXT_BASE_URL!;
const AUTH = `token ${process.env.ERPNEXT_API_KEY}:${process.env.ERPNEXT_API_SECRET}`;

export async function GET(req: NextRequest) {
  const date = req.nextUrl.searchParams.get('date');
  if (!date) return NextResponse.json({ error: 'date required' }, { status: 400 });

  try {
    const db = getDb();
    const dayStart = `${date}T00:00:00`;
    const dayEnd = `${date}T23:59:59`;

    // Fetch messages with employee name via JOIN, ERPNext channel/workspace data in parallel
    const [messagesResult, channelsRes, wsMembersRes, employeesResult] = await Promise.all([
      db
        .prepare(
          `SELECT rm.id, rm.content, rm.sender, rm.channel_id, rm.channel_name, rm.created_at, rm.employee_id,
                  e.name as employee_name
           FROM raven_messages rm
           LEFT JOIN employees e ON rm.employee_id = e.id
           WHERE rm.created_at >= ? AND rm.created_at <= ?
           ORDER BY rm.created_at ASC`
        )
        .bind(dayStart, dayEnd)
        .all<{
          id: string; content: string; sender: string; channel_id: string | null;
          channel_name: string | null; created_at: string; employee_id: string | null;
          employee_name: string | null;
        }>(),
      fetch(`${BASE}/api/resource/Raven%20Channel?fields=${encodeURIComponent('["name","channel_name","workspace"]')}&limit_page_length=500`, {
        headers: { Authorization: AUTH },
      }).then(r => r.json()).then(d => d.data || []),
      fetch(`${BASE}/api/resource/Raven%20Workspace%20Member?fields=${encodeURIComponent('["user","workspace"]')}&limit_page_length=1000`, {
        headers: { Authorization: AUTH },
      }).then(r => r.json()).then(d => d.data || []),
      db
        .prepare("SELECT id, name, email, raven_user FROM employees WHERE status = 'active'")
        .all<{ id: string; name: string; email: string | null; raven_user: string | null }>(),
    ]);

    const messages = messagesResult.results || [];
    const empList = employeesResult.results || [];

    // Channel ID -> workspace name
    const channelWorkspace = new Map<string, string>();
    for (const ch of channelsRes) {
      if (ch.workspace) channelWorkspace.set(ch.name, ch.workspace);
    }

    // User email -> primary workspace (from workspace membership)
    const userWorkspaceMap = new Map<string, string>();
    for (const m of wsMembersRes) {
      if (!userWorkspaceMap.has(m.user)) userWorkspaceMap.set(m.user, m.workspace);
    }

    // Employee ID -> email for workspace fallback
    const empEmailMap = new Map<string, string>();
    for (const e of empList) {
      empEmailMap.set(e.id, e.email || e.raven_user || '');
    }

    // Resolve workspace for each message
    type MsgRow = typeof messages[number];
    type GroupedMember = {
      id: string | null;
      name: string;
      messages: { id: string; content: string; channel: string | null; time: string }[];
    };
    type WorkspaceGroup = {
      name: string;
      members: Map<string, GroupedMember>;
      messageCount: number;
    };

    const wsGroups = new Map<string, WorkspaceGroup>();

    for (const msg of messages as MsgRow[]) {
      // 1. Try channel -> workspace
      let ws = msg.channel_id ? channelWorkspace.get(msg.channel_id) : null;
      // 2. Fallback: sender's primary workspace from membership
      if (!ws) {
        ws = userWorkspaceMap.get(msg.sender) || null;
      }
      // 3. Fallback by employee email
      if (!ws && msg.employee_id) {
        const email = empEmailMap.get(msg.employee_id);
        if (email) ws = userWorkspaceMap.get(email) || null;
      }
      if (!ws) ws = 'Other';

      if (!wsGroups.has(ws)) {
        wsGroups.set(ws, { name: ws, members: new Map(), messageCount: 0 });
      }
      const group = wsGroups.get(ws)!;
      group.messageCount++;

      const empName = msg.employee_name || msg.sender.split('@')[0].replace(/[._]/g, ' ').replace(/\b\w/g, (c: string) => c.toUpperCase());
      const empId = msg.employee_id || msg.sender;

      if (!group.members.has(empId)) {
        group.members.set(empId, { id: msg.employee_id || null, name: empName, messages: [] });
      }
      group.members.get(empId)!.messages.push({
        id: msg.id,
        content: msg.content,
        channel: msg.channel_name,
        time: msg.created_at,
      });
    }

    // Convert to serializable array, sorted by message count desc
    const workspaces = [...wsGroups.values()]
      .map(g => ({
        name: g.name,
        messageCount: g.messageCount,
        memberCount: g.members.size,
        members: [...g.members.values()].sort((a, b) => b.messages.length - a.messages.length),
      }))
      .filter(g => g.name !== 'Other' || g.messageCount > 0)
      .sort((a, b) => b.messageCount - a.messageCount);

    return NextResponse.json({ date, workspaces, totalMessages: messages.length });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
