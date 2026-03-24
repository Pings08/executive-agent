export type DbStatus = 'not_started' | 'in_progress' | 'completed' | 'blocked';
export type DbPriority = 'low' | 'medium' | 'high' | 'critical';
export type MessageCategory = 'progress_update' | 'blocker' | 'question' | 'discussion' | 'decision' | 'general';
export type Sentiment = 'positive' | 'neutral' | 'negative' | 'frustrated' | 'stressed' | 'excited';
export type AlertType = 'blocker_detected' | 'slowdown' | 'missed_deadline' | 'sentiment_drop' | 'no_activity' | 'objective_at_risk';
export type AlertSeverity = 'low' | 'medium' | 'high' | 'critical';

import { Workspace } from './index';
export type { Workspace };

export interface DbEmployee {
  id: string;
  erp_id: string | null;
  name: string;
  email: string | null;
  role: string;
  avatar_url: string | null;
  status: string;
  date_of_joining: string | null;
  raven_user: string | null;
  workspace: Workspace | null;
  created_at: string;
  updated_at: string;
}

export interface DbObjective {
  id: string;
  erp_id: string | null;
  title: string;
  description: string;
  status: DbStatus;
  priority: DbPriority;
  start_date: string | null;
  end_date: string | null;
  progress_percentage: number;
  last_activity_at: string | null;
  ai_summary: string | null;
  created_at: string;
  updated_at: string;
}

export interface DbTask {
  id: string;
  objective_id: string;
  parent_task_id: string | null;
  erp_id: string | null;
  title: string;
  description: string;
  status: DbStatus;
  assignee_id: string | null;
  start_date: string | null;
  end_date: string | null;
  progress_percentage: number;
  created_at: string;
  updated_at: string;
}

export interface DbRavenMessage {
  id: string;
  raven_message_id: string;
  channel_id: string | null;
  channel_name: string | null;
  sender: string;
  content: string;
  message_type: string;
  raw_json: Record<string, unknown> | null;
  created_at: string;
  ingested_at: string;
  processed: boolean;
  employee_id: string | null;
}

export interface DbMessageAnalysis {
  id: string;
  raven_message_id: string;
  employee_id: string | null;
  related_objective_id: string | null;
  related_task_id: string | null;
  category: MessageCategory;
  sentiment: Sentiment;
  productivity_score: number | null;
  summary: string | null;
  key_topics: string[] | null;
  blocker_detected: boolean;
  blocker_description: string | null;
  raw_ai_response: Record<string, unknown> | null;
  created_at: string;
}

export interface DbAlert {
  id: string;
  type: AlertType;
  severity: AlertSeverity;
  title: string;
  description: string;
  employee_id: string | null;
  objective_id: string | null;
  task_id: string | null;
  message_analysis_id: string | null;
  is_read: boolean;
  is_resolved: boolean;
  resolved_at: string | null;
  created_at: string;
}

export interface DbDailyDigest {
  id: string;
  employee_id: string;
  digest_date: string;
  message_count: number;
  avg_sentiment_score: number | null;
  avg_productivity_score: number | null;
  overall_rating: number | null;
  topics: string[] | null;
  summary: string | null;
  daily_note: string | null;
  objective_progress: Record<string, unknown>[] | null;
  blockers_count: number;
  created_at: string;
}
