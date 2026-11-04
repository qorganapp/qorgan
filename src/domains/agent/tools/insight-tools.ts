import { z } from 'zod';
import { AgentTool, defineTool } from '../runtime/agent-tool';

export interface InsightSource {
  latestSummary(): Promise<unknown>;
  findings(filter: {
    module?: string;
    severity?: string;
    status?: string;
  }): Promise<
    {
      id: string;
      module: string;
      severity: string;
      title: string;
      filePath: string | null;
      line: number | null;
      status: string;
      action: string;
      verdict?: {
        verdict: string;
        reachable: string;
        explanation: string;
      } | null;
    }[]
  >;
  activity(): Promise<
    {
      kind: string;
      status: string;
      title: string;
      summary: string;
      createdAt: Date;
    }[]
  >;
  fixPrs(): Promise<
    { title: string; prNumber: number; prUrl: string; status: string }[]
  >;
}

/** Read-only инструменты чата: результаты сканов, вердикты, действия агента. */
export function insightTools(src: InsightSource): AgentTool[] {
  return [
    defineTool({
      name: 'latest_scan_summary',
      description:
        'Summary of the latest finished Full Sweep: counts by module and severity, and the "fix now" list.',
      schema: z.object({}),
      run: async () => JSON.stringify(await src.latestSummary(), null, 1),
    }),
    defineTool({
      name: 'list_findings',
      description:
        'Findings from the latest scan, highest priority first (max 40). Includes your triage verdict when available.',
      schema: z.object({
        module: z
          .enum(['supply_chain', 'code_audit', 'secrets', 'infra'])
          .optional(),
        severity: z
          .enum(['critical', 'high', 'medium', 'low', 'info'])
          .optional(),
        status: z
          .enum(['open', 'ignored', 'fixed'])
          .optional()
          .describe('Default: open'),
      }),
      run: async (filter) => {
        const rows = await src.findings(filter);
        if (!rows.length) return 'No findings match.';
        return rows
          .slice(0, 40)
          .map((f) =>
            [
              `- [${f.severity}] ${f.title} (${f.module}${f.filePath ? `, ${f.filePath}${f.line ? `:${f.line}` : ''}` : ''}) status=${f.status}`,
              `  fix: ${f.action}`,
              f.verdict
                ? `  your verdict: ${f.verdict.verdict}, reachable=${f.verdict.reachable} — ${f.verdict.explanation}`
                : '',
            ]
              .filter(Boolean)
              .join('\n'),
          )
          .join('\n');
      },
    }),
    defineTool({
      name: 'recent_activity',
      description:
        'What you (the agent) did recently: triage runs, fix PRs, reviews.',
      schema: z.object({}),
      run: async () =>
        (await src.activity())
          .slice(0, 25)
          .map(
            (r) =>
              `- ${r.createdAt.toISOString().slice(0, 16)} ${r.kind} (${r.status}): ${r.title} — ${r.summary}`,
          )
          .join('\n') || 'No activity yet.',
    }),
    defineTool({
      name: 'list_fix_prs',
      description: 'Pull requests you opened with fixes, and their status.',
      schema: z.object({}),
      run: async () =>
        (await src.fixPrs())
          .map((p) => `- #${p.prNumber} [${p.status}] ${p.title} ${p.prUrl}`)
          .join('\n') || 'No fix pull requests yet.',
    }),
  ];
}
