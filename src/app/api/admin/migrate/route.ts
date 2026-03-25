import { NextResponse } from 'next/server';
import { getDb } from '@/lib/d1/client';

/**
 * POST /api/admin/migrate
 * Runs D1 migrations: creates company_snapshots + inferred_objectives tables
 * and necessary indexes.
 *
 * D1 supports exec() for DDL statements directly — no need for RPC workarounds.
 */
export async function POST() {
  const db = getDb();
  const results: { step: string; ok: boolean; error?: string }[] = [];

  const ddlStatements = getMigrationDDL();

  for (const { step, sql } of ddlStatements) {
    try {
      await db.exec(sql);
      results.push({ step, ok: true });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      results.push({ step, ok: false, error: message });
    }
  }

  return NextResponse.json({
    success: results.every(r => r.ok),
    results,
  });
}

function getMigrationDDL() {
  return [
    {
      step: 'create_company_snapshots',
      sql: `
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
      `,
    },
    {
      step: 'create_snapshots_index',
      sql: `CREATE INDEX IF NOT EXISTS idx_snapshots_period ON company_snapshots(period_type, period_start DESC);`,
    },
    {
      step: 'create_inferred_objectives',
      sql: `
        CREATE TABLE IF NOT EXISTS inferred_objectives (
          id TEXT PRIMARY KEY,
          title TEXT NOT NULL,
          description TEXT DEFAULT '',
          level TEXT NOT NULL DEFAULT 'operational' CHECK (level IN ('strategic', 'operational', 'tactical')),
          parent_id TEXT REFERENCES inferred_objectives(id) ON DELETE SET NULL,
          status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'progressing', 'stalled', 'completed', 'abandoned')),
          first_seen_at TEXT NOT NULL,
          last_seen_at TEXT NOT NULL,
          evidence_summary TEXT DEFAULT '',
          confidence_score REAL DEFAULT 0.5,
          source_snapshot_ids TEXT DEFAULT '[]',
          created_at TEXT DEFAULT (datetime('now')),
          updated_at TEXT DEFAULT (datetime('now'))
        );
      `,
    },
    {
      step: 'create_obj_indexes',
      sql: `
        CREATE INDEX IF NOT EXISTS idx_inferred_obj_status ON inferred_objectives(status);
        CREATE INDEX IF NOT EXISTS idx_inferred_obj_parent ON inferred_objectives(parent_id);
        CREATE INDEX IF NOT EXISTS idx_inferred_obj_last_seen ON inferred_objectives(last_seen_at DESC);
      `,
    },
  ];
}
