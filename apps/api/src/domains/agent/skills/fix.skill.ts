import { z } from 'zod';
import { LlmProvider } from '../llm/llm-provider';
import { FIX_SYSTEM } from '../prompts/fix';
import { defineTool } from '../runtime/agent-tool';
import { runAgent, RunResult, StepRecord } from '../runtime/agent-runtime';
import { Workspace } from '../runtime/workspace';
import { codeReadTools } from '../tools/code-tools';
import { describeFinding, TriageInput } from './triage.skill';

export interface FixTarget extends TriageInput {
  fingerprint: string;
  verdictExplanation?: string;
  fixHint?: string;
}

export interface VerifyResult {
  /** Целевые находки, которые сканер всё ещё видит. */
  stillPresent: string[];
  /** Новые находки модуля, которых не было до изменений. */
  introduced: { title: string; severity: string; filePath: string | null }[];
  error?: string;
}

export const verifyPassed = (v: VerifyResult) =>
  !v.error &&
  v.stillPresent.length === 0 &&
  !v.introduced.some((f) => f.severity === 'critical' || f.severity === 'high');

export interface FixSubmission {
  title: string;
  summary: string;
}

export interface FixOutcome {
  result: RunResult;
  submission: FixSubmission | null;
  abandoned: string | null;
  lastVerify: VerifyResult | null;
}

export async function runFix(opts: {
  provider: LlmProvider;
  workspace: Workspace;
  targets: FixTarget[];
  verify: () => Promise<VerifyResult>;
  updateLockfile: (manifestPath: string) => Promise<string>;
  maxSteps?: number;
  tokenBudget?: number;
  onStep?: (s: StepRecord) => Promise<void> | void;
}): Promise<FixOutcome> {
  const ws = opts.workspace;
  let dirty = false;
  let lastVerify: VerifyResult | null = null;
  let verifiedClean = false;
  let submission: FixSubmission | null = null;
  let abandoned: string | null = null;

  const markDirty = <T>(value: T): T => {
    dirty = true;
    verifiedClean = false;
    return value;
  };

  const tools = [
    ...codeReadTools(ws),
    defineTool({
      name: 'edit_file',
      description:
        'Replace an exact snippet in a file. old_text must occur exactly once; include enough surrounding lines.',
      schema: z.object({
        path: z.string(),
        old_text: z.string().min(1),
        new_text: z.string(),
      }),
      run: async ({ path, old_text, new_text }) =>
        markDirty(await ws.edit(path, old_text, new_text)),
    }),
    defineTool({
      name: 'create_file',
      description: 'Create a new file (fails if it already exists).',
      schema: z.object({ path: z.string(), content: z.string() }),
      run: async ({ path, content }) =>
        markDirty(await ws.create(path, content)),
    }),
    defineTool({
      name: 'update_lockfile',
      description:
        'Regenerate the lockfile next to a package manifest after you changed dependency versions (npm / pnpm). Install scripts are never run.',
      schema: z.object({
        manifest_path: z
          .string()
          .describe('e.g. "package.json" or "web/package.json"'),
      }),
      run: async ({ manifest_path }) => {
        await ws.resolvePath(manifest_path);
        return markDirty(await opts.updateLockfile(manifest_path));
      },
    }),
    defineTool({
      name: 'verify_fix',
      description:
        'Re-run the scanner that reported the issue against your changes. Call after every change.',
      schema: z.object({}),
      run: async () => {
        lastVerify = await opts.verify();
        verifiedClean = verifyPassed(lastVerify);
        dirty = false;
        if (lastVerify.error)
          return `Verification failed to run: ${lastVerify.error}`;
        const lines = [
          verifiedClean ? 'PASSED: the reported issue is gone.' : 'NOT PASSED.',
          lastVerify.stillPresent.length
            ? `Still reported: ${lastVerify.stillPresent.join('; ')}`
            : '',
          lastVerify.introduced.length
            ? `New findings introduced:\n${lastVerify.introduced.map((f) => `- [${f.severity}] ${f.title} (${f.filePath ?? ''})`).join('\n')}`
            : '',
        ];
        return lines.filter(Boolean).join('\n');
      },
    }),
    defineTool({
      name: 'submit_fix',
      description:
        'Finish: open a pull request with your changes. Only allowed after verify_fix passed on the final state.',
      schema: z.object({
        title: z
          .string()
          .min(8)
          .max(90)
          .describe(
            'Pull request title, e.g. "Upgrade lodash to 4.17.21 (CVE-2021-23337)"',
          ),
        summary: z
          .string()
          .min(20)
          .max(3000)
          .describe(
            'Markdown for reviewers: what was wrong, what changed, what to double-check',
          ),
      }),
      run: ({ title, summary }, ctx) => {
        if (dirty || !verifiedClean) {
          return 'Cannot submit yet: run verify_fix on the final changes and make sure it passes.';
        }
        submission = { title, summary };
        ctx.finish();
        return 'Submitted. A pull request will be opened.';
      },
    }),
    defineTool({
      name: 'abandon_fix',
      description:
        'Finish without a pull request when a safe fix is not possible.',
      schema: z.object({ reason: z.string().min(10).max(1000) }),
      run: ({ reason }, ctx) => {
        abandoned = reason;
        ctx.finish();
        return 'Abandoned. No pull request will be opened.';
      },
    }),
  ];

  const task = [
    `Fix ${opts.targets.length === 1 ? 'this security issue' : `these ${opts.targets.length} related security issues`}:`,
    '',
    ...opts.targets.map((t, i) =>
      [
        describeFinding(`F${i + 1}`, t),
        t.verdictExplanation ? `  triage: ${t.verdictExplanation}` : '',
        t.fixHint ? `  suggested fix: ${t.fixHint}` : '',
      ]
        .filter(Boolean)
        .join('\n'),
    ),
  ].join('\n');

  const result = await runAgent({
    provider: opts.provider,
    system: FIX_SYSTEM,
    tools,
    task,
    maxSteps: opts.maxSteps ?? 40,
    tokenBudget: opts.tokenBudget,
    onStep: opts.onStep,
  });
  return { result, submission, abandoned, lastVerify };
}
