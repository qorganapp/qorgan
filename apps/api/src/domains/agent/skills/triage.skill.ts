import { z } from 'zod';
import { Severity } from '../../../common/security.types';
import { LlmProvider } from '../llm/llm-provider';
import { TRIAGE_SYSTEM } from '../prompts/triage';
import { defineTool } from '../runtime/agent-tool';
import { runAgent, RunResult, StepRecord } from '../runtime/agent-runtime';
import { Workspace } from '../runtime/workspace';
import { codeReadTools } from '../tools/code-tools';

export interface TriageInput {
  id: string;
  module: string;
  tool: string;
  ruleId: string;
  severity: Severity;
  title: string;
  description: string;
  filePath: string | null;
  line: number | null;
  data: Record<string, unknown>;
}

export const VerdictSchema = z.object({
  finding: z.string().describe('Finding reference, e.g. "F3"'),
  verdict: z.enum(['true_positive', 'false_positive', 'needs_context']),
  reachable: z.enum(['yes', 'no', 'unknown']),
  severity: z.enum(['critical', 'high', 'medium', 'low', 'info']),
  confidence: z.enum(['high', 'medium', 'low']),
  explanation: z.string().min(10).max(1200),
  exploit_scenario: z.string().max(600).optional(),
  fix_hint: z.string().max(600).optional(),
});
export type VerdictInput = z.infer<typeof VerdictSchema>;

export interface TriageOutcome {
  result: RunResult;
  verdicts: Map<string, VerdictInput>;
}

/** Только то, что нужно модели: без сырых секретов и лишних полей. */
const DATA_KEYS = [
  'package',
  'version',
  'fixedVersion',
  'ecosystem',
  'vulnId',
  'malicious',
  'lookalikeOf',
  'secretType',
  'masked',
  'occurrences',
  'files',
  'firstSeenAt',
  'cwe',
  'owasp',
  'confidence',
  'impact',
  'snippet',
  'resource',
  'framework',
  'publicExposure',
  'tools',
];

export function describeFinding(ref: string, f: TriageInput): string {
  const data = Object.fromEntries(
    Object.entries(f.data).filter(
      ([k, v]) => DATA_KEYS.includes(k) && v !== undefined,
    ),
  );
  return [
    `${ref} [${f.module}] ${f.severity.toUpperCase()} — ${f.title}`,
    `  rule: ${f.ruleId} (${f.tool})`,
    f.filePath ? `  location: ${f.filePath}${f.line ? `:${f.line}` : ''}` : '',
    f.description
      ? `  details: ${f.description.slice(0, 600).replace(/\s+/g, ' ')}`
      : '',
    Object.keys(data).length
      ? `  data: ${JSON.stringify(data).slice(0, 800)}`
      : '',
  ]
    .filter(Boolean)
    .join('\n');
}

export async function runTriage(opts: {
  provider: LlmProvider;
  workspace: Workspace;
  findings: TriageInput[];
  maxSteps?: number;
  tokenBudget?: number;
  onStep?: (s: StepRecord) => Promise<void> | void;
}): Promise<TriageOutcome> {
  // Короткие ссылки F1..Fn вместо uuid — меньше токенов и меньше ошибок модели.
  const refs = new Map(opts.findings.map((f, i) => [`F${i + 1}`, f]));
  const verdicts = new Map<string, VerdictInput>();

  const submit = defineTool({
    name: 'submit_verdict',
    description:
      'Record your verdict for one finding. Call once per finding (you may call it again to correct a verdict).',
    schema: VerdictSchema,
    run: (input, ctx) => {
      const finding = refs.get(input.finding.trim().toUpperCase());
      if (!finding)
        return `Unknown finding "${input.finding}". Valid: ${[...refs.keys()].join(', ')}`;
      verdicts.set(finding.id, input);
      const left = [...refs.entries()]
        .filter(([, f]) => !verdicts.has(f.id))
        .map(([r]) => r);
      if (!left.length) {
        ctx.finish();
        return 'Saved. All findings have verdicts — you are done.';
      }
      return `Saved. Remaining: ${left.join(', ')}`;
    },
  });

  const task = [
    `Triage these ${refs.size} findings. Repository files are available through the tools.`,
    '',
    ...[...refs.entries()].map(([ref, f]) => describeFinding(ref, f)),
  ].join('\n');

  const result = await runAgent({
    provider: opts.provider,
    system: TRIAGE_SYSTEM,
    tools: [...codeReadTools(opts.workspace), submit],
    task,
    maxSteps: opts.maxSteps ?? 40,
    tokenBudget: opts.tokenBudget,
    onStep: opts.onStep,
  });
  return { result, verdicts };
}
