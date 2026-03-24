'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  Target, ChevronDown, Loader2, RefreshCw, Sparkles,
  TrendingUp, AlertTriangle, CheckCircle2, Pause, XCircle,
} from 'lucide-react';
import { useSelectedOrg } from '@/components/Sidebar';

type InferredObjective = {
  id: string;
  title: string;
  description: string;
  level: 'strategic' | 'operational' | 'tactical';
  status: string;
  confidence: number;
  evidence_summary: string;
  first_seen_at?: string;
  last_seen_at?: string;
  children?: InferredObjective[];
};

const STATUS_CONFIG: Record<string, { icon: typeof TrendingUp; color: string; label: string }> = {
  active:      { icon: TrendingUp,    color: 'text-blue-400 bg-blue-500/10',    label: 'Active' },
  progressing: { icon: TrendingUp,    color: 'text-green-400 bg-green-500/10',  label: 'Progressing' },
  stalled:     { icon: Pause,         color: 'text-yellow-400 bg-yellow-500/10', label: 'Stalled' },
  completed:   { icon: CheckCircle2,  color: 'text-emerald-400 bg-emerald-500/10', label: 'Completed' },
  abandoned:   { icon: XCircle,       color: 'text-gray-500 bg-gray-500/10',    label: 'Abandoned' },
};

const LEVEL_BADGE: Record<string, string> = {
  strategic:   'bg-purple-500/15 text-purple-400 border-purple-500/30',
  operational: 'bg-cyan-500/15 text-cyan-400 border-cyan-500/30',
  tactical:    'bg-orange-500/15 text-orange-400 border-orange-500/30',
};

export default function ObjectivesPage() {
  const [selectedOrg] = useSelectedOrg();
  const [objectives, setObjectives] = useState<InferredObjective[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [showAbandoned, setShowAbandoned] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/company?org=${selectedOrg}`);
      const data = await res.json();
      setObjectives(data.objectives || []);
      // Auto-expand strategic objectives
      const strategic = (data.objectives || [])
        .filter((o: InferredObjective) => o.level === 'strategic' && o.status !== 'abandoned')
        .map((o: InferredObjective) => o.id);
      setExpanded(new Set(strategic));
    } catch {
      setObjectives([]);
    } finally {
      setLoading(false);
    }
  }, [selectedOrg]);

  useEffect(() => { load(); }, [load]);

  // Re-fetch when org changes via sidebar
  useEffect(() => {
    const handler = () => load();
    window.addEventListener('org-changed', handler);
    return () => window.removeEventListener('org-changed', handler);
  }, [load]);

  const toggle = (id: string) => {
    setExpanded(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  // Group: strategic at top, then operational, then tactical
  // Build parent-child tree (objectives with children array OR flat list with parent_id)
  const strategic = objectives.filter(o => o.level === 'strategic');
  const operational = objectives.filter(o => o.level === 'operational');
  const tactical = objectives.filter(o => o.level === 'tactical');

  const activeStrategic = strategic.filter(o => o.status !== 'abandoned');
  const abandonedStrategic = strategic.filter(o => o.status === 'abandoned');
  const activeOps = operational.filter(o => o.status !== 'abandoned');
  const abandonedOps = operational.filter(o => o.status === 'abandoned');
  const activeTactical = tactical.filter(o => o.status !== 'abandoned');
  const abandonedTactical = tactical.filter(o => o.status === 'abandoned');

  const totalAbandoned = abandonedStrategic.length + abandonedOps.length + abandonedTactical.length;

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="animate-spin text-accent" size={28} />
      </div>
    );
  }

  return (
    <div className="max-w-5xl mx-auto py-8 px-6 space-y-6 animate-fadeIn">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight flex items-center gap-3">
            <Target size={26} className="text-accent" /> Objectives
          </h1>
          <p className="text-secondary text-sm mt-1 flex items-center gap-1.5">
            <Sparkles size={13} className="text-accent" />
            {objectives.length} objectives inferred from company communications
          </p>
        </div>
        <button
          onClick={load}
          disabled={loading}
          className="flex items-center gap-2 text-xs font-bold text-accent hover:underline disabled:opacity-50"
        >
          <RefreshCw size={13} className={loading ? 'animate-spin' : ''} /> Refresh
        </button>
      </header>

      {objectives.length === 0 && (
        <div className="card text-center py-16">
          <AlertTriangle size={32} className="mx-auto text-secondary/40 mb-3" />
          <p className="text-sm text-secondary">No objectives inferred yet.</p>
          <p className="text-xs text-secondary mt-1">Run "Extract Objectives" from Settings to generate them.</p>
        </div>
      )}

      {/* Strategic */}
      {activeStrategic.length > 0 && (
        <Section title="Strategic" count={activeStrategic.length} level="strategic">
          {activeStrategic.map(obj => (
            <ObjectiveCard
              key={obj.id}
              obj={obj}
              isExpanded={expanded.has(obj.id)}
              onToggle={() => toggle(obj.id)}
            />
          ))}
        </Section>
      )}

      {/* Operational */}
      {activeOps.length > 0 && (
        <Section title="Operational" count={activeOps.length} level="operational">
          {activeOps.map(obj => (
            <ObjectiveCard
              key={obj.id}
              obj={obj}
              isExpanded={expanded.has(obj.id)}
              onToggle={() => toggle(obj.id)}
            />
          ))}
        </Section>
      )}

      {/* Tactical */}
      {activeTactical.length > 0 && (
        <Section title="Tactical" count={activeTactical.length} level="tactical">
          {activeTactical.map(obj => (
            <ObjectiveCard
              key={obj.id}
              obj={obj}
              isExpanded={expanded.has(obj.id)}
              onToggle={() => toggle(obj.id)}
            />
          ))}
        </Section>
      )}

      {/* Abandoned toggle */}
      {totalAbandoned > 0 && (
        <div>
          <button
            onClick={() => setShowAbandoned(!showAbandoned)}
            className="text-xs text-secondary hover:text-text flex items-center gap-1.5"
          >
            <ChevronDown size={14} className={`transition-transform ${showAbandoned ? '' : '-rotate-90'}`} />
            {totalAbandoned} abandoned objective{totalAbandoned !== 1 ? 's' : ''}
          </button>
          {showAbandoned && (
            <div className="mt-3 space-y-2 opacity-60">
              {[...abandonedStrategic, ...abandonedOps, ...abandonedTactical].map(obj => (
                <ObjectiveCard key={obj.id} obj={obj} isExpanded={false} onToggle={() => {}} compact />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function Section({ title, count, level, children }: {
  title: string; count: number; level: string; children: React.ReactNode;
}) {
  return (
    <section className="space-y-3">
      <div className="flex items-center gap-2">
        <span className={`text-[10px] font-bold px-2 py-0.5 rounded border ${LEVEL_BADGE[level] || ''}`}>
          {title}
        </span>
        <span className="text-xs text-secondary">{count}</span>
      </div>
      <div className="space-y-2">{children}</div>
    </section>
  );
}

function ObjectiveCard({ obj, isExpanded, onToggle, compact }: {
  obj: InferredObjective; isExpanded: boolean; onToggle: () => void; compact?: boolean;
}) {
  const statusCfg = STATUS_CONFIG[obj.status] || STATUS_CONFIG.active;
  const StatusIcon = statusCfg.icon;
  const confidence = Math.round((obj.confidence || 0.5) * 100);

  return (
    <div className={`rounded-lg border border-border/60 overflow-hidden ${compact ? '' : 'bg-surface/30'}`}>
      <button
        onClick={onToggle}
        className="w-full flex items-center gap-3 px-4 py-3 hover:bg-glass/40 transition-colors text-left"
      >
        {!compact && (
          <ChevronDown
            size={14}
            className={`text-secondary transition-transform shrink-0 ${isExpanded ? '' : '-rotate-90'}`}
          />
        )}
        <div className="flex-1 min-w-0">
          <span className="text-sm font-medium">{obj.title}</span>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${statusCfg.color}`}>
            <StatusIcon size={10} className="inline mr-0.5 -mt-px" />
            {statusCfg.label}
          </span>
          <span className="text-[10px] text-secondary">{confidence}%</span>
        </div>
      </button>

      {isExpanded && (
        <div className="px-4 pb-4 space-y-2 border-t border-border/30 pt-3">
          <p className="text-xs leading-relaxed text-secondary">{obj.description}</p>
          {obj.evidence_summary && (
            <div className="flex items-start gap-2 text-[11px] bg-accent/5 rounded-lg px-3 py-2">
              <Sparkles size={12} className="text-accent shrink-0 mt-0.5" />
              <p className="text-secondary leading-relaxed">{obj.evidence_summary}</p>
            </div>
          )}
          {obj.children && obj.children.length > 0 && (
            <div className="mt-2 ml-2 border-l-2 border-border/40 pl-3 space-y-2">
              {obj.children.map(child => {
                const childStatus = STATUS_CONFIG[child.status] || STATUS_CONFIG.active;
                const ChildIcon = childStatus.icon;
                return (
                  <div key={child.id} className="py-1.5">
                    <div className="flex items-center gap-2">
                      <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded border ${LEVEL_BADGE[child.level] || ''}`}>
                        {child.level}
                      </span>
                      <span className="text-xs font-medium flex-1">{child.title}</span>
                      <span className={`text-[10px] px-1.5 py-0.5 rounded ${childStatus.color}`}>
                        <ChildIcon size={9} className="inline mr-0.5 -mt-px" />
                        {childStatus.label}
                      </span>
                    </div>
                    {child.description && (
                      <p className="text-[11px] text-secondary mt-1">{child.description}</p>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
