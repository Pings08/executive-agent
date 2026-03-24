'use client';

import { useApp } from '@/store/AppContext';
import { useEffect, useState, useCallback } from 'react';
import { WORKSPACE_LABELS, type Workspace } from '@/types';
import {
  Building2, Calendar, TrendingUp, Target, Users,
  AlertTriangle, Sparkles, ChevronDown, ChevronRight,
  Clock, Loader2, RefreshCw, ArrowRight, FlaskConical,
  Eye, Heart, Star, Lightbulb, PlusCircle,
} from 'lucide-react';
import Link from 'next/link';
import { format, parseISO } from 'date-fns';

// ── Types ────────────────────────────────────────────────────────────────────

interface CompanySnapshot {
  period_type: string;
  period_start: string;
  period_end: string;
  narrative: string;
  employee_narrative?: string;
  key_themes: string[];
  objectives_snapshot: { title: string; status_signal?: string; status?: string; objective_status?: string; level?: string; evidence?: string; confidence?: number; related_employee_names?: string[]; workspace_tag?: string }[];
  hypotheses_detected?: { title: string; description: string; stage: string; evidence: string; related_employee_names: string[]; workspace_tag?: string }[];
  proposed_objectives?: { title: string; reason: string; triggered_by: string; priority: string }[];
  performance_scores?: { employee_name: string; performance_score: number; contribution_summary: string }[];
  blockers: { description: string; severity?: string; affected_area?: string; mentioned_by?: string[]; first_excerpt?: string }[];
  highlights: { description: string; employee_name?: string | null }[];
  message_count: number;
  active_employee_count: number;
  created_at: string;
}

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

// ── Helpers ──────────────────────────────────────────────────────────────────

const levelColors: Record<string, string> = {
  strategic: 'bg-purple-500/10 text-purple-400 border-purple-500/30',
  operational: 'bg-blue-500/10 text-blue-400 border-blue-500/30',
  tactical: 'bg-teal-500/10 text-teal-400 border-teal-500/30',
};

const statusColors: Record<string, string> = {
  active: 'text-green-400',
  progressing: 'text-blue-400',
  stalled: 'text-yellow-400',
  completed: 'text-emerald-400',
  abandoned: 'text-gray-500',
  hypothesis: 'text-violet-400',
};

const statusDots: Record<string, string> = {
  active: 'bg-green-400',
  progressing: 'bg-blue-400',
  stalled: 'bg-yellow-400',
  completed: 'bg-emerald-400',
  abandoned: 'bg-gray-500',
  hypothesis: 'bg-violet-400',
};

// ── Component ────────────────────────────────────────────────────────────────

export default function Dashboard() {
  const { employees, isLoading: appLoading } = useApp();

  const [selectedOrg, setSelectedOrg] = useState<Workspace>('biotech');
  const [todaySnap, setTodaySnap] = useState<CompanySnapshot | null>(null);
  const [weekSnap, setWeekSnap] = useState<CompanySnapshot | null>(null);
  const [recentDays, setRecentDays] = useState<CompanySnapshot[]>([]);
  const [objectives, setObjectives] = useState<InferredObjective[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedObjective, setExpandedObjective] = useState<Set<string>>(new Set());
  const [selectedPeriod, setSelectedPeriod] = useState<'day' | 'week'>('day');
  const [reportView, setReportView] = useState<'pm' | 'employee'>('pm');
  const [fetchError, setFetchError] = useState<string | null>(null);

  // Sync with sidebar org selector
  useEffect(() => {
    const saved = localStorage.getItem('ea_selected_org') as Workspace | null;
    if (saved) setSelectedOrg(saved);

    const handler = (e: Event) => {
      const org = (e as CustomEvent).detail as Workspace;
      setSelectedOrg(org);
    };
    window.addEventListener('org-changed', handler);
    return () => window.removeEventListener('org-changed', handler);
  }, []);

  const fetchCompanyData = useCallback(async (org: Workspace) => {
    setLoading(true);
    setFetchError(null);
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 15000);
      const res = await fetch(`/api/company?org=${org}`, { signal: controller.signal });
      clearTimeout(timeout);
      const data = await res.json();

      const todayStr = format(new Date(), 'yyyy-MM-dd');
      const days = (data.daySnapshots || []) as CompanySnapshot[];

      setRecentDays(days);
      setTodaySnap(days.find(d => d.period_start === todayStr) || days[0] || null);
      setWeekSnap(data.weekSnapshot as CompanySnapshot | null);
      setObjectives(data.objectives || []);
    } catch (err) {
      const msg = err instanceof DOMException && err.name === 'AbortError'
        ? 'Request timed out — Supabase may be paused or unreachable'
        : 'Failed to connect to database';
      setFetchError(msg);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchCompanyData(selectedOrg);
  }, [fetchCompanyData, selectedOrg]);

  // Build objective tree
  const rootObjectives = objectives.filter(o => !o.parent_id);
  const childMap = new Map<string, InferredObjective[]>();
  for (const obj of objectives) {
    if (obj.parent_id) {
      const children = childMap.get(obj.parent_id) || [];
      children.push(obj);
      childMap.set(obj.parent_id, children);
    }
  }

  const toggleExpand = (id: string) => {
    setExpandedObjective(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const currentSnap = selectedPeriod === 'day' ? todaySnap : weekSnap;
  const isLoading = appLoading || loading;

  const noData = !isLoading && !todaySnap && !weekSnap && objectives.length === 0;

  return (
    <div className="max-w-7xl mx-auto py-8 px-6 space-y-8 animate-fadeIn">
      {/* Header */}
      <header className="flex justify-between items-end">
        <div>
          <h1 className="text-3xl font-bold tracking-tight flex items-center gap-3">
            <Building2 className="text-accent" size={28} />
            {WORKSPACE_LABELS[selectedOrg]} Pulse
          </h1>
          <p className="text-secondary text-sm mt-1">{format(new Date(), 'EEEE, MMMM d, yyyy')}</p>
        </div>
        <div className="flex items-center gap-3">
          {isLoading && <Loader2 className="animate-spin text-accent" size={14} />}
          <button
            onClick={() => fetchCompanyData(selectedOrg)}
            className="text-xs font-bold text-secondary hover:text-accent flex items-center gap-1 transition-colors"
          >
            <RefreshCw size={12} /> Refresh
          </button>
        </div>
      </header>

      {/* Connection Error Banner */}
      {fetchError && (
        <div className="card !border-red-500/30 bg-red-500/5 flex items-center gap-3 !py-3">
          <AlertTriangle className="text-red-400 shrink-0" size={18} />
          <div className="flex-1">
            <p className="text-sm font-bold text-red-400">{fetchError}</p>
            <p className="text-xs text-secondary mt-0.5">
              Check your Cloudflare D1 database status. Go to{' '}
              <a href="https://dash.cloudflare.com" target="_blank" rel="noopener noreferrer" className="text-accent underline">Cloudflare Dashboard</a>
              {' '}and verify your D1 database is accessible.
            </p>
          </div>
          <button onClick={() => fetchCompanyData(selectedOrg)} className="text-xs font-bold text-accent hover:underline shrink-0">
            Retry
          </button>
        </div>
      )}

      {noData && !fetchError && (
        <div className="card text-center py-16 space-y-4">
          <Sparkles className="mx-auto text-accent/50" size={40} />
          <h2 className="text-lg font-bold">No Company Snapshots Yet</h2>
          <p className="text-secondary text-sm max-w-md mx-auto">
            The company synthesis pipeline distills all team communications into daily narratives, weekly rollups, and a hierarchy of inferred objectives.
          </p>
          <div className="text-xs text-secondary space-y-1">
            <p>1. Go to Settings and click <strong>&quot;Backfill Days&quot;</strong> to synthesize historical days</p>
            <p>2. Then click <strong>&quot;Extract Objectives&quot;</strong> to build the objective hierarchy</p>
            <p>3. Use <strong>&quot;Synthesize Today&quot;</strong> for the latest snapshot</p>
          </div>
          <Link href="/settings" className="inline-block mt-4 text-sm font-bold text-accent hover:underline">
            Go to Settings <ArrowRight className="inline" size={14} />
          </Link>
        </div>
      )}

      {!noData && (
        <>
          {/* Stats Row */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            {[
              {
                label: 'Messages Today',
                value: todaySnap?.message_count ?? '—',
                icon: Calendar,
                color: 'text-accent',
              },
              {
                label: 'Active Employees',
                value: todaySnap?.active_employee_count ?? employees.length,
                icon: Users,
                color: 'text-accent',
              },
              {
                label: 'Inferred Objectives',
                value: objectives.filter(o => o.status === 'active' || o.status === 'progressing').length,
                icon: Target,
                color: 'text-accent',
              },
              {
                label: 'Key Themes',
                value: todaySnap?.key_themes?.length ?? 0,
                icon: TrendingUp,
                color: 'text-accent',
              },
            ].map((stat, i) => (
              <div key={i} className="card">
                <div className="flex justify-between items-start mb-4">
                  <span className="text-xs font-bold text-secondary uppercase tracking-wider">{stat.label}</span>
                  <stat.icon className={`${stat.color} opacity-60`} size={18} />
                </div>
                <p className="text-3xl font-bold">{stat.value}</p>
              </div>
            ))}
          </div>

          {/* Period + View Selectors + Narrative */}
          <section className="space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                {(['day', 'week'] as const).map(p => (
                  <button
                    key={p}
                    onClick={() => setSelectedPeriod(p)}
                    className={`px-4 py-1.5 rounded-lg text-xs font-bold transition-colors ${
                      selectedPeriod === p
                        ? 'bg-accent/20 text-accent'
                        : 'bg-glass text-secondary hover:text-primary'
                    }`}
                  >
                    {p === 'day' ? 'Daily View' : 'Weekly Rollup'}
                  </button>
                ))}
              </div>

              {/* PM / Employee View Toggle */}
              <div className="flex items-center gap-1 bg-glass rounded-lg p-0.5">
                <button
                  onClick={() => setReportView('pm')}
                  className={`px-3 py-1 rounded-md text-[10px] font-bold flex items-center gap-1 transition-colors ${
                    reportView === 'pm'
                      ? 'bg-accent/20 text-accent'
                      : 'text-secondary hover:text-primary'
                  }`}
                >
                  <Eye size={10} /> PM View
                </button>
                <button
                  onClick={() => setReportView('employee')}
                  className={`px-3 py-1 rounded-md text-[10px] font-bold flex items-center gap-1 transition-colors ${
                    reportView === 'employee'
                      ? 'bg-emerald-500/20 text-emerald-400'
                      : 'text-secondary hover:text-primary'
                  }`}
                >
                  <Heart size={10} /> Team View
                </button>
              </div>
            </div>

            {currentSnap ? (
              <div className="card space-y-4">
                <div className="flex items-center justify-between">
                  <h2 className="text-lg font-bold flex items-center gap-2">
                    <Sparkles className="text-accent" size={18} />
                    {selectedPeriod === 'day'
                      ? `${format(parseISO(currentSnap.period_start), 'EEEE, MMM d')} — ${reportView === 'pm' ? 'PM Intelligence' : 'Team Summary'}`
                      : `Week of ${format(parseISO(currentSnap.period_start), 'MMM d')} – ${format(parseISO(currentSnap.period_end), 'MMM d')}`}
                  </h2>
                  <span className="text-[10px] text-secondary">
                    {currentSnap.message_count} msgs · {currentSnap.active_employee_count} people
                  </span>
                </div>

                {/* Narrative — switches based on PM/Employee view */}
                <p className="text-sm leading-relaxed text-primary/90">
                  {reportView === 'employee' && currentSnap.employee_narrative
                    ? currentSnap.employee_narrative
                    : currentSnap.narrative}
                </p>

                {/* Key Themes */}
                {currentSnap.key_themes?.length > 0 && (
                  <div className="flex flex-wrap gap-2">
                    {currentSnap.key_themes.map((theme, i) => (
                      <span key={i} className="text-[10px] font-bold bg-accent/10 text-accent px-2 py-0.5 rounded">
                        {theme}
                      </span>
                    ))}
                  </div>
                )}

                {/* Performance Scores — employee view */}
                {reportView === 'employee' && currentSnap.performance_scores && currentSnap.performance_scores.length > 0 && (
                  <div className="space-y-2 mt-2">
                    <h3 className="text-xs font-bold text-emerald-400 uppercase tracking-wider flex items-center gap-1">
                      <Star size={12} /> Contributions
                    </h3>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                      {currentSnap.performance_scores.map((ps, i) => (
                        <div key={i} className="text-xs p-2 bg-emerald-500/5 border border-emerald-500/20 rounded-lg flex items-start gap-2">
                          <span className="text-lg font-bold text-emerald-400 shrink-0">{ps.performance_score}</span>
                          <div>
                            <span className="font-bold">{ps.employee_name}</span>
                            <p className="text-secondary/70 mt-0.5">{ps.contribution_summary}</p>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Objectives detected in this snapshot */}
                {currentSnap.objectives_snapshot?.length > 0 && (
                  <div className="space-y-2 mt-2">
                    <h3 className="text-xs font-bold text-accent uppercase tracking-wider flex items-center gap-1">
                      <Target size={12} /> Objectives Detected
                    </h3>
                    {currentSnap.objectives_snapshot.map((obj, i) => (
                      <div key={i} className="text-xs p-2 bg-accent/5 border border-accent/20 rounded-lg">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="font-bold">{obj.title}</span>
                          {obj.level && (
                            <span className={`text-[9px] px-1 py-px rounded border ${levelColors[obj.level] || 'bg-gray-500/10 text-gray-400 border-gray-500/30'}`}>
                              {obj.level}
                            </span>
                          )}
                          {obj.objective_status && (
                            <span className={`text-[9px] px-1 py-px rounded border ${
                              obj.objective_status === 'Hypothesis'
                                ? 'bg-violet-500/10 text-violet-400 border-violet-500/30'
                                : obj.objective_status === 'Completed'
                                  ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30'
                                  : 'bg-green-500/10 text-green-400 border-green-500/30'
                            }`}>
                              {obj.objective_status}
                            </span>
                          )}
                          {(obj.status_signal || obj.status) && (
                            <span className={`text-[9px] ${statusColors[obj.status_signal || obj.status || 'active']}`}>
                              {obj.status_signal || obj.status}
                            </span>
                          )}
                          {obj.workspace_tag && (
                            <span className="text-[9px] text-secondary/50 italic">{obj.workspace_tag}</span>
                          )}
                        </div>
                        {obj.evidence && <p className="text-secondary/70">{obj.evidence}</p>}
                      </div>
                    ))}
                  </div>
                )}

                {/* Hypotheses Detected */}
                {currentSnap.hypotheses_detected && currentSnap.hypotheses_detected.length > 0 && (
                  <div className="space-y-2 mt-2">
                    <h3 className="text-xs font-bold text-violet-400 uppercase tracking-wider flex items-center gap-1">
                      <FlaskConical size={12} /> Hypotheses (Research/Ideation)
                    </h3>
                    {currentSnap.hypotheses_detected.map((h, i) => (
                      <div key={i} className="text-xs p-2 bg-violet-500/5 border border-violet-500/20 rounded-lg">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="font-bold">{h.title}</span>
                          <span className="text-[9px] px-1 py-px rounded border bg-violet-500/10 text-violet-400 border-violet-500/30">
                            {h.stage}
                          </span>
                          {h.workspace_tag && (
                            <span className="text-[9px] text-secondary/50 italic">{h.workspace_tag}</span>
                          )}
                        </div>
                        <p className="text-secondary/70">{h.description}</p>
                        {h.evidence && <p className="text-secondary/50 mt-1 italic">{h.evidence}</p>}
                      </div>
                    ))}
                  </div>
                )}

                {/* Proposed Objectives — PM view only */}
                {reportView === 'pm' && currentSnap.proposed_objectives && currentSnap.proposed_objectives.length > 0 && (
                  <div className="space-y-2 mt-2">
                    <h3 className="text-xs font-bold text-amber-400 uppercase tracking-wider flex items-center gap-1">
                      <Lightbulb size={12} /> Proposed Objectives
                    </h3>
                    {currentSnap.proposed_objectives.map((po, i) => (
                      <div key={i} className="text-xs p-2 bg-amber-500/5 border border-amber-500/20 rounded-lg">
                        <div className="flex items-center gap-2 mb-1">
                          <PlusCircle size={10} className="text-amber-400 shrink-0" />
                          <span className="font-bold">{po.title}</span>
                          <span className={`text-[9px] px-1 py-px rounded border ${
                            po.priority === 'high' ? 'bg-red-500/10 text-red-400 border-red-500/30'
                              : po.priority === 'medium' ? 'bg-amber-500/10 text-amber-400 border-amber-500/30'
                                : 'bg-gray-500/10 text-gray-400 border-gray-500/30'
                          }`}>{po.priority}</span>
                        </div>
                        <p className="text-secondary/70">{po.reason}</p>
                        <span className="text-[10px] text-secondary/50 mt-1 block">Triggered by: {po.triggered_by}</span>
                      </div>
                    ))}
                  </div>
                )}

                {/* Blockers & Highlights side by side */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-2">
                  {currentSnap.blockers?.length > 0 && (
                    <div className="space-y-2">
                      <h3 className="text-xs font-bold text-red-400 uppercase tracking-wider flex items-center gap-1">
                        <AlertTriangle size={12} /> Blockers Identified
                      </h3>
                      {currentSnap.blockers.map((b, i) => (
                        <div key={i} className="text-xs p-2 bg-red-500/5 border border-red-500/20 rounded-lg">
                          <p>{typeof b === 'string' ? b : b.description}</p>
                          {typeof b !== 'string' && b.affected_area && (
                            <span className="text-[10px] text-red-300/60 mt-1 block">Area: {b.affected_area}</span>
                          )}
                        </div>
                      ))}
                    </div>
                  )}

                  {currentSnap.highlights?.length > 0 && (
                    <div className="space-y-2">
                      <h3 className="text-xs font-bold text-green-400 uppercase tracking-wider flex items-center gap-1">
                        <Sparkles size={12} /> Highlights
                      </h3>
                      {currentSnap.highlights.map((h, i) => (
                        <div key={i} className="text-xs p-2 bg-green-500/5 border border-green-500/20 rounded-lg">
                          <p>{typeof h === 'string' ? h : h.description}</p>
                          {typeof h !== 'string' && h.employee_name && (
                            <span className="text-[10px] text-green-300/60 mt-1 block">By: {h.employee_name}</span>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <div className="card text-center py-8 text-secondary text-xs italic">
                No {selectedPeriod} snapshot available yet. Run synthesis from Settings.
              </div>
            )}
          </section>

          {/* Two-column layout */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
            {/* Inferred Objectives Tree */}
            <section className="space-y-4">
              <div className="flex justify-between items-center">
                <h2 className="text-lg font-bold flex items-center gap-2">
                  <Target className="text-accent" size={18} />
                  Inferred Objectives
                </h2>
                <span className="text-[10px] text-secondary">
                  {objectives.filter(o => o.status === 'active' || o.status === 'progressing').length} active
                </span>
              </div>

              {rootObjectives.length === 0 ? (
                <div className="card text-center py-8 text-secondary text-xs italic">
                  No objectives extracted yet. Run &quot;Extract Objectives&quot; from Settings after backfilling some days.
                </div>
              ) : (
                <div className="space-y-2">
                  {rootObjectives.map(obj => {
                    const children = childMap.get(obj.id) || [];
                    const isExpanded = expandedObjective.has(obj.id);
                    return (
                      <div key={obj.id} className="card !p-3">
                        <div
                          className="flex items-start gap-2 cursor-pointer"
                          onClick={() => children.length > 0 && toggleExpand(obj.id)}
                        >
                          {children.length > 0 ? (
                            isExpanded ? <ChevronDown size={14} className="mt-0.5 text-secondary shrink-0" /> : <ChevronRight size={14} className="mt-0.5 text-secondary shrink-0" />
                          ) : (
                            <div className="w-3.5 shrink-0" />
                          )}
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 mb-1">
                              <span className={`w-2 h-2 rounded-full shrink-0 ${statusDots[obj.status] || 'bg-gray-400'}`} />
                              <span className="text-sm font-bold truncate">{obj.title}</span>
                            </div>
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded border ${levelColors[obj.level]}`}>
                                {obj.level}
                              </span>
                              <span className={`text-[10px] font-bold ${statusColors[obj.status] || 'text-gray-400'}`}>
                                {obj.status}
                              </span>
                              <span className="text-[10px] text-secondary">
                                {Math.round(obj.confidence_score * 100)}% confidence
                              </span>
                            </div>
                            {obj.description && (
                              <p className="text-[10px] text-secondary/70 mt-1 line-clamp-2">{obj.description}</p>
                            )}
                          </div>
                        </div>

                        {isExpanded && children.length > 0 && (
                          <div className="ml-6 mt-2 space-y-2 border-l border-border pl-3">
                            {children.map(child => {
                              const grandchildren = childMap.get(child.id) || [];
                              const childExpanded = expandedObjective.has(child.id);
                              return (
                                <div key={child.id}>
                                  <div
                                    className="flex items-start gap-2 cursor-pointer"
                                    onClick={() => grandchildren.length > 0 && toggleExpand(child.id)}
                                  >
                                    {grandchildren.length > 0 ? (
                                      childExpanded ? <ChevronDown size={12} className="mt-0.5 text-secondary shrink-0" /> : <ChevronRight size={12} className="mt-0.5 text-secondary shrink-0" />
                                    ) : (
                                      <div className="w-3 shrink-0" />
                                    )}
                                    <div className="flex-1 min-w-0">
                                      <div className="flex items-center gap-2">
                                        <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${statusDots[child.status] || 'bg-gray-400'}`} />
                                        <span className="text-xs font-bold truncate">{child.title}</span>
                                      </div>
                                      <div className="flex items-center gap-2 mt-0.5">
                                        <span className={`text-[9px] font-bold px-1 py-px rounded border ${levelColors[child.level]}`}>
                                          {child.level}
                                        </span>
                                        <span className={`text-[9px] ${statusColors[child.status]}`}>{child.status}</span>
                                      </div>
                                    </div>
                                  </div>

                                  {childExpanded && grandchildren.length > 0 && (
                                    <div className="ml-5 mt-1 space-y-1 border-l border-border/50 pl-2">
                                      {grandchildren.map(gc => (
                                        <div key={gc.id} className="flex items-center gap-2">
                                          <span className={`w-1 h-1 rounded-full shrink-0 ${statusDots[gc.status] || 'bg-gray-400'}`} />
                                          <span className="text-[10px] truncate">{gc.title}</span>
                                          <span className={`text-[9px] ${statusColors[gc.status]}`}>{gc.status}</span>
                                        </div>
                                      ))}
                                    </div>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </section>

            {/* Recent Day Snapshots Timeline */}
            <section className="space-y-4">
              <h2 className="text-lg font-bold flex items-center gap-2">
                <Clock className="text-accent" size={18} />
                Recent Activity
              </h2>

              {recentDays.length === 0 ? (
                <div className="card text-center py-8 text-secondary text-xs italic">
                  No day snapshots yet. Run &quot;Backfill Days&quot; from Settings.
                </div>
              ) : (
                <div className="space-y-3">
                  {recentDays.map((day, idx) => (
                    <div key={idx} className="card !p-4">
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-xs font-bold">
                          {format(parseISO(day.period_start), 'EEE, MMM d')}
                        </span>
                        <div className="flex items-center gap-2 text-[10px] text-secondary">
                          <span>{day.message_count} msgs</span>
                          <span>·</span>
                          <span>{day.active_employee_count} people</span>
                        </div>
                      </div>
                      <p className="text-xs text-secondary/80 line-clamp-3 leading-relaxed">
                        {day.narrative}
                      </p>
                      {day.key_themes?.length > 0 && (
                        <div className="flex flex-wrap gap-1 mt-2">
                          {day.key_themes.slice(0, 4).map((t, i) => (
                            <span key={i} className="text-[9px] bg-glass text-secondary px-1.5 py-0.5 rounded">
                              {t}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </section>
          </div>
        </>
      )}
    </div>
  );
}
