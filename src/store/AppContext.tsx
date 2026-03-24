'use client';

import React, { createContext, useContext, useEffect, useState, useCallback, useRef } from 'react';
import type {
  Objective, Employee, Alert, MessageAnalysis, SubPoint, Status, Priority,
  WorkUpdate, Note, SearchResult,
} from '@/types';

interface AppContextType {
  // Data
  objectives: Objective[];
  employees: Employee[];
  alerts: Alert[];
  recentAnalyses: MessageAnalysis[];
  unreadAlertCount: number;
  isLoading: boolean;
  isSyncing: boolean;
  lastSyncedAt: string | null;

  // Objective mutations
  addObjective: (objective: Omit<Objective, 'id' | 'createdAt' | 'updatedAt' | 'subPoints'>) => Promise<void>;
  updateObjective: (id: string, updates: Partial<Objective>) => Promise<void>;
  deleteObjective: (id: string) => Promise<void>;

  // Task mutations (replaces SubPoint operations)
  addSubPoint: (objectiveId: string, subPoint: Omit<SubPoint, 'id' | 'createdAt' | 'updatedAt' | 'subPoints'>) => Promise<void>;
  updateSubPoint: (objectiveId: string, subPointId: string, updates: Partial<SubPoint>) => Promise<void>;
  deleteSubPoint: (objectiveId: string, subPointId: string) => Promise<void>;
  addNestedSubPoint: (objectiveId: string, parentSubPointId: string, subPoint: Omit<SubPoint, 'id' | 'createdAt' | 'updatedAt' | 'subPoints'>) => Promise<void>;
  updateNestedSubPoint: (objectiveId: string, parentSubPointId: string, nestedSubPointId: string, updates: Partial<SubPoint>) => Promise<void>;
  deleteNestedSubPoint: (objectiveId: string, parentSubPointId: string, nestedSubPointId: string) => Promise<void>;

  // Alert actions
  markAlertAsRead: (id: string) => Promise<void>;
  resolveAlertById: (id: string) => Promise<void>;

  refreshData: () => Promise<void>;

  // Legacy (kept for backward compat during migration)
  addEmployee: (employee: Omit<Employee, 'id' | 'createdAt'>) => void;
  getEmployeeById: (id: string) => Employee | undefined;
  workUpdates: WorkUpdate[];
  notes: Note[];
  searchResults: SearchResult[];
  addWorkUpdate: (update: Omit<WorkUpdate, 'id' | 'createdAt'>) => void;
  addNote: (note: Omit<Note, 'id' | 'createdAt'>) => void;
  addSearchResult: (result: Omit<SearchResult, 'id'>) => void;
}

const AppContext = createContext<AppContextType | undefined>(undefined);

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [objectives, setObjectives] = useState<Objective[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [recentAnalyses, setRecentAnalyses] = useState<MessageAnalysis[]>([]);
  const [unreadAlertCount, setUnreadAlertCount] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [isSyncing, setIsSyncing] = useState(false);
  const [lastSyncedAt, setLastSyncedAt] = useState<string | null>(null);

  // Legacy state (kept during migration)
  const [workUpdates] = useState<WorkUpdate[]>([]);
  const [notes] = useState<Note[]>([]);
  const [searchResults] = useState<SearchResult[]>([]);

  // Ref to prevent duplicate polling intervals
  const alertPollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Deduplicate arrays by id — prevents React duplicate-key warnings when
  // polling and refreshData overlap in the same render cycle.
  function dedupe<T extends { id: string }>(arr: T[]): T[] {
    const seen = new Set<string>();
    return arr.filter(item => {
      if (seen.has(item.id)) return false;
      seen.add(item.id);
      return true;
    });
  }

  const refreshData = useCallback(async () => {
    try {
      const res = await fetch('/api/data');
      if (!res.ok) {
        console.error('Failed to fetch data:', res.status, res.statusText);
        return;
      }
      const data = await res.json();

      if (data.employees) setEmployees(dedupe(data.employees));
      if (data.objectives) setObjectives(dedupe(data.objectives));
      if (data.alerts) setAlerts(dedupe(data.alerts));
      if (data.analyses) setRecentAnalyses(dedupe(data.analyses));
      if (data.unreadAlertCount !== undefined) setUnreadAlertCount(data.unreadAlertCount);
    } catch (err) {
      const msg = err instanceof Error ? err.message : JSON.stringify(err);
      console.error('Failed to fetch data:', msg, err);
    }
  }, []);

  // Poll alerts every 30 seconds (replaces Supabase realtime subscriptions)
  const pollAlerts = useCallback(async () => {
    try {
      const res = await fetch('/api/data?alerts_only=true');
      if (!res.ok) return;
      const data = await res.json();

      if (data.alerts) setAlerts(dedupe(data.alerts));
      if (data.unreadAlertCount !== undefined) setUnreadAlertCount(data.unreadAlertCount);
      if (data.analyses) setRecentAnalyses(dedupe(data.analyses));
    } catch {
      // Silent fail — polling is non-critical
    }
  }, []);

  // Initial data load
  useEffect(() => {
    setIsLoading(true);
    refreshData().finally(() => setIsLoading(false));
  }, [refreshData]);

  // Alert polling (replaces realtime subscriptions) — every 30 seconds
  useEffect(() => {
    if (alertPollRef.current) clearInterval(alertPollRef.current);
    alertPollRef.current = setInterval(pollAlerts, 30_000);
    return () => {
      if (alertPollRef.current) clearInterval(alertPollRef.current);
    };
  }, [pollAlerts]);

  // Auto-sync ERP data on startup, then poll for new messages every 10 min
  useEffect(() => {
    const fetchWithTimeout = (url: string, opts: RequestInit = {}, ms = 10000) => {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), ms);
      return fetch(url, { ...opts, signal: controller.signal }).finally(() => clearTimeout(timeout));
    };

    const syncAndIngest = async () => {
      try {
        setIsSyncing(true);
        // Sync employees/projects/tasks from ERPNext first (10s timeout)
        await fetchWithTimeout('/api/pipeline/sync', { method: 'POST' }, 10000);
        // Then ingest new Raven messages (10s timeout)
        await fetchWithTimeout('/api/pipeline/ingest', { method: 'POST' }, 10000);
        // Refresh UI state after pipeline runs
        await refreshData();
        setLastSyncedAt(new Date().toISOString());
      } catch {
        // Silent fail — sync may time out but page should still load
      } finally {
        setIsSyncing(false);
      }
    };

    const pollIngest = async () => {
      try {
        await fetchWithTimeout('/api/pipeline/ingest', { method: 'POST' }, 10000);
        await refreshData();
      } catch {
        // Silent fail
      }
    };

    // On mount: defer sync so it doesn't block initial page load
    const syncTimeout = setTimeout(syncAndIngest, 5000);
    // Every 10 min: ingest only
    const interval = setInterval(pollIngest, 600_000);
    return () => { clearTimeout(syncTimeout); clearInterval(interval); };
  }, [refreshData]);

  // Objective mutations — call API routes, then optimistically update local state
  const addObjective = async (data: Omit<Objective, 'id' | 'createdAt' | 'updatedAt' | 'subPoints'>) => {
    const res = await fetch('/api/objectives', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    if (!res.ok) throw new Error('Failed to create objective');
    const { objective: newObj } = await res.json();
    setObjectives(prev => [newObj, ...prev]);
  };

  const updateObjective = async (id: string, updates: Partial<Objective>) => {
    const res = await fetch('/api/objectives', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, ...updates }),
    });
    if (!res.ok) throw new Error('Failed to update objective');
    setObjectives(prev =>
      prev.map(obj =>
        obj.id === id ? { ...obj, ...updates, updatedAt: new Date().toISOString() } : obj
      )
    );
  };

  const deleteObjective = async (id: string) => {
    const res = await fetch('/api/objectives', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id }),
    });
    if (!res.ok) throw new Error('Failed to delete objective');
    setObjectives(prev => prev.filter(obj => obj.id !== id));
  };

  // Task/SubPoint mutations
  const addSubPoint = async (objectiveId: string, subPoint: Omit<SubPoint, 'id' | 'createdAt' | 'updatedAt' | 'subPoints'>) => {
    const res = await fetch('/api/tasks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ objectiveId, ...subPoint }),
    });
    if (!res.ok) throw new Error('Failed to create task');
    const { task } = await res.json();
    const newSp: SubPoint = {
      id: task.id,
      title: task.title,
      description: task.description,
      status: task.status as Status,
      startDate: task.start_date ?? '',
      endDate: task.end_date ?? '',
      assigneeId: task.assignee_id ?? '',
      createdAt: task.created_at,
      updatedAt: task.updated_at,
      subPoints: [],
    };
    setObjectives(prev =>
      prev.map(obj =>
        obj.id === objectiveId
          ? { ...obj, subPoints: [...obj.subPoints, newSp], updatedAt: new Date().toISOString() }
          : obj
      )
    );
  };

  const updateSubPoint = async (_objectiveId: string, subPointId: string, updates: Partial<SubPoint>) => {
    const res = await fetch('/api/tasks', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: subPointId, ...updates }),
    });
    if (!res.ok) throw new Error('Failed to update task');
    setObjectives(prev =>
      prev.map(obj => ({
        ...obj,
        subPoints: obj.subPoints.map(sp =>
          sp.id === subPointId ? { ...sp, ...updates, updatedAt: new Date().toISOString() } : sp
        ),
      }))
    );
  };

  const deleteSubPoint = async (_objectiveId: string, subPointId: string) => {
    const res = await fetch('/api/tasks', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: subPointId }),
    });
    if (!res.ok) throw new Error('Failed to delete task');
    setObjectives(prev =>
      prev.map(obj => ({
        ...obj,
        subPoints: obj.subPoints.filter(sp => sp.id !== subPointId),
      }))
    );
  };

  const addNestedSubPoint = async (objectiveId: string, parentSubPointId: string, subPoint: Omit<SubPoint, 'id' | 'createdAt' | 'updatedAt' | 'subPoints'>) => {
    const res = await fetch('/api/tasks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ objectiveId, parentTaskId: parentSubPointId, ...subPoint }),
    });
    if (!res.ok) throw new Error('Failed to create nested task');
    const { task } = await res.json();
    const newSp: SubPoint = {
      id: task.id,
      title: task.title,
      description: task.description,
      status: task.status as Status,
      startDate: task.start_date ?? '',
      endDate: task.end_date ?? '',
      assigneeId: task.assignee_id ?? '',
      createdAt: task.created_at,
      updatedAt: task.updated_at,
      subPoints: [],
    };
    setObjectives(prev =>
      prev.map(obj =>
        obj.id === objectiveId
          ? {
              ...obj,
              subPoints: obj.subPoints.map(sp =>
                sp.id === parentSubPointId
                  ? { ...sp, subPoints: [...(sp.subPoints || []), newSp] }
                  : sp
              ),
            }
          : obj
      )
    );
  };

  const updateNestedSubPoint = async (_objectiveId: string, _parentSubPointId: string, nestedSubPointId: string, updates: Partial<SubPoint>) => {
    const res = await fetch('/api/tasks', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: nestedSubPointId, ...updates }),
    });
    if (!res.ok) throw new Error('Failed to update nested task');
    setObjectives(prev =>
      prev.map(obj => ({
        ...obj,
        subPoints: obj.subPoints.map(sp => ({
          ...sp,
          subPoints: (sp.subPoints || []).map(nsp =>
            nsp.id === nestedSubPointId ? { ...nsp, ...updates, updatedAt: new Date().toISOString() } : nsp
          ),
        })),
      }))
    );
  };

  const deleteNestedSubPoint = async (_objectiveId: string, _parentSubPointId: string, nestedSubPointId: string) => {
    const res = await fetch('/api/tasks', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: nestedSubPointId }),
    });
    if (!res.ok) throw new Error('Failed to delete nested task');
    setObjectives(prev =>
      prev.map(obj => ({
        ...obj,
        subPoints: obj.subPoints.map(sp => ({
          ...sp,
          subPoints: (sp.subPoints || []).filter(nsp => nsp.id !== nestedSubPointId),
        })),
      }))
    );
  };

  // Alert actions — call API routes
  const markAlertAsRead = async (id: string) => {
    const res = await fetch('/api/alerts', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, action: 'read' }),
    });
    if (!res.ok) throw new Error('Failed to mark alert as read');
    setAlerts(prev => prev.map(a => a.id === id ? { ...a, isRead: true } : a));
    setUnreadAlertCount(prev => Math.max(0, prev - 1));
  };

  const resolveAlertById = async (id: string) => {
    const res = await fetch('/api/alerts', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, action: 'resolve' }),
    });
    if (!res.ok) throw new Error('Failed to resolve alert');
    setAlerts(prev => prev.map(a => a.id === id ? { ...a, isResolved: true } : a));
  };

  // Legacy stubs
  const addEmployee = () => {};
  const addWorkUpdate = () => {};
  const addNote = () => {};
  const addSearchResult = () => {};
  const getEmployeeById = (id: string) => employees.find(e => e.id === id);

  return (
    <AppContext.Provider
      value={{
        objectives,
        employees,
        alerts,
        recentAnalyses,
        unreadAlertCount,
        isLoading,
        isSyncing,
        lastSyncedAt,
        addObjective,
        updateObjective,
        deleteObjective,
        addSubPoint,
        updateSubPoint,
        deleteSubPoint,
        addNestedSubPoint,
        updateNestedSubPoint,
        deleteNestedSubPoint,
        markAlertAsRead,
        resolveAlertById,
        refreshData,
        addEmployee,
        getEmployeeById,
        workUpdates,
        notes,
        searchResults,
        addWorkUpdate,
        addNote,
        addSearchResult,
      }}
    >
      {children}
    </AppContext.Provider>
  );
}

export function useApp() {
  const context = useContext(AppContext);
  if (!context) {
    throw new Error('useApp must be used within AppProvider');
  }
  return context;
}
