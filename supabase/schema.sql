-- Executive Agent (EA) — Supabase Schema
-- Run this in Supabase SQL Editor to create all tables

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ========================================
-- EMPLOYEES TABLE
-- ========================================
CREATE TABLE employees (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  erp_id TEXT UNIQUE,
  name TEXT NOT NULL,
  email TEXT,
  role TEXT DEFAULT 'Employee',
  avatar_url TEXT,
  status TEXT DEFAULT 'active',
  date_of_joining DATE,
  raven_user TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_employees_erp_id ON employees(erp_id);
CREATE INDEX idx_employees_raven_user ON employees(raven_user);

-- ========================================
-- OBJECTIVES TABLE
-- ========================================
CREATE TABLE objectives (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  erp_id TEXT UNIQUE,
  title TEXT NOT NULL,
  description TEXT DEFAULT '',
  status TEXT NOT NULL DEFAULT 'not_started'
    CHECK (status IN ('not_started', 'in_progress', 'completed', 'blocked')),
  priority TEXT NOT NULL DEFAULT 'medium'
    CHECK (priority IN ('low', 'medium', 'high', 'critical')),
  start_date DATE,
  end_date DATE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ========================================
-- OBJECTIVE_ASSIGNEES (many-to-many)
-- ========================================
CREATE TABLE objective_assignees (
  objective_id UUID REFERENCES objectives(id) ON DELETE CASCADE,
  employee_id UUID REFERENCES employees(id) ON DELETE CASCADE,
  PRIMARY KEY (objective_id, employee_id)
);

-- ========================================
-- TASKS TABLE (replaces SubPoints)
-- ========================================
CREATE TABLE tasks (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  objective_id UUID NOT NULL REFERENCES objectives(id) ON DELETE CASCADE,
  parent_task_id UUID REFERENCES tasks(id) ON DELETE CASCADE,
  erp_id TEXT UNIQUE,
  title TEXT NOT NULL,
  description TEXT DEFAULT '',
  status TEXT NOT NULL DEFAULT 'not_started'
    CHECK (status IN ('not_started', 'in_progress', 'completed', 'blocked')),
  assignee_id UUID REFERENCES employees(id) ON DELETE SET NULL,
  start_date DATE,
  end_date DATE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_tasks_objective ON tasks(objective_id);
CREATE INDEX idx_tasks_assignee ON tasks(assignee_id);
CREATE INDEX idx_tasks_parent ON tasks(parent_task_id);

-- ========================================
-- RAVEN_MESSAGES TABLE (raw message store)
-- ========================================
CREATE TABLE raven_messages (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  raven_message_id TEXT UNIQUE NOT NULL,
  channel_id TEXT,
  channel_name TEXT,
  sender TEXT NOT NULL,
  content TEXT NOT NULL,
  message_type TEXT DEFAULT 'text',
  raw_json JSONB,
  created_at TIMESTAMPTZ NOT NULL,
  ingested_at TIMESTAMPTZ DEFAULT NOW(),
  processed BOOLEAN DEFAULT FALSE,
  employee_id UUID REFERENCES employees(id) ON DELETE SET NULL
);

CREATE INDEX idx_raven_messages_sender ON raven_messages(sender);
CREATE INDEX idx_raven_messages_created ON raven_messages(created_at DESC);
CREATE INDEX idx_raven_messages_processed ON raven_messages(processed) WHERE processed = FALSE;
CREATE INDEX idx_raven_messages_raven_id ON raven_messages(raven_message_id);

-- ========================================
-- MESSAGE_ANALYSES TABLE (AI analysis results)
-- ========================================
CREATE TABLE message_analyses (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  raven_message_id UUID NOT NULL REFERENCES raven_messages(id) ON DELETE CASCADE,
  employee_id UUID REFERENCES employees(id) ON DELETE SET NULL,
  related_objective_id UUID REFERENCES objectives(id) ON DELETE SET NULL,
  related_task_id UUID REFERENCES tasks(id) ON DELETE SET NULL,
  category TEXT NOT NULL DEFAULT 'general'
    CHECK (category IN ('progress_update', 'blocker', 'question', 'discussion', 'decision', 'general')),
  sentiment TEXT DEFAULT 'neutral'
    CHECK (sentiment IN ('positive', 'neutral', 'negative', 'frustrated', 'stressed', 'excited')),
  productivity_score INTEGER CHECK (productivity_score BETWEEN 1 AND 5),
  summary TEXT,
  key_topics TEXT[],
  blocker_detected BOOLEAN DEFAULT FALSE,
  blocker_description TEXT,
  raw_ai_response JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_analyses_employee ON message_analyses(employee_id);
CREATE INDEX idx_analyses_objective ON message_analyses(related_objective_id);
CREATE INDEX idx_analyses_blocker ON message_analyses(blocker_detected) WHERE blocker_detected = TRUE;
CREATE INDEX idx_analyses_created ON message_analyses(created_at DESC);

-- ========================================
-- ALERTS TABLE
-- ========================================
CREATE TABLE alerts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  type TEXT NOT NULL
    CHECK (type IN ('blocker_detected', 'slowdown', 'missed_deadline', 'sentiment_drop', 'no_activity', 'objective_at_risk')),
  severity TEXT NOT NULL DEFAULT 'medium'
    CHECK (severity IN ('low', 'medium', 'high', 'critical')),
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  employee_id UUID REFERENCES employees(id) ON DELETE SET NULL,
  objective_id UUID REFERENCES objectives(id) ON DELETE SET NULL,
  task_id UUID REFERENCES tasks(id) ON DELETE SET NULL,
  message_analysis_id UUID REFERENCES message_analyses(id) ON DELETE SET NULL,
  is_read BOOLEAN DEFAULT FALSE,
  is_resolved BOOLEAN DEFAULT FALSE,
  resolved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_alerts_unread ON alerts(is_read) WHERE is_read = FALSE;
CREATE INDEX idx_alerts_unresolved ON alerts(is_resolved) WHERE is_resolved = FALSE;
CREATE INDEX idx_alerts_created ON alerts(created_at DESC);
CREATE INDEX idx_alerts_severity ON alerts(severity);

-- ========================================
-- DAILY_DIGESTS TABLE
-- ========================================
CREATE TABLE daily_digests (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  digest_date DATE NOT NULL,
  message_count INTEGER DEFAULT 0,
  avg_sentiment_score NUMERIC(3,2),
  avg_productivity_score NUMERIC(3,2),
  topics TEXT[],
  summary TEXT,
  blockers_count INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(employee_id, digest_date)
);

CREATE INDEX idx_digests_date ON daily_digests(digest_date DESC);
CREATE INDEX idx_digests_employee ON daily_digests(employee_id);

-- ========================================
-- PIPELINE_STATE TABLE
-- ========================================
CREATE TABLE pipeline_state (
  key TEXT PRIMARY KEY,
  value JSONB NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

INSERT INTO pipeline_state (key, value) VALUES
  ('raven_last_sync', '{"last_message_creation": null, "last_sync_at": null}'::jsonb);

-- ========================================
-- ROW LEVEL SECURITY
-- ========================================
ALTER TABLE employees ENABLE ROW LEVEL SECURITY;
ALTER TABLE objectives ENABLE ROW LEVEL SECURITY;
ALTER TABLE objective_assignees ENABLE ROW LEVEL SECURITY;
ALTER TABLE tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE raven_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE message_analyses ENABLE ROW LEVEL SECURITY;
ALTER TABLE alerts ENABLE ROW LEVEL SECURITY;
ALTER TABLE daily_digests ENABLE ROW LEVEL SECURITY;
ALTER TABLE pipeline_state ENABLE ROW LEVEL SECURITY;

-- Anon key: read all tables
CREATE POLICY "anon_read_employees" ON employees FOR SELECT USING (true);
CREATE POLICY "anon_read_objectives" ON objectives FOR SELECT USING (true);
CREATE POLICY "anon_read_objective_assignees" ON objective_assignees FOR SELECT USING (true);
CREATE POLICY "anon_read_tasks" ON tasks FOR SELECT USING (true);
CREATE POLICY "anon_read_raven_messages" ON raven_messages FOR SELECT USING (true);
CREATE POLICY "anon_read_message_analyses" ON message_analyses FOR SELECT USING (true);
CREATE POLICY "anon_read_alerts" ON alerts FOR SELECT USING (true);
CREATE POLICY "anon_read_daily_digests" ON daily_digests FOR SELECT USING (true);

-- Anon key: write objectives, tasks, assignees (CEO manages these)
CREATE POLICY "anon_write_objectives" ON objectives FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "anon_write_objective_assignees" ON objective_assignees FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "anon_write_tasks" ON tasks FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "anon_write_alerts" ON alerts FOR UPDATE USING (true) WITH CHECK (true);

-- ========================================
-- UPDATED_AT TRIGGER
-- ========================================
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER employees_updated BEFORE UPDATE ON employees FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER objectives_updated BEFORE UPDATE ON objectives FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER tasks_updated BEFORE UPDATE ON tasks FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ========================================
-- REALTIME
-- ========================================
ALTER PUBLICATION supabase_realtime ADD TABLE alerts;
ALTER PUBLICATION supabase_realtime ADD TABLE message_analyses;
ALTER PUBLICATION supabase_realtime ADD TABLE raven_messages;
ALTER PUBLICATION supabase_realtime ADD TABLE daily_digests;

-- ========================================
-- MIGRATION: AI Agent Enhancements
-- Run these ALTER statements in Supabase SQL Editor if upgrading an existing database
-- ========================================
ALTER TABLE daily_digests
  ADD COLUMN IF NOT EXISTS overall_rating SMALLINT CHECK (overall_rating BETWEEN 1 AND 10),
  ADD COLUMN IF NOT EXISTS daily_note TEXT,
  ADD COLUMN IF NOT EXISTS objective_progress JSONB DEFAULT '[]';

ALTER TABLE objectives
  ADD COLUMN IF NOT EXISTS progress_percentage INTEGER DEFAULT 0
    CHECK (progress_percentage BETWEEN 0 AND 100),
  ADD COLUMN IF NOT EXISTS last_activity_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS ai_summary TEXT;

ALTER TABLE tasks
  ADD COLUMN IF NOT EXISTS progress_percentage INTEGER DEFAULT 0
    CHECK (progress_percentage BETWEEN 0 AND 100);

-- ========================================
-- MIGRATION: Workspace categorization
-- Run in Supabase SQL Editor
-- ========================================
ALTER TABLE employees
  ADD COLUMN IF NOT EXISTS workspace TEXT
    CHECK (workspace IN ('biotech', 'tcr', 'sentient_x'));

-- ========================================
-- MIGRATION: Company-Level Synthesis
-- Run in Supabase SQL Editor
-- ========================================

CREATE TABLE IF NOT EXISTS company_snapshots (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  period_type TEXT NOT NULL CHECK (period_type IN ('day', 'week', 'month', 'year')),
  period_start DATE NOT NULL,
  period_end DATE NOT NULL,
  narrative TEXT NOT NULL DEFAULT '',
  key_themes TEXT[] DEFAULT '{}',
  objectives_snapshot JSONB DEFAULT '[]',
  blockers JSONB DEFAULT '[]',
  highlights JSONB DEFAULT '[]',
  message_count INTEGER DEFAULT 0,
  active_employee_count INTEGER DEFAULT 0,
  raw_ai_response JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(period_type, period_start)
);

CREATE INDEX IF NOT EXISTS idx_snapshots_period ON company_snapshots(period_type, period_start DESC);
CREATE TRIGGER snapshots_updated BEFORE UPDATE ON company_snapshots FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TABLE IF NOT EXISTS inferred_objectives (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  title TEXT NOT NULL,
  description TEXT DEFAULT '',
  level TEXT NOT NULL DEFAULT 'operational' CHECK (level IN ('strategic', 'operational', 'tactical')),
  parent_id UUID REFERENCES inferred_objectives(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'progressing', 'stalled', 'completed', 'abandoned')),
  first_seen_at DATE NOT NULL,
  last_seen_at DATE NOT NULL,
  evidence_summary TEXT DEFAULT '',
  confidence_score NUMERIC(3,2) DEFAULT 0.5 CHECK (confidence_score BETWEEN 0 AND 1),
  source_snapshot_ids UUID[] DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_inferred_obj_status ON inferred_objectives(status);
CREATE INDEX IF NOT EXISTS idx_inferred_obj_parent ON inferred_objectives(parent_id);
CREATE INDEX IF NOT EXISTS idx_inferred_obj_last_seen ON inferred_objectives(last_seen_at DESC);
CREATE TRIGGER inferred_objectives_updated BEFORE UPDATE ON inferred_objectives FOR EACH ROW EXECUTE FUNCTION update_updated_at();

ALTER TABLE company_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE inferred_objectives ENABLE ROW LEVEL SECURITY;
CREATE POLICY "anon_read_company_snapshots" ON company_snapshots FOR SELECT USING (true);
CREATE POLICY "anon_read_inferred_objectives" ON inferred_objectives FOR SELECT USING (true);
ALTER PUBLICATION supabase_realtime ADD TABLE company_snapshots;
