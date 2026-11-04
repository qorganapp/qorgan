/** Типы ответов API Qorgan (зеркало сущностей qorgan-app-backend). */

export type ScanModule = 'supply_chain' | 'code_audit' | 'secrets' | 'infra';
export const SCAN_MODULES: ScanModule[] = ['supply_chain', 'code_audit', 'secrets', 'infra'];

export type Severity = 'critical' | 'high' | 'medium' | 'low' | 'info';
export const SEVERITIES: Severity[] = ['critical', 'high', 'medium', 'low', 'info'];

export type ScanStatus = 'queued' | 'running' | 'done' | 'failed';
export type ModuleRunStatus = 'done' | 'partial' | 'failed';
export type FindingStatus = 'open' | 'ignored' | 'fixed';

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

export interface Repository {
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
