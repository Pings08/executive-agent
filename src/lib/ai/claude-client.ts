import Anthropic from '@anthropic-ai/sdk';
import { buildAnalysisPrompt, buildDailySummaryPrompt, buildEODDigestPrompt, buildDailyNotePrompt } from './prompts';

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY!,
});

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
  fn: () => Promise<Anthropic.Message>,
  retries = 3
): Promise<Anthropic.Message> {
  for (let i = 0; i < retries; i++) {
    try {
      return await fn();
    } catch (err: unknown) {
      const status = typeof err === 'object' && err !== null && 'status' in err
        ? (err as { status: number }).status : 0;
      const msg = err instanceof Error ? err.message : '';

      const is429 = status === 429 || msg.includes('429') || msg.includes('rate_limit');
      const is5xx = status === 500 || status === 529 ||
        msg.includes('500') || msg.includes('529') || msg.includes('overloaded');

      if ((is429 || is5xx) && i < retries - 1) {
        // Rate limit: wait 15s per attempt; server errors: exponential from 1.5s
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
  recentContext: { sender: string; content: string; timestamp: string }[]
): Promise<AnalysisResult> {
  const prompt = buildAnalysisPrompt(messageContent, senderName, channelName, objectives, recentContext);

  const response = await callWithRetry(() => anthropic.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 1024,
    messages: [{ role: 'user', content: prompt }],
  }));

  const text = response.content[0].type === 'text' ? response.content[0].text : '';
  const result = parseJSON<AnalysisResult>(text);

  // Validate and provide defaults
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

  const response = await callWithRetry(() => anthropic.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 1024,
    messages: [{ role: 'user', content: prompt }],
  }));

  const text = response.content[0].type === 'text' ? response.content[0].text : '';
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

  const response = await callWithRetry(() => anthropic.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 2048,
    messages: [{ role: 'user', content: prompt }],
  }));

  const text = response.content[0].type === 'text' ? response.content[0].text : '';
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

  const response = await callWithRetry(() => anthropic.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 2048,
    messages: [{ role: 'user', content: prompt }],
  }));

  const text = response.content[0].type === 'text' ? response.content[0].text : '';
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
