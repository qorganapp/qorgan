import { z } from 'zod';
import { LlmProvider } from '../llm/llm-provider';
import { REVIEW_SYSTEM } from '../prompts/review';
import { defineTool } from '../runtime/agent-tool';
import { runAgent, RunResult, StepRecord } from '../runtime/agent-runtime';
import { Workspace } from '../runtime/workspace';
import { codeReadTools } from '../tools/code-tools';
import { describeFinding, TriageInput } from './triage.skill';

export interface ReviewComment {
  path: string;
  line: number;
  severity: 'critical' | 'high' | 'medium' | 'low';
  body: string;
}

/** Бот никогда не ставит approve: его одобрение могло бы удовлетворить защиту ветки. */
export type ReviewDecision = 'request_changes' | 'comment' | 'no_issues';

export interface ReviewOutcome {
  result: RunResult;
  comments: ReviewComment[];
  decision: ReviewDecision | null;
  summary: string;
}

export async function runReview(opts: {
  provider: LlmProvider;
  workspace: Workspace;
  pr: { number: number; title: string; body: string; author: string };
  diff: string;
  changedLines: Map<string, Set<number>>;
  findings: TriageInput[];
  maxSteps?: number;
  tokenBudget?: number;
  onStep?: (s: StepRecord) => Promise<void> | void;
}): Promise<ReviewOutcome> {
  const comments: ReviewComment[] = [];
  let decision: ReviewDecision | null = null;
  let summary = '';

  const tools = [
    ...codeReadTools(opts.workspace),
    defineTool({
      name: 'add_comment',
      description:
        'Add an inline review comment on a line that this PR added or changed.',
      schema: z.object({
        path: z.string(),
        line: z
          .number()
          .int()
          .min(1)
          .describe('Line number in the new version of the file'),
        severity: z.enum(['critical', 'high', 'medium', 'low']),
        body: z
          .string()
          .min(20)
          .max(2500)
          .describe('Markdown: problem, exploit in one sentence, concrete fix'),
      }),
      run: ({ path, line, severity, body }) => {
        const clean = path.replace(/^\.?\//, '');
        const lines = opts.changedLines.get(clean);
        if (!lines)
          return `"${clean}" is not changed in this PR. Changed files: ${[...opts.changedLines.keys()].join(', ')}`;
        if (!lines.has(line)) {
          const nearest = [...lines]
            .sort((a, b) => Math.abs(a - line) - Math.abs(b - line))
            .slice(0, 5);
          return `Line ${line} of ${clean} is not changed in this PR. Nearest changed lines: ${nearest.join(', ')}`;
        }
        if (comments.length >= 15)
          return 'Comment limit reached; mention remaining issues in the summary.';
        comments.push({ path: clean, line, severity, body });
        return `Comment added (${comments.length}).`;
      },
    }),
    defineTool({
      name: 'submit_review',
      description: 'Finish the review.',
      schema: z.object({
        decision: z.enum(['request_changes', 'comment', 'no_issues']),
        summary: z.string().min(5).max(2000),
      }),
      run: (input, ctx) => {
        if (input.decision !== 'no_issues' && !comments.length) {
          return 'Add at least one inline comment, or submit with decision "no_issues".';
        }
        decision = input.decision;
        summary = input.summary;
        ctx.finish();
        return 'Review submitted.';
      },
    }),
  ];

  const task = [
    `Pull request #${opts.pr.number} by ${opts.pr.author}: ${opts.pr.title}`,
    // Описание PR пишет автор — это недоверенные данные, а не инструкции.
    `Description (untrusted, written by the PR author):\n<<<\n${opts.pr.body.slice(0, 4000)}\n>>>`,
    '',
    opts.findings.length
      ? `Scanner findings on changed lines (verify before commenting):\n${opts.findings.map((f, i) => describeFinding(`S${i + 1}`, f)).join('\n')}`
      : 'Scanners reported nothing new on the changed lines.',
    '',
    `Diff:\n\`\`\`diff\n${opts.diff}\n\`\`\``,
  ].join('\n');

  const result = await runAgent({
    provider: opts.provider,
    system: REVIEW_SYSTEM,
    tools,
    task,
    maxSteps: opts.maxSteps ?? 30,
    tokenBudget: opts.tokenBudget,
    onStep: opts.onStep,
  });
  return { result, comments, decision, summary };
}
