'use client';

import { useEffect, useState, useCallback } from 'react';
import { WORKSPACE_LABELS, type Workspace } from '@/types';
import {
  Building2, Users, MessageSquare, AlertTriangle,
  Loader2, RefreshCw, Target, ChevronDown, Sparkles,
} from 'lucide-react';
import Link from 'next/link';
import { format } from 'date-fns';
import { ORG_CATEGORIES, classifyObjective } from '@/lib/categories';

// ── Types ────────────────────────────────────────────────────────────────────

interface DayData {
  date: string;
  totalMessages: number;
  workspaces: { name: string; messageCount: number; memberCount: number; members: { name: string; messages: { content: string }[] }[] }[];
}

interface EmployeeEval {
  employee_name: string;
  topics: string[];
  effectiveness_score: number;
  summary: string;
  key_contributions: string[];
  blockers: string[];
  message_count: number;
}

interface InferredObjective {
  id: string;
  title: string;
  description: string;
  status: string;
  level: string;
  confidence_score: number;
}

const statusDot: Record<string, string> = {
  active: 'bg-green-400', progressing: 'bg-blue-400', stalled: 'bg-yellow-400',
  completed: 'bg-emerald-400', hypothesis: 'bg-violet-400', abandoned: 'bg-gray-500',
};

function scoreColor(s: number) {
  if (s >= 8) return 'text-emerald-400';
  if (s >= 6) return 'text-blue-400';
  if (s >= 4) return 'text-amber-400';
  return 'text-red-400';
}

function getInitials(name: string) {
  return name.split(' ').filter(Boolean).slice(0, 2).map(w => w[0]).join('').toUpperCase();
}

const AVATAR_COLORS = ['bg-emerald-600','bg-blue-600','bg-purple-600','bg-amber-600','bg-rose-600','bg-cyan-600','bg-indigo-600','bg-teal-600'];
function avatarColor(name: string) {
  let h = 0; for (const c of name) h = ((h << 5) - h + c.charCodeAt(0)) | 0;
  return AVATAR_COLORS[Math.abs(h) % AVATAR_COLORS.length];
}

// ── Component ────────────────────────────────────────────────────────────────

export default function Dashboard() {
  const [selectedOrg, setSelectedOrg] = useState<Workspace>('biotech');
  const [today] = useState(() => new Date().toISOString().slice(0, 10));
  const [dayData, setDayData] = useState<DayData | null>(null);
  const [evals, setEvals] = useState<EmployeeEval[]>([]);
  const [objectives, setObjectives] = useState<InferredObjective[]>([]);
  const [loading, setLoading] = useState(true);
  const [evalLoading, setEvalLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [expandedCats, setExpandedCats] = useState<Set<string>>(new Set());

  // Sync org selector with sidebar
  useEffect(() => {
    const saved = localStorage.getItem('ea_selected_org') as Workspace | null;
    if (saved) setSelectedOrg(saved);
    const handler = (e: Event) => setSelectedOrg((e as CustomEvent).detail as Workspace);
    window.addEventListener('org-changed', handler);
    return () => window.removeEventListener('org-changed', handler);
  }, []);

  // Fetch today's data
  const fetchAll = useCallback(async (org: Workspace) => {
    setLoading(true);
    try {
      const ORG_WS: Record<string, string[]> = {
        biotech: ['ExRNA', 'VV Biotech'], tcr: ['Technoculture'], sentient_x: ['Sentient'],
      };
      const allowed = ORG_WS[org] || [];

      const [msgRes, evalRes, companyRes] = await Promise.all([
        fetch(`/api/messages/daily?date=${today}`).then(r => r.json()).catch(() => null),
        fetch(`/api/messages/evaluate?date=${today}&org=${org}`).then(r => r.json()).catch(() => null),
        fetch(`/api/company?org=${org}`).then(r => r.json()).catch(() => null),
      ]);

      if (msgRes) {
        const filtered = (msgRes.workspaces || []).filter((w: DayData['workspaces'][0]) => allowed.includes(w.name));
        setDayData({
          date: today,
          totalMessages: filtered.reduce((s: number, w: DayData['workspaces'][0]) => s + w.messageCount, 0),
          workspaces: filtered,
        });
      }
      setEvals(evalRes?.evaluations || []);
      setObjectives(companyRes?.objectives || []);
    } catch { /* silent */ }
    finally { setLoading(false); }
  }, [today]);

  useEffect(() => { fetchAll(selectedOrg); }, [fetchAll, selectedOrg]);

  // Auto-sync: ingest new messages on load
  useEffect(() => {
    const sync = async () => {
      setSyncing(true);
      try {
        await fetch('/api/pipeline/ingest', { method: 'POST', signal: AbortSignal.timeout(10000) });
      } catch { /* silent */ }
      finally { setSyncing(false); }
    };
    const t = setTimeout(sync, 3000);
    return () => clearTimeout(t);
  }, []);

  // Run AI evaluation
  const runEval = async () => {
    setEvalLoading(true);
    try {
      const res = await fetch(`/api/messages/evaluate?date=${today}&org=${selectedOrg}`, { method: 'POST' });
      const data = await res.json();
      setEvals(data.evaluations || []);
    } catch { /* silent */ }
    finally { setEvalLoading(false); }
  };

  // Category grouping
  const categories = ORG_CATEGORIES[selectedOrg] || [];
  const catGroups = new Map<string, { label: string; color: string; bgColor: string; borderColor: string; objs: InferredObjective[] }>();
  for (const cat of categories) catGroups.set(cat.id, { label: cat.label, color: cat.color, bgColor: cat.bgColor, borderColor: cat.borderColor, objs: [] });
  catGroups.set('other', { label: 'Other', color: 'text-gray-400', bgColor: 'bg-gray-500/10', borderColor: 'border-gray-500/30', objs: [] });
  for (const obj of objectives) {
    const catId = classifyObjective(obj.title, obj.description || '', categories);
    catGroups.get(catId)?.objs.push(obj);
  }

  const toggleCat = (id: string) => setExpandedCats(p => { const x = new Set(p); x.has(id) ? x.delete(id) : x.add(id); return x; });

  // Compute stats
  const totalPeople = new Set(dayData?.workspaces.flatMap(w => w.members.map(m => m.name)) || []).size;
  const totalMsgs = dayData?.totalMessages || 0;
  const avgScore = evals.length > 0 ? (evals.reduce((s, e) => s + e.effectiveness_score, 0) / evals.length).toFixed(1) : '—';
  const blockers = evals.flatMap(e => e.blockers.map(b => ({ employee: e.employee_name, blocker: b })));

  return (
    <div className="max-w-5xl mx-auto py-8 px-6 space-y-6 animate-fadeIn">
      {/* Header */}
      <header className="flex justify-between items-end">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <Building2 className="text-accent" size={24} />
            {WORKSPACE_LABELS[selectedOrg]}
          </h1>
          <p className="text-secondary text-sm mt-0.5">{format(new Date(), 'EEEE, MMMM d, yyyy')}</p>
        </div>
        <div className="flex items-center gap-3">
          {(syncing || loading) && <Loader2 className="animate-spin text-accent" size={14} />}
          <button onClick={() => fetchAll(selectedOrg)} className="text-xs font-bold text-secondary hover:text-accent flex items-center gap-1">
            <RefreshCw size={12} /> Refresh
          </button>
        </div>
      </header>

      {/* Today's Stats — 4 cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { label: 'Messages', value: totalMsgs, icon: MessageSquare },
          { label: 'Active People', value: totalPeople, icon: Users },
          { label: 'Avg Score', value: avgScore, icon: Sparkles },
          { label: 'Blockers', value: blockers.length, icon: AlertTriangle },
        ].map((s, i) => (
          <div key={i} className="card !py-3 !px-4">
            <div className="flex items-center justify-between mb-1">
              <span className="text-[10px] font-bold text-secondary uppercase tracking-wider">{s.label}</span>
              <s.icon size={14} className="text-accent/50" />
            </div>
            <span className="text-2xl font-bold">{s.value}</span>
          </div>
        ))}
      </div>

      {/* Team Activity — who did what today */}
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-bold flex items-center gap-2">
            <Users className="text-accent" size={16} />
            Today&apos;s Team Activity
          </h2>
          <button onClick={runEval} disabled={evalLoading || totalMsgs === 0}
            className="text-[11px] font-bold text-accent hover:underline flex items-center gap-1 disabled:opacity-40">
            {evalLoading ? <Loader2 size={11} className="animate-spin" /> : <Sparkles size={11} />}
            {evals.length > 0 ? 'Re-evaluate' : 'AI Evaluate'}
          </button>
        </div>

        {totalMsgs === 0 && !loading && (
          <div className="card text-center py-10">
            <MessageSquare size={24} className="mx-auto text-secondary/30 mb-2" />
            <p className="text-sm text-secondary">No messages today yet</p>
            <p className="text-xs text-secondary/50 mt-1">Messages auto-sync from Raven every 10 minutes</p>
          </div>
        )}

        {evalLoading && (
          <div className="card flex items-center justify-center gap-2 py-6 text-sm text-secondary">
            <Loader2 size={16} className="animate-spin" /> Evaluating with AI...
          </div>
        )}

        {/* Employee cards */}
        {!evalLoading && dayData && dayData.workspaces.flatMap(w => w.members).length > 0 && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            {(() => {
              // Merge members across workspaces, attach eval
              const memberMap = new Map<string, { name: string; msgCount: number; eval?: EmployeeEval }>();
              for (const ws of dayData.workspaces) {
                for (const m of ws.members) {
                  const existing = memberMap.get(m.name);
                  if (existing) { existing.msgCount += m.messages.length; }
                  else { memberMap.set(m.name, { name: m.name, msgCount: m.messages.length }); }
                }
              }
              // Attach evals
              for (const ev of evals) {
                const m = memberMap.get(ev.employee_name);
                if (m) m.eval = ev;
              }

              return [...memberMap.values()]
                .sort((a, b) => (b.eval?.effectiveness_score || 0) - (a.eval?.effectiveness_score || 0) || b.msgCount - a.msgCount)
                .map(member => (
                  <div key={member.name} className="card !p-3 flex items-start gap-3">
                    <div className={`w-8 h-8 rounded-full ${avatarColor(member.name)} flex items-center justify-center text-[10px] font-bold text-white shrink-0 mt-0.5`}>
                      {getInitials(member.name)}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium truncate">{member.name}</span>
                        {member.eval && (
                          <span className={`text-sm font-bold ${scoreColor(member.eval.effectiveness_score)}`}>
                            {member.eval.effectiveness_score}/10
                          </span>
                        )}
                        <span className="text-[10px] text-secondary ml-auto shrink-0">{member.msgCount} msgs</span>
                      </div>
                      {member.eval ? (
                        <>
                          <p className="text-[11px] text-secondary/70 mt-0.5 line-clamp-2">{member.eval.summary}</p>
                          {member.eval.topics.length > 0 && (
                            <div className="flex flex-wrap gap-1 mt-1">
                              {member.eval.topics.slice(0, 3).map((t, j) => (
                                <span key={j} className="text-[9px] bg-accent/10 text-accent px-1.5 py-0.5 rounded">{t}</span>
                              ))}
                            </div>
                          )}
                        </>
                      ) : (
                        <p className="text-[10px] text-secondary/40 mt-0.5">Click &quot;AI Evaluate&quot; for assessment</p>
                      )}
                    </div>
                  </div>
                ));
            })()}
          </div>
        )}
      </section>

      {/* Blockers */}
      {blockers.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-sm font-bold flex items-center gap-2 text-red-400">
            <AlertTriangle size={16} /> Blockers
          </h2>
          {blockers.map((b, i) => (
            <div key={i} className="text-xs p-2.5 bg-red-500/5 border border-red-500/20 rounded-lg">
              <span className="font-bold">{b.employee}:</span> {b.blocker}
            </div>
          ))}
        </section>
      )}

      {/* Category Health */}
      {objectives.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-sm font-bold flex items-center gap-2">
            <Target className="text-accent" size={16} />
            Category Status
          </h2>
          <div className="space-y-2">
            {[...catGroups.entries()]
              .filter(([, g]) => g.objs.length > 0)
              .map(([catId, g]) => {
                const active = g.objs.filter(o => o.status === 'active' || o.status === 'progressing').length;
                const completed = g.objs.filter(o => o.status === 'completed').length;
                const stalled = g.objs.filter(o => o.status === 'stalled').length;
                const isOpen = expandedCats.has(catId);

                return (
                  <div key={catId} className={`rounded-lg border ${g.borderColor} overflow-hidden`}>
                    <button onClick={() => toggleCat(catId)} className={`w-full flex items-center justify-between px-4 py-2.5 ${g.bgColor} hover:brightness-110`}>
                      <div className="flex items-center gap-2">
                        <ChevronDown size={14} className={`${g.color} transition-transform ${isOpen ? '' : '-rotate-90'}`} />
                        <span className={`text-xs font-bold ${g.color}`}>{g.label}</span>
                      </div>
                      <div className="flex items-center gap-2 text-[10px] text-secondary">
                        {active > 0 && <span>{active} active</span>}
                        {completed > 0 && <span className="text-emerald-400">{completed} done</span>}
                        {stalled > 0 && <span className="text-yellow-400">{stalled} stalled</span>}
                      </div>
                    </button>
                    {isOpen && (
                      <div className="px-4 py-2 space-y-1.5">
                        {g.objs.map(o => (
                          <div key={o.id} className="flex items-center gap-2 text-xs">
                            <span className={`w-2 h-2 rounded-full shrink-0 ${statusDot[o.status] || 'bg-gray-400'}`} />
                            <span className="truncate">{o.title}</span>
                            <span className="text-[9px] text-secondary/50 shrink-0">{o.status}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
          </div>
        </section>
      )}

      {/* Quick links */}
      <div className="flex items-center gap-4 text-xs text-secondary pt-2">
        <Link href="/messages" className="hover:text-accent">View all messages</Link>
        <Link href="/categories" className="hover:text-accent">Category details</Link>
        <Link href="/settings" className="hover:text-accent">Settings</Link>
      </div>
    </div>
  );
}
