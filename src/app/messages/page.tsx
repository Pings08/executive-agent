'use client';

import { useEffect, useState, useCallback } from 'react';
import { createClient } from '@/lib/supabase/client';
import { fetchRecentMessages, fetchAnalyses, fetchDigests } from '@/lib/dal';
import type { RavenMessage, MessageAnalysis, DailyDigest, ObjectiveProgressEntry } from '@/types';
import { useApp } from '@/store/AppContext';
import {
  MessageSquare, Filter, AlertTriangle, TrendingUp,
  ChevronDown, ChevronUp, Loader2, RefreshCw,
  FileText, Target, CheckCircle2,
} from 'lucide-react';
import { format, parseISO } from 'date-fns';

const categoryColors: Record<string, string> = {
  progress_update: 'bg-green-500/10 text-green-400',
  blocker: 'bg-red-500/10 text-red-400',
  question: 'bg-blue-500/10 text-blue-400',
  discussion: 'bg-purple-500/10 text-purple-400',
  decision: 'bg-teal-500/10 text-teal-400',
  general: 'bg-gray-500/10 text-gray-400',
};

const sentimentColors: Record<string, string> = {
  positive: 'text-green-400',
  excited: 'text-green-400',
  neutral: 'text-gray-400',
  negative: 'text-red-400',
  frustrated: 'text-orange-400',
  stressed: 'text-yellow-400',
};

export default function MessagesPage() {
  const { employees } = useApp();
  const [messages, setMessages] = useState<RavenMessage[]>([]);
  const [analyses, setAnalyses] = useState<MessageAnalysis[]>([]);
  const [digests, setDigests] = useState<DailyDigest[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'feed' | 'notes'>('feed');
  const [filterEmployee, setFilterEmployee] = useState('');
  const [filterCategory, setFilterCategory] = useState('');
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [supabase] = useState(() => createClient());

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      // Fetch analyzed messages first (processed=true), then unprocessed, and daily digests
      const [analyzedMsgs, unprocessedMsgs, anl, dailyDigests] = await Promise.all([
        supabase
          .from('raven_messages')
          .select('*, employees(name)')
          .eq('processed', true)
          .order('created_at', { ascending: false })
          .limit(100)
          .then(({ data }) => (data || []).map((msg: Record<string, unknown> & { employees?: { name: string } | null }) => ({
            id: String(msg.id),
            ravenMessageId: String(msg.raven_message_id),
            channelId: msg.channel_id ? String(msg.channel_id) : undefined,
            channelName: msg.channel_name ? String(msg.channel_name) : undefined,
            sender: String(msg.sender),
            content: String(msg.content),
            messageType: String(msg.message_type),
            employeeId: msg.employee_id ? String(msg.employee_id) : undefined,
            employeeName: (msg.employees as { name: string } | null)?.name ?? undefined,
            createdAt: String(msg.created_at),
            processed: Boolean(msg.processed),
          }))),
        supabase
          .from('raven_messages')
          .select('*, employees(name)')
          .eq('processed', false)
          .order('created_at', { ascending: false })
          .limit(20)
          .then(({ data }) => (data || []).map((msg: Record<string, unknown> & { employees?: { name: string } | null }) => ({
            id: String(msg.id),
            ravenMessageId: String(msg.raven_message_id),
            channelId: msg.channel_id ? String(msg.channel_id) : undefined,
            channelName: msg.channel_name ? String(msg.channel_name) : undefined,
            sender: String(msg.sender),
            content: String(msg.content),
            messageType: String(msg.message_type),
            employeeId: msg.employee_id ? String(msg.employee_id) : undefined,
            employeeName: (msg.employees as { name: string } | null)?.name ?? undefined,
            createdAt: String(msg.created_at),
            processed: Boolean(msg.processed),
          }))),
        fetchAnalyses(supabase, {
          employeeId: filterEmployee || undefined,
          limit: 200,
        }),
        fetchDigests(supabase, { limit: 60 }),
      ]);
      // Analyzed messages first, then recent unprocessed
      setMessages([...analyzedMsgs, ...unprocessedMsgs]);
      setAnalyses(anl);
      setDigests(dailyDigests);
    } catch (err) {
      console.error('Failed to load messages:', err);
    } finally {
      setLoading(false);
    }
  }, [supabase, filterEmployee]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Realtime subscription for new messages
  useEffect(() => {
    const channel = supabase
      .channel('messages-feed')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'raven_messages' }, (payload) => {
        const m = payload.new;
        const newMsg: RavenMessage = {
          id: m.id,
          ravenMessageId: m.raven_message_id,
          channelId: m.channel_id,
          channelName: m.channel_name,
          sender: m.sender,
          content: m.content,
          messageType: m.message_type,
          employeeId: m.employee_id,
          createdAt: m.created_at,
          processed: m.processed,
        };
        setMessages(prev => [newMsg, ...prev].slice(0, 100));
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [supabase]);

  const toggleExpand = (id: string) => {
    setExpandedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  // Build analysis lookup by raven_message DB id
  const analysisMap = new Map<string, MessageAnalysis>();
  for (const a of analyses) {
    analysisMap.set(a.ravenMessageId, a);
  }

  // Filter messages
  let filteredMessages = messages;
  if (filterEmployee) {
    filteredMessages = filteredMessages.filter(m => m.employeeId === filterEmployee);
  }
  if (filterCategory) {
    filteredMessages = filteredMessages.filter(m => {
      const analysis = analysisMap.get(m.id);
      return analysis?.category === filterCategory;
    });
  }

  // Stats
  const blockerCount = analyses.filter(a => a.blockerDetected).length;
  const analyzedCount = analyses.length;
  const avgProductivity = analyses.length > 0
    ? (analyses.reduce((sum, a) => sum + (a.productivityScore || 3), 0) / analyses.length).toFixed(1)
    : '—';

  // Group digests by employee for the notes view
  const digestsByEmployee = digests.reduce<Record<string, DailyDigest[]>>((acc, d) => {
    const key = d.employeeId;
    if (!acc[key]) acc[key] = [];
    acc[key].push(d);
    return acc;
  }, {});

  return (
    <div className="max-w-7xl mx-auto py-8 px-6 space-y-6 animate-fadeIn">
      <header className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Messages</h1>
          <p className="text-secondary text-sm mt-1">Live feed from Raven with AI analysis</p>
        </div>
        <button
          onClick={loadData}
          className="flex items-center gap-2 text-xs font-bold text-accent hover:underline"
        >
          <RefreshCw size={14} /> Refresh
        </button>
      </header>

      {/* Tab switcher */}
      <div className="flex gap-1 border-b border-border">
        <button
          onClick={() => setActiveTab('feed')}
          className={`flex items-center gap-2 px-4 py-2 text-sm font-medium border-b-2 transition-colors ${activeTab === 'feed' ? 'border-accent text-accent' : 'border-transparent text-secondary hover:text-text'}`}
        >
          <MessageSquare size={14} /> Message Feed
        </button>
        <button
          onClick={() => setActiveTab('notes')}
          className={`flex items-center gap-2 px-4 py-2 text-sm font-medium border-b-2 transition-colors ${activeTab === 'notes' ? 'border-accent text-accent' : 'border-transparent text-secondary hover:text-text'}`}
        >
          <FileText size={14} /> Daily Notes
          {digests.filter(d => d.dailyNote).length > 0 && (
            <span className="bg-accent/20 text-accent text-[10px] px-1.5 py-0.5 rounded font-bold">
              {digests.filter(d => d.dailyNote).length}
            </span>
          )}
        </button>
      </div>

      {/* ==================== DAILY NOTES TAB ==================== */}
      {activeTab === 'notes' && (
        <div className="space-y-6">
          {loading ? (
            <div className="flex justify-center py-16">
              <Loader2 className="animate-spin text-accent" size={24} />
            </div>
          ) : Object.keys(digestsByEmployee).length === 0 ? (
            <div className="card text-center py-16 text-secondary text-xs italic">
              No daily notes yet. Run the AI agent (<code className="bg-glass px-1 rounded">POST /api/ai/agent</code>) to generate them.
            </div>
          ) : (
            Object.entries(digestsByEmployee).map(([empId, empDigests]) => {
              const emp = employees.find(e => e.id === empId);
              const latestDigest = empDigests[0];
              return (
                <div key={empId} className="card space-y-4">
                  {/* Employee header */}
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="w-9 h-9 rounded-full bg-accent/20 flex items-center justify-center text-sm font-bold text-accent">
                        {(emp?.name || 'U').charAt(0).toUpperCase()}
                      </div>
                      <div>
                        <p className="font-semibold">{emp?.name || 'Unknown'}</p>
                        <p className="text-xs text-secondary">{emp?.role}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-3 text-xs text-secondary">
                      {latestDigest.overallRating && (
                        <span className={`font-bold text-sm ${latestDigest.overallRating >= 7 ? 'text-green-400' : latestDigest.overallRating >= 5 ? 'text-yellow-400' : 'text-red-400'}`}>
                          {latestDigest.overallRating}/10
                        </span>
                      )}
                      <span>{format(parseISO(latestDigest.digestDate), 'MMM d, yyyy')}</span>
                    </div>
                  </div>

                  {/* Digest selector for this employee */}
                  {empDigests.length > 1 && (
                    <div className="flex gap-2 flex-wrap">
                      {empDigests.map((d) => (
                        <button
                          key={d.id}
                          className="text-[10px] px-2 py-1 rounded bg-background border border-border hover:border-accent"
                        >
                          {format(parseISO(d.digestDate), 'MMM d')}
                        </button>
                      ))}
                    </div>
                  )}

                  {/* Daily Note */}
                  {latestDigest.dailyNote ? (
                    <div className="space-y-3">
                      <h3 className="text-sm font-semibold flex items-center gap-2 text-accent">
                        <FileText size={14} /> Daily Work Note
                      </h3>
                      <div className="bg-background rounded-lg p-4 text-sm leading-relaxed whitespace-pre-wrap text-text-secondary">
                        {latestDigest.dailyNote}
                      </div>
                    </div>
                  ) : (
                    <p className="text-xs text-secondary italic">No daily note generated yet for this date.</p>
                  )}

                  {/* Objective Progress Breakdown */}
                  {latestDigest.objectiveProgress && latestDigest.objectiveProgress.length > 0 && (
                    <div className="space-y-2">
                      <h3 className="text-sm font-semibold flex items-center gap-2 text-accent">
                        <Target size={14} /> Objective Progress Today
                      </h3>
                      <div className="space-y-2">
                        {latestDigest.objectiveProgress.map((op: ObjectiveProgressEntry, i: number) => (
                          <div key={i} className="flex items-start gap-3 p-3 bg-background rounded-lg border border-border/50">
                            <CheckCircle2 size={14} className={`mt-0.5 shrink-0 ${op.estimatedProgressPct > 0 ? 'text-green-400' : 'text-secondary'}`} />
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 flex-wrap">
                                <span className="text-xs font-medium">{op.objectiveTitle || 'General work'}</span>
                                {op.taskTitle && (
                                  <span className="text-[10px] text-secondary">→ {op.taskTitle}</span>
                                )}
                                {op.estimatedProgressPct > 0 && (
                                  <span className="text-[10px] bg-green-500/10 text-green-400 px-1.5 py-0.5 rounded font-bold">
                                    +{op.estimatedProgressPct}%
                                  </span>
                                )}
                                {op.suggestedStatus === 'blocked' && (
                                  <span className="text-[10px] bg-red-500/10 text-red-400 px-1.5 py-0.5 rounded font-bold">BLOCKED</span>
                                )}
                              </div>
                              <p className="text-[11px] text-secondary mt-1">{op.evidenceSummary}</p>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* CEO Summary */}
                  {latestDigest.summary && (
                    <details className="group">
                      <summary className="text-xs font-semibold text-secondary cursor-pointer hover:text-text flex items-center gap-1">
                        <ChevronDown size={12} className="group-open:rotate-180 transition-transform" /> CEO Verdict
                      </summary>
                      <p className="text-xs leading-relaxed mt-2 text-text-secondary bg-background rounded p-3 border-l-2 border-red-500/40">
                        {latestDigest.summary}
                      </p>
                    </details>
                  )}
                </div>
              );
            })
          )}
        </div>
      )}

      {/* ==================== MESSAGE FEED TAB ==================== */}
      {activeTab === 'feed' && (
      <>
      {/* Quick Stats */}
      <div className="grid grid-cols-3 gap-4">
        <div className="card">
          <span className="text-xs text-secondary font-bold uppercase">Analyzed</span>
          <p className="text-2xl font-bold mt-1">{analyzedCount} <span className="text-xs text-secondary font-normal">of {messages.length}</span></p>
        </div>
        <div className="card">
          <span className="text-xs text-secondary font-bold uppercase">Blockers</span>
          <p className="text-2xl font-bold mt-1 text-red-400">{blockerCount}</p>
        </div>
        <div className="card">
          <span className="text-xs text-secondary font-bold uppercase">Avg Productivity</span>
          <p className="text-2xl font-bold mt-1">{avgProductivity}/5</p>
        </div>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-4">
        <Filter size={16} className="text-secondary" />
        <select
          value={filterEmployee}
          onChange={e => setFilterEmployee(e.target.value)}
          className="bg-surface border border-border rounded px-3 py-1.5 text-xs"
        >
          <option value="">All Employees</option>
          {employees.map(emp => (
            <option key={emp.id} value={emp.id}>{emp.name}</option>
          ))}
        </select>
        <select
          value={filterCategory}
          onChange={e => setFilterCategory(e.target.value)}
          className="bg-surface border border-border rounded px-3 py-1.5 text-xs"
        >
          <option value="">All Categories</option>
          <option value="progress_update">Progress Update</option>
          <option value="blocker">Blocker</option>
          <option value="question">Question</option>
          <option value="discussion">Discussion</option>
          <option value="decision">Decision</option>
          <option value="general">General</option>
        </select>
      </div>

      {/* Message Feed */}
      {loading ? (
        <div className="flex justify-center py-16">
          <Loader2 className="animate-spin text-accent" size={24} />
        </div>
      ) : (
        <div className="space-y-3">
          {filteredMessages.map(msg => {
            const analysis = analysisMap.get(msg.id);
            const isExpanded = expandedIds.has(msg.id);
            const emp = employees.find(e => e.id === msg.employeeId);

            return (
              <div key={msg.id} className="card">
                {/* Message Header */}
                <div className="flex items-start justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <div className="w-7 h-7 rounded-full bg-accent/20 flex items-center justify-center text-[10px] font-bold text-accent">
                      {(emp?.name || msg.sender).charAt(0).toUpperCase()}
                    </div>
                    <div>
                      <span className="text-sm font-bold">{emp?.name || msg.sender}</span>
                      {msg.channelName && (
                        <span className="text-[10px] text-secondary ml-2">#{msg.channelName}</span>
                      )}
                    </div>
                  </div>
                  <span className="text-[10px] text-secondary">
                    {format(parseISO(msg.createdAt), 'MMM d, h:mm a')}
                  </span>
                </div>

                {/* Message Content */}
                <p className="text-sm leading-relaxed ml-9">{msg.content}</p>

                {/* Analysis Toggle */}
                {analysis && (
                  <div className="ml-9 mt-3">
                    <button
                      onClick={() => toggleExpand(msg.id)}
                      className="flex items-center gap-2 text-[10px] font-bold text-accent hover:underline"
                    >
                      <MessageSquare size={12} />
                      AI Analysis
                      {isExpanded ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                    </button>

                    {isExpanded && (
                      <div className="mt-2 p-3 bg-glass rounded-lg space-y-2">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className={`text-[10px] px-2 py-0.5 rounded font-bold ${categoryColors[analysis.category] || categoryColors.general}`}>
                            {analysis.category.replace(/_/g, ' ')}
                          </span>
                          <span className={`text-[10px] ${sentimentColors[analysis.sentiment] || 'text-gray-400'}`}>
                            {analysis.sentiment}
                          </span>
                          {analysis.productivityScore && (
                            <span className="text-[10px] text-secondary flex items-center gap-1">
                              <TrendingUp size={10} />
                              {analysis.productivityScore}/5
                            </span>
                          )}
                          {analysis.blockerDetected && (
                            <span className="text-[10px] text-red-400 font-bold flex items-center gap-1">
                              <AlertTriangle size={10} /> BLOCKER
                            </span>
                          )}
                        </div>
                        <p className="text-xs leading-relaxed">{analysis.summary}</p>
                        {analysis.blockerDescription && (
                          <p className="text-xs text-red-300/70">Blocker: {analysis.blockerDescription}</p>
                        )}
                        {analysis.relatedObjectiveTitle && (
                          <p className="text-[10px] text-secondary">
                            Related to: {analysis.relatedObjectiveTitle}
                          </p>
                        )}
                        {analysis.keyTopics && analysis.keyTopics.length > 0 && (
                          <div className="flex gap-1 flex-wrap">
                            {analysis.keyTopics.map((topic, i) => (
                              <span key={i} className="text-[9px] bg-accent/10 text-accent px-1.5 py-0.5 rounded">
                                {topic}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}

                {!analysis && !msg.processed && (
                  <p className="text-[10px] text-secondary/50 ml-9 mt-2 italic">⏳ Awaiting AI analysis (next poll in ~2 min)</p>
                )}
                {!analysis && msg.processed && (
                  <p className="text-[10px] text-secondary/50 ml-9 mt-2">Analysis pending...</p>
                )}
              </div>
            );
          })}
          {filteredMessages.length === 0 && (
            <div className="card text-center py-16 text-secondary text-xs italic">
              No messages found. Messages from Raven will appear here automatically.
            </div>
          )}
        </div>
      )}
      </>
      )}
    </div>
  );
}
