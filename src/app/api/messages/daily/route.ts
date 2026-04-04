import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/d1/client';

const BASE = process.env.ERPNEXT_BASE_URL!;
const AUTH = `token ${process.env.ERPNEXT_API_KEY}:${process.env.ERPNEXT_API_SECRET}`;

/**
 * Channel prefix → workspace mapping.
 * This is the authoritative source — matches the synthesis pipeline.
 */
const CHANNEL_PREFIX_TO_WORKSPACE: Record<string, string> = {
  'ExRNA-': 'ExRNA',
  'VV Biotech-': 'VV Biotech',
  'Technoculture-': 'Technoculture',
  'Sentient-': 'Sentient',
};

function getWorkspaceFromChannel(channelId: string | null): string | null {
  if (!channelId) return null;
  for (const [prefix, ws] of Object.entries(CHANNEL_PREFIX_TO_WORKSPACE)) {
    if (channelId.startsWith(prefix)) return ws;
  }
  return null;
}

export async function GET(req: NextRequest) {
  const date = req.nextUrl.searchParams.get('date');
  if (!date) return NextResponse.json({ error: 'date required' }, { status: 400 });

  try {
    const db = getDb();
    const dayStart = `${date} 00:00:00`;
    const dayEnd = `${date} 23:59:59`;

    // Fetch messages with employee join + ERPNext channel data for unmapped channels
    const [messagesResult, channelsRes] = await Promise.all([
      db
        .prepare(
          `SELECT rm.id, rm.content, rm.sender, rm.channel_id, rm.channel_name, rm.created_at, rm.employee_id,
                  rm.message_type, rm.raw_json,
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
          employee_name: string | null; message_type: string | null; raw_json: string | null;
        }>(),
      fetch(`${BASE}/api/resource/Raven%20Channel?fields=${encodeURIComponent('["name","channel_name","workspace"]')}&limit_page_length=500`, {
        headers: { Authorization: AUTH },
      }).then(r => r.json()).then(d => d.data || []).catch(() => []),
    ]);

    const messages = messagesResult.results || [];

    // Build ERPNext channel → workspace map as fallback
    const erpChannelWorkspace = new Map<string, string>();
    for (const ch of channelsRes) {
      if (ch.workspace) erpChannelWorkspace.set(ch.name, ch.workspace);
    }

    // Group messages by workspace
    type GroupedMember = {
      id: string | null;
      name: string;
      messages: { id: string; content: string; channel: string | null; time: string; message_type: string; file_url: string | null }[];
    };
    type WorkspaceGroup = {
      name: string;
      members: Map<string, GroupedMember>;
      messageCount: number;
    };

    const wsGroups = new Map<string, WorkspaceGroup>();

    for (const msg of messages) {
      // 1. Primary: channel_id prefix (authoritative, matches synthesis pipeline)
      let ws = getWorkspaceFromChannel(msg.channel_id);

      // 2. Fallback: ERPNext channel → workspace mapping
      if (!ws && msg.channel_id) {
        ws = erpChannelWorkspace.get(msg.channel_id) || null;
      }

      // 3. Skip messages that don't belong to any known workspace (DMs, etc.)
      if (!ws) continue;

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
      // Extract file URL from raw_json for images/files
      let fileUrl: string | null = null;
      if (msg.message_type === 'Image' || msg.message_type === 'File') {
        try {
          const raw = msg.raw_json ? JSON.parse(msg.raw_json) : null;
          if (raw?.file) {
            fileUrl = raw.file.startsWith('http') ? raw.file : `${BASE}${raw.file}`;
          }
        } catch { /* ignore parse errors */ }
      }

      group.members.get(empId)!.messages.push({
        id: msg.id,
        content: msg.content,
        channel: msg.channel_name || msg.channel_id,
        time: msg.created_at,
        message_type: msg.message_type || 'Text',
        file_url: fileUrl,
      });
    }

    // Convert to array, sorted by message count
    const workspaces = [...wsGroups.values()]
      .map(g => ({
        name: g.name,
        messageCount: g.messageCount,
        memberCount: g.members.size,
        members: [...g.members.values()].sort((a, b) => b.messages.length - a.messages.length),
      }))
      .sort((a, b) => b.messageCount - a.messageCount);

    const totalMessages = workspaces.reduce((s, w) => s + w.messageCount, 0);
    return NextResponse.json({ date, workspaces, totalMessages });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
