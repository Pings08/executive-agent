'use client';

import { useEffect, useState, useCallback } from 'react';
import {
  MessageSquare, ChevronLeft, ChevronRight, ChevronDown,
  Loader2, RefreshCw, Users, Calendar,
} from 'lucide-react';
import { format, parseISO, addDays, subDays } from 'date-fns';
import { useSelectedOrg } from '@/components/Sidebar';

/** Map app org to the Raven workspace names it includes */
const ORG_WORKSPACES: Record<string, string[]> = {
  biotech: ['ExRNA', 'VV Biotech'],
  tcr: ['Technoculture'],
  sentient_x: ['Sentient'],
};

type Msg = { id: string; content: string; channel: string | null; time: string };
type Member = { id: string | null; name: string; messages: Msg[] };
type WsGroup = { name: string; messageCount: number; memberCount: number; members: Member[] };

const WS_COLORS: Record<string, { bg: string; text: string; border: string }> = {
  ExRNA:         { bg: 'bg-emerald-500/10', text: 'text-emerald-400', border: 'border-emerald-500/30' },
  Sentient:      { bg: 'bg-cyan-500/10',    text: 'text-cyan-400',    border: 'border-cyan-500/30' },
  Technoculture: { bg: 'bg-purple-500/10',  text: 'text-purple-400',  border: 'border-purple-500/30' },
  'VV Biotech':  { bg: 'bg-orange-500/10',  text: 'text-orange-400',  border: 'border-orange-500/30' },
  Other:         { bg: 'bg-gray-500/10',    text: 'text-gray-400',    border: 'border-gray-500/30' },
};

const fallbackColor = { bg: 'bg-gray-500/10', text: 'text-gray-400', border: 'border-gray-500/30' };

export default function MessagesPage() {
  const [selectedOrg] = useSelectedOrg();
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [workspaces, setWorkspaces] = useState<WsGroup[]>([]);
  const [totalMessages, setTotalMessages] = useState(0);
  const [loading, setLoading] = useState(true);
  const [expandedWs, setExpandedWs] = useState<Set<string>>(new Set());
  const [expandedMembers, setExpandedMembers] = useState<Set<string>>(new Set());

  const loadDay = useCallback(async (d: string) => {
    setLoading(true);
    try {
      const res = await fetch(`/api/messages/daily?date=${d}`);
      const data = await res.json();
      // Filter workspaces to only those matching the selected org
      const allowed = ORG_WORKSPACES[selectedOrg] || [];
      const filtered = (data.workspaces || []).filter((w: WsGroup) => allowed.includes(w.name));
      setWorkspaces(filtered);
      setTotalMessages(filtered.reduce((s: number, w: WsGroup) => s + w.messageCount, 0));
      setExpandedWs(new Set(filtered.map((w: WsGroup) => w.name)));
      setExpandedMembers(new Set());
    } catch {
      setWorkspaces([]);
    } finally {
      setLoading(false);
    }
  }, [selectedOrg]);

  useEffect(() => { loadDay(date); }, [date, loadDay]);

  // Re-fetch when org changes via sidebar
  useEffect(() => {
    const handler = () => loadDay(date);
    window.addEventListener('org-changed', handler);
    return () => window.removeEventListener('org-changed', handler);
  }, [date, loadDay]);

  const prevDay = () => setDate(subDays(parseISO(date), 1).toISOString().slice(0, 10));
  const nextDay = () => {
    const tomorrow = addDays(parseISO(date), 1).toISOString().slice(0, 10);
    const today = new Date().toISOString().slice(0, 10);
    if (tomorrow <= today) setDate(tomorrow);
  };
  const goToday = () => setDate(new Date().toISOString().slice(0, 10));

  const toggleWs = (name: string) => {
    setExpandedWs(prev => {
      const next = new Set(prev);
      next.has(name) ? next.delete(name) : next.add(name);
      return next;
    });
  };

  const toggleMember = (key: string) => {
    setExpandedMembers(prev => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });
  };

  const isToday = date === new Date().toISOString().slice(0, 10);

  return (
    <div className="max-w-5xl mx-auto py-8 px-6 space-y-6 animate-fadeIn">
      {/* Header + date navigation */}
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Messages</h1>
          <p className="text-secondary text-sm mt-1">Daily activity by workspace</p>
        </div>
        <button
          onClick={() => loadDay(date)}
          disabled={loading}
          className="flex items-center gap-2 text-xs font-bold text-accent hover:underline disabled:opacity-50"
        >
          <RefreshCw size={13} className={loading ? 'animate-spin' : ''} /> Refresh
        </button>
      </header>

      {/* Date picker */}
      <div className="flex items-center gap-3">
        <button onClick={prevDay} className="p-1.5 rounded hover:bg-glass transition-colors">
          <ChevronLeft size={18} />
        </button>
        <div className="flex items-center gap-2 text-sm font-bold">
          <Calendar size={15} className="text-accent" />
          {format(parseISO(date), 'EEEE, MMMM d, yyyy')}
        </div>
        <button
          onClick={nextDay}
          disabled={isToday}
          className="p-1.5 rounded hover:bg-glass transition-colors disabled:opacity-30"
        >
          <ChevronRight size={18} />
        </button>
        {!isToday && (
          <button onClick={goToday} className="text-[11px] font-bold text-accent hover:underline ml-2">
            Today
          </button>
        )}
        <span className="ml-auto text-xs text-secondary">
          {totalMessages} message{totalMessages !== 1 ? 's' : ''} total
        </span>
      </div>

      {/* Loading */}
      {loading && (
        <div className="flex justify-center py-20">
          <Loader2 className="animate-spin text-accent" size={28} />
        </div>
      )}

      {/* Empty state */}
      {!loading && workspaces.length === 0 && (
        <div className="card text-center py-20">
          <MessageSquare size={32} className="mx-auto text-secondary/40 mb-3" />
          <p className="text-sm text-secondary">No messages on this day</p>
        </div>
      )}

      {/* Workspace rows */}
      {!loading && workspaces.map(ws => {
        const colors = WS_COLORS[ws.name] || fallbackColor;
        const isOpen = expandedWs.has(ws.name);

        return (
          <section key={ws.name} className={`rounded-xl border ${colors.border} overflow-hidden`}>
            {/* Workspace header — always visible */}
            <button
              onClick={() => toggleWs(ws.name)}
              className={`w-full flex items-center justify-between px-5 py-4 ${colors.bg} hover:brightness-110 transition-all`}
            >
              <div className="flex items-center gap-3">
                <ChevronDown
                  size={16}
                  className={`${colors.text} transition-transform ${isOpen ? '' : '-rotate-90'}`}
                />
                <span className={`text-sm font-bold ${colors.text}`}>{ws.name}</span>
              </div>
              <div className="flex items-center gap-4 text-xs text-secondary">
                <span className="flex items-center gap-1">
                  <Users size={12} /> {ws.memberCount}
                </span>
                <span className="flex items-center gap-1">
                  <MessageSquare size={12} /> {ws.messageCount}
                </span>
              </div>
            </button>

            {/* Members list */}
            {isOpen && (
              <div className="divide-y divide-border/40">
                {ws.members.map(member => {
                  const memberKey = `${ws.name}::${member.id || member.name}`;
                  const memberOpen = expandedMembers.has(memberKey);

                  return (
                    <div key={memberKey}>
                      {/* Member row */}
                      <button
                        onClick={() => toggleMember(memberKey)}
                        className="w-full flex items-center gap-3 px-5 py-3 hover:bg-glass/50 transition-colors"
                      >
                        <div className="w-7 h-7 rounded-full bg-accent/15 flex items-center justify-center text-[10px] font-bold text-accent shrink-0">
                          {member.name.charAt(0).toUpperCase()}
                        </div>
                        <span className="text-sm font-medium flex-1 text-left truncate">{member.name}</span>
                        <span className="text-[11px] text-secondary">
                          {member.messages.length} msg{member.messages.length !== 1 ? 's' : ''}
                        </span>
                        <ChevronDown
                          size={14}
                          className={`text-secondary transition-transform ${memberOpen ? '' : '-rotate-90'}`}
                        />
                      </button>

                      {/* Messages */}
                      {memberOpen && (
                        <div className="px-5 pb-4 pl-14 space-y-2">
                          {member.messages.map(msg => (
                            <div key={msg.id} className="flex gap-3">
                              <span className="text-[10px] text-secondary/60 w-14 shrink-0 pt-0.5">
                                {format(parseISO(msg.time), 'h:mm a')}
                              </span>
                              <div className="flex-1 min-w-0">
                                {msg.channel && (
                                  <span className="text-[10px] text-secondary/50 mr-2">#{msg.channel}</span>
                                )}
                                <p className="text-xs leading-relaxed text-text-secondary inline">{msg.content}</p>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
}
