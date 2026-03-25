-- Executive Agent (EA) — Cloudflare D1 Schema (SQLite)
-- Apply with: wrangler d1 execute executive-agent-db --file=./d1/schema.sql

PRAGMA foreign_keys = ON;

-- ========================================
-- EMPLOYEES TABLE
-- ========================================
CREATE TABLE IF NOT EXISTS employees (
  id TEXT PRIMARY KEY,
  erp_id TEXT UNIQUE,
  name TEXT NOT NULL,
  email TEXT,
  role TEXT DEFAULT 'Employee',
  avatar_url TEXT,
  status TEXT DEFAULT 'active',
  date_of_joining TEXT,
  raven_user TEXT,
  workspace TEXT CHECK (workspace IN ('biotech', 'tcr', 'sentient_x')),
  raven_api_key TEXT,
  raven_api_secret TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_employees_erp_id ON employees(erp_id);
CREATE INDEX IF NOT EXISTS idx_employees_raven_user ON employees(raven_user);
CREATE INDEX IF NOT EXISTS idx_employees_status ON employees(status);

-- ========================================
-- OBJECTIVES TABLE
-- ========================================
CREATE TABLE IF NOT EXISTS objectives (
  id TEXT PRIMARY KEY,
  erp_id TEXT UNIQUE,
  title TEXT NOT NULL,
  description TEXT DEFAULT '',
  status TEXT NOT NULL DEFAULT 'not_started'
    CHECK (status IN ('not_started', 'in_progress', 'completed', 'blocked')),
  priority TEXT NOT NULL DEFAULT 'medium'
    CHECK (priority IN ('low', 'medium', 'high', 'critical')),
  start_date TEXT,
  end_date TEXT,
  progress_percentage INTEGER DEFAULT 0 CHECK (progress_percentage BETWEEN 0 AND 100),
  last_activity_at TEXT,
  ai_summary TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

-- ========================================
-- OBJECTIVE_ASSIGNEES (many-to-many)
-- ========================================
CREATE TABLE IF NOT EXISTS objective_assignees (
  objective_id TEXT REFERENCES objectives(id) ON DELETE CASCADE,
  employee_id TEXT REFERENCES employees(id) ON DELETE CASCADE,
  PRIMARY KEY (objective_id, employee_id)
);

-- ========================================
-- TASKS TABLE
-- ========================================
CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY,
  objective_id TEXT NOT NULL REFERENCES objectives(id) ON DELETE CASCADE,
  parent_task_id TEXT REFERENCES tasks(id) ON DELETE CASCADE,
  erp_id TEXT UNIQUE,
  title TEXT NOT NULL,
  description TEXT DEFAULT '',
  status TEXT NOT NULL DEFAULT 'not_started'
    CHECK (status IN ('not_started', 'in_progress', 'completed', 'blocked')),
  assignee_id TEXT REFERENCES employees(id) ON DELETE SET NULL,
  start_date TEXT,
  end_date TEXT,
  progress_percentage INTEGER DEFAULT 0 CHECK (progress_percentage BETWEEN 0 AND 100),
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_tasks_objective ON tasks(objective_id);
CREATE INDEX IF NOT EXISTS idx_tasks_assignee ON tasks(assignee_id);
CREATE INDEX IF NOT EXISTS idx_tasks_parent ON tasks(parent_task_id);

-- ========================================
-- RAVEN_MESSAGES TABLE
-- ========================================
CREATE TABLE IF NOT EXISTS raven_messages (
  id TEXT PRIMARY KEY,
  raven_message_id TEXT UNIQUE NOT NULL,
  channel_id TEXT,
  channel_name TEXT,
  sender TEXT NOT NULL,
  content TEXT NOT NULL,
  message_type TEXT DEFAULT 'text',
  raw_json TEXT,
  created_at TEXT NOT NULL,
  ingested_at TEXT DEFAULT (datetime('now')),
  processed INTEGER DEFAULT 0,
  employee_id TEXT REFERENCES employees(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_raven_messages_sender ON raven_messages(sender);
CREATE INDEX IF NOT EXISTS idx_raven_messages_created ON raven_messages(created_at);
CREATE INDEX IF NOT EXISTS idx_raven_messages_processed ON raven_messages(processed) WHERE processed = 0;
CREATE INDEX IF NOT EXISTS idx_raven_messages_raven_id ON raven_messages(raven_message_id);
CREATE INDEX IF NOT EXISTS idx_raven_messages_channel ON raven_messages(channel_id);
CREATE INDEX IF NOT EXISTS idx_raven_messages_employee ON raven_messages(employee_id);

-- ========================================
-- MESSAGE_ANALYSES TABLE
-- ========================================
CREATE TABLE IF NOT EXISTS message_analyses (
  id TEXT PRIMARY KEY,
  raven_message_id TEXT NOT NULL REFERENCES raven_messages(id) ON DELETE CASCADE,
  employee_id TEXT REFERENCES employees(id) ON DELETE SET NULL,
  related_objective_id TEXT REFERENCES objectives(id) ON DELETE SET NULL,
  related_task_id TEXT REFERENCES tasks(id) ON DELETE SET NULL,
  category TEXT NOT NULL DEFAULT 'general'
    CHECK (category IN ('progress_update', 'blocker', 'question', 'discussion', 'decision', 'general')),
  sentiment TEXT DEFAULT 'neutral'
    CHECK (sentiment IN ('positive', 'neutral', 'negative', 'frustrated', 'stressed', 'excited')),
  productivity_score INTEGER CHECK (productivity_score BETWEEN 1 AND 5),
  summary TEXT,
  key_topics TEXT,
  blocker_detected INTEGER DEFAULT 0,
  blocker_description TEXT,
  raw_ai_response TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_analyses_employee ON message_analyses(employee_id);
CREATE INDEX IF NOT EXISTS idx_analyses_objective ON message_analyses(related_objective_id);
CREATE INDEX IF NOT EXISTS idx_analyses_blocker ON message_analyses(blocker_detected) WHERE blocker_detected = 1;
CREATE INDEX IF NOT EXISTS idx_analyses_created ON message_analyses(created_at);

-- ========================================
-- ALERTS TABLE
-- ========================================
CREATE TABLE IF NOT EXISTS alerts (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL
    CHECK (type IN ('blocker_detected', 'slowdown', 'missed_deadline', 'sentiment_drop', 'no_activity', 'objective_at_risk')),
  severity TEXT NOT NULL DEFAULT 'medium'
    CHECK (severity IN ('low', 'medium', 'high', 'critical')),
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  employee_id TEXT REFERENCES employees(id) ON DELETE SET NULL,
  objective_id TEXT REFERENCES objectives(id) ON DELETE SET NULL,
  task_id TEXT REFERENCES tasks(id) ON DELETE SET NULL,
  message_analysis_id TEXT REFERENCES message_analyses(id) ON DELETE SET NULL,
  is_read INTEGER DEFAULT 0,
  is_resolved INTEGER DEFAULT 0,
  resolved_at TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_alerts_unread ON alerts(is_read) WHERE is_read = 0;
CREATE INDEX IF NOT EXISTS idx_alerts_unresolved ON alerts(is_resolved) WHERE is_resolved = 0;
CREATE INDEX IF NOT EXISTS idx_alerts_created ON alerts(created_at);

-- ========================================
-- DAILY_DIGESTS TABLE
-- ========================================
CREATE TABLE IF NOT EXISTS daily_digests (
  id TEXT PRIMARY KEY,
  employee_id TEXT NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  digest_date TEXT NOT NULL,
  message_count INTEGER DEFAULT 0,
  avg_sentiment_score REAL,
  avg_productivity_score REAL,
  overall_rating INTEGER CHECK (overall_rating BETWEEN 1 AND 10),
  topics TEXT,
  summary TEXT,
  daily_note TEXT,
  objective_progress TEXT DEFAULT '[]',
  blockers_count INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now')),
  UNIQUE(employee_id, digest_date)
);

CREATE INDEX IF NOT EXISTS idx_digests_date ON daily_digests(digest_date);
CREATE INDEX IF NOT EXISTS idx_digests_employee ON daily_digests(employee_id);

-- ========================================
-- PIPELINE_STATE TABLE
-- ========================================
CREATE TABLE IF NOT EXISTS pipeline_state (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT DEFAULT (datetime('now'))
);

INSERT OR IGNORE INTO pipeline_state (key, value) VALUES
  ('raven_last_sync', '{"last_message_creation":null,"last_sync_at":null}');

-- ========================================
-- COMPANY_SNAPSHOTS TABLE
-- ========================================
CREATE TABLE IF NOT EXISTS company_snapshots (
  id TEXT PRIMARY KEY,
  period_type TEXT NOT NULL CHECK (period_type IN ('day', 'week', 'month', 'year')),
  period_start TEXT NOT NULL,
  period_end TEXT NOT NULL,
  narrative TEXT NOT NULL DEFAULT '',
  key_themes TEXT DEFAULT '[]',
  objectives_snapshot TEXT DEFAULT '[]',
  blockers TEXT DEFAULT '[]',
  highlights TEXT DEFAULT '[]',
  message_count INTEGER DEFAULT 0,
  active_employee_count INTEGER DEFAULT 0,
  raw_ai_response TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  UNIQUE(period_type, period_start)
);

CREATE INDEX IF NOT EXISTS idx_snapshots_period ON company_snapshots(period_type, period_start);

-- ========================================
-- INFERRED_OBJECTIVES TABLE
-- ========================================
CREATE TABLE IF NOT EXISTS inferred_objectives (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT DEFAULT '',
  level TEXT NOT NULL DEFAULT 'operational' CHECK (level IN ('strategic', 'operational', 'tactical')),
  parent_id TEXT REFERENCES inferred_objectives(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'progressing', 'stalled', 'completed', 'abandoned', 'hypothesis')),
  first_seen_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  evidence_summary TEXT DEFAULT '',
  confidence_score REAL DEFAULT 0.5 CHECK (confidence_score BETWEEN 0 AND 1),
  source_snapshot_ids TEXT DEFAULT '[]',
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_inferred_obj_status ON inferred_objectives(status);
CREATE INDEX IF NOT EXISTS idx_inferred_obj_parent ON inferred_objectives(parent_id);
CREATE INDEX IF NOT EXISTS idx_inferred_obj_last_seen ON inferred_objectives(last_seen_at);
