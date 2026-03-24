'use client';

import { useState, useEffect } from 'react';
import { Users, RefreshCw } from 'lucide-react';

type Member = {
  id: string | null;
  name: string;
  role: string;
  email: string;
};

type Workspace = {
  name: string;
  label: string;
  description: string;
  members: Member[];
};

const WORKSPACE_COLORS: Record<string, { badge: string; ring: string; dot: string }> = {
  ExRNA:         { badge: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30', ring: 'ring-emerald-500/20', dot: 'bg-emerald-400' },
  Sentient:      { badge: 'bg-cyan-500/15 text-cyan-400 border-cyan-500/30',         ring: 'ring-cyan-500/20',    dot: 'bg-cyan-400' },
  Technoculture: { badge: 'bg-purple-500/15 text-purple-400 border-purple-500/30',   ring: 'ring-purple-500/20',  dot: 'bg-purple-400' },
  'VV Biotech':  { badge: 'bg-orange-500/15 text-orange-400 border-orange-500/30',   ring: 'ring-orange-500/20',  dot: 'bg-orange-400' },
};

const fallbackColor = { badge: 'bg-gray-500/15 text-gray-400 border-gray-500/30', ring: 'ring-gray-500/20', dot: 'bg-gray-400' };

export default function TeamPage() {
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/team');
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setWorkspaces(data.workspaces || []);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  return (
    <div className="max-w-7xl mx-auto py-8 px-6 space-y-6 animate-fadeIn">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight flex items-center gap-3">
            <Users size={26} className="text-accent" /> Team
          </h1>
          <p className="text-secondary text-sm mt-1">Members by Raven workspace</p>
        </div>
        <button
          onClick={load}
          disabled={loading}
          className="flex items-center gap-2 text-xs font-bold text-accent hover:underline disabled:opacity-50"
        >
          <RefreshCw size={13} className={loading ? 'animate-spin' : ''} /> Refresh
        </button>
      </header>

      {error && (
        <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-4 text-sm text-red-400">{error}</div>
      )}

      {loading && !error && (
        <div className="grid grid-cols-4 gap-6">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="card animate-pulse space-y-3">
              <div className="h-5 w-24 bg-glass rounded" />
              <div className="h-3 w-32 bg-glass rounded" />
              {[...Array(4)].map((_, j) => (
                <div key={j} className="h-10 bg-glass rounded-lg" />
              ))}
            </div>
          ))}
        </div>
      )}

      {!loading && !error && (
        <div className="grid grid-cols-4 gap-6">
          {workspaces.map(ws => {
            const colors = WORKSPACE_COLORS[ws.name] || fallbackColor;
            return (
              <div key={ws.name} className="card space-y-4">
                {/* Header */}
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <span className={`text-xs font-bold px-2 py-0.5 rounded border ${colors.badge}`}>
                      {ws.label}
                    </span>
                    <span className="text-2xl font-bold text-accent">{ws.members.length}</span>
                  </div>
                  {ws.description && (
                    <p className="text-[11px] text-secondary">{ws.description}</p>
                  )}
                </div>

                {/* Members */}
                <div className="space-y-1.5">
                  {ws.members.length === 0 ? (
                    <p className="text-[11px] text-secondary italic">No members</p>
                  ) : (
                    ws.members.map((m, i) => (
                      <div key={m.email || i} className="flex items-center gap-2 py-1.5 px-2 rounded-lg hover:bg-glass transition-colors">
                        <div className={`w-6 h-6 rounded-full ring-1 ${colors.ring} bg-surface flex items-center justify-center text-[10px] font-bold text-accent shrink-0`}>
                          {m.name.charAt(0).toUpperCase()}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-medium truncate leading-tight">{m.name}</p>
                          <p className="text-[10px] text-secondary truncate leading-tight">{m.role}</p>
                        </div>
                        {m.id && (
                          <div className={`w-1.5 h-1.5 rounded-full shrink-0 ${colors.dot}`} title="In Supabase" />
                        )}
                      </div>
                    ))
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
