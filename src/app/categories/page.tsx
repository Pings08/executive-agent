'use client';

import { useEffect, useState, useCallback } from 'react';
import { Layers, Loader2, RefreshCw } from 'lucide-react';
import { useSelectedOrg } from '@/components/Sidebar';
import { WORKSPACE_LABELS, type Workspace } from '@/types';
import { ORG_CATEGORIES, classifyObjective } from '@/lib/categories';

interface InferredObjective {
  id: string;
  title: string;
  description: string;
  level: 'strategic' | 'operational' | 'tactical';
  parent_id: string | null;
  status: string;
  first_seen_at: string;
  last_seen_at: string;
  evidence_summary: string;
  confidence_score: number;
}

const STATUS_COLORS: Record<string, { bar: string; text: string; label: string }> = {
  active:      { bar: 'bg-blue-500',    text: 'text-blue-400',    label: 'Active' },
  progressing: { bar: 'bg-emerald-500', text: 'text-emerald-400', label: 'Progressing' },
  stalled:     { bar: 'bg-yellow-500',  text: 'text-yellow-400',  label: 'Stalled' },
  completed:   { bar: 'bg-emerald-600', text: 'text-emerald-400', label: 'Completed' },
  hypothesis:  { bar: 'bg-violet-500',  text: 'text-violet-400',  label: 'Research' },
  abandoned:   { bar: 'bg-gray-500',    text: 'text-gray-400',    label: 'Abandoned' },
};

/**
 * Calculate the Gantt bar position and width relative to a timeline range.
 */
function getBarStyle(firstSeen: string, lastSeen: string, timelineStart: Date, timelineEnd: Date) {
  const totalDays = Math.max(1, (timelineEnd.getTime() - timelineStart.getTime()) / (1000 * 60 * 60 * 24));
  const start = new Date(firstSeen);
  const end = new Date(lastSeen);

  const startOffset = Math.max(0, (start.getTime() - timelineStart.getTime()) / (1000 * 60 * 60 * 24));
  const duration = Math.max(1, (end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24));

  const left = (startOffset / totalDays) * 100;
  const width = Math.min((duration / totalDays) * 100, 100 - left);

  return { left: `${left}%`, width: `${Math.max(width, 2)}%` };
}

function daysAgo(dateStr: string): number {
  return Math.round((Date.now() - new Date(dateStr).getTime()) / (1000 * 60 * 60 * 24));
}

function formatShort(dateStr: string): string {
  const d = new Date(dateStr);
  return d.toLocaleDateString('en', { month: 'short', day: 'numeric' });
}

export default function CategoriesPage() {
  const [selectedOrg] = useSelectedOrg();
  const [objectives, setObjectives] = useState<InferredObjective[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchData = useCallback(async (org: Workspace) => {
    setLoading(true);
    try {
      const res = await fetch(`/api/company?org=${org}`);
      const data = await res.json();
      setObjectives(data.objectives || []);
    } catch { setObjectives([]); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { fetchData(selectedOrg); }, [fetchData, selectedOrg]);
  useEffect(() => {
    const handler = (e: Event) => fetchData((e as CustomEvent).detail as Workspace);
    window.addEventListener('org-changed', handler);
    return () => window.removeEventListener('org-changed', handler);
  }, [fetchData]);

  const categories = ORG_CATEGORIES[selectedOrg] || [];

  // Group objectives by category
  const catGroups = new Map<string, { label: string; color: string; bgColor: string; borderColor: string; objs: InferredObjective[] }>();
  for (const cat of categories) catGroups.set(cat.id, { label: cat.label, color: cat.color, bgColor: cat.bgColor, borderColor: cat.borderColor, objs: [] });
  catGroups.set('other', { label: 'Other', color: 'text-gray-400', bgColor: 'bg-gray-500/10', borderColor: 'border-gray-500/30', objs: [] });
  for (const obj of objectives) {
    const catId = classifyObjective(obj.title, obj.description || '', categories);
    catGroups.get(catId)?.objs.push(obj);
  }

  // Timeline range: earliest first_seen to today + 7 days
  const allDates = objectives.flatMap(o => [o.first_seen_at, o.last_seen_at]).filter(Boolean).map(d => new Date(d).getTime());
  const timelineStart = allDates.length > 0 ? new Date(Math.min(...allDates)) : new Date();
  const timelineEnd = new Date();
  timelineEnd.setDate(timelineEnd.getDate() + 7);

  // Timeline month markers
  const months: { label: string; left: string }[] = [];
  const totalDays = Math.max(1, (timelineEnd.getTime() - timelineStart.getTime()) / (1000 * 60 * 60 * 24));
  const cursor = new Date(timelineStart);
  cursor.setDate(1);
  cursor.setMonth(cursor.getMonth() + 1);
  while (cursor < timelineEnd) {
    const offset = (cursor.getTime() - timelineStart.getTime()) / (1000 * 60 * 60 * 24);
    months.push({ label: cursor.toLocaleDateString('en', { month: 'short' }), left: `${(offset / totalDays) * 100}%` });
    cursor.setMonth(cursor.getMonth() + 1);
  }

  return (
    <div className="max-w-6xl mx-auto py-8 px-6 space-y-6 animate-fadeIn">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <Layers className="text-accent" size={24} />
            {WORKSPACE_LABELS[selectedOrg]} — Categories
          </h1>
          <p className="text-secondary text-sm mt-0.5">Objective tracking by category</p>
        </div>
        <button onClick={() => fetchData(selectedOrg)} disabled={loading}
          className="flex items-center gap-2 text-xs font-bold text-secondary hover:text-accent disabled:opacity-50">
          <RefreshCw size={12} className={loading ? 'animate-spin' : ''} /> Refresh
        </button>
      </header>

      {loading && <div className="flex justify-center py-20"><Loader2 className="animate-spin text-accent" size={28} /></div>}

      {!loading && objectives.length === 0 && (
        <div className="card text-center py-16">
          <Layers size={28} className="mx-auto text-secondary/30 mb-3" />
          <p className="text-sm text-secondary">No objectives yet. Run synthesis from Settings.</p>
        </div>
      )}

      {!loading && objectives.length > 0 && (
        <div className="space-y-6">
          {[...catGroups.entries()]
            .filter(([, g]) => g.objs.length > 0)
            .map(([catId, g]) => {
              const active = g.objs.filter(o => o.status === 'active' || o.status === 'progressing').length;
              const completed = g.objs.filter(o => o.status === 'completed').length;
              const stalled = g.objs.filter(o => o.status === 'stalled').length;

              return (
                <section key={catId} className={`rounded-xl border ${g.borderColor} overflow-hidden`}>
                  {/* Category header */}
                  <div className={`px-5 py-3 ${g.bgColor} flex items-center justify-between`}>
                    <span className={`text-sm font-bold ${g.color}`}>{g.label}</span>
                    <div className="flex items-center gap-3 text-[10px] text-secondary">
                      {active > 0 && <span className="text-blue-400">{active} active</span>}
                      {completed > 0 && <span className="text-emerald-400">{completed} done</span>}
                      {stalled > 0 && <span className="text-yellow-400">{stalled} stalled</span>}
                      <span className="font-bold">{g.objs.length} total</span>
                    </div>
                  </div>

                  {/* Gantt chart */}
                  <div className="px-5 py-3">
                    {/* Timeline header */}
                    <div className="relative h-5 mb-1 border-b border-border/30">
                      {months.map((m, i) => (
                        <span key={i} className="absolute text-[9px] text-secondary/40 -translate-x-1/2" style={{ left: m.left }}>
                          {m.label}
                        </span>
                      ))}
                      <span className="absolute right-0 text-[9px] text-accent/60">Today</span>
                    </div>

                    {/* Objective rows */}
                    <div className="space-y-1.5">
                      {g.objs
                        .sort((a, b) => a.first_seen_at.localeCompare(b.first_seen_at))
                        .map(obj => {
                          const sc = STATUS_COLORS[obj.status] || STATUS_COLORS.active;
                          const bar = getBarStyle(obj.first_seen_at, obj.last_seen_at, timelineStart, timelineEnd);
                          const days = daysAgo(obj.first_seen_at);
                          const lastActive = daysAgo(obj.last_seen_at);

                          return (
                            <div key={obj.id} className="flex items-center gap-3 group hover:bg-glass/30 rounded px-1 py-1 -mx-1">
                              {/* Title */}
                              <div className="w-[240px] shrink-0 min-w-0">
                                <div className="flex items-center gap-1.5">
                                  <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${sc.bar}`} />
                                  <span className="text-[11px] font-medium truncate" title={obj.title}>{obj.title}</span>
                                </div>
                              </div>

                              {/* Gantt bar */}
                              <div className="flex-1 relative h-5">
                                {/* Today marker */}
                                {(() => {
                                  const todayOffset = (Date.now() - timelineStart.getTime()) / (1000 * 60 * 60 * 24);
                                  const todayLeft = (todayOffset / totalDays) * 100;
                                  return <div className="absolute top-0 bottom-0 w-px bg-accent/30" style={{ left: `${todayLeft}%` }} />;
                                })()}

                                <div
                                  className={`absolute top-1 h-3 rounded-sm ${sc.bar} ${obj.status === 'stalled' ? 'opacity-60 bg-stripes' : 'opacity-80'}`}
                                  style={bar}
                                  title={`${formatShort(obj.first_seen_at)} → ${formatShort(obj.last_seen_at)} (${days}d)`}
                                />
                              </div>

                              {/* Duration info */}
                              <div className="w-[80px] shrink-0 text-right">
                                <span className={`text-[9px] font-bold ${sc.text}`}>{sc.label}</span>
                                <br />
                                <span className="text-[8px] text-secondary/40">
                                  {lastActive === 0 ? 'today' : `${lastActive}d ago`}
                                </span>
                              </div>
                            </div>
                          );
                        })}
                    </div>
                  </div>
                </section>
              );
            })}

          {/* Legend */}
          <div className="flex items-center gap-4 text-[10px] text-secondary justify-center">
            {Object.entries(STATUS_COLORS).filter(([k]) => k !== 'abandoned').map(([k, v]) => (
              <span key={k} className="flex items-center gap-1">
                <span className={`w-3 h-2 rounded-sm ${v.bar}`} /> {v.label}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
