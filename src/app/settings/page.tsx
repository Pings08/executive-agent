'use client';

import { useApp } from '@/store/AppContext';
import {
  Database, CheckCircle, XCircle, Clock,
  Server, Key, Globe, Activity, Users, Save, Eye, EyeOff, RefreshCw, Layers,
} from 'lucide-react';
import { format } from 'date-fns';
import { useState, useEffect } from 'react';
import { WORKSPACE_LABELS, WORKSPACE_COLORS, type Workspace } from '@/types';

type EmployeeKeyRow = {
  id: string;
  name: string;
  raven_user: string | null;
  email: string | null;
  raven_api_key: string | null;
  raven_api_secret: string | null;
  workspace: Workspace | null;
};

export default function SettingsPage() {
  const { employees, objectives, lastSyncedAt, isLoading } = useApp();

  const [keyRows, setKeyRows] = useState<EmployeeKeyRow[]>([]);
  const [editing, setEditing] = useState<Record<string, { key: string; secret: string }>>({});
  const [saving, setSaving] = useState<string | null>(null);
  const [saved, setSaved] = useState<Record<string, boolean>>({});
  const [showSecret, setShowSecret] = useState<Record<string, boolean>>({});
  const [loadingKeys, setLoadingKeys] = useState(true);
  const [reanalyzing, setReanalyzing] = useState(false);
  const [reanalyzeResult, setReanalyzeResult] = useState<string | null>(null);
  const [draining, setDraining] = useState(false);
  const [drainResult, setDrainResult] = useState<string | null>(null);
  const [synthesizing, setSynthesizing] = useState(false);
  const [synthesizeResult, setSynthesizeResult] = useState<string | null>(null);
  const [backfilling, setBackfilling] = useState(false);
  const [backfillResult, setBackfillResult] = useState<string | null>(null);
  const [assigningOrgs, setAssigningOrgs] = useState(false);
  const [assignOrgResult, setAssignOrgResult] = useState<string | null>(null);
  const [monthlyBackfilling, setMonthlyBackfilling] = useState(false);
  const [monthlyBackfillResult, setMonthlyBackfillResult] = useState<string | null>(null);

  const reanalyzeMessages = async () => {
    setReanalyzing(true);
    setReanalyzeResult(null);
    try {
      const res = await fetch('/api/pipeline/reanalyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ limit: 50 }),
      });
      const data = await res.json();
      if (data.error) {
        setReanalyzeResult(`Error: ${data.error}`);
      } else {
        setReanalyzeResult(`${data.reset} messages queued for re-analysis. Click "Drain Queue" to process them now.`);
      }
    } catch {
      setReanalyzeResult('Request failed.');
    }
    setReanalyzing(false);
  };

  const drainQueue = async () => {
    setDraining(true);
    setDrainResult(null);
    try {
      const res = await fetch('/api/pipeline/drain', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ maxBatches: 10 }),
      });
      const data = await res.json();
      if (data.error) {
        setDrainResult(`Error: ${data.error}`);
      } else if (data.totalProcessed === 0 && data.firstError) {
        setDrainResult(`Failed — ${data.firstError}`);
      } else if (data.totalProcessed === 0 && data.remainingPending > 0) {
        setDrainResult(`0 processed, ${data.remainingPending} still pending. Check GEMINI_API_KEY is set in .env.local and the server was restarted after adding it.`);
      } else {
        const remaining = data.remainingPending > 0 ? ` (${data.remainingPending} still pending — run again)` : ' — queue clear!';
        setDrainResult(`Analyzed ${data.totalProcessed} messages, generated ${data.alertsCreated} alerts.${remaining}`);
      }
    } catch {
      setDrainResult('Request failed.');
    }
    setDraining(false);
  };

  const synthesizeToday = async () => {
    setSynthesizing(true);
    setSynthesizeResult(null);
    try {
      const today = new Date().toISOString().slice(0, 10);
      const res = await fetch('/api/pipeline/synthesize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ period: 'day', date: today, allOrgs: true, extractObjectives: true }),
      });
      const data = await res.json();
      if (!data.success) {
        setSynthesizeResult(`Error: ${data.error}`);
      } else if (data.allOrgs) {
        const lines = Object.entries(data.results || {}).map(([org, r]: [string, unknown]) => {
          const result = r as { messageCount: number; employeeCount: number; skipped: boolean; error: string | null };
          if (result.error) return `${org}: Error - ${result.error}`;
          if (result.skipped) return `${org}: skipped (no messages)`;
          return `${org}: ${result.messageCount} msgs, ${result.employeeCount} people`;
        });
        setSynthesizeResult(lines.join(' | '));
      } else if (data.skipped) {
        setSynthesizeResult('Skipped — no messages found for today.');
      } else {
        const objInfo = data.objectives ? ` Objectives: ${data.objectives.created} new, ${data.objectives.updated} updated.` : '';
        setSynthesizeResult(`Day snapshot created (${data.messageCount} msgs, ${data.employeeCount} people).${objInfo}`);
      }
    } catch {
      setSynthesizeResult('Request failed.');
    }
    setSynthesizing(false);
  };

  const runBackfill = async () => {
    setBackfilling(true);
    setBackfillResult(null);
    try {
      const res = await fetch('/api/pipeline/backfill', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ batchLimit: 10, allOrgs: true }),
      });
      const data = await res.json();
      if (!data.success) {
        setBackfillResult(`Error: ${JSON.stringify(data)}`);
      } else if (data.allOrgs) {
        const lines = Object.entries(data.results || {}).map(([org, r]: [string, unknown]) => {
          const result = r as { processed: number; skipped: number; remaining: number; errors: string[] };
          return `${org}: ${result.processed} done, ${result.remaining} left`;
        });
        setBackfillResult(lines.join(' | '));
      } else {
        const status = data.complete ? 'Backfill complete!' : `${data.remaining} days remaining — run again.`;
        const errs = data.errors?.length > 0 ? ` Errors: ${data.errors[0]}` : '';
        setBackfillResult(`Processed ${data.processed} days, skipped ${data.skipped}. ${status}${errs}`);
      }
    } catch {
      setBackfillResult('Request failed.');
    }
    setBackfilling(false);
  };

  const runWeekRollup = async () => {
    setSynthesizing(true);
    setSynthesizeResult(null);
    try {
      const org = localStorage.getItem('ea_selected_org') || 'biotech';
      const res = await fetch('/api/pipeline/backfill', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: 'weeks', org, weeksBack: 4 }),
      });
      const data = await res.json();
      if (!data.success) {
        setSynthesizeResult(`Error: ${JSON.stringify(data)}`);
      } else {
        setSynthesizeResult(`Week rollup (${data.org}): ${data.processed} weeks synthesized, ${data.skipped} skipped.`);
      }
    } catch {
      setSynthesizeResult('Request failed.');
    }
    setSynthesizing(false);
  };

  const runObjectiveExtraction = async () => {
    setSynthesizing(true);
    setSynthesizeResult(null);
    try {
      const res = await fetch('/api/pipeline/synthesize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ period: 'objectives', allOrgs: true, lookbackDays: 365 }),
      });
      const data = await res.json();
      if (!data.success) {
        setSynthesizeResult(`Error: ${JSON.stringify(data)}`);
      } else if (data.allOrgs) {
        const lines = Object.entries(data.results || {}).map(([org, r]: [string, unknown]) => {
          const result = r as { created: number; updated: number; stalled: number; errors: string[] };
          return `${org}: ${result.created} new, ${result.updated} updated`;
        });
        setSynthesizeResult(`Objectives: ${lines.join(' | ')}`);
      } else {
        setSynthesizeResult(`Objectives: ${data.created} new, ${data.updated} updated, ${data.stalled} stalled.`);
      }
    } catch {
      setSynthesizeResult('Request failed.');
    }
    setSynthesizing(false);
  };

  const runAssignOrgs = async () => {
    setAssigningOrgs(true);
    setAssignOrgResult(null);
    try {
      const res = await fetch('/api/pipeline/assign-orgs', { method: 'POST' });
      const data = await res.json();
      if (!data.success) {
        setAssignOrgResult(`Error: ${data.error}`);
      } else {
        const counts = Object.entries(data.assigned || {}).map(([k, v]) => `${k}: ${v}`).join(', ');
        setAssignOrgResult(`Assigned ${data.total} employees (${counts}). ${data.unassigned?.length || 0} unassigned.`);
      }
    } catch {
      setAssignOrgResult('Request failed.');
    }
    setAssigningOrgs(false);
  };

  const runMonthlyBackfill = async () => {
    setMonthlyBackfilling(true);
    setMonthlyBackfillResult(null);
    try {
      const res = await fetch('/api/pipeline/backfill', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: 'monthly', allOrgs: true, monthsBack: 12 }),
      });
      const data = await res.json();
      if (!data.success) {
        setMonthlyBackfillResult(`Error: ${JSON.stringify(data)}`);
      } else if (data.results) {
        const lines = Object.entries(data.results).map(([org, r]: [string, unknown]) => {
          const result = r as { processed: number; skipped: number; errors: string[] };
          return `${org}: ${result.processed} processed, ${result.skipped} skipped${result.errors.length ? ` (${result.errors[0]})` : ''}`;
        });
        setMonthlyBackfillResult(lines.join(' | '));
      } else {
        setMonthlyBackfillResult(`Processed ${data.processed}, skipped ${data.skipped}.`);
      }
    } catch {
      setMonthlyBackfillResult('Request failed.');
    }
    setMonthlyBackfilling(false);
  };

  // Load employees + org assignments via API
  useEffect(() => {
    Promise.all([
      fetch('/api/employees?active=true&fields=keys').then(r => r.json()),
      fetch('/api/company/org-assignments').then(r => r.json()),
    ]).then(([empData, orgMap]) => {
      const emps = empData.employees || [];
      const assignments = orgMap as Record<string, string>;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      setKeyRows(emps.map((e: any) => ({
        ...e,
        workspace: (assignments[e.id] as Workspace) || null,
      })));
      setLoadingKeys(false);
    });
  }, []);

  const saveWorkspace = async (empId: string, workspace: Workspace | null) => {
    await fetch('/api/company/org-assignments', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ employeeId: empId, workspace }),
    });
    setKeyRows(prev => prev.map(r => r.id === empId ? { ...r, workspace } : r));
  };

  const saveKey = async (empId: string) => {
    const vals = editing[empId];
    if (!vals) return;
    setSaving(empId);
    try {
      const res = await fetch('/api/employees', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: empId, raven_api_key: vals.key || null, raven_api_secret: vals.secret || null }),
      });
      if (res.ok) {
        setKeyRows(prev => prev.map(r =>
          r.id === empId ? { ...r, raven_api_key: vals.key || null, raven_api_secret: vals.secret || null } : r
        ));
        setSaved(prev => ({ ...prev, [empId]: true }));
        setTimeout(() => setSaved(prev => ({ ...prev, [empId]: false })), 2000);
      }
    } catch {
      // Silent fail
    }
    setSaving(null);
    setEditing(prev => { const n = { ...prev }; delete n[empId]; return n; });
  };

  const envVars = [
    { name: 'CLOUDFLARE_D1_DATABASE_ID', label: 'D1 Database ID', icon: Globe },
    { name: 'GEMINI_API_KEY', label: 'Gemini API Key', icon: Key },
    { name: 'ERPNEXT_BASE_URL', label: 'ERPNext URL', icon: Server },
    { name: 'ERPNEXT_API_KEY', label: 'ERPNext API Key (default)', icon: Key },
  ];

  return (
    <div className="max-w-4xl mx-auto py-8 px-6 space-y-8 animate-fadeIn">
      <header>
        <h1 className="text-3xl font-bold tracking-tight">Settings</h1>
        <p className="text-secondary text-sm mt-1">Pipeline status and configuration</p>
      </header>

      {/* Connection Status */}
      <section className="card space-y-4">
        <h2 className="text-lg font-bold flex items-center gap-2">
          <Database size={18} className="text-accent" />
          Connection Status
        </h2>
        <div className="grid grid-cols-2 gap-4">
          <div className="p-3 bg-glass rounded-lg">
            <div className="flex items-center gap-2 mb-1">
              {employees.length > 0 ? (
                <CheckCircle size={14} className="text-green-400" />
              ) : (
                <XCircle size={14} className="text-red-400" />
              )}
              <span className="text-xs font-bold">ERPNext / Raven</span>
            </div>
            <p className="text-[10px] text-secondary">
              {isLoading
                ? 'Syncing...'
                : employees.length > 0
                ? `${employees.length} employees, ${objectives.length} objectives`
                : 'Connecting...'}
            </p>
          </div>
          <div className="p-3 bg-glass rounded-lg">
            <div className="flex items-center gap-2 mb-1">
              <CheckCircle size={14} className="text-green-400" />
              <span className="text-xs font-bold">D1 Database</span>
            </div>
            <p className="text-[10px] text-secondary">Connected</p>
          </div>
        </div>

        {lastSyncedAt && (
          <p className="text-xs text-secondary flex items-center gap-1">
            <Clock size={12} />
            Last synced: {format(new Date(lastSyncedAt), 'MMM d, yyyy h:mm a')}
          </p>
        )}
      </section>

      {/* Workspace Assignment */}
      <section className="card space-y-4">
        <div>
          <h2 className="text-lg font-bold flex items-center gap-2">
            <Layers size={18} className="text-accent" />
            Workspace Assignment
          </h2>
          <p className="text-xs text-secondary mt-1">
            Assign each team member to their business unit. This categorizes their activity across Biotech, TCR (Technoculture Research), and Sentient X.
          </p>
        </div>

        {loadingKeys ? (
          <p className="text-xs text-secondary italic">Loading team members...</p>
        ) : (
          <div className="space-y-2">
            {keyRows.map(emp => (
              <div key={emp.id} className="flex items-center gap-3 p-3 bg-glass rounded-lg">
                <div className="w-7 h-7 rounded-full bg-accent/20 flex items-center justify-center text-[10px] font-bold text-accent shrink-0">
                  {emp.name.charAt(0).toUpperCase()}
                </div>
                <p className="text-sm font-bold flex-1 min-w-0 truncate">{emp.name}</p>
                {emp.workspace && (
                  <span className={`text-[10px] font-bold px-2 py-0.5 rounded border ${WORKSPACE_COLORS[emp.workspace]}`}>
                    {WORKSPACE_LABELS[emp.workspace]}
                  </span>
                )}
                <select
                  value={emp.workspace || ''}
                  onChange={e => saveWorkspace(emp.id, (e.target.value as Workspace) || null)}
                  className="text-xs bg-surface border border-border rounded px-2 py-1 text-secondary"
                >
                  <option value="">— unassigned —</option>
                  <option value="biotech">Biotech</option>
                  <option value="tcr">TCR</option>
                  <option value="sentient_x">Sentient X</option>
                </select>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Per-User Raven API Keys */}
      <section className="card space-y-4">
        <div>
          <h2 className="text-lg font-bold flex items-center gap-2">
            <Users size={18} className="text-accent" />
            Team Raven API Keys
          </h2>
          <p className="text-xs text-secondary mt-1">
            Each team member can generate their own API key at{' '}
            <code className="bg-glass px-1 rounded">erp.panomic.cloud → My Profile → API Access → Generate Keys</code>.
            Adding their key lets the pipeline fetch their messages directly, giving you full team visibility.
          </p>
        </div>

        {loadingKeys ? (
          <p className="text-xs text-secondary italic">Loading team members...</p>
        ) : (
          <div className="space-y-3">
            {keyRows.map(emp => {
              const isEditing = !!editing[emp.id];
              const editVals = editing[emp.id] || { key: emp.raven_api_key || '', secret: emp.raven_api_secret || '' };
              const hasKey = emp.raven_api_key && emp.raven_api_secret;
              const showSec = showSecret[emp.id];

              return (
                <div key={emp.id} className="p-3 bg-glass rounded-lg">
                  <div className="flex items-center gap-3 mb-2">
                    <div className="w-7 h-7 rounded-full bg-accent/20 flex items-center justify-center text-[10px] font-bold text-accent shrink-0">
                      {emp.name.charAt(0).toUpperCase()}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-bold">{emp.name}</p>
                      <p className="text-[10px] text-secondary truncate">{emp.raven_user || emp.email || emp.id}</p>
                    </div>
                    {hasKey && !isEditing ? (
                      <span className="text-[10px] text-green-400 font-bold flex items-center gap-1">
                        <CheckCircle size={10} /> Key set
                      </span>
                    ) : (
                      <span className="text-[10px] text-yellow-400/70 font-bold">No key</span>
                    )}
                    {saved[emp.id] && (
                      <span className="text-[10px] text-green-400">Saved!</span>
                    )}
                  </div>

                  {isEditing ? (
                    <div className="space-y-2 mt-2">
                      <input
                        type="text"
                        placeholder="API Key"
                        value={editVals.key}
                        onChange={e => setEditing(prev => ({ ...prev, [emp.id]: { ...editVals, key: e.target.value } }))}
                        className="w-full bg-surface border border-border rounded px-3 py-1.5 text-xs font-mono"
                      />
                      <div className="relative">
                        <input
                          type={showSec ? 'text' : 'password'}
                          placeholder="API Secret"
                          value={editVals.secret}
                          onChange={e => setEditing(prev => ({ ...prev, [emp.id]: { ...editVals, secret: e.target.value } }))}
                          className="w-full bg-surface border border-border rounded px-3 py-1.5 text-xs font-mono pr-8"
                        />
                        <button
                          type="button"
                          onClick={() => setShowSecret(prev => ({ ...prev, [emp.id]: !prev[emp.id] }))}
                          className="absolute right-2 top-1/2 -translate-y-1/2 text-secondary"
                        >
                          {showSec ? <EyeOff size={12} /> : <Eye size={12} />}
                        </button>
                      </div>
                      <div className="flex gap-2">
                        <button
                          onClick={() => saveKey(emp.id)}
                          disabled={saving === emp.id}
                          className="text-xs font-bold text-accent hover:underline flex items-center gap-1"
                        >
                          <Save size={12} /> {saving === emp.id ? 'Saving...' : 'Save'}
                        </button>
                        <button
                          onClick={() => setEditing(prev => { const n = { ...prev }; delete n[emp.id]; return n; })}
                          className="text-xs text-secondary hover:text-primary"
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  ) : (
                    <button
                      onClick={() => setEditing(prev => ({ ...prev, [emp.id]: { key: emp.raven_api_key || '', secret: emp.raven_api_secret || '' } }))}
                      className="text-[10px] font-bold text-accent hover:underline mt-1"
                    >
                      {hasKey ? 'Update key' : '+ Add API key'}
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* Re-analyze + Drain Queue */}
      <section className="card space-y-4">
        <h2 className="text-lg font-bold flex items-center gap-2">
          <RefreshCw size={18} className="text-accent" />
          Analysis Queue
        </h2>
        <p className="text-xs text-secondary">
          <strong className="text-primary">Re-analyze</strong> resets the 50 most recent messages so they get fresh scores from the current AI prompt.{' '}
          <strong className="text-primary">Drain Queue</strong> immediately processes all pending (unanalyzed) messages — use this to clear a backlog fast instead of waiting for the 2-minute cycle.
        </p>
        <div className="flex flex-wrap gap-3">
          <button
            onClick={reanalyzeMessages}
            disabled={reanalyzing || draining}
            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-accent/20 hover:bg-accent/30 text-accent text-sm font-bold transition-colors disabled:opacity-50"
          >
            <RefreshCw size={14} className={reanalyzing ? 'animate-spin' : ''} />
            {reanalyzing ? 'Resetting...' : 'Re-analyze Last 50'}
          </button>
          <button
            onClick={drainQueue}
            disabled={draining || reanalyzing}
            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-orange-500/20 hover:bg-orange-500/30 text-orange-400 text-sm font-bold transition-colors disabled:opacity-50"
          >
            <RefreshCw size={14} className={draining ? 'animate-spin' : ''} />
            {draining ? 'Draining... (may take 1–2 min)' : 'Drain Queue Now'}
          </button>
        </div>
        {reanalyzeResult && (
          <p className={`text-xs ${reanalyzeResult.startsWith('Error') ? 'text-red-400' : 'text-green-400'}`}>
            {reanalyzeResult}
          </p>
        )}
        {drainResult && (
          <p className={`text-xs ${drainResult.startsWith('Error') ? 'text-red-400' : 'text-green-400'}`}>
            {drainResult}
          </p>
        )}
      </section>

      {/* Org Assignment + Monthly Backfill */}
      <section className="card space-y-4">
        <h2 className="text-lg font-bold flex items-center gap-2">
          <Activity size={18} className="text-accent" />
          Org-Separated Pipeline
        </h2>
        <p className="text-xs text-secondary">
          <strong className="text-primary">Step 1: Assign Orgs</strong> auto-assigns employees to orgs from Raven workspace membership (must run first).{' '}
          <strong className="text-primary">Step 2: Monthly Backfill</strong> processes all historical data — one Gemini call per org per month, plus employee trajectories.
        </p>
        <div className="flex flex-wrap gap-3">
          <button
            onClick={runAssignOrgs}
            disabled={assigningOrgs || monthlyBackfilling}
            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-green-500/20 hover:bg-green-500/30 text-green-400 text-sm font-bold transition-colors disabled:opacity-50"
          >
            <RefreshCw size={14} className={assigningOrgs ? 'animate-spin' : ''} />
            {assigningOrgs ? 'Assigning...' : '1. Assign Orgs from Raven'}
          </button>
          <button
            onClick={runMonthlyBackfill}
            disabled={monthlyBackfilling || assigningOrgs}
            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-accent/20 hover:bg-accent/30 text-accent text-sm font-bold transition-colors disabled:opacity-50"
          >
            <RefreshCw size={14} className={monthlyBackfilling ? 'animate-spin' : ''} />
            {monthlyBackfilling ? 'Backfilling...' : '2. Monthly Backfill (all orgs)'}
          </button>
        </div>
        {assignOrgResult && (
          <p className={`text-xs ${assignOrgResult.startsWith('Error') ? 'text-red-400' : 'text-green-400'}`}>
            {assignOrgResult}
          </p>
        )}
        {monthlyBackfillResult && (
          <p className={`text-xs ${monthlyBackfillResult.startsWith('Error') ? 'text-red-400' : 'text-green-400'}`}>
            {monthlyBackfillResult}
          </p>
        )}
      </section>

      {/* Company Synthesis (legacy daily) */}
      <section className="card space-y-4">
        <h2 className="text-lg font-bold flex items-center gap-2">
          <Activity size={18} className="text-accent" />
          Daily Synthesis (Legacy)
        </h2>
        <p className="text-xs text-secondary">
          <strong className="text-primary">Synthesize Today</strong> creates a single AI narrative from all today&apos;s messages + extracts objectives.{' '}
          <strong className="text-primary">Backfill Days</strong> processes historical days (20 per batch, cursor-tracked).{' '}
          <strong className="text-primary">Week Rollup</strong> aggregates day snapshots into weekly summaries.{' '}
          <strong className="text-primary">Extract Objectives</strong> builds the hierarchical objective tree from the last 30 days of narratives.
        </p>
        <div className="flex flex-wrap gap-3">
          <button
            onClick={synthesizeToday}
            disabled={synthesizing || backfilling}
            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-accent/20 hover:bg-accent/30 text-accent text-sm font-bold transition-colors disabled:opacity-50"
          >
            <RefreshCw size={14} className={synthesizing ? 'animate-spin' : ''} />
            {synthesizing ? 'Running...' : 'Synthesize Today'}
          </button>
          <button
            onClick={runBackfill}
            disabled={backfilling || synthesizing}
            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-blue-500/20 hover:bg-blue-500/30 text-blue-400 text-sm font-bold transition-colors disabled:opacity-50"
          >
            <RefreshCw size={14} className={backfilling ? 'animate-spin' : ''} />
            {backfilling ? 'Backfilling...' : 'Backfill Days (20)'}
          </button>
          <button
            onClick={runWeekRollup}
            disabled={synthesizing || backfilling}
            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-purple-500/20 hover:bg-purple-500/30 text-purple-400 text-sm font-bold transition-colors disabled:opacity-50"
          >
            Week Rollup (4 wks)
          </button>
          <button
            onClick={runObjectiveExtraction}
            disabled={synthesizing || backfilling}
            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-teal-500/20 hover:bg-teal-500/30 text-teal-400 text-sm font-bold transition-colors disabled:opacity-50"
          >
            Extract Objectives
          </button>
        </div>
        {synthesizeResult && (
          <p className={`text-xs ${synthesizeResult.startsWith('Error') ? 'text-red-400' : 'text-green-400'}`}>
            {synthesizeResult}
          </p>
        )}
        {backfillResult && (
          <p className={`text-xs ${backfillResult.startsWith('Error') ? 'text-red-400' : 'text-green-400'}`}>
            {backfillResult}
          </p>
        )}
      </section>

      {/* Pipeline Info */}
      <section className="card space-y-4">
        <h2 className="text-lg font-bold flex items-center gap-2">
          <Activity size={18} className="text-accent" />
          Automated Pipeline
        </h2>
        <div className="text-xs text-secondary space-y-3">
          {[
            { step: 1, title: 'ERP Sync', desc: 'Employees, projects, and tasks are synced from ERPNext on startup.' },
            { step: 2, title: 'Message Ingestion', desc: 'New Raven messages are ingested every 2 minutes per user API key. Users without a key are skipped unless the default key can see their messages.' },
            { step: 3, title: 'Gemini Analysis', desc: 'Each message is analyzed for category, sentiment, productivity, and blocker detection.' },
            { step: 4, title: 'Alert Generation', desc: 'Alerts fire automatically for blockers, sentiment drops, inactivity, and missed deadlines.' },
            { step: 5, title: 'EOD Digest', desc: 'Trigger POST /api/pipeline/digest (or schedule it) to generate per-employee end-of-day reports with ratings and objective updates.' },
          ].map(item => (
            <div key={item.step} className="flex items-start gap-3">
              <span className="w-5 h-5 rounded-full bg-green-500/20 text-green-400 flex items-center justify-center text-[10px] font-bold shrink-0 mt-0.5">
                {item.step}
              </span>
              <div>
                <p className="font-bold text-primary">{item.title}</p>
                <p>{item.desc}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Environment Configuration */}
      <section className="card space-y-4">
        <h2 className="text-lg font-bold flex items-center gap-2">
          <Key size={18} className="text-accent" />
          Environment
        </h2>
        <p className="text-xs text-secondary">
          Credentials are configured via <code className="bg-glass px-1 rounded">.env.local</code>.
        </p>
        <div className="space-y-2">
          {envVars.map(v => (
            <div key={v.name} className="flex items-center gap-3 p-2 bg-glass rounded">
              <v.icon size={14} className="text-secondary" />
              <span className="text-xs font-mono flex-1">{v.name}</span>
              <span className="text-[10px] text-green-400">configured</span>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
