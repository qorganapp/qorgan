import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ScanModule } from '../../common/security.types';
import { FindingsService } from '../findings/findings.service';
import { mergeDuplicates } from '../findings/merge';
import { GithubAppService } from '../github/github-app.service';
import { RepositoriesService } from '../repositories/repositories.service';
import { ADAPTERS } from '../scanner/adapters';
import { parseGitleaks } from '../scanner/adapters/gitleaks.adapter';
import { NormalizedFinding, RAW_SECRET } from '../scanner/adapters/types';
import { cloneRepository, git } from '../scanner/git';
import { runTool } from '../scanner/run-tool';
import { AgentRunKind, AgentRunStatus } from './agent-run.entity';
import { AgentRunsService } from './agent-runs.service';
import { LLM_PROVIDER, LlmProvider } from './llm/llm-provider';
import { ReviewJob } from './queue/agent-jobs';
import { Workspace } from './runtime/workspace';
import { ReviewComment, runReview } from './skills/review.skill';
import { parseAddedLines } from './tools/diff';

const SEVERITY_BADGE: Record<ReviewComment['severity'], string> = {
  critical: '🔴 **Critical**',
  high: '🟠 **High**',
  medium: '🟡 **Medium**',
  low: '🔵 **Low**',
};

interface PullRequest {
  number: number;
  title: string;
  body: string | null;
  draft: boolean;
  user: { login: string };
  head: { sha: string };
}

@Injectable()
export class AgentReviewService {
  private readonly logger = new Logger(AgentReviewService.name);
  private readonly timeoutMs: number;

  constructor(
    @Optional()
    @Inject(LLM_PROVIDER)
    private readonly provider: LlmProvider | null,
    private readonly runs: AgentRunsService,
    private readonly findings: FindingsService,
    private readonly repositories: RepositoriesService,
    private readonly github: GithubAppService,
    config: ConfigService,
  ) {
    this.timeoutMs = Number(config.get('SCAN_TIMEOUT_MS', 15 * 60_000));
  }

  async review(job: ReviewJob): Promise<void> {
    const repo = await this.repositories.findWithInstallation(job.repositoryId);
    if (!this.provider || !repo?.agentPrReview) return;
    const installationId = repo.installation.githubInstallationId;
    const pr = await this.github.asInstallation<PullRequest>(
      installationId,
      `/repos/${repo.fullName}/pulls/${job.prNumber}`,
    );
    // Пока шла очередь, в PR могли запушить ещё — тогда ревьюит более свежая задача.
    if (pr.draft || pr.head.sha !== job.headSha) return;

    const run = await this.runs.start(
      repo.id,
      AgentRunKind.Review,
      `Review of PR #${pr.number}: ${pr.title}`.slice(0, 200),
      {
        prNumber: pr.number,
        prUrl: `https://github.com/${repo.fullName}/pull/${pr.number}`,
        headSha: pr.head.sha,
      },
    );
    const budget = await this.runs.remainingDailyBudget(repo.id);
    if (budget <= 0) {
      await this.runs.finish(run, null, {
        status: AgentRunStatus.Skipped,
        summary: 'Daily token budget exhausted',
      });
      return;
    }

    const root = await mkdtemp(join(tmpdir(), 'qorgan-review-'));
    const workdir = join(root, 'repo');
    const reportDir = join(root, 'reports');
    await mkdir(reportDir);
    try {
      const token = await this.github.installationToken(installationId);
      await cloneRepository({
        fullName: repo.fullName,
        branch: job.baseRef,
        token,
        dir: workdir,
        timeoutMs: this.timeoutMs,
      });
      await git(
        workdir,
        ['fetch', '--quiet', 'origin', `pull/${pr.number}/head`],
        { token, timeoutMs: this.timeoutMs },
      );
      await git(workdir, ['checkout', '--quiet', '--detach', 'FETCH_HEAD']);
      const head = (await git(workdir, ['rev-parse', 'HEAD'])).trim();
      const base = (
        await git(workdir, ['merge-base', `origin/${job.baseRef}`, 'HEAD'])
      ).trim();

      const fullDiff = await git(workdir, [
        'diff',
        '--no-color',
        '--no-ext-diff',
        base,
        'HEAD',
      ]);
      const changedLines = parseAddedLines(fullDiff);
      if (!changedLines.size) {
        await this.runs.finish(run, null, {
          status: AgentRunStatus.Skipped,
          summary: 'Nothing to review (no added lines).',
        });
        return;
      }

      const { findings, secrets } = await this.scanChanges(
        repo.id,
        workdir,
        reportDir,
        base,
        changedLines,
      );
      const outcome = await runReview({
        provider: this.provider,
        workspace: new Workspace(workdir, false, secrets),
        pr: {
          number: pr.number,
          title: pr.title,
          body: pr.body ?? '',
          author: pr.user.login,
        },
        diff: redact(
          fullDiff.length > 60_000
            ? `${fullDiff.slice(0, 60_000)}\n…[diff truncated]`
            : fullDiff,
          secrets,
        ),
        changedLines,
        findings: findings.map((f, i) => ({ ...f, id: `s${i}` })),
        tokenBudget: budget,
        onStep: (step) => this.runs.recordStep(run.id, step),
      });

      if (!outcome.decision) {
        await this.runs.finish(run, outcome.result, {
          model: this.provider.model,
          summary: 'Review did not complete.',
        });
        return;
      }
      if (outcome.decision === 'no_issues') {
        await this.runs.finish(run, outcome.result, {
          model: this.provider.model,
          summary: `No security issues in PR #${pr.number}. ${outcome.summary}`,
        });
        return;
      }

      await this.github.asInstallation(
        installationId,
        `/repos/${repo.fullName}/pulls/${pr.number}/reviews`,
        {
          method: 'POST',
          body: {
            commit_id: head,
            event:
              outcome.decision === 'request_changes'
                ? 'REQUEST_CHANGES'
                : 'COMMENT',
            body: `### Qorgan security review\n\n${outcome.summary}\n\n_Automated review by the Qorgan security agent._`,
            comments: outcome.comments.map((c) => ({
              path: c.path,
              line: c.line,
              side: 'RIGHT',
              body: `${SEVERITY_BADGE[c.severity]} · security\n\n${c.body}`,
            })),
          },
        },
      );
      const worst = outcome.comments.some(
        (c) => c.severity === 'critical' || c.severity === 'high',
      );
      await this.runs.finish(run, outcome.result, {
        model: this.provider.model,
        summary: `${worst ? 'Requested changes on' : 'Commented on'} PR #${pr.number}: ${outcome.comments.length} issue(s). ${outcome.summary}`,
        target: {
          decision: outcome.decision,
          comments: outcome.comments.length,
        },
      });
    } catch (e) {
      this.logger.error(
        `Review failed for ${repo.fullName}#${job.prNumber}: ${(e as Error).message}`,
      );
      await this.runs.finish(run, null, {
        status: AgentRunStatus.Failed,
        summary: (e as Error).message,
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }

  /** Только новые для репозитория находки на изменённых строках + секреты в коммитах PR. */
  private async scanChanges(
    repositoryId: string,
    workdir: string,
    reportDir: string,
    base: string,
    changed: Map<string, Set<number>>,
  ): Promise<{ findings: NormalizedFinding[]; secrets: string[] }> {
    const ctx = { workdir, reportDir, timeoutMs: this.timeoutMs };
    const modules = [
      ScanModule.CodeAudit,
      ScanModule.Infra,
      ScanModule.SupplyChain,
    ];
    const settled = await Promise.allSettled(
      modules.flatMap((m) => ADAPTERS[m].map((a) => a.run(ctx))),
    );
    const scanned = mergeDuplicates(
      settled.flatMap((r) => (r.status === 'fulfilled' ? r.value : [])),
    );

    const known = new Set<string>();
    for (const m of modules)
      for (const fp of await this.findings.knownFingerprints(repositoryId, m))
        known.add(fp);

    const onChangedLines = scanned.filter((f) => {
      if (!f.filePath || !changed.has(f.filePath) || known.has(f.fingerprint))
        return false;
      return f.line === null || changed.get(f.filePath)!.has(f.line);
    });

    // Секреты — только в коммитах этого PR, а не во всей истории.
    let secretFindings: NormalizedFinding[] = [];
    const secrets: string[] = [];
    try {
      const report = join(reportDir, 'gitleaks-pr.json');
      await runTool(
        'gitleaks',
        [
          'git',
          '--log-opts',
          `${base}..HEAD`,
          '--report-format',
          'json',
          '--report-path',
          report,
          '--exit-code',
          '0',
          '--no-banner',
          '--log-level',
          'error',
          workdir,
        ],
        { timeoutMs: this.timeoutMs },
      );
      const parsed = parseGitleaks(workdir, await readFile(report, 'utf8'));
      for (const f of parsed) {
        if (f[RAW_SECRET]) secrets.push(f[RAW_SECRET]);
        delete f[RAW_SECRET];
      }
      secretFindings = parsed;
    } catch (e) {
      this.logger.warn(`gitleaks on PR failed: ${(e as Error).message}`);
    }
    return {
      findings: [...secretFindings, ...onChangedLines].slice(0, 40),
      secrets,
    };
  }
}

function redact(text: string, secrets: string[]): string {
  return secrets.reduce(
    (t, s) => (s.length >= 6 ? t.split(s).join('[REDACTED SECRET]') : t),
    text,
  );
}
