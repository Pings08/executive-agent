'use client';

import { useEffect, useState, useCallback } from 'react';
import {
  Layers, ChevronDown, Loader2, RefreshCw, Target,
} from 'lucide-react';
import { useSelectedOrg } from '@/components/Sidebar';
import { WORKSPACE_LABELS, type Workspace } from '@/types';
import { ORG_CATEGORIES, groupByCategory, type OrgCategory } from '@/lib/categories';

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

const statusDots: Record<string, string> = {
  active: 'bg-green-400',
  progressing: 'bg-blue-400',
  stalled: 'bg-yellow-400',
  completed: 'bg-emerald-400',
  abandoned: 'bg-gray-500',
  hypothesis: 'bg-violet-400',
};

const statusLabels: Record<string, string> = {
  active: 'Active',
  progressing: 'Progressing',
  stalled: 'Stalled',
  completed: 'Completed',
  hypothesis: 'Research',
};

export default function CategoriesPage() {
  const [selectedOrg] = useSelectedOrg();
  const [objectives, setObjectives] = useState<InferredObjective[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const fetchData = useCallback(async (org: Workspace) => {
    setLoading(true);
    try {
      const res = await fetch(`/api/company?org=${org}`);
      const data = await res.json();
      setObjectives(data.objectives || []);
      // Auto-expand all categories
      const cats = ORG_CATEGORIES[org] || [];
      setExpanded(new Set(cats.map(c => c.id)));
    } catch { setObjectives([]); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { fetchData(selectedOrg); }, [fetchData, selectedOrg]);
  useEffect(() => {
    const handler = (e: Event) => {
      const newOrg = (e as CustomEvent).detail as Workspace;
      fetchData(newOrg);
    };
    window.addEventListener('org-changed', handler);
    return () => window.removeEventListener('org-changed', handler);
  }, [fetchData]);

  const toggle = (id: string) => setExpanded(p => {
    const x = new Set(p); x.has(id) ? x.delete(id) : x.add(id); return x;
  });

  const categories = ORG_CATEGORIES[selectedOrg] || [];
  const grouped = groupByCategory(objectives, categories);

  // Calculate stats per category
  function getCatStats(objs: InferredObjective[]) {
    const total = objs.length;
    const active = objs.filter(o => o.status === 'active' || o.status === 'progressing').length;
    const completed = objs.filter(o => o.status === 'completed').length;
    const stalled = objs.filter(o => o.status === 'stalled').length;
    const hypothesis = objs.filter(o => o.status === 'hypothesis').length;
    const progress = total > 0 ? Math.round(((completed + active * 0.5) / total) * 100) : 0;
    return { total, active, completed, stalled, hypothesis, progress };
  }

  return (
    <div className="max-w-5xl mx-auto py-8 px-6 space-y-6 animate-fadeIn">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight flex items-center gap-3">
            <Layers className="text-accent" size={28} />
            {WORKSPACE_LABELS[selectedOrg]} Categories
          </h1>
          <p className="text-secondary text-sm mt-1">Objectives organized by CEO-defined categories</p>
        </div>
        <button onClick={() => fetchData(selectedOrg)} disabled={loading}
          className="flex items-center gap-2 text-xs font-bold text-accent hover:underline disabled:opacity-50">
          <RefreshCw size={13} className={loading ? 'animate-spin' : ''} /> Refresh
        </button>
      </header>

      {loading && (
        <div className="flex justify-center py-20"><Loader2 className="animate-spin text-accent" size={28} /></div>
      )}

      {!loading && objectives.length === 0 && (
        <div className="card text-center py-16">
          <Layers size={32} className="mx-auto text-secondary/40 mb-3" />
          <p className="text-sm text-secondary">No objectives yet. Run synthesis from Settings first.</p>
        </div>
      )}

      {!loading && objectives.length > 0 && (
        <>
          {/* Category overview — Gantt-style progress bars */}
          <div className="space-y-2">
            {[...grouped.entries()]
              .filter(([id]) => id !== 'uncategorized' || grouped.get(id)!.objectives.length > 0)
              .map(([catId, { category: cat, objectives: catObjs }]) => {
                const stats = getCatStats(catObjs as InferredObjective[]);

                return (
                  <div key={catId} className={`rounded-xl border ${cat.borderColor} overflow-hidden`}>
                    {/* Category header with progress bar */}
                    <button
                      onClick={() => toggle(catId)}
                      className={`w-full px-5 py-4 ${cat.bgColor} hover:brightness-110 transition-all`}
                    >
                      <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center gap-3">
                          <ChevronDown size={16} className={`${cat.color} transition-transform ${expanded.has(catId) ? '' : '-rotate-90'}`} />
                          <span className={`text-sm font-bold ${cat.color}`}>{cat.label}</span>
                        </div>
                        <div className="flex items-center gap-3 text-[11px] text-secondary">
                          <span>{stats.active} active</span>
                          {stats.completed > 0 && <span className="text-emerald-400">{stats.completed} done</span>}
                          {stats.stalled > 0 && <span className="text-yellow-400">{stats.stalled} stalled</span>}
                          {stats.hypothesis > 0 && <span className="text-violet-400">{stats.hypothesis} research</span>}
                          <span className="font-bold">{stats.total} total</span>
                        </div>
                      </div>

                      {/* Progress bar */}
                      {stats.total > 0 && (
                        <div className="w-full h-2 bg-black/20 rounded-full overflow-hidden flex">
                          {stats.completed > 0 && (
                            <div className="h-full bg-emerald-400" style={{ width: `${(stats.completed / stats.total) * 100}%` }} />
                          )}
                          {stats.active > 0 && (
                            <div className="h-full bg-blue-400" style={{ width: `${(stats.active / stats.total) * 100}%` }} />
                          )}
                          {stats.hypothesis > 0 && (
                            <div className="h-full bg-violet-400" style={{ width: `${(stats.hypothesis / stats.total) * 100}%` }} />
                          )}
                          {stats.stalled > 0 && (
                            <div className="h-full bg-yellow-400" style={{ width: `${(stats.stalled / stats.total) * 100}%` }} />
                          )}
                        </div>
                      )}
                    </button>

                    {/* Objectives list */}
                    {expanded.has(catId) && catObjs.length > 0 && (
                      <div className="divide-y divide-border/30">
                        {(catObjs as InferredObjective[]).map(obj => (
                          <div key={obj.id} className="px-5 py-3 hover:bg-glass/30 transition-colors">
                            <div className="flex items-center gap-3">
                              {/* Status indicator */}
                              <div className={`w-2.5 h-2.5 rounded-full shrink-0 ${statusDots[obj.status] || 'bg-gray-400'}`} />

                              {/* Title and info */}
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2">
                                  <span className="text-sm font-medium">{obj.title}</span>
                                  <span className={`text-[9px] px-1.5 py-0.5 rounded-full font-bold ${
                                    obj.status === 'active' ? 'bg-green-500/15 text-green-400' :
                                    obj.status === 'progressing' ? 'bg-blue-500/15 text-blue-400' :
                                    obj.status === 'completed' ? 'bg-emerald-500/15 text-emerald-400' :
                                    obj.status === 'stalled' ? 'bg-yellow-500/15 text-yellow-400' :
                                    obj.status === 'hypothesis' ? 'bg-violet-500/15 text-violet-400' :
                                    'bg-gray-500/15 text-gray-400'
                                  }`}>
                                    {statusLabels[obj.status] || obj.status}
                                  </span>
                                </div>
                                {obj.description && (
                                  <p className="text-[11px] text-secondary/60 mt-0.5 line-clamp-1">{obj.description}</p>
                                )}
                              </div>

                              {/* Confidence */}
                              <span className="text-[10px] text-secondary shrink-0">
                                {Math.round(obj.confidence_score * 100)}%
                              </span>
                            </div>

                            {/* Timeline bar — from first_seen to last_seen */}
                            {obj.first_seen_at && obj.last_seen_at && (
                              <div className="ml-5 mt-2 flex items-center gap-2 text-[9px] text-secondary/50">
                                <span>{obj.first_seen_at}</span>
                                <div className={`flex-1 h-1 rounded-full ${
                                  obj.status === 'completed' ? 'bg-emerald-400/40' :
                                  obj.status === 'stalled' ? 'bg-yellow-400/40' :
                                  obj.status === 'hypothesis' ? 'bg-violet-400/40' :
                                  'bg-accent/20'
                                }`} />
                                <span>{obj.last_seen_at}</span>
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    )}

                    {expanded.has(catId) && catObjs.length === 0 && (
                      <div className="px-5 py-6 text-center text-xs text-secondary/50 italic">
                        No objectives in this category yet
                      </div>
                    )}
                  </div>
                );
              })}
          </div>

          {/* Legend */}
          <div className="flex items-center gap-4 text-[10px] text-secondary justify-center pt-2">
            <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-green-400" /> Active</span>
            <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-blue-400" /> Progressing</span>
            <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-emerald-400" /> Completed</span>
            <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-yellow-400" /> Stalled</span>
            <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-violet-400" /> Research</span>
          </div>
        </>
      )}
    </div>
  );
}
