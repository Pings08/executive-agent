'use client';

import { useEffect, useState, useCallback } from 'react';
import {
  MessageSquare, ChevronLeft, ChevronRight, ChevronDown,
  Loader2, RefreshCw, Users, Calendar, Sparkles, Star,
  AlertTriangle, Target, Image as ImageIcon, FileText,
} from 'lucide-react';
import { format, parseISO, addDays, subDays } from 'date-fns';
import { useSelectedOrg } from '@/components/Sidebar';

const ORG_WORKSPACES: Record<string, string[]> = {
  biotech: ['ExRNA', 'VV Biotech'],
  tcr: ['Technoculture'],
  sentient_x: ['Sentient'],
};

type Msg = { id: string; content: string; channel: string | null; time: string; message_type?: string; file_url?: string | null };
type Member = { id: string | null; name: string; messages: Msg[] };
type WsGroup = { name: string; messageCount: number; memberCount: number; members: Member[] };
type EmployeeEval = {
  employee_name: string; topics: string[]; effectiveness_score: number;
  summary: string; key_contributions: string[]; blockers: string[]; message_count: number;
};

function getInitials(name: string): string {
  return name.split(' ').filter(Boolean).slice(0, 2).map(w => w[0]).join('').toUpperCase();
}
const COLORS = ['bg-emerald-600','bg-blue-600','bg-purple-600','bg-amber-600','bg-rose-600','bg-cyan-600','bg-indigo-600','bg-teal-600'];
function colorFor(name: string): string {
  let h = 0; for (const c of name) h = ((h << 5) - h + c.charCodeAt(0)) | 0;
  return COLORS[Math.abs(h) % COLORS.length];
}

function scoreColor(score: number): string {
  if (score >= 8) return 'text-emerald-400';
  if (score >= 6) return 'text-blue-400';
  if (score >= 4) return 'text-amber-400';
  return 'text-red-400';
}

const WS_COLORS: Record<string, { bg: string; text: string; border: string }> = {
  ExRNA:         { bg: 'bg-emerald-500/10', text: 'text-emerald-400', border: 'border-emerald-500/30' },
  Sentient:      { bg: 'bg-cyan-500/10',    text: 'text-cyan-400',    border: 'border-cyan-500/30' },
  Technoculture: { bg: 'bg-purple-500/10',  text: 'text-purple-400',  border: 'border-purple-500/30' },
  'VV Biotech':  { bg: 'bg-orange-500/10',  text: 'text-orange-400',  border: 'border-orange-500/30' },
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

  // AI Evaluations
  const [evaluations, setEvaluations] = useState<EmployeeEval[]>([]);
  const [evalLoading, setEvalLoading] = useState(false);
  const [evalCached, setEvalCached] = useState(false);

  const loadDay = useCallback(async (d: string) => {
    setLoading(true);
    try {
      const res = await fetch(`/api/messages/daily?date=${d}`);
      const data = await res.json();
      const allowed = ORG_WORKSPACES[selectedOrg] || [];
      const filtered = (data.workspaces || []).filter((w: WsGroup) => allowed.includes(w.name));
      setWorkspaces(filtered);
      setTotalMessages(filtered.reduce((s: number, w: WsGroup) => s + w.messageCount, 0));
      setExpandedWs(new Set(filtered.map((w: WsGroup) => w.name)));
      setExpandedMembers(new Set());
    } catch { setWorkspaces([]); }
    finally { setLoading(false); }
  }, [selectedOrg]);

  const loadEvaluations = useCallback(async (d: string, org: string) => {
    try {
      const res = await fetch(`/api/messages/evaluate?date=${d}&org=${org}`);
      const data = await res.json();
      setEvaluations(data.evaluations || []);
      setEvalCached(data.cached || false);
    } catch { setEvaluations([]); }
  }, []);

  const runEvaluation = async () => {
    setEvalLoading(true);
    try {
      const res = await fetch(`/api/messages/evaluate?date=${date}&org=${selectedOrg}`, { method: 'POST' });
      const data = await res.json();
      setEvaluations(data.evaluations || []);
      setEvalCached(false);
    } catch { /* silent */ }
    finally { setEvalLoading(false); }
  };

  useEffect(() => { loadDay(date); loadEvaluations(date, selectedOrg); }, [date, loadDay, loadEvaluations, selectedOrg]);

  useEffect(() => {
    const handler = () => { loadDay(date); loadEvaluations(date, selectedOrg); };
    window.addEventListener('org-changed', handler);
    return () => window.removeEventListener('org-changed', handler);
  }, [date, loadDay, loadEvaluations, selectedOrg]);

  const prevDay = () => setDate(subDays(parseISO(date), 1).toISOString().slice(0, 10));
  const nextDay = () => { const t = addDays(parseISO(date), 1).toISOString().slice(0, 10); if (t <= new Date().toISOString().slice(0, 10)) setDate(t); };
  const goToday = () => setDate(new Date().toISOString().slice(0, 10));
  const isToday = date === new Date().toISOString().slice(0, 10);

  const toggleWs = (n: string) => setExpandedWs(p => { const x = new Set(p); x.has(n) ? x.delete(n) : x.add(n); return x; });
  const toggleMember = (k: string) => setExpandedMembers(p => { const x = new Set(p); x.has(k) ? x.delete(k) : x.add(k); return x; });

  // Build eval lookup by employee name (case-insensitive)
  const evalMap = new Map<string, EmployeeEval>();
  for (const e of evaluations) evalMap.set(e.employee_name.toLowerCase(), e);

  return (
    <div className="max-w-5xl mx-auto py-8 px-6 space-y-6 animate-fadeIn">
      {/* Header */}
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Messages</h1>
          <p className="text-secondary text-sm mt-1">Daily activity + AI evaluation by workspace</p>
        </div>
        <button onClick={() => loadDay(date)} disabled={loading}
          className="flex items-center gap-2 text-xs font-bold text-accent hover:underline disabled:opacity-50">
          <RefreshCw size={13} className={loading ? 'animate-spin' : ''} /> Refresh
        </button>
      </header>

      {/* Date picker */}
      <div className="flex items-center gap-3">
        <button onClick={prevDay} className="p-1.5 rounded hover:bg-glass transition-colors"><ChevronLeft size={18} /></button>
        <div className="flex items-center gap-2 text-sm font-bold">
          <Calendar size={15} className="text-accent" />
          {format(parseISO(date), 'EEEE, MMMM d, yyyy')}
        </div>
        <button onClick={nextDay} disabled={isToday} className="p-1.5 rounded hover:bg-glass transition-colors disabled:opacity-30"><ChevronRight size={18} /></button>
        {!isToday && <button onClick={goToday} className="text-[11px] font-bold text-accent hover:underline ml-2">Today</button>}
        <span className="ml-auto text-xs text-secondary">{totalMessages} message{totalMessages !== 1 ? 's' : ''}</span>
      </div>

      {/* AI Evaluation Banner */}
      {!loading && workspaces.length > 0 && (
        <div className="card !p-4 space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-bold flex items-center gap-2">
              <Sparkles className="text-accent" size={16} />
              AI Daily Evaluation
            </h2>
            <button onClick={runEvaluation} disabled={evalLoading}
              className="text-[11px] font-bold text-accent hover:underline flex items-center gap-1 disabled:opacity-50">
              {evalLoading ? <Loader2 size={12} className="animate-spin" /> : <Sparkles size={12} />}
              {evaluations.length > 0 ? 'Re-evaluate' : 'Run Evaluation'}
            </button>
          </div>

          {evalLoading && (
            <div className="flex items-center gap-2 text-xs text-secondary py-4 justify-center">
              <Loader2 size={14} className="animate-spin" /> Analyzing messages with AI...
            </div>
          )}

          {!evalLoading && evaluations.length === 0 && (
            <p className="text-xs text-secondary italic py-2">
              No evaluation yet. Click &quot;Run Evaluation&quot; to get AI assessment of each team member&apos;s daily activity.
            </p>
          )}

          {!evalLoading && evaluations.length > 0 && (
            <div className="space-y-2">
              {evaluations
                .sort((a, b) => b.effectiveness_score - a.effectiveness_score)
                .map((ev, i) => (
                <div key={i} className="p-3 bg-glass rounded-lg">
                  <div className="flex items-start gap-3">
                    <div className={`w-8 h-8 rounded-full ${colorFor(ev.employee_name)} flex items-center justify-center text-[10px] font-bold text-white shrink-0`}>
                      {getInitials(ev.employee_name)}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-sm font-bold">{ev.employee_name}</span>
                        <span className={`text-lg font-bold ${scoreColor(ev.effectiveness_score)}`}>
                          {ev.effectiveness_score}
                        </span>
                        <span className="text-[10px] text-secondary">/10</span>
                        <span className="text-[10px] text-secondary ml-auto">{ev.message_count} msgs</span>
                      </div>
                      <p className="text-xs text-secondary/80 leading-relaxed">{ev.summary}</p>

                      {/* Topics */}
                      {ev.topics.length > 0 && (
                        <div className="flex flex-wrap gap-1 mt-2">
                          {ev.topics.map((t, j) => (
                            <span key={j} className="text-[10px] bg-accent/10 text-accent px-1.5 py-0.5 rounded flex items-center gap-0.5">
                              <Target size={8} /> {t}
                            </span>
                          ))}
                        </div>
                      )}

                      {/* Key contributions */}
                      {ev.key_contributions.length > 0 && (
                        <div className="mt-2 space-y-0.5">
                          {ev.key_contributions.map((c, j) => (
                            <div key={j} className="flex items-start gap-1 text-[10px] text-emerald-400/80">
                              <Star size={8} className="mt-0.5 shrink-0" /> {c}
                            </div>
                          ))}
                        </div>
                      )}

                      {/* Blockers */}
                      {ev.blockers.length > 0 && (
                        <div className="mt-2 space-y-0.5">
                          {ev.blockers.map((b, j) => (
                            <div key={j} className="flex items-start gap-1 text-[10px] text-red-400/80">
                              <AlertTriangle size={8} className="mt-0.5 shrink-0" /> {b}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              ))}
              {evalCached && <p className="text-[10px] text-secondary/50 text-right">Cached evaluation</p>}
            </div>
          )}
        </div>
      )}

      {/* Loading */}
      {loading && <div className="flex justify-center py-20"><Loader2 className="animate-spin text-accent" size={28} /></div>}

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
            <button onClick={() => toggleWs(ws.name)}
              className={`w-full flex items-center justify-between px-5 py-4 ${colors.bg} hover:brightness-110 transition-all`}>
              <div className="flex items-center gap-3">
                <ChevronDown size={16} className={`${colors.text} transition-transform ${isOpen ? '' : '-rotate-90'}`} />
                <span className={`text-sm font-bold ${colors.text}`}>{ws.name}</span>
              </div>
              <div className="flex items-center gap-4 text-xs text-secondary">
                <span className="flex items-center gap-1"><Users size={12} /> {ws.memberCount}</span>
                <span className="flex items-center gap-1"><MessageSquare size={12} /> {ws.messageCount}</span>
              </div>
            </button>

            {isOpen && (
              <div className="divide-y divide-border/40">
                {ws.members.map(member => {
                  const memberKey = `${ws.name}::${member.id || member.name}`;
                  const memberOpen = expandedMembers.has(memberKey);
                  const ev = evalMap.get(member.name.toLowerCase());

                  return (
                    <div key={memberKey}>
                      <button onClick={() => toggleMember(memberKey)}
                        className="w-full flex items-center gap-3 px-5 py-3 hover:bg-glass/50 transition-colors">
                        <div className={`w-7 h-7 rounded-full ${colorFor(member.name)} flex items-center justify-center text-[10px] font-bold text-white shrink-0`}>
                          {getInitials(member.name)}
                        </div>
                        <span className="text-sm font-medium flex-1 text-left truncate">{member.name}</span>
                        {ev && (
                          <span className={`text-sm font-bold ${scoreColor(ev.effectiveness_score)}`}>
                            {ev.effectiveness_score}/10
                          </span>
                        )}
                        <span className="text-[11px] text-secondary">
                          {member.messages.length} msg{member.messages.length !== 1 ? 's' : ''}
                        </span>
                        <ChevronDown size={14} className={`text-secondary transition-transform ${memberOpen ? '' : '-rotate-90'}`} />
                      </button>

                      {memberOpen && (
                        <div className="px-5 pb-4 pl-14 space-y-2">
                          {/* Inline AI eval summary */}
                          {ev && (
                            <div className="p-2 bg-accent/5 border border-accent/20 rounded-lg mb-3">
                              <p className="text-xs text-secondary/80">{ev.summary}</p>
                              {ev.topics.length > 0 && (
                                <div className="flex flex-wrap gap-1 mt-1.5">
                                  {ev.topics.map((t, j) => (
                                    <span key={j} className="text-[9px] bg-accent/10 text-accent px-1.5 py-0.5 rounded">{t}</span>
                                  ))}
                                </div>
                              )}
                            </div>
                          )}

                          {member.messages.map(msg => (
                            <div key={msg.id} className="flex gap-3">
                              <span className="text-[10px] text-secondary/60 w-14 shrink-0 pt-0.5">
                                {(() => { try { return format(parseISO(msg.time), 'h:mm a'); } catch { return msg.time?.slice(11, 16) || ''; } })()}
                              </span>
                              <div className="flex-1 min-w-0">
                                {msg.channel && <span className="text-[10px] text-secondary/50 mr-2">#{msg.channel}</span>}
                                {msg.message_type === 'Image' ? (
                                  <div className="mt-1 flex items-center gap-1.5 text-xs text-secondary/60">
                                    <ImageIcon size={12} />
                                    <span>{msg.content || 'Shared an image'}</span>
                                    {msg.file_url && (
                                      <a href={msg.file_url} target="_blank" rel="noopener noreferrer"
                                        className="text-accent hover:underline ml-1">[view]</a>
                                    )}
                                  </div>
                                ) : msg.message_type === 'File' ? (
                                  <div className="mt-1 flex items-center gap-1.5 text-xs text-secondary/60">
                                    <FileText size={12} />
                                    {msg.file_url ? (
                                      <a href={msg.file_url} target="_blank" rel="noopener noreferrer"
                                        className="text-accent hover:underline">{msg.content || 'Shared a file'}</a>
                                    ) : <span>{msg.content || 'Shared a file'}</span>}
                                  </div>
                                ) : (
                                  <p className="text-xs leading-relaxed text-text-secondary inline">{msg.content}</p>
                                )}
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
