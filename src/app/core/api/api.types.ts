/** Типы ответов API Qorgan (зеркало сущностей qorgan-app-backend). */

export type ScanModule = 'supply_chain' | 'code_audit' | 'secrets' | 'infra';
export const SCAN_MODULES: ScanModule[] = ['supply_chain', 'code_audit', 'secrets', 'infra'];

export type Severity = 'critical' | 'high' | 'medium' | 'low' | 'info';
export const SEVERITIES: Severity[] = ['critical', 'high', 'medium', 'low', 'info'];

export type ScanStatus = 'queued' | 'running' | 'done' | 'failed';
export type ModuleRunStatus = 'done' | 'partial' | 'failed';
export type FindingStatus = 'open' | 'ignored' | 'fixed';
export type TriageStatus = 'pending' | 'running' | 'done' | 'skipped' | 'failed';

export interface AgentVerdict {
  verdict: 'true_positive' | 'false_positive' | 'needs_context';
  reachable: 'yes' | 'no' | 'unknown';
  severity: Severity;
  confidence: 'high' | 'medium' | 'low';
  explanation: string;
  exploitScenario?: string;
  fixHint?: string;
  runId: string;
  at: string;
}

export interface Me {
  id: string;
  username: string;
  createdAt: string;
}

export interface GithubInstallation {
  id: string;
  githubInstallationId: string;
  accountLogin: string;
  createdAt: string;
}

export interface AgentSettings {
  agentTriage: boolean;
  agentAutoFix: boolean;
  agentPrReview: boolean;
  maxOpenAgentPrs: number;
}

export interface Repository extends AgentSettings {
  id: string;
  githubRepoId: string;
  fullName: string;
  defaultBranch: string;
  private: boolean;
  installationId: string;
  createdAt: string;
}

export interface ToolRunInfo {
  tool: string;
  ok: boolean;
  version?: string;
  findings: number;
  durationMs: number;
  error?: string;
}

export interface ModuleRun {
  id: string;
  scanId: string;
  module: ScanModule;
  status: ModuleRunStatus;
  tools: ToolRunInfo[];
  durationMs: number;
}

export interface Scan {
  id: string;
  repositoryId: string;
  branch: string;
  commitSha: string | null;
  modules: ScanModule[];
  status: ScanStatus;
  trigger: 'manual' | 'push';
  error: string | null;
  /** Этап разбора находок агентом; null — агент не настроен. */
  triageStatus?: TriageStatus | null;
  startedAt: string | null;
  finishedAt: string | null;
  createdAt: string;
  moduleRuns?: ModuleRun[];
}

export interface Finding {
  id: string;
  module: ScanModule;
  tool: string;
  ruleId: string;
  severity: Severity;
  title: string;
  description: string;
  filePath: string | null;
  line: number | null;
  data: Record<string, unknown>;
  action: string;
  status: FindingStatus;
  priorityScore: number;
  agentVerdict?: AgentVerdict | null;
  statusReason?: string | null;
}

export interface Page<T> {
  items: T[];
  total: number;
  limit: number;
  offset: number;
}

export interface FixNowItem {
  module: ScanModule;
  moduleTitle: string;
  severity: Severity;
  title: string;
  action: string;
  filePath: string | null;
  score: number;
  findingIds: string[];
  agentVerified?: boolean;
  agentNote?: string | null;
  fix?: { prNumber: number; prUrl: string; status: AgentFixStatus } | null;
}

export interface ScanSummary {
  scanId: string;
  status: ScanStatus;
  commitSha: string | null;
  totals: { open: number; fixedSinceLastScan: number };
  bySeverity: Record<Severity, number>;
  byModule: Partial<Record<ScanModule, number>>;
  modules: ModuleRun[];
  fixNow: FixNowItem[];
  triageStatus?: TriageStatus | null;
}

export type AgentRunKind = 'triage' | 'fix' | 'review' | 'chat';
export type AgentRunStatus =
  'running' | 'done' | 'failed' | 'refused' | 'budget_exceeded' | 'max_steps' | 'skipped';
export type AgentFixStatus = 'open' | 'merged' | 'closed';

export interface AgentStatus {
  enabled: boolean;
  provider: string | null;
  model: string | null;
}

export interface AgentRun {
  id: string;
  repositoryId: string;
  kind: AgentRunKind;
  status: AgentRunStatus;
  title: string;
  summary: string;
  target: Record<string, unknown>;
  model: string;
  inputTokens: number;
  outputTokens: number;
  steps: number;
  error: string | null;
  createdAt: string;
  finishedAt: string | null;
}

export interface AgentStep {
  id: string;
  index: number;
  text: string;
  toolCalls: { name: string; input: unknown; result: string; isError: boolean }[];
}

export interface AgentRunDetails extends AgentRun {
  stepLog: AgentStep[];
}

export interface AgentFix {
  id: string;
  module: ScanModule;
  findingIds: string[];
  title: string;
  branch: string;
  prNumber: number;
  prUrl: string;
  status: AgentFixStatus;
  createdAt: string;
}

export interface AgentMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  status: 'pending' | 'done' | 'failed';
  createdAt: string;
}

export interface AgentConversation {
  id: string;
  repositoryId: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  messages?: AgentMessage[];
}

export interface FindingsQuery {
  module?: ScanModule;
  severity?: Severity;
  status?: FindingStatus;
  limit?: number;
  offset?: number;
}

/** Сообщение об ошибке из ответа NestJS ({ message: string | string[] }). */
export function apiErrorMessage(error: unknown, fallback = 'Something went wrong'): string {
  const body = (error as { error?: { message?: string | string[] } })?.error;
  const message = body?.message;
  if (Array.isArray(message)) return message.join('. ');
  return message || fallback;
}
