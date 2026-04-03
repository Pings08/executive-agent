import { buildAnalysisPrompt, buildDailySummaryPrompt, buildEODDigestPrompt, buildDailyNotePrompt, buildDaySynthesisPrompt, buildWeekRollupPrompt, buildObjectiveExtractionPrompt, buildMonthlySynthesisPrompt, buildEmployeeTrajectoryPrompt } from './prompts';

/**
 * Direct Gemini REST API client — replaces @google/generative-ai SDK
 * which doesn't work in Cloudflare Workers runtime.
 */
const GEMINI_MODEL = 'gemini-2.0-flash';
const GEMINI_API_URL = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;

async function generateContent(prompt: string): Promise<string> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('GEMINI_API_KEY not set');

  const res = await fetch(`${GEMINI_API_URL}?key=${apiKey}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.7, maxOutputTokens: 8192 },
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Gemini API error ${res.status}: ${err}`);
  }

  const data = await res.json() as {
    candidates?: { content?: { parts?: { text?: string }[] } }[];
  };
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error('No text in Gemini response');
  return text;
}

export interface EmployeeContext {
  recentSummaries: { date: string; summary: string; productivityScore: number; category: string }[];
  knownBlockers: { description: string; count: number; firstSeen: string; lastSeen: string }[];
  avgProductivityScore: number;
  topTopics: string[];
}

export interface AnalysisResult {
  category: string;
  sentiment: string;
  productivityScore: number;
  summary: string;
  keyTopics: string[];
  blockerDetected: boolean;
  blockerDescription: string | null;
  relatedObjectiveTitle: string | null;
  relatedTaskTitle: string | null;
}

export interface DigestResult {
  summary: string;
  avgSentimentScore: number;
  avgProductivityScore: number;
  topics: string[];
  blockersCount: number;
}

export interface EODBlocker {
  description: string;
  severity: 'low' | 'medium' | 'high';
  messageExcerpt: string;
}

export interface EODObjectiveProgress {
  objectiveTitle: string;
  progressMade: boolean;
  evidence: string;
  suggestedStatus: string | null;
}

export interface ObjectiveUpdate {
  objectiveTitle: string | null;
  taskTitle: string | null;
  evidenceSummary: string;
  estimatedProgressPct: number;  // delta for today (0-25)
  suggestedStatus: string | null; // 'in_progress' | 'blocked' | null
}

export interface DailyNoteResult {
  narrativeNote: string;           // human-readable day summary
  objectiveProgress: ObjectiveUpdate[];
}

export interface EODDigestResult {
  overallRating: number;        // 1-10: holistic day quality
  productivityScore: number;    // 1-5: productivity score
  sentimentScore: number;       // -1 to 1
  summary: string;              // 3-5 sentence CEO-facing summary
  keyTopics: string[];
  blockers: EODBlocker[];
  objectiveProgress: EODObjectiveProgress[];
  blockersCount: number;
}

function parseJSON<T>(text: string): T {
  // Extract JSON from potential markdown code blocks
  const jsonMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/) || [null, text];
  const cleaned = (jsonMatch[1] || text).trim();
  return JSON.parse(cleaned);
}

async function callWithRetry(
  fn: () => Promise<string>,
  retries = 3
): Promise<string> {
  for (let i = 0; i < retries; i++) {
    try {
      return await fn();
    } catch (err: unknown) {
      const status = typeof err === 'object' && err !== null && 'status' in err
        ? (err as { status: number }).status : 0;
      const msg = err instanceof Error ? err.message : '';

      const is429 = status === 429 || msg.includes('429') || msg.includes('rate_limit') || msg.includes('quota');
      const is5xx = status >= 500 || msg.includes('500') || msg.includes('503') || msg.includes('overloaded');

      if ((is429 || is5xx) && i < retries - 1) {
        const waitMs = is429 ? 15_000 * (i + 1) : 1500 * Math.pow(2, i);
        await new Promise(r => setTimeout(r, waitMs));
        continue;
      }
      throw err;
    }
  }
  throw new Error('Max retries exceeded');
}

export async function analyzeMessage(
  messageContent: string,
  senderName: string,
  channelName: string | null,
  objectives: { title: string; description: string; tasks: string[] }[],
  recentContext: { sender: string; content: string; timestamp: string }[],
  employeeContext?: EmployeeContext
): Promise<AnalysisResult> {
  const prompt = buildAnalysisPrompt(messageContent, senderName, channelName, objectives, recentContext, employeeContext);

  const text = await callWithRetry(async () => {
    return await generateContent(prompt);
  });

  const result = parseJSON<AnalysisResult>(text);

  return {
    category: result.category || 'general',
    sentiment: result.sentiment || 'neutral',
    productivityScore: Math.min(5, Math.max(1, result.productivityScore || 3)),
    summary: result.summary || 'No summary generated.',
    keyTopics: result.keyTopics || [],
    blockerDetected: result.blockerDetected || false,
    blockerDescription: result.blockerDescription || null,
    relatedObjectiveTitle: result.relatedObjectiveTitle || null,
    relatedTaskTitle: result.relatedTaskTitle || null,
  };
}

export async function generateDailySummary(
  employeeName: string,
  messages: { content: string; timestamp: string; category: string; sentiment: string }[],
  analyses: { summary: string; category: string; sentiment: string; productivityScore: number }[]
): Promise<DigestResult> {
  const prompt = buildDailySummaryPrompt(employeeName, messages, analyses);

  const text = await callWithRetry(async () => {
    return await generateContent(prompt);
  });

  const result = parseJSON<DigestResult>(text);

  return {
    summary: result.summary || 'No summary generated.',
    avgSentimentScore: result.avgSentimentScore || 0,
    avgProductivityScore: result.avgProductivityScore || 3,
    topics: result.topics || [],
    blockersCount: result.blockersCount || 0,
  };
}

// Generates a factual daily note per employee + objective/task progress attribution.
// Distinct from generateEODDigest: this is employee-readable, not CEO-verdict style.
export async function generateEmployeeDailyNote(
  employeeName: string,
  messages: { content: string; timestamp: string; channel: string | null }[],
  analyses: {
    summary: string;
    relatedObjectiveTitle: string | null;
    relatedTaskTitle: string | null;
    productivityScore: number;
    blockerDetected: boolean;
    blockerDescription: string | null;
  }[],
  objectives: {
    title: string;
    description: string;
    status: string;
    tasks: { title: string; status: string; progress_percentage: number }[];
  }[]
): Promise<DailyNoteResult> {
  const prompt = buildDailyNotePrompt(employeeName, messages, analyses, objectives);

  const text = await callWithRetry(async () => {
    return await generateContent(prompt);
  });

  const result = parseJSON<DailyNoteResult>(text);

  return {
    narrativeNote: result.narrativeNote || 'No daily note generated.',
    objectiveProgress: Array.isArray(result.objectiveProgress)
      ? result.objectiveProgress.map(p => ({
          objectiveTitle: p.objectiveTitle || null,
          taskTitle: p.taskTitle || null,
          evidenceSummary: p.evidenceSummary || '',
          estimatedProgressPct: Math.min(25, Math.max(0, Math.round(p.estimatedProgressPct || 0))),
          suggestedStatus: p.suggestedStatus || null,
        }))
      : [],
  };
}

// Generates a structured End-of-Day report for a single employee covering
// their entire day's communication: rating, blockers, objective progress.
export async function generateEODDigest(
  employeeName: string,
  messages: { content: string; timestamp: string; channel: string | null }[],
  analyses: {
    summary: string;
    category: string;
    sentiment: string;
    productivityScore: number;
    blockerDetected: boolean;
    blockerDescription: string | null;
    relatedObjectiveTitle: string | null;
  }[],
  objectives: {
    title: string;
    description: string;
    status: string;
    tasks: { title: string; status: string }[];
  }[]
): Promise<EODDigestResult> {
  const prompt = buildEODDigestPrompt(employeeName, messages, analyses, objectives);

  const text = await callWithRetry(async () => {
    return await generateContent(prompt);
  });

  const result = parseJSON<EODDigestResult>(text);

  return {
    overallRating: Math.min(10, Math.max(1, Math.round(result.overallRating || 5))),
    productivityScore: Math.min(5, Math.max(1, Math.round(result.productivityScore || 3))),
    sentimentScore: Math.min(1, Math.max(-1, result.sentimentScore ?? 0)),
    summary: result.summary || 'No summary generated.',
    keyTopics: Array.isArray(result.keyTopics) ? result.keyTopics : [],
    blockers: Array.isArray(result.blockers) ? result.blockers.map(b => ({
      description: b.description || '',
      severity: (['low', 'medium', 'high'].includes(b.severity) ? b.severity : 'medium') as 'low' | 'medium' | 'high',
      messageExcerpt: b.messageExcerpt || '',
    })) : [],
    objectiveProgress: Array.isArray(result.objectiveProgress) ? result.objectiveProgress.map(p => ({
      objectiveTitle: p.objectiveTitle || '',
      progressMade: Boolean(p.progressMade),
      evidence: p.evidence || '',
      suggestedStatus: p.suggestedStatus || null,
    })) : [],
    blockersCount: Math.max(0, result.blockersCount || 0),
  };
}

// ============================================================
// COMPANY-LEVEL SYNTHESIS
// ============================================================

export interface HypothesisDetected {
  title: string;
  description: string;
  stage: 'ideation' | 'research' | 'testing' | 'transitioning_to_objective';
  evidence: string;
  related_employee_names: string[];
  workspace_tag?: string;
}

export interface ProposedObjective {
  title: string;
  reason: string;
  triggered_by: string;
  priority: 'high' | 'medium' | 'low';
}

export interface PerformanceScore {
  employee_name: string;
  performance_score: number;
  contribution_summary: string;
}

export interface CompanySynthesisResult {
  narrative: string;
  employee_narrative?: string;
  key_themes: string[];
  objectives_snapshot: {
    title: string;
    level: string;
    description: string;
    objective_status?: string;
    status_signal: string;
    evidence: string;
    confidence: number;
    related_employee_names: string[];
    workspace_tag?: string;
  }[];
  hypotheses_detected?: HypothesisDetected[];
  proposed_objectives?: ProposedObjective[];
  performance_scores?: PerformanceScore[];
  blockers: {
    description: string;
    severity: string;
    affected_area: string;
    mentioned_by: string[];
    first_excerpt?: string;
    chronic?: boolean;
  }[];
  highlights: { description: string; employee_name: string | null }[];
}

export interface ObjectiveHierarchyResult {
  objectives: {
    title: string;
    level: string;
    description: string;
    status: string;
    confidence: number;
    evidence_summary: string;
    children: {
      title: string;
      level: string;
      description: string;
      status: string;
      confidence: number;
      evidence_summary: string;
    }[];
  }[];
}

export async function synthesizeCompanyDay(
  date: string,
  messages: { employeeName: string; channel: string | null; content: string; time: string }[],
  allEmployeeNames: string[]
): Promise<CompanySynthesisResult> {
  const prompt = buildDaySynthesisPrompt(date, messages, allEmployeeNames);
  const text = await callWithRetry(async () => {
    return await generateContent(prompt);
  });
  const r = parseJSON<CompanySynthesisResult & { objectives_in_progress?: CompanySynthesisResult['objectives_snapshot'] }>(text);
  return {
    narrative: r.narrative || '',
    employee_narrative: r.employee_narrative || '',
    key_themes: Array.isArray(r.key_themes) ? r.key_themes : [],
    objectives_snapshot: Array.isArray(r.objectives_in_progress) ? r.objectives_in_progress
      : Array.isArray(r.objectives_snapshot) ? r.objectives_snapshot : [],
    hypotheses_detected: Array.isArray(r.hypotheses_detected) ? r.hypotheses_detected : [],
    proposed_objectives: Array.isArray(r.proposed_objectives) ? r.proposed_objectives : [],
    performance_scores: Array.isArray(r.performance_scores) ? r.performance_scores : [],
    blockers: Array.isArray(r.blockers) ? r.blockers : [],
    highlights: Array.isArray(r.highlights) ? r.highlights : [],
  };
}

export async function synthesizeCompanyWeek(
  weekStart: string,
  weekEnd: string,
  daySnapshots: { date: string; narrative: string; key_themes: string[]; message_count: number }[]
): Promise<CompanySynthesisResult> {
  const prompt = buildWeekRollupPrompt(weekStart, weekEnd, daySnapshots);
  const text = await callWithRetry(async () => {
    return await generateContent(prompt);
  });
  const r = parseJSON<CompanySynthesisResult & { objectives_in_progress?: CompanySynthesisResult['objectives_snapshot'] }>(text);
  return {
    narrative: r.narrative || '',
    employee_narrative: r.employee_narrative || '',
    key_themes: Array.isArray(r.key_themes) ? r.key_themes : [],
    objectives_snapshot: Array.isArray(r.objectives_in_progress) ? r.objectives_in_progress
      : Array.isArray(r.objectives_snapshot) ? r.objectives_snapshot : [],
    hypotheses_detected: Array.isArray(r.hypotheses_detected) ? r.hypotheses_detected : [],
    proposed_objectives: Array.isArray(r.proposed_objectives) ? r.proposed_objectives : [],
    performance_scores: Array.isArray(r.performance_scores) ? r.performance_scores : [],
    blockers: Array.isArray(r.blockers) ? r.blockers : [],
    highlights: Array.isArray(r.highlights) ? r.highlights : [],
  };
}

export async function extractObjectiveHierarchy(
  snapshots: { date: string; narrative: string }[],
  existingObjectives: { title: string; level: string; status: string; last_seen_at: string }[]
): Promise<ObjectiveHierarchyResult> {
  const prompt = buildObjectiveExtractionPrompt(snapshots, existingObjectives);
  const text = await callWithRetry(async () => {
    return await generateContent(prompt);
  });
  const r = parseJSON<ObjectiveHierarchyResult>(text);
  return { objectives: Array.isArray(r.objectives) ? r.objectives : [] };
}

// ============================================================
// MONTHLY SYNTHESIS
// ============================================================

export interface MonthlySynthesisResult {
  monthly_narrative: string;
  employee_narrative?: string;
  key_themes: string[];
  weekly_breakdowns: {
    week_number: number;
    week_start: string;
    week_end: string;
    narrative: string;
    key_themes: string[];
    highlights: { description: string; employee_name: string | null }[];
  }[];
  daily_highlights: {
    date: string;
    headline: string;
    notable_events: string[];
  }[];
  objectives_snapshot: {
    title: string;
    level: string;
    description: string;
    objective_status?: string;
    status_signal: string;
    evidence: string;
    confidence: number;
    related_employee_names: string[];
    workspace_tag?: string;
  }[];
  hypotheses_detected?: HypothesisDetected[];
  performance_scores?: PerformanceScore[];
  blockers: {
    description: string;
    severity: string;
    affected_area: string;
    mentioned_by: string[];
    chronic: boolean;
  }[];
  highlights: { description: string; employee_name: string | null }[];
}

export interface EmployeeTrajectory {
  email: string;
  name: string;
  monthly_summary: string;
  performance_score?: number;
  productivity_pattern: string;
  primary_projects: string[];
  key_contributions?: string[];
  daily_log: {
    date: string;
    message_count: number;
    topics: string[];
    highlights: string[];
    blockers_raised: string[];
  }[];
  weekly_patterns: {
    week_number: number;
    active_days: number;
    message_count: number;
    primary_focus: string;
    assessment: string;
  }[];
  objectives_contributed_to?: string[];
  hypotheses_contributed_to?: string[];
  orphaned_objectives: string[];
  completion_rate: number;
  switching_frequency: number;
  todos: string[];
}

export async function synthesizeCompanyMonth(
  month: string,
  orgLabel: string,
  messages: { employeeName: string; channel: string | null; content: string; date: string; time: string }[],
  allEmployeeNames: string[]
): Promise<MonthlySynthesisResult> {
  const prompt = buildMonthlySynthesisPrompt(month, orgLabel, messages, allEmployeeNames);
  const text = await callWithRetry(async () => {
    return await generateContent(prompt);
  });
  const r = parseJSON<MonthlySynthesisResult>(text);
  return {
    monthly_narrative: r.monthly_narrative || '',
    employee_narrative: r.employee_narrative || '',
    key_themes: Array.isArray(r.key_themes) ? r.key_themes : [],
    weekly_breakdowns: Array.isArray(r.weekly_breakdowns)
      ? r.weekly_breakdowns.map(w => ({
          week_number: w.week_number || 1,
          week_start: w.week_start || '',
          week_end: w.week_end || '',
          narrative: w.narrative || '',
          key_themes: Array.isArray(w.key_themes) ? w.key_themes : [],
          highlights: Array.isArray(w.highlights)
            ? w.highlights.map(h => ({
                description: h.description || '',
                employee_name: h.employee_name || null,
              }))
            : [],
        }))
      : [],
    daily_highlights: Array.isArray(r.daily_highlights)
      ? r.daily_highlights.map(d => ({
          date: d.date || '',
          headline: d.headline || '',
          notable_events: Array.isArray(d.notable_events) ? d.notable_events : [],
        }))
      : [],
    objectives_snapshot: Array.isArray(r.objectives_snapshot)
      ? r.objectives_snapshot.map(o => ({
          title: o.title || '',
          level: o.level || 'operational',
          description: o.description || '',
          objective_status: o.objective_status || undefined,
          status_signal: o.status_signal || 'active',
          evidence: o.evidence || '',
          confidence: Math.min(1, Math.max(0, o.confidence ?? 0.5)),
          related_employee_names: Array.isArray(o.related_employee_names) ? o.related_employee_names : [],
          workspace_tag: o.workspace_tag || undefined,
        }))
      : [],
    hypotheses_detected: Array.isArray(r.hypotheses_detected) ? r.hypotheses_detected : [],
    performance_scores: Array.isArray(r.performance_scores) ? r.performance_scores : [],
    blockers: Array.isArray(r.blockers)
      ? r.blockers.map(b => ({
          description: b.description || '',
          severity: b.severity || 'medium',
          affected_area: b.affected_area || '',
          mentioned_by: Array.isArray(b.mentioned_by) ? b.mentioned_by : [],
          chronic: Boolean(b.chronic),
        }))
      : [],
    highlights: Array.isArray(r.highlights)
      ? r.highlights.map(h => ({
          description: h.description || '',
          employee_name: h.employee_name || null,
        }))
      : [],
  };
}

// ============================================================
// EMPLOYEE TRAJECTORIES
// ============================================================

export async function computeMonthlyTrajectories(
  month: string,
  orgLabel: string,
  employees: {
    name: string;
    email: string;
    messages: { date: string; time: string; channel: string | null; content: string }[];
  }[]
): Promise<EmployeeTrajectory[]> {
  const prompt = buildEmployeeTrajectoryPrompt(month, orgLabel, employees);
  const text = await callWithRetry(async () => {
    return await generateContent(prompt);
  });
  const r = parseJSON<{ employees: EmployeeTrajectory[] }>(text);
  const trajectories = Array.isArray(r.employees) ? r.employees : [];
  return trajectories.map(t => ({
    email: t.email || '',
    name: t.name || '',
    monthly_summary: t.monthly_summary || '',
    performance_score: typeof t.performance_score === 'number' ? Math.min(10, Math.max(1, t.performance_score)) : undefined,
    productivity_pattern: ['consistent', 'declining', 'improving', 'sporadic'].includes(t.productivity_pattern)
      ? t.productivity_pattern
      : 'sporadic',
    primary_projects: Array.isArray(t.primary_projects) ? t.primary_projects : [],
    key_contributions: Array.isArray(t.key_contributions) ? t.key_contributions : [],
    daily_log: Array.isArray(t.daily_log)
      ? t.daily_log.map(d => ({
          date: d.date || '',
          message_count: Math.max(0, d.message_count || 0),
          topics: Array.isArray(d.topics) ? d.topics : [],
          highlights: Array.isArray(d.highlights) ? d.highlights : [],
          blockers_raised: Array.isArray(d.blockers_raised) ? d.blockers_raised : [],
        }))
      : [],
    weekly_patterns: Array.isArray(t.weekly_patterns)
      ? t.weekly_patterns.map(w => ({
          week_number: w.week_number || 1,
          active_days: Math.max(0, w.active_days || 0),
          message_count: Math.max(0, w.message_count || 0),
          primary_focus: w.primary_focus || '',
          assessment: w.assessment || '',
        }))
      : [],
    objectives_contributed_to: Array.isArray(t.objectives_contributed_to) ? t.objectives_contributed_to : [],
    hypotheses_contributed_to: Array.isArray(t.hypotheses_contributed_to) ? t.hypotheses_contributed_to : [],
    orphaned_objectives: Array.isArray(t.orphaned_objectives) ? t.orphaned_objectives : [],
    completion_rate: Math.min(1, Math.max(0, t.completion_rate ?? 0)),
    switching_frequency: Math.max(0, t.switching_frequency ?? 0),
    todos: Array.isArray(t.todos) ? t.todos : [],
  }));
}
