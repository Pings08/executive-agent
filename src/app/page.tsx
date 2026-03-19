'use client';

import { useApp } from '@/store/AppContext';
import {
  AlertTriangle, Bell, Activity, TrendingUp, Target,
  ArrowRight, CheckCircle, XCircle, Eye, Clock, Loader2,
} from 'lucide-react';
import Link from 'next/link';
import { format, parseISO } from 'date-fns';

const severityColors: Record<string, string> = {
  critical: 'bg-red-500/10 text-red-400 border-red-500/30',
  high: 'bg-orange-500/10 text-orange-400 border-orange-500/30',
  medium: 'bg-yellow-500/10 text-yellow-400 border-yellow-500/30',
  low: 'bg-blue-500/10 text-blue-400 border-blue-500/30',
};

const categoryColors: Record<string, string> = {
  progress_update: 'bg-green-500/10 text-green-400',
  blocker: 'bg-red-500/10 text-red-400',
  question: 'bg-blue-500/10 text-blue-400',
  discussion: 'bg-purple-500/10 text-purple-400',
  decision: 'bg-teal-500/10 text-teal-400',
  general: 'bg-gray-500/10 text-gray-400',
};

const sentimentIcons: Record<string, string> = {
  positive: 'text-green-400',
  excited: 'text-green-400',
  neutral: 'text-gray-400',
  negative: 'text-red-400',
  frustrated: 'text-orange-400',
  stressed: 'text-yellow-400',
};

export default function Dashboard() {
  const {
    objectives, employees, alerts, recentAnalyses,
    unreadAlertCount, isLoading, markAlertAsRead, resolveAlertById,
  } = useApp();

  const activeObjectives = objectives.filter(o => o.status === 'in_progress');
  const totalTasks = objectives.reduce((acc, obj) => acc + obj.subPoints.length, 0);
  const completedTasks = objectives.reduce(
    (acc, obj) => acc + obj.subPoints.filter(sp => sp.status === 'completed').length, 0
  );
  const progress = totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0;

  const unresolvedAlerts = alerts.filter(a => !a.isResolved);
  const criticalAlerts = unresolvedAlerts.filter(a => a.severity === 'critical' || a.severity === 'high');

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-screen">
        <Loader2 className="animate-spin text-accent" size={32} />
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto py-8 px-6 space-y-8 animate-fadeIn">
      {/* Alert Banner */}
      {criticalAlerts.length > 0 && (
        <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <AlertTriangle className="text-red-400" size={20} />
            <div>
              <p className="text-sm font-bold text-red-400">
                {criticalAlerts.length} critical alert{criticalAlerts.length > 1 ? 's' : ''} require attention
              </p>
              <p className="text-xs text-red-300/70 mt-0.5">{criticalAlerts[0].title}</p>
            </div>
          </div>
          <Link href="#alerts" className="text-xs font-bold text-red-400 hover:underline">
            View All
          </Link>
        </div>
      )}

      {/* Header */}
      <header className="flex justify-between items-end">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Command Center</h1>
          <p className="text-secondary text-sm mt-1">{format(new Date(), 'EEEE, MMMM d, yyyy')}</p>
        </div>
      </header>

      {/* Stats */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        {[
          { label: 'Active Alerts', value: unreadAlertCount, icon: Bell,
            color: unreadAlertCount > 0 ? 'text-red-400' : 'text-green-400' },
          { label: 'Team Members', value: employees.length, icon: Activity, color: 'text-accent' },
          { label: 'Active Objectives', value: activeObjectives.length, icon: Target, color: 'text-accent' },
          { label: 'Task Progress', value: `${progress}%`, icon: TrendingUp, color: 'text-accent' },
        ].map((stat, i) => (
          <div key={i} className="card">
            <div className="flex justify-between items-start mb-4">
              <span className="text-xs font-bold text-secondary uppercase tracking-wider">{stat.label}</span>
              <stat.icon className={`${stat.color} opacity-60`} size={18} />
            </div>
            <p className="text-3xl font-bold">{stat.value}</p>
            {stat.label === 'Task Progress' && (
              <div className="mt-3 progress-bar">
                <div className="progress-bar-fill" style={{ width: `${progress}%` }} />
              </div>
            )}
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        {/* Left Column */}
        <div className="space-y-8">
          {/* Recent Alerts */}
          <section id="alerts" className="space-y-4">
            <div className="flex justify-between items-center">
              <h2 className="text-lg font-bold">Recent Alerts</h2>
              <span className="text-xs text-secondary">{unresolvedAlerts.length} unresolved</span>
            </div>
            <div className="space-y-3">
              {unresolvedAlerts.slice(0, 5).map(alert => (
                <div key={alert.id} className={`rounded-lg border p-4 ${severityColors[alert.severity] || severityColors.medium}`}>
                  <div className="flex justify-between items-start mb-2">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-[10px] font-bold uppercase tracking-wider opacity-70">
                          {alert.severity}
                        </span>
                        <span className="text-[10px] opacity-50">
                          {alert.type.replace(/_/g, ' ')}
                        </span>
                      </div>
                      <p className="text-sm font-bold">{alert.title}</p>
                      <p className="text-xs opacity-70 mt-1 line-clamp-2">{alert.description}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 mt-3">
                    {!alert.isRead && (
                      <button
                        onClick={() => markAlertAsRead(alert.id)}
                        className="text-[10px] font-bold flex items-center gap-1 opacity-60 hover:opacity-100"
                      >
                        <Eye size={12} /> Mark Read
                      </button>
                    )}
                    <button
                      onClick={() => resolveAlertById(alert.id)}
                      className="text-[10px] font-bold flex items-center gap-1 opacity-60 hover:opacity-100"
                    >
                      <CheckCircle size={12} /> Resolve
                    </button>
                    <span className="text-[10px] opacity-40 ml-auto">
                      <Clock size={10} className="inline mr-1" />
                      {format(parseISO(alert.createdAt), 'MMM d, h:mm a')}
                    </span>
                  </div>
                </div>
              ))}
              {unresolvedAlerts.length === 0 && (
                <div className="card text-center py-8 text-secondary text-xs">
                  <CheckCircle className="mx-auto mb-2 text-green-400" size={24} />
                  No active alerts. All clear.
                </div>
              )}
            </div>
          </section>

          {/* Objectives Overview */}
          <section className="space-y-4">
            <div className="flex justify-between items-center">
              <h2 className="text-lg font-bold">Objectives</h2>
              <Link href="/objectives" className="text-xs font-bold text-accent hover:underline">
                View All <ArrowRight className="inline" size={12} />
              </Link>
            </div>
            <div className="space-y-3">
              {activeObjectives.slice(0, 4).map(obj => {
                const total = obj.subPoints.length;
                const done = obj.subPoints.filter(sp => sp.status === 'completed').length;
                const blocked = obj.subPoints.filter(sp => sp.status === 'blocked').length;
                const pct = total > 0 ? Math.round((done / total) * 100) : 0;
                return (
                  <div key={obj.id} className="card">
                    <div className="flex justify-between items-start mb-2">
                      <h3 className="text-sm font-bold">{obj.title}</h3>
                      {blocked > 0 && (
                        <span className="text-[10px] bg-red-500/10 text-red-400 px-2 py-0.5 rounded">
                          <XCircle size={10} className="inline mr-1" />{blocked} blocked
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-3">
                      <div className="flex-1 progress-bar">
                        <div className="progress-bar-fill" style={{ width: `${pct}%` }} />
                      </div>
                      <span className="text-xs text-secondary font-bold">{pct}%</span>
                    </div>
                    <p className="text-[10px] text-secondary mt-2">{done}/{total} tasks complete</p>
                  </div>
                );
              })}
              {activeObjectives.length === 0 && (
                <div className="card text-center py-8 text-secondary text-xs italic">
                  No active objectives.
                </div>
              )}
            </div>
          </section>
        </div>

        {/* Right Column */}
        <div className="space-y-8">
          {/* Team Pulse */}
          <section className="space-y-4">
            <h2 className="text-lg font-bold">Team Pulse</h2>
            <div className="space-y-3">
              {employees.slice(0, 6).map(emp => {
                const empAnalyses = recentAnalyses.filter(a => a.employeeId === emp.id);
                const latestSummary = empAnalyses[0]?.summary;
                const avgSentiment = empAnalyses.length > 0
                  ? empAnalyses[0].sentiment
                  : 'neutral';
                return (
                  <div key={emp.id} className="card flex items-start gap-3">
                    <div className="w-8 h-8 rounded-full bg-accent/20 flex items-center justify-center text-xs font-bold text-accent shrink-0">
                      {emp.name.charAt(0).toUpperCase()}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-bold truncate">{emp.name}</span>
                        <span className={`w-2 h-2 rounded-full ${sentimentIcons[avgSentiment]?.includes('green') ? 'bg-green-400' : sentimentIcons[avgSentiment]?.includes('red') ? 'bg-red-400' : 'bg-gray-400'}`} />
                      </div>
                      <p className="text-xs text-secondary truncate">{emp.role}</p>
                      {latestSummary && (
                        <p className="text-[10px] text-secondary/70 mt-1 line-clamp-2">{latestSummary}</p>
                      )}
                    </div>
                    <span className="text-[10px] text-secondary shrink-0">{empAnalyses.length} msgs</span>
                  </div>
                );
              })}
              {employees.length === 0 && (
                <div className="card text-center py-8 text-secondary text-xs italic">
                  No team members synced yet. Go to Settings to sync.
                </div>
              )}
            </div>
          </section>

          {/* Recent AI Insights */}
          <section className="space-y-4">
            <div className="flex justify-between items-center">
              <h2 className="text-lg font-bold">Recent Insights</h2>
              <Link href="/messages" className="text-xs font-bold text-accent hover:underline">
                All Messages <ArrowRight className="inline" size={12} />
              </Link>
            </div>
            <div className="space-y-3">
              {recentAnalyses.slice(0, 5).map(analysis => (
                <div key={analysis.id} className="card">
                  <div className="flex items-center gap-2 mb-2">
                    <span className={`text-[10px] px-2 py-0.5 rounded font-bold ${categoryColors[analysis.category] || categoryColors.general}`}>
                      {analysis.category.replace(/_/g, ' ')}
                    </span>
                    <span className={`text-[10px] ${sentimentIcons[analysis.sentiment] || 'text-gray-400'}`}>
                      {analysis.sentiment}
                    </span>
                    {analysis.blockerDetected && (
                      <span className="text-[10px] text-red-400 font-bold">BLOCKER</span>
                    )}
                  </div>
                  <p className="text-xs leading-relaxed">{analysis.summary}</p>
                  {analysis.employeeName && (
                    <p className="text-[10px] text-secondary mt-1">by {analysis.employeeName}</p>
                  )}
                </div>
              ))}
              {recentAnalyses.length === 0 && (
                <div className="card text-center py-8 text-secondary text-xs italic">
                  No AI insights yet. Messages will be analyzed automatically.
                </div>
              )}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
