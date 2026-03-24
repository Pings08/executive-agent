// =============================================
// UI / View Model Types (used by React components)
// =============================================
export type Status = 'not_started' | 'in_progress' | 'completed' | 'blocked';
export type Priority = 'low' | 'medium' | 'high' | 'critical';

export interface SubPoint {
  id: string;
  title: string;
  description: string;
  status: Status;
  startDate: string;
  endDate: string;
  assigneeId: string;
  progressPercentage?: number;
  createdAt: string;
  updatedAt: string;
  subPoints?: SubPoint[];
}

export interface Objective {
  id: string;
  title: string;
  description: string;
  status: Status;
  priority: Priority;
  startDate: string;
  endDate: string;
  assigneeIds: string[];
  subPoints: SubPoint[];
  progressPercentage?: number;
  lastActivityAt?: string;
  aiSummary?: string;
  createdAt: string;
  updatedAt: string;
}

export type Workspace = 'biotech' | 'tcr' | 'sentient_x';

export const WORKSPACE_LABELS: Record<Workspace, string> = {
  biotech: 'ExRNA / VVB',
  tcr: 'TCR',
  sentient_x: 'Sentient',
};

export const WORKSPACE_COLORS: Record<Workspace, string> = {
  biotech: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30',
  tcr: 'bg-purple-500/15 text-purple-400 border-purple-500/30',
  sentient_x: 'bg-cyan-500/15 text-cyan-400 border-cyan-500/30',
};

export interface Employee {
  id: string;
  name: string;
  email: string;
  role: string;
  avatar?: string;
  status?: string;
  ravenUser?: string;
  workspace?: Workspace;
  dateOfJoining?: string;
  createdAt: string;
}

export interface RavenMessage {
  id: string;
  ravenMessageId: string;
  channelId?: string;
  channelName?: string;
  sender: string;
  content: string;
  messageType: string;
  employeeId?: string;
  employeeName?: string;
  createdAt: string;
  processed: boolean;
}

export interface MessageAnalysis {
  id: string;
  ravenMessageId: string;
  employeeId?: string;
  employeeName?: string;
  relatedObjectiveId?: string;
  relatedObjectiveTitle?: string;
  relatedTaskId?: string;
  category: string;
  sentiment: string;
  productivityScore?: number;
  summary?: string;
  keyTopics?: string[];
  blockerDetected: boolean;
  blockerDescription?: string;
  messageContent?: string;
  createdAt: string;
}

export interface Alert {
  id: string;
  type: string;
  severity: string;
  title: string;
  description: string;
  employeeId?: string;
  employeeName?: string;
  objectiveId?: string;
  objectiveTitle?: string;
  isRead: boolean;
  isResolved: boolean;
  createdAt: string;
}

export interface ObjectiveProgressEntry {
  objectiveTitle: string | null;
  taskTitle: string | null;
  evidenceSummary: string;
  estimatedProgressPct: number;
  suggestedStatus: string | null;
}

export interface DailyDigest {
  id: string;
  employeeId: string;
  employeeName?: string;
  digestDate: string;
  messageCount: number;
  avgSentimentScore?: number;
  avgProductivityScore?: number;
  overallRating?: number;
  topics?: string[];
  summary?: string;
  dailyNote?: string;
  objectiveProgress?: ObjectiveProgressEntry[];
  blockersCount: number;
}

// Legacy types kept for backward compatibility during migration
export interface WorkUpdate {
  id: string;
  employeeId: string;
  objectiveId?: string;
  subPointId?: string;
  yesterday: string;
  today: string;
  challenges: string;
  blockers: string;
  createdAt: string;
}

export interface Note {
  id: string;
  employeeId: string;
  content: string;
  rating: number;
  createdAt: string;
  updateId?: string;
}

export interface SearchResult {
  id: string;
  title: string;
  snippet: string;
  url: string;
  savedTo?: string;
}

export interface AppState {
  objectives: Objective[];
  employees: Employee[];
  workUpdates: WorkUpdate[];
  notes: Note[];
  searchResults: SearchResult[];
}
