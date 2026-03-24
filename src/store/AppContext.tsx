'use client';

import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import type {
  Objective, Employee, Alert, MessageAnalysis, SubPoint, Status, Priority,
  WorkUpdate, Note, SearchResult,
} from '@/types';
import { createClient } from '@/lib/supabase/client';
import {
  fetchEmployees as dalFetchEmployees,
  fetchObjectives as dalFetchObjectives,
  createObjective as dalCreateObjective,
  updateObjective as dalUpdateObjective,
  deleteObjective as dalDeleteObjective,
  createTask as dalCreateTask,
  updateTask as dalUpdateTask,
  deleteTask as dalDeleteTask,
  fetchAlerts as dalFetchAlerts,
  fetchUnreadAlertCount as dalFetchUnreadAlertCount,
  markAlertRead as dalMarkAlertRead,
  resolveAlert as dalResolveAlert,
  fetchAnalyses as dalFetchAnalyses,
} from '@/lib/dal';

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
  const [supabase] = useState(() => createClient());
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

  const isSupabaseConfigured =
    process.env.NEXT_PUBLIC_SUPABASE_URL?.startsWith('https://') &&
    !process.env.NEXT_PUBLIC_SUPABASE_URL?.includes('YOUR_PROJECT');

  // Deduplicate arrays by id — prevents React duplicate-key warnings when
  // realtime subscriptions and refreshData overlap in the same render cycle.
  function dedupe<T extends { id: string }>(arr: T[]): T[] {
    const seen = new Set<string>();
    return arr.filter(item => {
      if (seen.has(item.id)) return false;
      seen.add(item.id);
      return true;
    });
  }

  const refreshData = useCallback(async () => {
    if (!isSupabaseConfigured) {
      console.warn('Supabase not configured — fill in .env.local to connect');
      return;
    }
    try {
      // Fetch essential data first (2 queries instead of 5)
      const [emps, objs] = await Promise.all([
        dalFetchEmployees(supabase),
        dalFetchObjectives(supabase),
      ]);
      setEmployees(dedupe(emps));
      setObjectives(dedupe(objs));

      // Fetch non-critical data lazily (don't block page load)
      Promise.all([
        dalFetchAlerts(supabase, { unresolvedOnly: true, limit: 10 }),
        dalFetchUnreadAlertCount(supabase),
        dalFetchAnalyses(supabase, { limit: 10 }),
      ]).then(([alts, alertCount, analyses]) => {
        setAlerts(dedupe(alts));
        setUnreadAlertCount(alertCount);
        setRecentAnalyses(dedupe(analyses));
      }).catch(() => { /* non-critical */ });
    } catch (err) {
      const msg = err instanceof Error ? err.message : JSON.stringify(err);
      console.error('Failed to fetch data from Supabase:', msg, err);
    }
  }, [supabase]);

  // Initial data load
  useEffect(() => {
    setIsLoading(true);
    refreshData().finally(() => setIsLoading(false));
  }, [refreshData]);

  // Realtime subscriptions
  useEffect(() => {
    const alertChannel = supabase
      .channel('alerts-realtime')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'alerts' }, (payload) => {
        const a = payload.new;
        const newAlert: Alert = {
          id: a.id,
          type: a.type,
          severity: a.severity,
          title: a.title,
          description: a.description,
          employeeId: a.employee_id ?? undefined,
          objectiveId: a.objective_id ?? undefined,
          isRead: a.is_read,
          isResolved: a.is_resolved,
          createdAt: a.created_at,
        };
        setAlerts(prev => prev.some(a => a.id === newAlert.id) ? prev : [newAlert, ...prev]);
        setUnreadAlertCount(prev => prev + 1);
      })
      .subscribe();

    const analysisChannel = supabase
      .channel('analyses-realtime')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'message_analyses' }, (payload) => {
        const a = payload.new;
        const newAnalysis: MessageAnalysis = {
          id: a.id,
          ravenMessageId: a.raven_message_id,
          employeeId: a.employee_id ?? undefined,
          relatedObjectiveId: a.related_objective_id ?? undefined,
          category: a.category,
          sentiment: a.sentiment,
          productivityScore: a.productivity_score ?? undefined,
          summary: a.summary ?? undefined,
          keyTopics: a.key_topics ?? undefined,
          blockerDetected: a.blocker_detected,
          blockerDescription: a.blocker_description ?? undefined,
          createdAt: a.created_at,
        };
        setRecentAnalyses(prev =>
          prev.some(a => a.id === newAnalysis.id) ? prev : [newAnalysis, ...prev].slice(0, 50)
        );
      })
      .subscribe();

    return () => {
      supabase.removeChannel(alertChannel);
      supabase.removeChannel(analysisChannel);
    };
  }, [supabase]);

  // Auto-sync ERP data on startup, then poll for new messages every 2 min
  useEffect(() => {
    if (!isSupabaseConfigured) return;

    const fetchWithTimeout = (url: string, opts: RequestInit = {}, ms = 10000) => {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), ms);
      return fetch(url, { ...opts, signal: controller.signal }).finally(() => clearTimeout(timeout));
    };

    const syncAndIngest = async () => {
      try {
        // Sync employees/projects/tasks from ERPNext first (10s timeout)
        await fetchWithTimeout('/api/pipeline/sync', { method: 'POST' }, 10000);
        // Then ingest new Raven messages (10s timeout)
        await fetchWithTimeout('/api/pipeline/ingest', { method: 'POST' }, 10000);
        // Refresh UI state after pipeline runs
        await refreshData();
      } catch {
        // Silent fail — sync may time out but page should still load
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
    // Every 10 min: ingest only (reduced to ease Supabase load)
    const interval = setInterval(pollIngest, 600_000);
    return () => { clearTimeout(syncTimeout); clearInterval(interval); };
  }, [refreshData]);

  // Objective mutations
  const addObjective = async (data: Omit<Objective, 'id' | 'createdAt' | 'updatedAt' | 'subPoints'>) => {
    const newObj = await dalCreateObjective(supabase, {
      title: data.title,
      description: data.description,
      status: data.status,
      priority: data.priority,
      startDate: data.startDate,
      endDate: data.endDate,
      assigneeIds: data.assigneeIds,
    });
    setObjectives(prev => [newObj, ...prev]);
  };

  const updateObjective = async (id: string, updates: Partial<Objective>) => {
    await dalUpdateObjective(supabase, id, {
      title: updates.title,
      description: updates.description,
      status: updates.status,
      priority: updates.priority,
      startDate: updates.startDate,
      endDate: updates.endDate,
      assigneeIds: updates.assigneeIds,
    });
    setObjectives(prev =>
      prev.map(obj =>
        obj.id === id ? { ...obj, ...updates, updatedAt: new Date().toISOString() } : obj
      )
    );
  };

  const deleteObjective = async (id: string) => {
    await dalDeleteObjective(supabase, id);
    setObjectives(prev => prev.filter(obj => obj.id !== id));
  };

  // Task/SubPoint mutations
  const addSubPoint = async (objectiveId: string, subPoint: Omit<SubPoint, 'id' | 'createdAt' | 'updatedAt' | 'subPoints'>) => {
    const task = await dalCreateTask(supabase, {
      objectiveId,
      title: subPoint.title,
      description: subPoint.description,
      status: subPoint.status,
      assigneeId: subPoint.assigneeId || undefined,
      startDate: subPoint.startDate || undefined,
      endDate: subPoint.endDate || undefined,
    });
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
    await dalUpdateTask(supabase, subPointId, {
      title: updates.title,
      description: updates.description,
      status: updates.status,
      assigneeId: updates.assigneeId,
      startDate: updates.startDate,
      endDate: updates.endDate,
    });
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
    await dalDeleteTask(supabase, subPointId);
    setObjectives(prev =>
      prev.map(obj => ({
        ...obj,
        subPoints: obj.subPoints.filter(sp => sp.id !== subPointId),
      }))
    );
  };

  const addNestedSubPoint = async (objectiveId: string, parentSubPointId: string, subPoint: Omit<SubPoint, 'id' | 'createdAt' | 'updatedAt' | 'subPoints'>) => {
    const task = await dalCreateTask(supabase, {
      objectiveId,
      parentTaskId: parentSubPointId,
      title: subPoint.title,
      description: subPoint.description,
      status: subPoint.status,
      assigneeId: subPoint.assigneeId || undefined,
      startDate: subPoint.startDate || undefined,
      endDate: subPoint.endDate || undefined,
    });
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
    await dalUpdateTask(supabase, nestedSubPointId, {
      title: updates.title,
      description: updates.description,
      status: updates.status,
      assigneeId: updates.assigneeId,
      startDate: updates.startDate,
      endDate: updates.endDate,
    });
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
    await dalDeleteTask(supabase, nestedSubPointId);
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

  // Alert actions
  const markAlertAsRead = async (id: string) => {
    await dalMarkAlertRead(supabase, id);
    setAlerts(prev => prev.map(a => a.id === id ? { ...a, isRead: true } : a));
    setUnreadAlertCount(prev => Math.max(0, prev - 1));
  };

  const resolveAlertById = async (id: string) => {
    await dalResolveAlert(supabase, id);
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
